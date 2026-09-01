"""Behavior and architecture contracts for persistent Vault document caches."""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

from backend.domains.vault.links import document_cache


def _dependencies(
    tmp_path: Path,
    body_cache: document_cache.BodyCache,
    parsed_cache: document_cache.ParsedDocumentCache,
    parse_calls: list[str],
) -> document_cache.DocumentCacheDependencies:
    def write_json(path: Path, payload: object) -> None:
        path.write_text(json.dumps(payload), encoding="utf-8")

    def parse_frontmatter(raw: str, path: Path) -> tuple[document_cache.Metadata, str]:
        parse_calls.append(path.name)
        return {"title": path.stem}, raw

    return document_cache.DocumentCacheDependencies(
        body_cache=body_cache,
        body_lock=threading.Lock(),
        parsed_cache=parsed_cache,
        parsed_lock=threading.Lock(),
        page_index_cache_path=lambda: tmp_path / "cache" / "page-index.json",
        data_dir=lambda: tmp_path,
        write_json=write_json,
        parse_frontmatter=parse_frontmatter,
        body_persist_debounce=0.0,
        parsed_persist_debounce=0.0,
        logger=logging.getLogger(__name__),
    )


def test_body_cache_round_trip_and_mtime_invalidation(tmp_path: Path) -> None:
    source = tmp_path / "Page.md"
    source.write_text("first", encoding="utf-8")
    body_cache: document_cache.BodyCache = {}
    parsed_cache: document_cache.ParsedDocumentCache = {}
    dependencies = _dependencies(tmp_path, body_cache, parsed_cache, [])

    assert document_cache.body_for_path(source, dependencies) == "first"
    assert document_cache.body_for_path(source, dependencies) == "first"

    first_mtime = source.stat().st_mtime_ns
    source.write_text("second", encoding="utf-8")
    os.utime(source, ns=(first_mtime + 1_000_000_000, first_mtime + 1_000_000_000))
    assert document_cache.body_for_path(source, dependencies) == "second"

    document_cache.save_body_cache(dependencies)
    body_cache.clear()
    assert document_cache.load_body_cache(dependencies) is True
    assert body_cache[str(source)][1] == "second"


def test_parsed_cache_reuses_parse_and_invalidates_after_rewrite(tmp_path: Path) -> None:
    source = tmp_path / "Document.md"
    source.write_text("original", encoding="utf-8")
    parse_calls: list[str] = []
    dependencies = _dependencies(tmp_path, {}, {}, parse_calls)

    assert document_cache.parsed_document(source, dependencies) == (
        {"title": "Document"},
        "original",
    )
    assert document_cache.parsed_document(source, dependencies) == (
        {"title": "Document"},
        "original",
    )
    assert parse_calls == ["Document.md"]

    first_mtime = source.stat().st_mtime_ns
    source.write_text("updated", encoding="utf-8")
    os.utime(source, ns=(first_mtime + 1_000_000_000, first_mtime + 1_000_000_000))
    assert document_cache.parsed_document(source, dependencies) == (
        {"title": "Document"},
        "updated",
    )
    assert parse_calls == ["Document.md", "Document.md"]


def test_document_cache_domain_does_not_import_http_facade() -> None:
    source_path = Path(document_cache.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
