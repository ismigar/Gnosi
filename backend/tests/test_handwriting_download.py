from pathlib import Path
from types import SimpleNamespace
import asyncio

import pytest

from backend.services import handwriting_download as downloads

MODEL = 'qa/model'
REVISION = 'a' * 40


@pytest.fixture(autouse=True)
def private_states(monkeypatch):
    monkeypatch.setattr(downloads, '_downloads', {})


def snapshot(cache):
    root = Path(cache) / 'models--qa--model'
    (root / 'refs').mkdir(parents=True, exist_ok=True)
    (root / 'refs/main').write_text(REVISION)
    target = root / 'snapshots' / REVISION
    target.mkdir(parents=True, exist_ok=True)
    for name in ('config.json', 'preprocessor_config.json', 'tokenizer.json'):
        (target / name).write_text('{}')
    return target


def fake_hub(monkeypatch, download):
    import huggingface_hub
    files = ('config.json', 'preprocessor_config.json', 'tokenizer.json', 'model.safetensors', 'pytorch_model.bin')
    info = SimpleNamespace(sha=REVISION, siblings=[SimpleNamespace(rfilename=name, size=4) for name in files])
    monkeypatch.setattr(huggingface_hub, 'HfApi', lambda: SimpleNamespace(model_info=lambda *_args, **_kwargs: info))
    monkeypatch.setattr(downloads, '_download_file', download)
    monkeypatch.setattr(huggingface_hub, 'try_to_load_from_cache', lambda *_args, **_kwargs: None)


def test_cached_weights_are_distinct_from_loaded_model_and_need_no_network(tmp_path, monkeypatch):
    target = snapshot(tmp_path)
    (target / 'model.safetensors').write_bytes(b'test weights')
    fake_hub(monkeypatch, lambda *_args, **_kwargs: pytest.fail('Cached model requested network'))
    assert downloads.prepare(MODEL, str(tmp_path), 'alice') == str(target)
    state = downloads.status(MODEL, str(tmp_path), 'alice')
    assert state['downloaded'] and state['state'] == 'downloaded'
    assert not downloads.cancel(MODEL, str(tmp_path), 'alice')


def test_metadata_or_incomplete_shards_are_not_a_complete_download(tmp_path):
    target = snapshot(tmp_path)
    assert downloads.cached_snapshot(MODEL, str(tmp_path)) is None
    (target / 'model.safetensors.index.json').write_text('{"weight_map":{"a":"model-1.safetensors","b":"model-2.safetensors"}}')
    (target / 'model-1.safetensors').write_bytes(b'first shard')
    assert downloads.cached_snapshot(MODEL, str(tmp_path)) is None
    (target / 'model-2.safetensors').write_bytes(b'second shard')
    assert downloads.cached_snapshot(MODEL, str(tmp_path)) == target


def test_downloads_are_serial_and_choose_one_weight_format(tmp_path, monkeypatch):
    files = []
    def download(model, revision, name, target, job):
        assert model == MODEL and revision == REVISION
        files.append(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b'test')
        job.downloaded_bytes += 4
        state = downloads.status(MODEL, str(tmp_path), 'alice')
        assert state['downloaded_bytes'] == len(files) * 4
        assert state['total_bytes'] == 16
    fake_hub(monkeypatch, download)
    downloads.prepare(MODEL, str(tmp_path), 'alice')
    assert len(files) == 4 and 'model.safetensors' in files and 'pytorch_model.bin' not in files
    assert downloads.status(MODEL, str(tmp_path), 'alice')['state'] == 'downloaded'


def test_owner_can_cancel_before_next_file_and_another_owner_cannot(tmp_path, monkeypatch):
    def download(_model, _revision, _name, _target, job):
        job.downloaded_bytes += 1
        assert not downloads.cancel(MODEL, str(tmp_path), 'bob')
        assert downloads.status(MODEL, str(tmp_path), 'bob')['downloaded_bytes'] == 0
        assert downloads.cancel(MODEL, str(tmp_path), 'alice')
    fake_hub(monkeypatch, download)
    with pytest.raises(downloads.DownloadCancelled):
        downloads.prepare(MODEL, str(tmp_path), 'alice')
    state = downloads.status(MODEL, str(tmp_path), 'alice')
    assert state['state'] == 'cancelled' and not state['cancelling'] and not state['downloaded']


def test_load_boundary_checks_cancellation(tmp_path):
    downloads.transition(MODEL, str(tmp_path), 'alice', 'downloading')
    assert downloads.cancel(MODEL, str(tmp_path), 'alice')
    with pytest.raises(downloads.DownloadCancelled):
        downloads.transition(MODEL, str(tmp_path), 'alice', 'loading')
    assert downloads.status(MODEL, str(tmp_path), 'alice')['state'] == 'cancelled'


def test_loading_cannot_be_reported_as_cancellable_download(tmp_path):
    downloads.transition(MODEL, str(tmp_path), 'alice', 'loading')
    assert not downloads.cancel(MODEL, str(tmp_path), 'alice')


def test_insufficient_space_stops_before_any_weight_download(tmp_path, monkeypatch):
    fake_hub(monkeypatch, lambda *_args, **_kwargs: pytest.fail('Download started without disk space'))
    monkeypatch.setattr(downloads.shutil, 'disk_usage', lambda _: SimpleNamespace(free=100))
    with pytest.raises(downloads.InsufficientDiskSpace):
        downloads.prepare(MODEL, str(tmp_path), 'alice')
    state = downloads.status(MODEL, str(tmp_path), 'alice')
    assert state['state'] == 'failed' and state['error'] == 'InsufficientDiskSpace'


@pytest.mark.parametrize('outcome', ['complete', 'cancel', 'corrupt', 'truncated'])
def test_stream_integrity_cancellation_and_no_partial_cache(tmp_path, monkeypatch, outcome):
    import hashlib
    import httpx
    import huggingface_hub
    from huggingface_hub import utils
    from contextlib import contextmanager

    data = b'first second'
    job = downloads.Download()
    target = tmp_path / 'model.safetensors'
    monkeypatch.setattr(utils, 'build_hf_headers', lambda: {'authorization': 'Bearer synthetic-secret'})
    monkeypatch.setattr(huggingface_hub, 'get_hf_file_metadata', lambda *_args, **_kwargs: SimpleNamespace(
        commit_hash=REVISION, size=len(data), etag=hashlib.sha256(data).hexdigest(), location='https://cdn.example/model'))

    class Response:
        def raise_for_status(self):
            pass

        def iter_bytes(self, **kwargs):
            assert kwargs['chunk_size'] == 64 * 1024
            yield data[:6]
            assert job.downloaded_bytes == 6 and not target.exists()
            if outcome == 'cancel':
                job.cancel.set()
            if outcome != 'truncated':
                yield b'broken' if outcome == 'corrupt' else data[6:]

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        @contextmanager
        def stream(self, method, url, headers):
            assert method == 'GET' and url == 'https://cdn.example/model'
            assert 'authorization' not in headers
            yield Response()

    monkeypatch.setattr(httpx, 'Client', Client)
    if outcome == 'complete':
        downloads._download_file(MODEL, REVISION, target.name, target, job)
        assert target.read_bytes() == data and job.downloaded_bytes == len(data)
    else:
        with pytest.raises(downloads.DownloadCancelled if outcome == 'cancel' else ValueError):
            downloads._download_file(MODEL, REVISION, target.name, target, job)
        assert not target.exists()
    assert not target.with_name(target.name + '.incomplete').exists()


@pytest.mark.parametrize('when', ['before_metadata', 'during_metadata'])
def test_cancellation_during_metadata_never_starts_file_transfer(tmp_path, monkeypatch, when):
    import httpx
    import huggingface_hub
    from huggingface_hub import utils

    job = downloads.Download()
    if when == 'before_metadata':
        job.cancel.set()

    def metadata(*_args, **_kwargs):
        assert when == 'during_metadata'
        job.cancel.set()
        return SimpleNamespace()

    monkeypatch.setattr(utils, 'build_hf_headers', lambda: {})
    monkeypatch.setattr(huggingface_hub, 'get_hf_file_metadata', metadata)
    monkeypatch.setattr(httpx, 'Client', lambda **_kwargs: pytest.fail('Cancelled download started a transfer'))
    with pytest.raises(downloads.DownloadCancelled):
        downloads._download_file(MODEL, REVISION, 'model.safetensors', tmp_path / 'model.safetensors', job)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize('changes', [{'user_id': 'bob'}, {'workspace_id': 'other'}, {'vault_path': '/other-vault'}])
def test_http_cancel_preserves_user_workspace_and_vault_scope(tmp_path, monkeypatch, changes):
    import httpx
    from fastapi import FastAPI
    from backend.api import handwriting_routes
    from backend.services import handwriting
    from backend.services.agent_execution_models import ExecutionScope
    from backend.services.agent_execution_scope import execution_scope

    monkeypatch.setattr(handwriting, '_model_id', lambda: MODEL)
    monkeypatch.setattr(handwriting, '_cache_dir', lambda: str(tmp_path))
    monkeypatch.setattr(handwriting, 'is_available', lambda: True)
    monkeypatch.setattr(handwriting, 'is_loaded', lambda: False)
    scope = ExecutionScope(user_id='alice', workspace_id='team', vault_path=str(tmp_path), role='owner')
    with execution_scope(scope):
        owner = handwriting._download_owner()
        downloads.transition(MODEL, str(tmp_path), owner, 'downloading')
    app = FastAPI()
    app.include_router(handwriting_routes.router)

    async def requests():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://fixture') as client:
            with execution_scope(scope.model_copy(update=changes)):
                response = await client.post('/api/vault/handwriting/cancel-download')
                assert response.status_code == 200 and response.json() == {'cancelling': False}
                state = await client.get('/api/vault/handwriting/status')
                assert state.json()['state'] == 'not_downloaded'
            with execution_scope(scope):
                # The worker retains its model identity if settings change.
                monkeypatch.setattr(handwriting, '_model_id', lambda: 'newly-selected-model')
                state = await client.get('/api/vault/handwriting/status')
                assert state.json()['model'] == MODEL and not state.json()['loaded']
                response = await client.post('/api/vault/handwriting/cancel-download')
                assert response.status_code == 200 and response.json() == {'cancelling': True}
                state = await client.get('/api/vault/handwriting/status')
                assert state.json()['state'] == 'downloading' and state.json()['cancelling']
    asyncio.run(requests())
