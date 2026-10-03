"""Cloud metadata must never become defaults or destructive writes."""
from __future__ import annotations

import asyncio
from concurrent.futures import Future

import pytest

from backend.utils import metadata_io
from backend.utils.safe_io import safe_write_text


@pytest.fixture(autouse=True)
def reset_download_state():
    metadata_io._pending.clear()
    metadata_io._failed.clear()
    yield
    metadata_io._pending.clear()
    metadata_io._failed.clear()


def test_local_and_non_metadata_reads_do_not_download(tmp_path, monkeypatch):
    path = tmp_path / '.gnosi' / 'skills' / 'skill.yaml'
    path.parent.mkdir(parents=True)
    path.write_text('id: retained')
    monkeypatch.setattr(metadata_io, '_download', lambda path: pytest.fail('local download'))
    assert metadata_io.read_metadata_text(path) == 'id: retained'
    outside = tmp_path / 'ordinary'
    outside.write_text('content')
    monkeypatch.setattr(metadata_io, 'is_cloud_placeholder', lambda *_: True)
    assert metadata_io.read_metadata_text(outside) == 'content'


def test_failed_download_preserves_existing_content_and_cooldown(tmp_path, monkeypatch):
    path = tmp_path / '.gnosi' / 'favorites.json'
    path.parent.mkdir()
    path.write_text('original')
    monkeypatch.setattr(metadata_io, 'is_cloud_placeholder', lambda *_: True)
    calls = []
    def download(path):
        calls.append(path)
        return False
    monkeypatch.setattr(metadata_io, '_download', download)
    with pytest.raises(metadata_io.MetadataUnavailable):
        safe_write_text(path, 'defaults')
    with pytest.raises(metadata_io.MetadataUnavailable):
        metadata_io.read_metadata_text(path)
    assert calls == [path]
    assert path.read_text() == 'original'
    assert list(path.parent.iterdir()) == [path]


def test_successful_hydration_reads_original_and_preserves_sparse_local_files(tmp_path, monkeypatch):
    path = tmp_path / '.gnosi' / 'wiki.json'
    path.parent.mkdir()
    path.write_text('original')
    placeholder = [True]
    monkeypatch.setattr(metadata_io, 'is_cloud_placeholder', lambda *_: placeholder[0])
    def download(path):
        placeholder[0] = False
        return True
    monkeypatch.setattr(metadata_io, '_download', download)
    assert metadata_io.read_metadata_text(path) == 'original'


def test_async_reader_does_not_block_or_duplicate_download(tmp_path, monkeypatch):
    path = tmp_path / '.gnosi' / 'skill.yaml'
    path.parent.mkdir()
    path.write_text('original')
    monkeypatch.setattr(metadata_io, 'is_cloud_placeholder', lambda *_: True)
    job = Future()
    class Pool:
        calls = 0
        def submit(self, *args):
            self.calls += 1
            return job
    pool = Pool()
    monkeypatch.setattr(metadata_io, '_pool', pool)
    async def read():
        for _ in range(2):
            with pytest.raises(metadata_io.MetadataUnavailable, match='pending'):
                metadata_io.read_metadata_text(path)
        await asyncio.sleep(0)
        assert pool.calls == 1
    asyncio.run(read())
    job.set_result(False)


def test_cloud_symlink_parent_is_never_downloaded(tmp_path, monkeypatch):
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'skill.yaml').write_text('secret')
    (tmp_path / '.gnosi').symlink_to(outside, target_is_directory=True)
    monkeypatch.setattr(metadata_io, 'is_cloud_placeholder', lambda *_: True)
    monkeypatch.setattr(metadata_io, '_download', lambda path: pytest.fail('escaped root'))
    with pytest.raises(metadata_io.MetadataUnavailable, match='safely'):
        metadata_io.read_metadata_text(tmp_path / '.gnosi' / 'skill.yaml')


def test_warmup_covers_all_metadata_without_following_links(tmp_path, monkeypatch):
    from backend.services import vault_warmup
    root = tmp_path / '.gnosi'
    expected = []
    for relative in ['agent/skills/a/skill.yaml', 'plugins/p/manifest.json', 'wiki/source.json', 'favorites.json']:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('original')
        expected.append(path)
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'secret').write_text('secret')
    (root / 'escape').symlink_to(outside, target_is_directory=True)
    monkeypatch.setattr(vault_warmup, 'is_cloud_placeholder', lambda *_: True)
    monkeypatch.setattr(vault_warmup, '_critical_warmup_enabled', lambda _: False)
    observed = []
    monkeypatch.setattr(vault_warmup, 'ensure_metadata_local', observed.append)
    asyncio.run(vault_warmup._warm_critical(str(tmp_path)))
    assert set(observed) == set(expected)


def test_download_queue_is_bounded_and_health_remains_available(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.app.errors import register_error_handlers
    monkeypatch.setattr(metadata_io, 'is_cloud_placeholder', lambda *_: True)
    jobs = []
    class Pool:
        def submit(self, *args):
            job = Future()
            jobs.append(job)
            return job
    monkeypatch.setattr(metadata_io, '_pool', Pool())
    paths = []
    for name in ['skill.yaml', 'favorites.json', 'plugins.json']:
        path = tmp_path / '.gnosi' / name
        path.parent.mkdir(exist_ok=True)
        path.write_text('original')
        paths.append(path)
    app = FastAPI()
    register_error_handlers(app)
    @app.get('/metadata')
    async def read():
        for path in paths:
            try:
                metadata_io.read_metadata_text(path)
            except metadata_io.MetadataUnavailable:
                if path == paths[-1]:
                    raise
        return {}
    @app.get('/health')
    async def health():
        return {'status': 'ok'}
    with TestClient(app) as client:
        response = client.get('/metadata', headers={'Accept-Language': 'ca-ES,es;q=0.9'})
        assert response.status_code == 503
        assert response.json()['code'] == 'metadata_unavailable'
        assert 'núvol' in response.json()['detail']
        assert str(tmp_path) not in response.text
        assert response.headers['Retry-After'] == '30'
        assert client.get('/health').json() == {'status': 'ok'}
        assert len(jobs) == 2
    for job in jobs:
        job.set_result(False)


def test_missing_skill_file_download_is_not_reported_as_deleted(tmp_path, monkeypatch):
    from backend.services.user_skill_store import UserSkillStore
    package = tmp_path / '.gnosi' / 'agent' / 'skills' / 'user.cloud'
    package.mkdir(parents=True)
    (package / 'skill.yaml').write_text('remote descriptor')
    (package / 'SKILL.md').write_text('remote instructions')
    monkeypatch.setattr(metadata_io, 'is_cloud_placeholder', lambda *_: True)
    monkeypatch.setattr(metadata_io, '_download', lambda _: False)
    with pytest.raises(metadata_io.MetadataUnavailable):
        UserSkillStore(tmp_path).load_all()
    assert (package / 'skill.yaml').read_text() == 'remote descriptor'
