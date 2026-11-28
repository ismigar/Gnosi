"""Tests for persistent local disk caching of LLM Wiki page sidecars."""

from __future__ import annotations

import json
import os
from pathlib import Path

from backend.services import llm_wiki_page_cache, llm_wiki_storage


def test_page_state_disk_cache_survives_cold_restart_without_rereading(
    tmp_path: Path, monkeypatch
) -> None:
    local_dir = tmp_path / "local"
    synced_dir = tmp_path / "vault" / ".gnosi" / "llm_wiki"
    pages_dir = synced_dir / "pages"
    pages_dir.mkdir(parents=True)
    sidecar = pages_dir / "note-1.json"
    sidecar.write_text(
        json.dumps({"version": 1, "page_id": "note-1", "metadata": {"llm_wiki_resource_id": "book-1"}}),
        encoding="utf-8",
    )

    monkeypatch.setattr(llm_wiki_storage, "local_root", lambda: local_dir)
    monkeypatch.setattr(llm_wiki_storage, "synced_root", lambda: synced_dir)
    llm_wiki_storage._PAGE_STATE_CACHE.clear()  # noqa: SLF001
    llm_wiki_page_cache.reset_state()

    reads: list[Path] = []
    real_read_json = llm_wiki_storage._read_json  # noqa: SLF001

    def counting_read(path: Path) -> object:
        reads.append(path)
        return real_read_json(path)

    monkeypatch.setattr(llm_wiki_storage, "_read_json", counting_read)

    # First read populates RAM cache and marks disk cache dirty.
    first = llm_wiki_storage.load_page_state("note-1")
    assert first == {"llm_wiki_resource_id": "book-1"}
    assert reads == [sidecar]

    llm_wiki_storage.flush_page_state_cache()
    assert (local_dir / llm_wiki_page_cache.CACHE_FILENAME).exists()

    # Simulate an app restart: clear in-memory caches and verify 0 sidecar reads.
    llm_wiki_storage._PAGE_STATE_CACHE.clear()  # noqa: SLF001
    llm_wiki_page_cache.reset_state()
    reads.clear()

    second = llm_wiki_storage.load_page_state("note-1")
    assert second == {"llm_wiki_resource_id": "book-1"}
    assert reads == []

    # Mutating the sidecar invalidates the cached signature and triggers a fresh read.
    sidecar.write_text(
        json.dumps({"version": 1, "page_id": "note-1", "metadata": {"llm_wiki_resource_id": "book-2"}}),
        encoding="utf-8",
    )
    stat = sidecar.stat()
    os.utime(sidecar, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))

    third = llm_wiki_storage.load_page_state("note-1")
    assert third == {"llm_wiki_resource_id": "book-2"}
    assert reads == [sidecar]


def test_page_state_disk_cache_ignores_corrupt_file(tmp_path: Path, monkeypatch) -> None:
    local_dir = tmp_path / "local"
    local_dir.mkdir(parents=True)
    (local_dir / llm_wiki_page_cache.CACHE_FILENAME).write_text("{corrupt", encoding="utf-8")

    synced_dir = tmp_path / "vault" / ".gnosi" / "llm_wiki"
    pages_dir = synced_dir / "pages"
    pages_dir.mkdir(parents=True)
    sidecar = pages_dir / "note-2.json"
    sidecar.write_text(
        json.dumps({"version": 1, "page_id": "note-2", "metadata": {"llm_wiki_resource_id": "book-9"}}),
        encoding="utf-8",
    )

    monkeypatch.setattr(llm_wiki_storage, "local_root", lambda: local_dir)
    monkeypatch.setattr(llm_wiki_storage, "synced_root", lambda: synced_dir)
    llm_wiki_storage._PAGE_STATE_CACHE.clear()  # noqa: SLF001
    llm_wiki_page_cache.reset_state()

    assert llm_wiki_storage.load_page_state("note-2") == {"llm_wiki_resource_id": "book-9"}
