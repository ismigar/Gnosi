"""Deterministic contract tests for the LLM Wiki lint report."""

from typing import Any

import pytest

from backend.services import llm_wiki_lint as lint


def _note(
    note_id: str,
    title: str,
    *,
    body: str = "",
    note_type: str = "lectura",
    review: str = "2026-08-28",
    managed_key: str = "",
    managed_role: str = "",
    managed_stale: bool = False,
    source_table_id: str = "",
    resource_id: str = "",
) -> dict[str, Any]:
    out_ids, out_titles = lint._outbound_targets(body)
    return {
        "id": note_id,
        "title": title,
        "body": body,
        "out_ids": out_ids,
        "out_titles": out_titles,
        "review": review,
        "note_type": note_type,
        "managed_key": managed_key,
        "managed_role": managed_role,
        "managed_stale": managed_stale,
        "source_table_id": source_table_id,
        "resource_id": resource_id,
    }


def test_run_lint_preserves_all_finding_categories(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notes = [
        _note(
            "alpha-id",
            "Alpha Concept",
            body="Beta Concept appears only as prose.",
            note_type="permanent",
            review="",
            managed_key="duplicate",
        ),
        _note(
            "beta-id",
            "Beta Concept",
            body="[[Alpha Concept|alpha-id]]",
            managed_key="duplicate",
            source_table_id="sources",
            resource_id="resource-1",
        ),
        _note(
            "old-id",
            "Superseded Note",
            note_type="resource-index",
            managed_stale=True,
        ),
    ]
    monkeypatch.setattr(lint, "_load_notes", lambda _table_id: notes)
    monkeypatch.setattr(
        lint,
        "_reprocess_candidates",
        lambda table_id: [{"id": f"reprocess-{table_id}"}],
    )
    monkeypatch.setattr(
        lint,
        "_broken_citations",
        lambda _notes: [{"id": "alpha-id", "segment_id": "missing"}],
    )

    report = lint.run_lint("brain", ["references"])

    assert report["orphans"] == [{"id": "beta-id", "title": "Beta Concept"}]
    assert report["stale"] == [
        {"id": "alpha-id", "title": "Alpha Concept", "review": None, "days": None}
    ]
    assert report["missing_xref"] == [
        {
            "id": "alpha-id",
            "title": "Alpha Concept",
            "should_link": "Beta Concept",
            "target_id": "beta-id",
        }
    ]
    assert report["reprocess"] == [{"id": "reprocess-references"}]
    assert report["duplicate_keys"] == [
        {
            "key": "duplicate",
            "notes": [
                {"id": "alpha-id", "title": "Alpha Concept"},
                {"id": "beta-id", "title": "Beta Concept"},
            ],
        }
    ]
    assert report["stale_managed"] == [{"id": "old-id", "title": "Superseded Note"}]
    assert report["broken_cites"] == [{"id": "alpha-id", "segment_id": "missing"}]
    assert report["index_drift"] == [{"source_table_id": "sources", "resource_id": "resource-1"}]
    assert report["counts"] == {
        "orphans": 1,
        "stale": 1,
        "missing_xref": 1,
        "reprocess": 1,
        "duplicate_keys": 1,
        "stale_managed": 1,
        "broken_cites": 1,
        "index_drift": 1,
    }
    assert report["truncated_missing_xref"] is False


def test_explicit_resource_index_prevents_drift() -> None:
    notes = [
        _note(
            "reading",
            "Reading",
            source_table_id="sources",
            resource_id="resource-1",
        ),
        _note(
            "index",
            "Index",
            note_type="resource-index",
            managed_role="resource-index",
            source_table_id="sources",
            resource_id="resource-1",
        ),
    ]

    assert lint._resource_index_drift(notes) == []
