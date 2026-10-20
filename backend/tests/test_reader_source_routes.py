"""Reader API operations retain subscriptions independently of the SQL cache."""
import asyncio
from io import BytesIO
import json

from fastapi import HTTPException, UploadFile
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.domains.reader import routes, source_registry
from backend.models.reader import Article, FeedSource, FeedSourceCreate
from backend.services.context_vars import active_vault_path


@pytest.fixture
def reader(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    token = active_vault_path.set(vault)
    monkeypatch.setattr(source_registry, "_lock_directory", lambda: tmp_path / "locks")
    engine = create_engine(f"sqlite:///{tmp_path}/reader.db")
    FeedSource.__table__.create(engine)
    Article.__table__.create(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        yield vault, db, sessions
    active_vault_path.reset(token)
    engine.dispose()


def test_create_reload_delete_and_no_resurrection(reader):
    vault, db, sessions = reader
    created = routes.create_source(FeedSourceCreate(name="News", url="https://example.test/rss"), db)
    assert json.loads((vault / ".gnosi/reader_sources.json").read_text())["sources"][0]["name"] == "News"
    source_id = created.id
    with sessions() as restarted:
        assert routes.get_sources(restarted)[0].id == source_id
        routes.delete_source(source_id, restarted)
    assert routes.get_sources(db) == []
    assert json.loads((vault / ".gnosi/reader_sources.json").read_text())["sources"] == []


def test_opml_duplicates_and_folder_survive_empty_database(reader):
    vault, db, _sessions = reader
    content = b'''<opml><body><outline text="Science">
      <outline text="Example" xmlUrl="https://example.test/rss"/>
      <outline text="Example again" xmlUrl="https://example.test/rss"/>
    </outline></body></opml>'''
    upload = UploadFile(file=BytesIO(content), filename="feeds.opml")
    result = asyncio.run(routes.upload_opml(upload, db))
    assert result["message"] == "Successfully imported 1 new feeds."
    db.query(FeedSource).delete()
    db.commit()
    restored = routes.get_sources(db)
    assert [(row.name, row.category) for row in restored] == [("Example", "Science")]


def test_corrupt_registry_returns_retryable_error_and_preserves_database(reader):
    vault, db, _sessions = reader
    routes.create_source(FeedSourceCreate(name="News", url="https://example.test/rss"), db)
    path = vault / ".gnosi/reader_sources.json"
    path.write_text("{broken")
    for operation in (
        lambda: routes.get_sources(db),
        lambda: routes.create_source(FeedSourceCreate(name="Other", url="https://other.test/rss"), db),
        lambda: routes.delete_source(db.query(FeedSource).one().id, db),
    ):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 503
        assert db.query(FeedSource).count() == 1
        assert path.read_text() == "{broken"


def test_newsletter_alias_is_canonical_and_deduplicated(reader):
    vault, db, _sessions = reader
    created = routes.create_source(FeedSourceCreate(
        name='Alias', url='newsletter://Ada+News@example.test'), db)
    assert (created.url, created.type) == ('mailto:Ada+News@example.test', 'newsletter')
    with pytest.raises(HTTPException) as error:
        routes.create_source(FeedSourceCreate(name='Duplicate', url=created.url), db)
    assert error.value.status_code == 400
    saved = json.loads((vault / '.gnosi/reader_sources.json').read_text())['sources']
    assert len(saved) == 1
    assert saved[0]['url'] == created.url
    assert saved[0]['type'] == 'newsletter'


@pytest.mark.parametrize('mailbox', [
    'user:secret@example.test', 'user%3Asecret@example.test',
    'user@example.test/path', 'user@example.test?password=secret',
    'user@example.test#secret', 'user@@example.test', 'user example@test',
    'user@example.test\\secret', 'user@example.test\n', '',
    'us\x00er@example.test', 'us\x07er@example.test', 'us\x1ber@example.test',
    'us\x7fer@example.test', 'us\x9fer@example.test',
])
def test_newsletter_alias_rejects_secrets_and_ambiguous_input(reader, mailbox):
    vault, db, _sessions = reader
    with pytest.raises(HTTPException) as error:
        routes.create_source(FeedSourceCreate(name='Invalid', url='newsletter://' + mailbox), db)
    assert error.value.status_code == 422
    assert db.query(FeedSource).count() == 0
    assert not (vault / '.gnosi/reader_sources.json').exists()


def test_opml_alias_and_mailto_share_one_source(reader):
    _vault, db, _sessions = reader
    content = b'''<opml><body>
      <outline text="Alias" xmlUrl="newsletter://ada@example.test"/>
      <outline text="Canonical" xmlUrl="mailto:ada@example.test"/>
    </body></opml>'''
    result = asyncio.run(routes.upload_opml(
        UploadFile(file=BytesIO(content), filename='news.opml'), db))
    assert result['message'] == 'Successfully imported 1 new feeds.'
    row = db.query(FeedSource).one()
    assert (row.url, row.type) == ('mailto:ada@example.test', 'newsletter')
