"""Tests for the atomic write helpers in backend/utils/safe_io.py.

What we cover:
    - safe_write_text overwrites atomically (no temp file leftover, content correct)
    - safe_write_json round-trips with non-ASCII content
    - file_etag changes when the file changes and is None when missing
    - file_mtime_ns parity with the etag

What we deliberately do NOT cover here:
    - Real OneDrive FUSE behaviour (out of scope for unit tests)
    - Crash-during-fsync recovery (would need fault injection)

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_safe_io.py -v
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from backend.utils.safe_io import (
    file_etag,
    file_mtime_ns,
    safe_write_bytes,
    safe_write_json,
    safe_write_text,
)


def test_safe_write_text_creates_file(tmp_path: Path):
    target = tmp_path / "subdir" / "note.md"
    safe_write_text(target, "hello world")
    assert target.read_text() == "hello world"


def test_safe_write_text_overwrites_atomically(tmp_path: Path):
    target = tmp_path / "note.md"
    safe_write_text(target, "v1")
    safe_write_text(target, "v2 with àccents — emojis 🎉")
    assert target.read_text() == "v2 with àccents — emojis 🎉"
    # No leftover tmp files in the directory
    siblings = [p.name for p in tmp_path.iterdir()]
    assert siblings == ["note.md"], f"unexpected leftovers: {siblings}"


def test_safe_write_json_roundtrip(tmp_path: Path):
    target = tmp_path / "registry.json"
    payload = {"Projectes": ["uuid1", "uuid2"], "Arxivar": False, "n": 42}
    safe_write_json(target, payload)
    loaded = json.loads(target.read_text())
    assert loaded == payload


def test_safe_write_bytes_binary(tmp_path: Path):
    target = tmp_path / "blob.bin"
    data = b"\x00\x01\x02\xff\xfe"
    safe_write_bytes(target, data)
    assert target.read_bytes() == data


def test_file_etag_none_for_missing(tmp_path: Path):
    assert file_etag(tmp_path / "nope.md") is None
    assert file_mtime_ns(tmp_path / "nope.md") is None


def test_file_etag_changes_after_write(tmp_path: Path):
    target = tmp_path / "note.md"
    safe_write_text(target, "v1")
    etag_v1 = file_etag(target)
    assert etag_v1 is not None
    # Different content of different length must change the etag
    safe_write_text(target, "v2 longer content")
    etag_v2 = file_etag(target)
    assert etag_v1 != etag_v2


def test_safe_write_cleans_tmp_on_error(tmp_path: Path, monkeypatch):
    """If os.replace raises, the temp file must be cleaned up."""
    target = tmp_path / "note.md"
    # Pre-existing file we shouldn't damage
    target.write_text("original")

    def boom(*args, **kwargs):
        raise OSError("simulated rename failure")

    monkeypatch.setattr("os.replace", boom)
    with pytest.raises(OSError):
        safe_write_text(target, "new content")
    # Original survives
    assert target.read_text() == "original"
    # No orphan .tmp file
    tmp_files = [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")]
    assert tmp_files == [], f"orphan tmp files: {tmp_files}"
