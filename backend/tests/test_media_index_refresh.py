"""Expired media indexes stay usable while complete replacements are built."""

import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import BoundedSemaphore, Event, Lock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.domains.media import index_refresh as refresh
from backend.domains.media import scan_cache
from backend.domains.vault.media import routes
from backend.services.context_vars import active_vault_path

LOG = logging.getLogger(__name__)
TTL = 86_400.0


class Service:
    def __init__(self, target, cache_dir, clock):
        self.target = target
        self.cache_dir = cache_dir
        self.clock = clock
        self._scan_cache = {}
        self._locks = {}

    def _persist_path(self, target):
        return self.cache_dir / f"scan_{hashlib.sha1(str(target).encode()).hexdigest()[:16]}.json"

    def _load_persisted(self, target):
        return scan_cache.load_persisted(target, self._persist_path, LOG)

    def _get_lock(self, key):
        return self._locks.setdefault(key, Lock())

    def _save_persisted(self, target, timestamp, entries):
        scan_cache.save_persisted(target, timestamp, entries, self._persist_path, LOG)

    def _scan_recursive(self, target, skip_dirs=None):
        yield from scan_cache.scan_recursive(
            target, skip_dirs, valid_extensions={".jpg"}, recurse=self._scan_recursive, logger=LOG,
        )

    def get_all_media(self, *args, **kwargs):
        entries = scan_cache.scan_with_cache(self, self.target, None, TTL, lambda: self.clock[0], LOG)
        return {"items": [{"filename": path.name} for path, _ in entries],
                "total": len(entries), "limit": 50, "offset": 0, "root": "images"}

    def invalidate(self):
        scan_cache.invalidate_cache(self, self.target, self.cache_dir)


@pytest.fixture
def environment(monkeypatch, tmp_path):
    monkeypatch.setattr(refresh, "_states", {})
    monkeypatch.setattr(refresh, "_capacity", BoundedSemaphore(8))
    clock = [TTL + 100.0]
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    with ThreadPoolExecutor(max_workers=2) as executor:
        monkeypatch.setattr(refresh, "_executor", executor)

        def service(name="images", entries=None):
            target = tmp_path / name
            target.mkdir()
            result = Service(target, cache_dir, clock)
            rows = [(target / "previous.jpg", 2.0)] if entries is None else entries
            result._persist_path(target).write_text(json.dumps({
                "ts": 10.0, "entries": [[str(path), mtime] for path, mtime in rows],
            }))
            return result

        yield service, clock


def _read(service):
    return refresh.read_with_index_state(service.get_all_media)


def _state(service):
    return refresh._states[str(service._persist_path(service.target))]


def test_expired_index_returns_immediately_and_one_background_scan_replaces_it(environment, monkeypatch):
    make, clock = environment
    service = make()
    entered, release = Event(), Event()
    calls = []

    def scan(target, exclusions):
        calls.append((target, exclusions, active_vault_path.get()))
        entered.set()
        assert release.wait(timeout=5)
        return [(target / "new.jpg", 5.0), (target / "older.jpg", 1.0)]

    monkeypatch.setattr(service, "_scan_recursive", scan)
    token = active_vault_path.set(service.target)
    try:
        first, receipt = _read(service)
        assert entered.wait(timeout=2)
        pending = _state(service).pending
        with ThreadPoolExecutor(max_workers=6) as readers:
            copies = list(readers.map(lambda _: _read(service), range(20)))
        assert all(page == first and state.state == "refreshing" for page, state in copies)
        assert first["items"] == [{"filename": "previous.jpg"}]
        assert receipt.state == "refreshing" and len(calls) == 1
        assert calls[0] == (service.target, None, None)
        active_vault_path.set(service.target.parent / "other-vault")
    finally:
        active_vault_path.reset(token)
        release.set()
    pending.result(timeout=3)
    current, current_receipt = _read(service)
    assert current["items"] == [{"filename": "new.jpg"}, {"filename": "older.jpg"}]
    assert current_receipt.state == "fresh" and current_receipt.revision != receipt.revision
    assert _state(service).snapshot[0] == clock[0]
    saved = json.loads(service._persist_path(service.target).read_text())
    assert set(saved) == {"ts", "entries"} and len(saved["entries"]) == 2


def test_valid_empty_snapshot_is_still_available_during_refresh(environment, monkeypatch):
    make, _ = environment
    service = make(entries=[])
    release = Event()
    monkeypatch.setattr(service, "_scan_recursive", lambda *_: (release.wait(timeout=5) and []))
    try:
        page, receipt = _read(service)
        pending = _state(service).pending
        assert page["items"] == [] and page["total"] == 0
        assert receipt.state == "refreshing"
    finally:
        release.set()
    pending.result(timeout=3)
    assert _read(service)[1].state == "fresh"


def test_missing_index_waits_for_the_first_complete_scan(environment, monkeypatch):
    make, _ = environment
    service = make()
    service._persist_path(service.target).unlink()
    entered, release = Event(), Event()

    def scan(target, _):
        entered.set()
        assert release.wait(timeout=5)
        return [(target / "first.jpg", 1.0)]

    monkeypatch.setattr(service, "_scan_recursive", scan)
    with ThreadPoolExecutor(max_workers=1) as readers:
        read = readers.submit(_read, service)
        try:
            assert entered.wait(timeout=2) and not read.done()
        finally:
            release.set()
        page, receipt = read.result(timeout=3)
    assert page["items"] == [{"filename": "first.jpg"}] and receipt.state == "fresh"


def test_legacy_consumer_remains_blocking_on_an_expired_index(environment, monkeypatch):
    make, _ = environment
    service = make()
    entered, release = Event(), Event()

    def scan(target, _):
        entered.set()
        assert release.wait(timeout=5)
        return [(target / "current.jpg", 1.0)]

    monkeypatch.setattr(service, "_scan_recursive", scan)
    with ThreadPoolExecutor(max_workers=1) as readers:
        read = readers.submit(service.get_all_media)
        try:
            assert entered.wait(timeout=2) and not read.done()
        finally:
            release.set()
        page = read.result(timeout=3)
    assert page["items"] == [{"filename": "current.jpg"}]
    assert _state(service).pending is None


@pytest.mark.parametrize("failure", ["exception", "partial"])
def test_errors_keep_complete_snapshot_and_retry_only_after_cooldown(environment, monkeypatch, failure):
    make, clock = environment
    service = make()
    original = service._persist_path(service.target).read_bytes()
    (service.target / "available.jpg").write_text("synthetic")
    blocked = service.target / "unavailable"
    blocked.mkdir()
    scandir = scan_cache.os.scandir
    entered, release = Event(), Event()

    def unavailable(path):
        if Path(path) == blocked:
            raise OSError("Synthetic directory unavailable")
        return scandir(path)

    scan = service._scan_recursive

    def read(target, exclusions):
        entered.set()
        assert release.wait(timeout=5)
        if failure == "exception":
            raise OSError("Synthetic scan unavailable")
        return scan(target, exclusions)

    monkeypatch.setattr(service, "_scan_recursive", read)
    monkeypatch.setattr(scan_cache.os, "scandir", unavailable)
    try:
        first, receipt = _read(service)
        assert entered.wait(timeout=2)
        pending = _state(service).pending
    finally:
        release.set()
    pending.result(timeout=3)
    failed, failed_receipt = _read(service)
    assert failed == first and failed_receipt.state == "failed"
    assert failed_receipt.revision == receipt.revision and failed_receipt.retry_after == 30
    assert service._persist_path(service.target).read_bytes() == original
    assert _state(service).pending is None
    clock[0] += 29
    assert _read(service)[1].state == "failed" and _state(service).pending is None
    monkeypatch.setattr(service, "_scan_recursive", lambda *_: [])
    clock[0] += 2
    _, retry = _read(service)
    assert retry.state == "refreshing"
    retry_pending = _state(service).pending
    if retry_pending is not None:
        retry_pending.result(timeout=3)
    assert _read(service)[0]["items"] == [] and _read(service)[1].state == "fresh"


@pytest.mark.parametrize("pause_at", ["scan", "staging"])
def test_invalidation_retires_pending_work_and_cannot_restore_a_deleted_cache(environment, monkeypatch, pause_at):
    make, _ = environment
    service = make()
    path = service._persist_path(service.target)
    original = path.read_bytes()
    entered, release = Event(), Event()
    stage = refresh._stage_snapshot

    def scan(target, _):
        if pause_at == "scan":
            entered.set()
            assert release.wait(timeout=5)
        return [(target / "late.jpg", 5.0)]

    def staged(cache_file, timestamp, entries):
        temporary = stage(cache_file, timestamp, entries)
        if pause_at == "staging":
            assert cache_file.read_bytes() == original
            entered.set()
            assert release.wait(timeout=5)
        return temporary

    monkeypatch.setattr(service, "_scan_recursive", scan)
    monkeypatch.setattr(refresh, "_stage_snapshot", staged)
    try:
        _read(service)
        assert entered.wait(timeout=2)
        pending = _state(service).pending
        service.invalidate()
        assert not path.exists() and _state(service).snapshot is None
    finally:
        release.set()
    pending.result(timeout=3)
    assert not path.exists() and not service._scan_cache and _state(service).snapshot is None
    assert not list(path.parent.glob("*.tmp"))
    monkeypatch.setattr(refresh, "_stage_snapshot", stage)
    monkeypatch.setattr(service, "_scan_recursive", lambda *_: [])
    assert _read(service)[0]["items"] == []


def test_pending_queue_is_bounded_across_roots(environment, monkeypatch):
    make, _ = environment
    services = [make(f"root-{index}") for index in range(3)]
    monkeypatch.setattr(refresh, "_capacity", BoundedSemaphore(2))
    entered, release = Event(), Event()
    guard = Lock()
    calls = []

    def scan(target, _):
        with guard:
            calls.append(target)
            if len(calls) == 2:
                entered.set()
        assert release.wait(timeout=5)
        return []

    for service in services:
        monkeypatch.setattr(service, "_scan_recursive", scan)
    pending = []
    try:
        for service in services[:2]:
            assert _read(service)[1].state == "refreshing"
            pending.append(_state(service).pending)
        assert entered.wait(timeout=2)
        page, receipt = _read(services[2])
        assert receipt.state == "failed" and receipt.retry_after == 30
        assert page["total"] == 1 and _state(services[2]).pending is None
        assert len(calls) == 2
    finally:
        release.set()
    for future in pending:
        future.result(timeout=3)


def test_route_headers_describe_the_returned_snapshot_even_if_refresh_finishes(environment, monkeypatch):
    make, _ = environment
    service = make()
    release = Event()
    scan_entered = Event()

    def scan(*_):
        scan_entered.set()
        assert release.wait(timeout=5)
        return []

    monkeypatch.setattr(service, "_scan_recursive", scan)
    read = service.get_all_media

    def finish_after_read(*args, **kwargs):
        page = read(*args, **kwargs)
        pending = _state(service).pending
        if pending is not None:
            assert scan_entered.wait(timeout=2)
            release.set()
            pending.result(timeout=3)
        return page

    monkeypatch.setattr(service, "get_all_media", finish_after_read)
    monkeypatch.setattr(routes, "_media_service", lambda: service)
    app = FastAPI()
    app.get("/api/vault/media")(routes.get_all_media)
    try:
        with TestClient(app) as client:
            old = client.get("/api/vault/media")
            assert old.status_code == 200 and old.json()["items"] == [{"filename": "previous.jpg"}]
            assert old.headers["X-Gnosi-Media-Index"] == "refreshing"
            current = client.get("/api/vault/media")
            assert current.status_code == 200 and current.json()["items"] == []
            assert current.headers["X-Gnosi-Media-Index"] == "fresh"
            assert current.headers["X-Gnosi-Media-Index-Revision"] != old.headers["X-Gnosi-Media-Index-Revision"]
            assert "retry-after" not in current.headers
    finally:
        release.set()


def test_failed_header_preserves_the_body_and_no_snapshot_failure_returns_503(environment, monkeypatch):
    make, _ = environment
    service = make()
    release = Event()

    def scan(*_):
        assert release.wait(timeout=5)
        raise OSError("Synthetic refresh failure")

    monkeypatch.setattr(service, "_scan_recursive", scan)
    monkeypatch.setattr(routes, "_media_service", lambda: service)
    app = FastAPI()
    app.get("/api/vault/media")(routes.get_all_media)
    try:
        with TestClient(app) as client:
            original = client.get("/api/vault/media")
            pending = _state(service).pending
            release.set()
            pending.result(timeout=3)
            failed = client.get("/api/vault/media")
            assert failed.status_code == 200 and failed.json() == original.json()
            assert failed.headers["X-Gnosi-Media-Index"] == "failed"
            assert failed.headers["X-Gnosi-Media-Index-Revision"] == original.headers["X-Gnosi-Media-Index-Revision"]
            assert failed.headers["Retry-After"] == "30"
            service.invalidate()
            unavailable = client.get("/api/vault/media")
            assert unavailable.status_code == 503
            assert unavailable.headers["X-Gnosi-Media-Index"] == "failed"
            assert unavailable.headers["Retry-After"] == "30"
    finally:
        release.set()


@pytest.mark.parametrize("failure_at", ["staging", "replace"])
def test_complete_first_scan_is_available_when_persistence_fails(environment, monkeypatch, failure_at):
    make, _ = environment
    service = make()
    service._persist_path(service.target).unlink()
    monkeypatch.setattr(service, "_scan_recursive", lambda *_: [(service.target / "complete.jpg", 3.0)])

    def unavailable(*_):
        raise OSError("Synthetic cache volume unavailable")

    monkeypatch.setattr(refresh if failure_at == "staging" else refresh.os,
                        "_stage_snapshot" if failure_at == "staging" else "replace", unavailable)
    page, receipt = _read(service)
    assert receipt.state == "fresh" and page["items"] == [{"filename": "complete.jpg"}]
    assert _read(service)[0] == page and _state(service).pending is None
    assert not service._persist_path(service.target).exists()
    assert not list(service.cache_dir.glob("*.tmp"))


def test_partial_legacy_scan_cannot_certify_or_replace_a_complete_snapshot(environment, monkeypatch):
    make, _ = environment
    service = make()
    original = service._persist_path(service.target).read_bytes()
    (service.target / "available.jpg").write_text("synthetic")
    blocked = service.target / "unavailable"
    blocked.mkdir()
    scandir = scan_cache.os.scandir

    def unavailable(path):
        if Path(path) == blocked:
            raise OSError("Synthetic directory unavailable")
        return scandir(path)

    monkeypatch.setattr(scan_cache.os, "scandir", unavailable)
    partial = service.get_all_media()
    assert partial["items"] == [{"filename": "available.jpg"}]
    assert not service._scan_cache and service._persist_path(service.target).read_bytes() == original
    release = Event()
    monkeypatch.setattr(service, "_scan_recursive", lambda *_: (release.wait(timeout=5) and []))
    try:
        current, receipt = _read(service)
        pending = _state(service).pending
        assert current["items"] == [{"filename": "previous.jpg"}] and receipt.state == "refreshing"
    finally:
        release.set()
    pending.result(timeout=3)


def test_invalidation_also_retires_a_legacy_scan_before_publication(environment, monkeypatch):
    make, _ = environment
    service = make()
    entered, release = Event(), Event()

    def scan(target, _):
        entered.set()
        assert release.wait(timeout=5)
        return [(target / "late.jpg", 1.0)]

    monkeypatch.setattr(service, "_scan_recursive", scan)
    with ThreadPoolExecutor(max_workers=1) as readers:
        pending = readers.submit(service.get_all_media)
        try:
            assert entered.wait(timeout=2)
            service.invalidate()
        finally:
            release.set()
        assert pending.result(timeout=3)["items"] == [{"filename": "late.jpg"}]
    assert not service._scan_cache and not service._persist_path(service.target).exists()
    assert _state(service).snapshot is None


def test_deleted_entries_preserve_snapshot_slots_and_do_not_block_other_photos(environment, monkeypatch):
    from backend.services import media_service as media_module

    make, clock = environment
    service = make()
    first = service.target / "deleted.jpg"
    second = service.target / "present.jpg"
    third = service.target / "also-deleted.jpg"
    fourth = service.target / "last.jpg"
    second.write_bytes(b"synthetic")
    fourth.write_bytes(b"synthetic")
    service._persist_path(service.target).write_text(json.dumps({
        "ts": 10.0,
        "entries": [[str(path), mtime] for path, mtime in [(first, 4), (second, 3), (third, 2), (fourth, 1)]],
    }))
    release = Event()
    monkeypatch.setattr(service, "_scan_recursive", lambda *_: (release.wait(timeout=5) and []))
    real = media_module.MediaService()
    monkeypatch.setattr(real, "_resolve_album_dir", lambda *_, **__: service.target)
    monkeypatch.setattr(real, "_root_dir", lambda *_: service.target)
    monkeypatch.setattr(media_module, "_active_vault_path", lambda: service.target.parent)
    monkeypatch.setattr(real, "_get_user_meta_for", lambda *_: {"tags": [], "description": ""})
    monkeypatch.setattr(real, "_scan_with_cache", lambda target, skip_dirs=None: scan_cache.scan_with_cache(
        service, target, skip_dirs, TTL, lambda: clock[0], LOG,
    ))
    monkeypatch.setattr(routes, "_media_service", lambda: real)
    app = FastAPI()
    app.get("/api/vault/media", response_model=routes.MediaPageResponse)(routes.get_all_media)
    try:
        with TestClient(app) as client:
            pages = [client.get("/api/vault/media", params={"offset": index, "limit": 1}) for index in range(4)]
        pending = _state(service).pending
        assert all(page.status_code == 200 and page.json()["total"] == 4 for page in pages)
        assert [page.headers["X-Gnosi-Media-Next-Offset"] for page in pages] == ["1", "2", "3", "4"]
        assert [page.json()["offset"] for page in pages] == [0, 1, 2, 3]
        assert [len(page.json()["items"]) for page in pages] == [0, 1, 0, 1]
        assert [page.json()["items"][0]["filename"] for page in (pages[1], pages[3])] == [second.name, fourth.name]
        assert len({page.headers["X-Gnosi-Media-Index-Revision"] for page in pages}) == 1
        assert all(page.headers["X-Gnosi-Media-Index"] == "refreshing" for page in pages)
        monkeypatch.setattr(real, "_get_file_info", lambda *_, **__: (_ for _ in ()).throw(PermissionError("Synthetic")))
        with pytest.raises(PermissionError):
            refresh.read_with_index_state(real.get_all_media, offset=1, limit=1)
    finally:
        release.set()
    pending.result(timeout=3)
