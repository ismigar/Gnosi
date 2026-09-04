"""Regression tests for the opt-in Knowledge sidebar projection."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.domains.vault.api import pages_queries
from backend.domains.vault.api.pages_queries import _compact_sidebar_metadata
from backend.domains.vault.schemas.pages import PageInfo


def test_compact_sidebar_metadata_preserves_navigation_and_visual_fields() -> None:
    metadata: dict[object, object] = {
        "favorite": True,
        "icon": "🧠",
        "tags": ["research/topic"],
        "table_id": "notes",
        "database_table_id": "notes",
        "resolved_table_id": "notes",
        "is_dashboard": True,
        "is_template": False,
        "is_default_template": False,
        "date": "2026-09-04",
        "source": "gnosi",
        "note_type": "daily",
        "translation_lang": "ca",
        "large_user_field": "x" * 20_000,
    }

    compact = _compact_sidebar_metadata(metadata)

    assert compact == {
        key: value
        for key, value in metadata.items()
        if key != "large_user_field"
    }


def test_compact_sidebar_projection_removes_large_unneeded_user_fields() -> None:
    metadata = {
        "favorite": False,
        "icon": "📄",
        "table_id": "resources",
        "embedding_input": "synthetic " * 2_000,
        "extracted_document": "fixture " * 8_000,
    }

    full_bytes = len(json.dumps(metadata, separators=(",", ":")).encode())
    compact_bytes = len(
        json.dumps(
            _compact_sidebar_metadata(metadata),
            separators=(",", ":"),
        ).encode()
    )

    assert compact_bytes < full_bytes * 0.01


def test_sidebar_projection_is_opt_in_and_keeps_legacy_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    page = PageInfo(
        id="00000000-0000-4000-8000-000000000001",
        title="Synthetic page",
        metadata={"favorite": True, "custom_user_field": "preserved"},
        last_modified="2026-09-04T00:00:00+00:00",
        size=64,
    )
    dependencies = SimpleNamespace(get_pages_snapshot=lambda: [page])
    monkeypatch.setattr(pages_queries, "_dependencies", dependencies)

    legacy = asyncio.run(pages_queries.list_sidebar_summary(compact=False))
    compact = asyncio.run(pages_queries.list_sidebar_summary(compact=True))

    assert legacy[0].metadata == {
        "favorite": True,
        "custom_user_field": "preserved",
    }
    assert compact[0].metadata == {"favorite": True}
