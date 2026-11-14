"""Real descriptor transfer, deadlines and cleanup without cloud services."""
import hashlib
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import tracemalloc

import pytest

from backend.utils import bounded_file_io as io

pytestmark = pytest.mark.skipif(os.name != "posix", reason="Unix descriptor transport")


def test_one_owned_worker_reads_and_copies_multiple_files_then_exits(tmp_path):
    source = tmp_path / "source"
    source.write_bytes(b"Verified content" * 10000)
    target = tmp_path / "copy"
    reader = io.Reader(timeout=3)
    try:
        with source.open("rb") as file:
            data, digest, size = reader.run(file.fileno(), source.stat().st_size)
        process = reader.process
        assert data == source.read_bytes() and size == len(data)
        assert digest == hashlib.sha256(data).hexdigest()
        with source.open("rb") as file, target.open("wb") as output:
            assert reader.run(file.fileno(), size, output.fileno()) == (b"", digest, size)
        assert reader.process is process
        assert target.read_bytes() == data
    finally:
        reader.close()
    assert process is not None and process.poll() == 0


def test_blocked_worker_times_out_and_is_reaped(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.write_bytes(b"unchanged")
    real_spawn = subprocess.Popen
    children = []

    def blocked(command, **kwargs):
        child = real_spawn([sys.executable, "-c", "import time; time.sleep(60)"], **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(io.subprocess, "Popen", blocked)
    started = time.monotonic()
    reader = io.Reader(timeout=0.05)
    with source.open("rb") as file, pytest.raises(io.ReadUnavailable):
        reader.run(file.fileno(), 100)
    reader.close()
    assert time.monotonic() - started < 3
    assert children and all(child.poll() is not None for child in children)
    assert source.read_bytes() == b"unchanged"


def test_worker_rejects_oversized_source_and_same_inode_output(tmp_path):
    source = tmp_path / "source"
    source.write_bytes(b"private bytes")
    for maximum, copy in [(1, False), (100, True)]:
        reader = io.Reader(timeout=3)
        with source.open("r+b") as file, pytest.raises(io.ReadUnavailable):
            reader.run(file.fileno(), maximum, file.fileno() if copy else None)
        assert reader.process is None
    assert source.read_bytes() == b"private bytes"


def test_hash_only_does_not_transfer_large_attachment_bytes(tmp_path):
    source = tmp_path / "large.pdf"
    with source.open("wb") as file:
        file.seek(40_000_000)
        file.write(b"end")
    reader = io.Reader(timeout=3)
    tracemalloc.start()
    try:
        with source.open("rb") as file:
            data, digest, size = reader.run(file.fileno(), 50_000_000, read_bytes=False)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
        reader.close()
    assert data == b"" and size == source.stat().st_size
    with source.open("rb") as file:
        assert digest == hashlib.file_digest(file, "sha256").hexdigest()
    assert peak < 8 * 1024 ** 2


def test_frozen_entrypoint_worker_mode_bypasses_application_startup(tmp_path):
    # Exercise the exact command/argument boundary used by the frozen executable.
    parent, child = socket.socketpair()
    data_dir = tmp_path / "must-not-initialize"
    command = [sys.executable, str(Path(__file__).resolve().parents[1] / "server.py"),
               "--bounded-file-io-worker", str(child.fileno()), str(os.getpid())]
    process = subprocess.Popen(command, pass_fds=(child.fileno(),),
        env={**os.environ, "GNOSI_DATA_DIR": str(data_dir), "VAULT_PATH": str(data_dir)},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    child.close()
    reader = io.Reader(timeout=3)
    reader.channel, reader.process = parent, process
    source = tmp_path / "source"
    source.write_bytes(b"Only this authorized descriptor")
    try:
        with source.open("rb") as file:
            assert reader.run(file.fileno(), 100)[0] == source.read_bytes()
    finally:
        reader.close()
    assert process.returncode == 0
    assert not data_dir.exists()
    assert process.stdout.read() == b""



def test_cloud_source_timeout_leaves_no_partial_snapshot(tmp_path, monkeypatch):
    from backend.domains.sites import asset_files
    root = tmp_path / "vault"
    root.mkdir()
    source = root / "file.pdf"
    source.write_bytes(b"original")
    cache = tmp_path / "cache"
    monkeypatch.setattr(io, "cloud_path", lambda _: True)
    monkeypatch.setattr(io, "transfer", lambda *args, **kwargs: (_ for _ in ()).throw(io.ReadUnavailable("blocked")))
    with pytest.raises(asset_files.AssetFileError, match="deadline"):
        asset_files.snapshot_asset(source, root, cache)
    assert not list(cache.iterdir())
    assert source.read_bytes() == b"original"


def test_cloud_notes_use_owned_reader_and_preserve_content(tmp_path, monkeypatch):
    from backend.domains.sites import exporter
    from types import SimpleNamespace
    path = tmp_path / "note.md"
    path.write_text("---\nid: cloud-note\ntitle: Cloud\n---\nUnchanged body\n")
    monkeypatch.setattr(io, "cloud_path", lambda _: True)
    notes = exporter.notes(SimpleNamespace(vault=tmp_path))
    assert len(notes) == 1 and notes[0].metadata["id"] == "cloud-note"
    assert notes[0].body == "Unchanged body\n"
    assert notes[0].digest == hashlib.sha256(path.read_bytes()).hexdigest()
    assert io._current.get() is None


def test_scan_root_cannot_be_redirected_and_pin_closes_on_failure(tmp_path):
    from backend.domains.sites import asset_files
    inside, outside, alias = tmp_path / "inside", tmp_path / "outside", tmp_path / "alias"
    inside.mkdir()
    outside.mkdir()
    (inside / "note.md").write_bytes(b"allowed")
    (outside / "note.md").write_bytes(b"outside")
    alias.symlink_to(inside, target_is_directory=True)
    descriptor = None
    with pytest.raises(asset_files.AssetFileError, match="outside"):
        with asset_files.read_session():
            assert asset_files.read_selected_bytes(alias / "note.md", alias, 100) == b"allowed"
            descriptor = asset_files._read_roots.get()[0][2]
            alias.unlink()
            alias.symlink_to(outside, target_is_directory=True)
            asset_files.read_selected_bytes(alias / "note.md", alias, 100)
    assert asset_files._read_roots.get() is None
    if descriptor is not None:
        with pytest.raises(OSError):
            os.fstat(descriptor)
    # A separate request takes its own root; no authorization cache persists.
    with asset_files.read_session():
        assert asset_files.read_selected_bytes(alias / "note.md", alias, 100) == b"outside"
