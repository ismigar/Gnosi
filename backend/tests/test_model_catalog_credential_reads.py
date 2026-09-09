"""Credential availability must not wait on model discovery or its refresh lock."""
from __future__ import annotations

import json
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.agent import model_catalog as catalog
from backend.security import ai_credentials


def write_catalog(path: Path, alias: str, provider_id: str = 'fixture') -> None:
    path.write_text(json.dumps({'providers': [{'id': provider_id, 'env': [alias]}]}))


@pytest.fixture(autouse=True)
def local_catalog(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(catalog, '_mem_cache', None)
    monkeypatch.setattr(catalog, '_cache_path', lambda: tmp_path / 'cached.json')
    monkeypatch.setattr(catalog, 'VENDORED_PATH', tmp_path / 'vendored.json')
    catalog._file_env_index.cache_clear()

    def no_model_discovery(*args: object, **kwargs: object) -> None:
        raise AssertionError('Credential metadata must not discover models')

    monkeypatch.setattr(catalog, 'load_catalog', no_model_discovery)
    monkeypatch.setattr(catalog, '_fetch_remote', no_model_discovery)
    monkeypatch.setattr(catalog, '_live_ollama_models', no_model_discovery)


def test_offline_credential_checks_use_vendored_aliases(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    write_catalog(tmp_path / 'vendored.json', 'FIXTURE_KEY')
    monkeypatch.setenv('FIXTURE_KEY', 'fixture-only-value')
    monkeypatch.setattr(ai_credentials, 'get_keychain', lambda: SimpleNamespace(get_credential=lambda key: None))
    document = ai_credentials.sanitize_ai_config_concurrently({'providers': {'fixture': {}, 'unknown': {}}})
    assert document['providers']['fixture']['has_api_key'] is True
    assert document['providers']['unknown']['has_api_key'] is False
    assert 'fixture-only-value' not in repr(document)


def test_saved_aliases_override_vendored_and_follow_file_changes(tmp_path: Path) -> None:
    cached = tmp_path / 'cached.json'
    write_catalog(cached, 'SAVED_KEY')
    write_catalog(tmp_path / 'vendored.json', 'BUNDLED_KEY')
    assert catalog.catalog_env_keys(' FIXTURE ') == ['SAVED_KEY']
    result = catalog.catalog_env_keys('fixture')
    result.append('MUTATED_KEY')
    assert catalog.catalog_env_keys('fixture') == ['SAVED_KEY']
    replacement = tmp_path / 'replacement.json'
    write_catalog(replacement, 'UPDATED_KEY')
    replacement.replace(cached)
    assert catalog.catalog_env_keys('fixture') == ['UPDATED_KEY']
    cached.write_text('not json')
    assert catalog.catalog_env_keys('fixture') == ['BUNDLED_KEY']
    cached.unlink()
    assert catalog.catalog_env_keys('fixture') == ['BUNDLED_KEY']


def test_local_lookups_do_not_wait_for_a_model_refresh(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    write_catalog(tmp_path / 'vendored.json', 'BUNDLED_KEY')
    completed = threading.Event()
    result: list[str] = []

    def read() -> None:
        result.extend(catalog.catalog_env_keys('fixture'))
        completed.set()

    with catalog._mem_lock:
        thread = threading.Thread(target=read, daemon=True)
        thread.start()
        ready = completed.wait(timeout=1)
    thread.join(timeout=1)
    assert ready, 'Credential lookup waited for a model refresh'
    assert result == ['BUNDLED_KEY']
    monkeypatch.setattr(catalog, '_mem_cache', {'providers': [{'id': 'fixture', 'env': ['REFRESHED_KEY']}]})
    assert catalog.catalog_env_keys('fixture') == ['REFRESHED_KEY']
    monkeypatch.setattr(catalog, '_mem_cache', {'providers': [{'id': 'fixture', 'env': []}]})
    assert catalog.catalog_env_keys('fixture') == []


def test_failed_metadata_read_is_retried(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    cached = tmp_path / 'cached.json'
    write_catalog(cached, 'SAVED_KEY')
    original = catalog._read_json
    calls = 0

    def transient_failure(path: Path | None) -> dict | None:
        nonlocal calls
        if path == cached:
            calls += 1
            if calls == 1:
                return None
        return original(path)

    monkeypatch.setattr(catalog, '_read_json', transient_failure)
    assert catalog.catalog_env_keys('fixture') == []
    assert catalog.catalog_env_keys('fixture') == ['SAVED_KEY']
    assert catalog.catalog_env_keys('fixture') == ['SAVED_KEY']
    assert calls == 2


@pytest.mark.parametrize('fail_first_read', [False, True])
def test_overlapping_credential_checks_share_one_decode_and_retry_failures(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, fail_first_read: bool,
) -> None:
    cached = tmp_path / 'cached.json'
    write_catalog(cached, 'SAVED_KEY')
    original = catalog._read_json
    reading = threading.Event()
    waiting = threading.Event()
    release = threading.Event()
    waiter_guard = threading.Lock()
    waiters = 0
    calls = 0

    class ObservedFuture(Future):
        def result(self, timeout=None):
            nonlocal waiters
            with waiter_guard:
                waiters += 1
                if waiters == 5:
                    waiting.set()
            return super().result(timeout)

    def blocked_read(path: Path | None) -> dict | None:
        nonlocal calls
        calls += 1
        if calls == 1:
            reading.set()
            assert release.wait(timeout=5)
            if fail_first_read:
                return None
        return original(path)

    monkeypatch.setattr(catalog, 'Future', ObservedFuture)
    monkeypatch.setattr(catalog, '_read_json', blocked_read)
    with ThreadPoolExecutor(max_workers=6) as pool:
        first = pool.submit(catalog.catalog_env_keys, 'fixture')
        try:
            assert reading.wait(timeout=5)
            rest = [pool.submit(catalog.catalog_env_keys, 'fixture') for _ in range(5)]
            assert waiting.wait(timeout=5)
        finally:
            release.set()
        results = [future.result(timeout=5) for future in [first, *rest]]
    assert results == ([[]] * 6 if fail_first_read else [['SAVED_KEY']] * 6)
    assert calls == 1
    assert not catalog._env_reads
    assert catalog.catalog_env_keys('fixture') == ['SAVED_KEY']
    assert calls == (2 if fail_first_read else 1)


def test_pending_catalog_read_does_not_block_another_file_or_replacement(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    cached = tmp_path / 'cached.json'
    other = tmp_path / 'other.json'
    write_catalog(cached, 'OLD_KEY')
    write_catalog(other, 'OTHER_KEY')
    original = catalog._read_json
    reading = threading.Event()
    release = threading.Event()

    def blocked_read(path: Path | None) -> dict | None:
        result = original(path)
        if path == cached and not reading.is_set():
            reading.set()
            assert release.wait(timeout=5)
        return result

    monkeypatch.setattr(catalog, '_read_json', blocked_read)
    with ThreadPoolExecutor(max_workers=3) as pool:
        first = pool.submit(catalog.catalog_env_keys, 'fixture')
        try:
            assert reading.wait(timeout=5)
            # Another vault's file must not queue behind this read.
            independent = pool.submit(catalog._shared_file_env_index, other, (1,))
            assert independent.result(timeout=5) == {'fixture': ('OTHER_KEY',)}
            replacement = tmp_path / 'replacement.json'
            write_catalog(replacement, 'NEW_KEY')
            replacement.replace(cached)
            fresh = pool.submit(catalog.catalog_env_keys, 'fixture')
            assert fresh.result(timeout=5) == ['NEW_KEY']
            assert not first.done()
        finally:
            release.set()
        assert first.result(timeout=5) == ['OLD_KEY']
    assert catalog.catalog_env_keys('fixture') == ['NEW_KEY']
    assert not catalog._env_reads
