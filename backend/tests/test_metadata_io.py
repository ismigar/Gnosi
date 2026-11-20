"""Demand reads deliver coordinated bytes and preserve offline vault data."""
from __future__ import annotations

import asyncio
import errno
import os
import threading
from pathlib import Path

import pytest

from backend.platform.files import snapshots
from backend.tests.cloud_file_fixtures import install_coordinated_reader
from backend.utils import metadata_io
from backend.utils.metadata_io import MetadataUnavailable
from backend.utils.safe_io import safe_write_text


@pytest.fixture(autouse=True)
def isolated_queue(monkeypatch):
    queue = snapshots.CoordinatedReads()
    monkeypatch.setattr(snapshots, "reads", queue)
    yield
    queue._pool.shutdown()
    if queue._expiry is not None:
        queue._expiry.cancel()


def test_local_metadata_and_regular_sparse_files_do_not_download(tmp_path, monkeypatch):
    path = tmp_path / ".gnosi/skills/skill.yaml"
    path.parent.mkdir(parents=True)
    path.write_text("id: retained")
    monkeypatch.setattr(snapshots, "_copy", lambda *_: pytest.fail("local download"))
    assert metadata_io.read_metadata_text(path) == "id: retained"
    outside = tmp_path / "ordinary"
    with outside.open("wb") as handle:
        handle.truncate(65536)
    assert metadata_io.read_vault_bytes(outside) == bytes(65536)


def test_failed_read_preserves_existing_content_and_cooldown(tmp_path, monkeypatch):
    path = tmp_path / ".gnosi/favorites.json"
    path.parent.mkdir()
    path.write_text("original")
    calls = []

    def offline(candidate):
        calls.append(candidate)
        raise MetadataUnavailable(path=candidate, reason="offline")

    install_coordinated_reader(monkeypatch, offline)
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda *_: True)
    with pytest.raises(MetadataUnavailable) as write:
        safe_write_text(path, "defaults")
    with pytest.raises(MetadataUnavailable) as read:
        metadata_io.read_metadata_text(path)
    for failure in (write, read):
        assert (failure.value.path, failure.value.reason, failure.value.retryable) == (path, "offline", True)
    assert calls == [path]
    assert path.read_text() == "original"
    assert list(path.parent.iterdir()) == [path]


def test_coordinated_note_reads_complete_content_without_reopening_source(tmp_path, monkeypatch):
    source = tmp_path / "Notes/note.md"
    source.parent.mkdir()
    text = "ç" * 150_000 + "\nFinal line\n"
    source.write_text(text)
    before = source.stat()
    monkeypatch.setattr(metadata_io, "is_native_vault_file", lambda *_: True)
    original_open = Path.open
    closed = False

    async def copy(path, target, timeout):
        nonlocal closed
        with original_open(path, "rb") as handle:
            target.write(handle.read())
        closed = True
        return before

    def guarded_open(path, *args, **kwargs):
        if path == source and closed:
            raise OSError(errno.EDEADLK, "provider evicted the file")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(snapshots, "copy_coordinated", copy)
    monkeypatch.setattr(Path, "open", guarded_open)
    value, stat_result = metadata_io.read_vault_text_with_stat(source, root=tmp_path)
    assert value == text and stat_result.st_ino == before.st_ino


def test_async_waiters_share_one_snapshot_after_one_is_cancelled(tmp_path, monkeypatch):
    source = tmp_path / "attachment.pdf"
    content = b"private\x00" * 32768
    source.write_bytes(content)
    started, release = threading.Event(), threading.Event()
    calls = []

    def download(path):
        calls.append(path)
        started.set()
        return release.wait(3)

    install_coordinated_reader(monkeypatch, download)
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda *_: True)

    async def run():
        first = asyncio.create_task(metadata_io.read_vault_bytes_async(source, root=tmp_path))
        assert await asyncio.to_thread(started.wait, 2)
        second = asyncio.create_task(metadata_io.vault_file_snapshot_async(source, root=tmp_path))
        await asyncio.sleep(0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        lease = await second
        assert lease.path.name == source.name and lease.path != source
        with lease:
            assert lease.path.read_bytes() == content
            assert lease.stat_result.st_size == len(content)
        lease.close()
        await asyncio.sleep(0)
        assert not lease.path.exists()

    try:
        asyncio.run(run())
    finally:
        release.set()
    assert calls == [source]


def test_explicit_selection_uses_reserved_slot_before_speculative_backlog(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    paths = [tmp_path / name for name in ("warm1", "warm2", "selected", "selected2")]
    for path in paths:
        path.write_text(path.name)
    started = {path: threading.Event() for path in paths}
    release = threading.Event()
    calls = []

    def download(path):
        calls.append(path)
        started[path].set()
        return release.wait(3) if path == paths[0] else True

    install_coordinated_reader(monkeypatch, download)
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda *_: True)

    async def run():
        with ThreadPoolExecutor(max_workers=1) as worker:
            first = asyncio.create_task(metadata_io.vault_file_snapshot_async(paths[0], background=True))
            assert await asyncio.to_thread(started[paths[0]].wait, 2)
            next_warmup = asyncio.create_task(metadata_io.vault_file_snapshot_async(paths[1], background=True))
            # Exercise the API event loop and an independent synchronous task worker.
            selected = worker.submit(metadata_io.read_vault_text, paths[2])
            assert await asyncio.wait_for(metadata_io.read_vault_text_async(paths[3]), 2) == "selected2"
            assert selected.result(1) == "selected"
            assert not started[paths[1]].is_set()
            release.set()
            for lease in await asyncio.gather(first, next_warmup):
                lease.close()

    try:
        asyncio.run(run())
    finally:
        release.set()
    assert len(calls) == 4


def test_sync_reader_on_event_loop_can_retry_same_download_without_blocking(tmp_path, monkeypatch):
    path = tmp_path / ".gnosi/skill.yaml"
    path.parent.mkdir()
    path.write_text("original")
    started, release = threading.Event(), threading.Event()
    calls = []

    def download(candidate):
        calls.append(candidate)
        started.set()
        return release.wait(3)

    install_coordinated_reader(monkeypatch, download)
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda *_: True)

    async def read():
        for _ in range(2):
            with pytest.raises(MetadataUnavailable, match="pending") as failure:
                metadata_io.read_metadata_text(path)
            assert failure.value.path == path and failure.value.reason == "pending"
        assert await asyncio.to_thread(started.wait, 1)
        release.set()
        assert await metadata_io.read_vault_text_async(path) == "original"
        assert metadata_io.read_metadata_text(path) == "original"
        path.write_text("updated")
        assert await metadata_io.read_vault_text_async(path) == "updated"

    try:
        asyncio.run(read())
    finally:
        release.set()
    assert calls == [path, path]


def test_alias_for_trusted_vault_root_is_allowed_but_symlink_escapes_are_refused(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(vault, target_is_directory=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret").write_text("private")
    (vault / ".gnosi").symlink_to(outside, target_is_directory=True)
    source = vault / "note.md"
    source.write_text("allowed")
    calls = []
    install_coordinated_reader(monkeypatch, lambda path: calls.append(path) or True)
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda *_: True)
    assert metadata_io.read_vault_text(alias / "note.md", root=alias) == "allowed"
    for candidate, root in [(alias / ".gnosi/secret", alias), (vault / ".gnosi/secret", None),
                            (outside / "secret", vault), (vault / "../outside/secret", vault)]:
        with pytest.raises(MetadataUnavailable) as failure:
            metadata_io.read_vault_text(candidate, root=root)
        assert failure.value.reason == "permission" and not failure.value.retryable
    assert calls == [source]


def test_warmup_covers_only_metadata_without_following_links(tmp_path, monkeypatch):
    from backend.services import vault_warmup
    root = tmp_path / ".gnosi"
    expected = []
    for relative in ["agent/a/skill.yaml", "plugins/p/manifest.json", "wiki/source.json", "favorites.json"]:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("original")
        expected.append(path)
    outside = tmp_path / "Notes"
    outside.mkdir()
    (outside / "secret").write_text("secret")
    (root / "escape").symlink_to(outside, target_is_directory=True)
    uploads = root / "chat-attachments/another-session"
    uploads.mkdir(parents=True)
    (uploads / "unselected.pdf").write_bytes(b"attachment")
    monkeypatch.setattr(vault_warmup, "is_cloud_placeholder", lambda *_: True)
    monkeypatch.setattr(vault_warmup, "_critical_warmup_enabled", lambda _: False)
    observed = []

    async def snapshot(path, *, root, background):
        assert root == tmp_path and background
        observed.append(path)
        return snapshots.VaultFileSnapshot(path, path.stat())

    monkeypatch.setattr(vault_warmup, "vault_file_snapshot_async", snapshot)
    asyncio.run(vault_warmup._warm_critical(str(tmp_path)))
    assert set(observed) == set(expected)


def test_missing_skill_file_download_is_not_reported_as_deleted(tmp_path, monkeypatch):
    from backend.services.user_skill_store import UserSkillStore
    package = tmp_path / ".gnosi/agent/skills/user.cloud"
    package.mkdir(parents=True)
    (package / "skill.yaml").write_text("remote descriptor")
    (package / "SKILL.md").write_text("remote instructions")
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda *_: True)
    install_coordinated_reader(monkeypatch, lambda _: False)
    with pytest.raises(MetadataUnavailable):
        UserSkillStore(tmp_path).load_all()
    assert (package / "skill.yaml").read_text() == "remote descriptor"


def test_foreground_subscriber_promotes_a_queued_speculative_file(tmp_path, monkeypatch):
    first, selected = tmp_path / "first", tmp_path / "selected"
    first.write_text("a")
    selected.write_text("b")
    started, release = threading.Event(), threading.Event()
    calls = []

    def download(path):
        calls.append(path)
        if path == first:
            started.set()
            return release.wait(3)
        return True

    install_coordinated_reader(monkeypatch, download)
    queue = snapshots.reads
    first_wait = queue.request(first, first.stat(), background=True)
    try:
        assert started.wait(1)
        planned = queue.request(selected, selected.stat(), background=True)
        active = queue.request(selected, selected.stat())
        assert active is planned and active.result(1).path.read_text() == "b"
    finally:
        release.set()
        first_wait.result(2).close()
    assert calls == [first, selected]


def test_replacement_during_a_read_gives_new_subscriber_the_new_revision(tmp_path, monkeypatch):
    original = tmp_path / "page.md"
    original.write_text("old")
    replacement = tmp_path / "next"
    replacement.write_text("new")
    started, release = threading.Event(), threading.Event()

    async def copy(path, target, timeout):
        with path.open("rb") as handle:
            content = handle.read()
            info = os.fstat(handle.fileno())
        if content == b"old":
            started.set()
            assert release.wait(3)
        target.write(content)
        return info

    monkeypatch.setattr(snapshots, "copy_coordinated", copy)
    queue = snapshots.reads
    before = queue.request(original, original.stat())
    try:
        assert started.wait(2)
        replacement.replace(original)
        current = queue.request(original, original.stat())
        assert current.result(2).path.read_bytes() == b"new"
    finally:
        release.set()
    assert before.result(2).path.read_bytes() == b"old"


def test_missing_child_of_dataless_directory_cannot_be_written_as_new(tmp_path, monkeypatch):
    folder = tmp_path / ".gnosi"
    folder.mkdir()
    path = folder / "params.yaml"
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda candidate, _: candidate == folder)
    with pytest.raises(MetadataUnavailable) as error:
        safe_write_text(path, "defaults")
    assert error.value.reason == "pending" and error.value.path == path
    assert not path.exists()


def test_full_worker_pool_keeps_http_health_responsive_and_private(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.app.errors import register_error_handlers

    paths = [tmp_path / name for name in ["one", "two", "three"]]
    for path in paths:
        path.write_text("private")
    started = {path: threading.Event() for path in paths}
    release = threading.Event()

    def download(path):
        started[path].set()
        return release.wait(3)

    install_coordinated_reader(monkeypatch, download)
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda *_: True)
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/file/{index}")
    async def read(index: int):
        return metadata_io.read_metadata_text(paths[index])

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    try:
        with TestClient(app) as client:
            for index in range(3):
                response = client.get(f"/file/{index}", headers={"Accept-Language": "ca"})
                assert response.status_code == 503 and response.json()["code"] == "metadata_unavailable"
                assert "núvol" in response.json()["detail"] and str(tmp_path) not in response.text
                assert int(response.headers["Retry-After"]) > 0
            assert started[paths[0]].wait(1) and started[paths[1]].wait(1) and not started[paths[2]].is_set()
            assert client.get("/health").json() == {"status": "ok"}
    finally:
        release.set()
        assert started[paths[2]].wait(2)


def test_allocated_file_beneath_configured_vault_alias_uses_native_reader(tmp_path, monkeypatch):
    managed = tmp_path / "Library/CloudStorage/OneDrive-fixture/Vault"
    managed.mkdir(parents=True)
    note = managed / "note.md"
    note.write_text("managed")
    alias = tmp_path / "alias"
    alias.symlink_to(managed, target_is_directory=True)
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(alias))
    monkeypatch.setattr(metadata_io.sys, "platform", "darwin")
    assert metadata_io.is_native_vault_file(alias / note.name, note.stat())
    calls = []

    async def copy(path, target, timeout):
        calls.append(path)
        target.write(path.read_bytes())
        return path.stat()

    monkeypatch.setattr(snapshots, "copy_coordinated", copy)
    assert metadata_io.read_vault_text(alias / note.name) == "managed"
    assert calls == [note]
    local = tmp_path / "local"
    local.mkdir()
    (local / note.name).write_text("local")
    alias.unlink()
    alias.symlink_to(local, target_is_directory=True)
    assert not metadata_io.is_native_vault_file(alias / note.name)
    assert metadata_io.read_vault_text(alias / note.name) == "local" and calls == [note]
