"""Compatibility contracts for modular LLM Wiki processing and indexes."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from backend.domains.llm_wiki import (
    dimensions,
    index_rendering,
    ingestion,
    planning,
    search_index,
    writing,
)
from backend.services import llm_wiki, llm_wiki_indices


def test_processing_facades_keep_historical_exports_and_small_domains() -> None:
    llm_wiki_exports = (
        "_apply_plan",
        "_build_chunk_prompt",
        "_canonical_dimension_value",
        "_dimension_context",
        "_dimension_options",
        "_metadata_property_value",
        "_parse_plan",
        "_validate_ai_dimensions",
        "_validate_and_reduce_plans",
        "process_resource",
        "start_ingest",
    )
    index_exports = (
        "_rebuild_dimension_indexes",
        "_rebuild_fts_index",
        "_rebuild_general_index",
        "_upsert_resource_index",
        "load_search_cache",
        "mark_search_index_stale",
        "rebuild_search_cache",
        "search_index_candidates",
        "search_index_status",
        "search_vector",
        "upsert_search_records",
        "vector_similarity",
    )
    assert all(callable(getattr(llm_wiki, name)) for name in llm_wiki_exports)
    assert all(callable(getattr(llm_wiki_indices, name)) for name in index_exports)

    paths = [
        Path(module.__file__ or "")
        for module in (
            dimensions,
            ingestion,
            index_rendering,
            planning,
            search_index,
            writing,
            llm_wiki,
            llm_wiki_indices,
        )
    ]
    assert all(len(path.read_text(encoding="utf-8").splitlines()) <= 800 for path in paths)
    domain_source = "\n".join(path.read_text(encoding="utf-8") for path in paths[:6])
    assert "backend.services.llm_wiki" not in domain_source


def test_planning_facade_resolves_locator_and_dimension_seams_late(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        llm_wiki,
        "_locator_label",
        lambda locator: f"page-{locator['page']}",
    )
    prompt = llm_wiki._build_chunk_prompt(  # noqa: SLF001
        {
            "origin_label": "Book",
            "kind": "pdf",
            "segments": [{"id": "segment-1", "text": "Grounded text", "locator": {"page": 7}}],
        },
        "Resource",
        [],
        "English",
        [],
    )
    assert "[SEGMENT segment-1 | page-7]" in prompt

    observed: list[Any] = []

    def validate_dimensions(
        raw: Any,
        _allowed: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        observed.append(raw)
        return {"field": "canonical"}

    monkeypatch.setattr(llm_wiki, "_validate_ai_dimensions", validate_dimensions)
    note = {
        "title": "Atomic idea",
        "source_segment_id": "segment-1",
        "dimensions": {"field": "model-label"},
        "citations": [{"segment_id": "segment-1", "quote": "Grounded text"}],
    }
    origins = [
        {
            "origin_id": "origin-1",
            "input_order": 0,
            "label": "Book",
            "kind": "pdf",
            "snapshot_id": "snapshot-1",
            "source_url": "",
            "segments": [
                {
                    "id": "segment-1",
                    "order": 1,
                    "text": "Grounded text",
                    "locator": {"page": 7},
                }
            ],
        }
    ]
    reduced, warnings = llm_wiki._validate_and_reduce_plans(  # noqa: SLF001
        [({"segments": origins[0]["segments"]}, {"notes": [note]})],
        origins,
        [{"field_id": "field"}],
    )
    assert warnings == []
    assert observed == [{"field": "model-label"}]
    assert reduced[0]["dimensions"] == {"field": "canonical"}


def test_index_rendering_facade_resolves_upsert_seam_late(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    def upsert(*args: Any, **kwargs: Any) -> dict[str, Any]:
        captured.append((args, kwargs))
        return {"id": "index-1", "title": str(args[1])}

    monkeypatch.setattr(llm_wiki_indices, "_upsert_managed_page", upsert)
    page = SimpleNamespace(
        id="note-1",
        title="Atomic idea",
        metadata={
            "llm_wiki_resource_title": "Resource",
            "llm_wiki_origin_order": 0,
            "Posició": 1,
        },
    )
    result = llm_wiki_indices._upsert_resource_index(  # noqa: SLF001
        "brain",
        "sources",
        "resource-1",
        [page],
        {},
        {"ui_locale": "en", "index_field_ids": [], "brain_roles": {}},
        {},
    )
    assert result == {"id": "index-1", "title": "Index · Resource"}
    assert captured[0][0][4] == "1. [[note-1|Atomic idea]]"


def test_ingestion_facade_resolves_generation_and_write_seams_late(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    origin = {
        "origin_id": "origin-1",
        "input_order": 0,
        "label": "Source",
        "kind": "text",
        "content_hash": "hash-1",
        "segments": [
            {
                "id": "segment-1",
                "order": 1,
                "text": "Grounded text",
                "locator": {"line_start": 1},
            }
        ],
    }
    config = {
        "version": 2,
        "brain_table_id": "brain",
        "source_tables": [{"table_id": "sources"}],
        "index_field_ids": [],
        "brain_roles": {},
    }
    applied: list[dict[str, Any]] = []
    generated: list[str] = []
    manifests: list[dict[str, Any]] = []
    monkeypatch.setattr(llm_wiki.llm_wiki_config, "load_config", lambda: config)
    monkeypatch.setattr(
        llm_wiki.llm_wiki_extractors,
        "extract_resource_sources",
        lambda *_args, **_kwargs: ([origin], []),
    )
    monkeypatch.setattr(
        llm_wiki.llm_wiki_storage,
        "save_snapshot",
        lambda *_args: {"snapshot_id": "snapshot-1"},
    )
    monkeypatch.setattr(llm_wiki, "_load_brain_index", lambda *_args: [])
    monkeypatch.setattr(llm_wiki, "_dimension_context", lambda *_args: ({}, []))

    def generate(prompt: str, **_kwargs: Any) -> tuple[str, str]:
        generated.append(prompt)
        return (
            '{"summary":"Grounded summary","notes":['
            '{"title":"Atomic idea","type":"concepte",'
            '"body_md":"Body","source_segment_id":"segment-1",'
            '"dimensions":{},"citations":['
            '{"segment_id":"segment-1","quote":"Grounded text"}]}]}',
            "test-model",
        )

    monkeypatch.setattr("backend.agent.factory.generate_text", generate)

    def apply(plan: dict[str, Any], *_args: Any, **_kwargs: Any) -> dict[str, list[str]]:
        applied.append(plan)
        return {"created": ["Atomic idea"], "created_ids": ["note-1"], "updated": []}

    monkeypatch.setattr(llm_wiki, "_apply_plan", apply)
    monkeypatch.setattr(
        llm_wiki.llm_wiki_pdf_annotations,
        "sync_generated_pdf_annotations",
        lambda *_args: {"warnings": []},
    )
    monkeypatch.setattr(llm_wiki.llm_wiki_storage, "load_manifest", lambda *_args: {})
    monkeypatch.setattr(
        llm_wiki.llm_wiki_storage,
        "save_manifest",
        lambda _table, _page, manifest: manifests.append(manifest),
    )

    report = llm_wiki.process_resource(
        "resource-1",
        "Resource",
        {"table_id": "sources"},
        "",
        "brain",
        tmp_path,
        source_table_id="sources",
        source_table={"id": "sources", "properties": []},
        source_config={"table_id": "sources"},
    )
    assert generated and "[SEGMENT segment-1" in generated[0]
    assert applied[0]["notes"][0]["managed_key"]
    assert report["model"] == "test-model"
    assert report["created_ids"] == ["note-1"]
    assert manifests[0]["managed_keys"] == report["managed_keys"]


def test_search_rebuild_resolves_vector_and_storage_seams_late(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    written: list[dict[str, Any]] = []
    indexed: list[list[dict[str, Any]]] = []
    page = SimpleNamespace(id="note-1", title="Atomic idea", path="note.md")
    monkeypatch.setattr(llm_wiki_indices, "_brain_pages", lambda _table_id: [page])
    monkeypatch.setattr(
        llm_wiki_indices,
        "_meta",
        lambda _page: {"note_type": "lectura"},
    )
    monkeypatch.setattr(llm_wiki_indices, "_path", lambda _page: Path("note.md"))
    monkeypatch.setattr(
        llm_wiki_indices,
        "_read_page",
        lambda _path: ({}, "Grounded body"),
    )
    monkeypatch.setattr(llm_wiki_indices, "search_vector", lambda _text: [7.0])
    monkeypatch.setattr(
        llm_wiki_indices,
        "safe_write_json",
        lambda _path, payload, **_kwargs: written.append(payload),
    )

    def upsert_records(
        _brain_table_id: str,
        records: Any,
        *,
        replace_snapshot: bool = False,
    ) -> int:
        assert replace_snapshot is True
        indexed.append(list(records))
        return 1

    monkeypatch.setattr(llm_wiki_indices, "upsert_search_records", upsert_records)
    monkeypatch.setattr("backend.api.vault_routes.get_p", lambda _key: tmp_path)
    monkeypatch.setattr(
        "backend.agent.vault_tools.clear_wiki_search_cache",
        lambda _table_id: None,
    )

    assert llm_wiki_indices.rebuild_search_cache("brain") == 1
    assert written[0]["notes"][0]["vector"] == [7.0]
    assert indexed[0][0]["id"] == "note-1"
