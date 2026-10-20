"""Synthetic vault tests for portable reader subscriptions."""
import json
import shutil
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.data.db import Base
from backend.models.reader import Article, FeedSource
from backend.domains.reader import source_registry as registry


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(registry, '_lock_directory', lambda: tmp_path / 'locks')
    engine = create_engine(f'sqlite:///{tmp_path}/projection.db')
    Base.metadata.create_all(engine, tables=[FeedSource.__table__, Article.__table__])
    sessions = sessionmaker(bind=engine)
    vault = tmp_path / 'vault'
    vault.mkdir()
    yield vault, sessions
    engine.dispose()


def add(db, url='https://example.test/feed', kind='rss'):
    row = FeedSource(name='Example', url=url, type=kind, category='News',
                     created_at=datetime(2024, 1, 2, tzinfo=timezone.utc))
    db.add(row)
    return row


def file(vault):
    return vault / '.gnosi' / 'reader_sources.json'


def test_legacy_all_types_and_unchanged_read(setup):
    vault, sessions = setup
    with sessions() as db:
        add(db)
        add(db, 'newsletter:example', 'newsletter')
        db.commit()
        with registry.source_transaction(db, vault):
            assert db.query(FeedSource).count() == 2
        before = file(vault).stat().st_mtime_ns
        with registry.source_transaction(db, vault):
            pass
        assert file(vault).stat().st_mtime_ns == before
        assert {x['type'] for x in json.loads(file(vault).read_text())['sources']} == {'rss', 'newsletter'}


def test_copy_and_restore_empty_database(setup, tmp_path, monkeypatch):
    vault, sessions = setup
    with sessions() as db:
        with registry.source_transaction(db, vault, write=True):
            add(db)
        copied = tmp_path / 'copied'
        shutil.copytree(vault, copied)
        fresh_engine = create_engine(f'sqlite:///{tmp_path}/fresh.db')
        Base.metadata.create_all(fresh_engine, tables=[FeedSource.__table__, Article.__table__])
        with sessionmaker(bind=fresh_engine)() as restored:
            with registry.source_transaction(restored, copied):
                assert restored.query(FeedSource).one().created_at.year == 2024
        fresh_engine.dispose()


def test_alias_import_recovers_canonical_mailbox_and_preserves_articles(setup):
    vault, sessions = setup
    with sessions() as db:
        row = add(db, 'newsletter://ada@example.test', 'newsletter')
        db.flush()
        pk = row.id
        db.add(Article(source_id=pk, url='https://example.test/article', title='Existing'))
        db.commit()
        with registry.source_transaction(db, vault):
            restored = db.query(FeedSource).one()
            assert (restored.id, restored.url, restored.type) == (pk, 'mailto:ada@example.test', 'newsletter')
            assert db.query(Article).one().source_id == pk
        saved = json.loads(file(vault).read_text())['sources']
        assert saved[0]['url'] == 'mailto:ada@example.test'


def test_imported_registry_alias_normalizes_without_modifying_readonly_file(setup):
    vault, sessions = setup
    file(vault).parent.mkdir()
    original = json.dumps({'version': 1, 'sources': [{
        'name': 'Imported', 'url': 'newsletter://ada@example.test',
        'category': 'News', 'type': 'newsletter', 'created_at': '2024-01-02T00:00:00Z',
    }]})
    file(vault).write_text(original)
    with sessions() as db:
        with registry.source_transaction(db, vault):
            assert db.query(FeedSource).one().url == 'mailto:ada@example.test'
        assert file(vault).read_text() == original
        with registry.source_transaction(db, vault, write=True):
            pass
        assert json.loads(file(vault).read_text())['sources'][0]['url'] == 'mailto:ada@example.test'


def test_alias_collision_in_registry_remains_invalid(setup):
    vault, sessions = setup
    item = {'name': 'Duplicate', 'url': 'newsletter://ada@example.test',
            'category': None, 'type': 'newsletter', 'created_at': '2024-01-02T00:00:00Z'}
    file(vault).parent.mkdir()
    file(vault).write_text(json.dumps({'version': 1, 'sources': [item, {**item, 'url': 'mailto:ada@example.test'}]}))
    before = file(vault).read_bytes()
    with sessions() as db, pytest.raises(registry.SourceRegistryError, match='Duplicate'):
        with registry.source_transaction(db, vault):
            pass
    assert file(vault).read_bytes() == before


def test_last_delete_tombstone_and_stale_database(setup):
    vault, sessions = setup
    with sessions() as db:
        with registry.source_transaction(db, vault, write=True):
            add(db)
        with registry.source_transaction(db, vault, write=True):
            db.delete(db.query(FeedSource).one())
        add(db)
        db.commit()
        with registry.source_transaction(db, vault):
            assert db.query(FeedSource).count() == 0
        assert json.loads(file(vault).read_text())['sources'] == []


def test_preserves_pk_articles_and_vault_isolation(setup, tmp_path):
    vault, sessions = setup
    with sessions() as db:
        with registry.source_transaction(db, vault, write=True):
            row = add(db)
        pk = row.id
        db.add(Article(source_id=pk, url='https://example.test/article', title='Article'))
        db.commit()
        with registry.source_transaction(db, vault):
            assert db.query(FeedSource).one().id == pk
            assert db.query(Article).count() == 1
        other = tmp_path / 'other'
        other.mkdir()
        with registry.source_transaction(db, other, write=True):
            db.delete(db.query(FeedSource).one())
        assert json.loads(file(vault).read_text())['sources']
        assert db.query(Article).count() == 0


@pytest.mark.parametrize('content', ['broken', '{"version": 2, "sources": []}',
    '{"version": 1, "sources": [{"name": "missing fields"}]}'])
def test_invalid_no_changes(setup, content):
    vault, sessions = setup
    file(vault).parent.mkdir()
    file(vault).write_text(content)
    with sessions() as db:
        add(db)
        db.commit()
        with pytest.raises(registry.SourceRegistryError):
            with registry.source_transaction(db, vault):
                pytest.fail('must not yield')
        assert db.query(FeedSource).count() == 1
        assert file(vault).read_text() == content


def test_atomic_failure_rolls_back(setup, monkeypatch):
    vault, sessions = setup
    with sessions() as db:
        with registry.source_transaction(db, vault):
            pass
        before = file(vault).read_bytes()
        def fail(*args, **kwargs):
            raise OSError('synthetic write failure')
        monkeypatch.setattr(registry, 'safe_write_json', fail)
        with pytest.raises(registry.SourceRegistryError):
            with registry.source_transaction(db, vault, write=True):
                add(db)
        assert db.query(FeedSource).count() == 0
        assert file(vault).read_bytes() == before


def test_commit_failure_recovers_from_file(setup, monkeypatch):
    vault, sessions = setup
    with sessions() as db:
        with registry.source_transaction(db, vault):
            pass
        original = db.commit
        def fail():
            raise RuntimeError('synthetic commit failure')
        monkeypatch.setattr(db, 'commit', fail)
        with pytest.raises(RuntimeError):
            with registry.source_transaction(db, vault, write=True):
                add(db)
        monkeypatch.setattr(db, 'commit', original)
        assert db.query(FeedSource).count() == 0
        with registry.source_transaction(db, vault):
            assert db.query(FeedSource).count() == 1


def test_stale_sessions_keep_other_additions_and_deletions(setup):
    vault, sessions = setup
    with sessions() as first, sessions() as stale:
        with registry.source_transaction(first, vault, write=True):
            add(first)
        old = stale.query(FeedSource).one()
        with registry.source_transaction(first, vault, write=True):
            first.delete(first.query(FeedSource).one())
            add(first, 'https://second.test/feed')
        with registry.source_transaction(stale, vault, write=True):
            add(stale, 'https://third.test/feed')
        urls = {x['url'] for x in json.loads(file(vault).read_text())['sources']}
        assert urls == {'https://second.test/feed', 'https://third.test/feed'}


def test_symlink_rejected(setup, tmp_path):
    vault, sessions = setup
    external = tmp_path / 'external'
    external.mkdir()
    (vault / '.gnosi').symlink_to(external)
    with sessions() as db, pytest.raises(registry.SourceRegistryError):
        with registry.source_transaction(db, vault):
            pass
    assert not (external / 'reader_sources.json').exists()


def test_concurrent_stale_writers_are_serialized(setup):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    vault, sessions = setup
    with sessions() as db:
        with registry.source_transaction(db, vault, write=True):
            add(db)
    ready = Barrier(2)
    def writer(number):
        with sessions() as db:
            db.query(FeedSource).all()  # Both sessions start with the same projection.
            ready.wait(timeout=5)
            with registry.source_transaction(db, vault, write=True):
                add(db, f'https://writer-{number}.test/feed')
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(writer, (1, 2)))
    assert len(json.loads(file(vault).read_text())['sources']) == 3


def test_unavailable_cloud_metadata_fails_closed(setup, monkeypatch):
    vault, sessions = setup
    def unavailable(*args, **kwargs):
        raise registry.MetadataUnavailable('Synthetic cloud placeholder')
    monkeypatch.setattr(registry, 'read_metadata_text', unavailable)
    with sessions() as db:
        add(db)
        db.commit()
        with pytest.raises(registry.SourceRegistryError):
            with registry.source_transaction(db, vault):
                pass
        assert db.query(FeedSource).count() == 1
        assert not file(vault).exists()


def test_data_directory_changes_do_not_split_the_local_lock(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, local
    from backend.config import data_dir

    current = local()
    monkeypatch.setattr(data_dir, 'resolve_data_dir', lambda: current.directory)
    # Keep the real platform lock-root selection while isolating its directory.
    calls = []
    def platform_root(**kwargs):
        calls.append(kwargs)
        return tmp_path / 'device-data'
    monkeypatch.setattr(registry, 'default_data_dir', platform_root)
    vault = tmp_path / 'shared-vault'
    vault.mkdir()
    engines = [create_engine(f'sqlite:///{tmp_path}/instance-{number}.db') for number in (1, 2)]
    for engine in engines:
        Base.metadata.create_all(engine, tables=[FeedSource.__table__, Article.__table__])
    ready = Barrier(2)
    def writer(number):
        current.directory = tmp_path / f'instance-{number}-data'
        with sessionmaker(bind=engines[number])() as db:
            ready.wait(timeout=5)
            with registry.source_transaction(db, vault, write=True):
                add(db, f'https://instance-{number}.test/rss')
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(writer, (0, 1)))
        assert {row['url'] for row in json.loads(file(vault).read_text())['sources']} == {
            'https://instance-0.test/rss', 'https://instance-1.test/rss'
        }
        assert calls and all(call == {'environ': {}, 'docker': False} for call in calls)
    finally:
        for engine in engines:
            engine.dispose()


def test_stale_database_cannot_overwrite_vault_creation_date(setup, tmp_path):
    vault, sessions = setup
    with sessions() as first:
        with registry.source_transaction(first, vault, write=True):
            add(first)
    engine = create_engine(f'sqlite:///{tmp_path}/stale.db')
    Base.metadata.create_all(engine, tables=[FeedSource.__table__, Article.__table__])
    try:
        with sessionmaker(bind=engine)() as stale:
            row = add(stale)
            row.created_at = datetime(2025, 1, 2, tzinfo=timezone.utc)
            stale.commit()
            source_id = row.id
            with registry.source_transaction(stale, vault, write=True):
                add(stale, 'https://unrelated.test/feed')
            assert stale.get(FeedSource, source_id).created_at.year == 2024
        payload = json.loads(file(vault).read_text())
        original = next(item for item in payload['sources'] if item['url'] == 'https://example.test/feed')
        assert original['created_at'] == '2024-01-02T00:00:00+00:00'
    finally:
        engine.dispose()
