"""Regression tests for the opt-in Knowledge sidebar projection."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.domains.vault.api import pages_queries
from backend.domains.vault.api.pages_queries import _compact_sidebar_metadata
from backend.domains.vault.api.pages_queries import _sparse_sidebar_metadata
from backend.domains.vault.schemas.pages import PageInfo, SidebarPageInfo


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


def test_sparse_sidebar_metadata_removes_only_exact_top_level_duplicates() -> None:
    page = PageInfo(
        id="00000000-0000-4000-8000-000000000001",
        title="Synthetic page",
        metadata={
            "id": "00000000-0000-4000-8000-000000000001",
            "table_id": "notes",
            "database_table_id": "legacy-notes",
            "resolved_table_id": "notes",
            "icon": "🧠",
        },
        resolved_table_id="notes",
        last_modified="2026-09-04T00:00:00+00:00",
        size=64,
    )

    assert _sparse_sidebar_metadata(page) == {
        "database_table_id": "legacy-notes",
        "icon": "🧠",
    }


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


def test_sparse_sidebar_tree_omits_only_structural_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pages = [
        PageInfo(
            id="00000000-0000-4000-8000-000000000001",
            title="Root",
            metadata={},
            last_modified="2026-09-04T00:00:00+00:00",
            size=64,
        ),
        PageInfo(
            id="00000000-0000-4000-8000-000000000002",
            title="Child",
            parent_id="00000000-0000-4000-8000-000000000001",
            is_database=True,
            metadata={"favorite": True, "ignored": "large"},
            last_modified="2026-09-04T00:01:00+00:00",
            size=64,
            folder="BD/Notes",
            resolved_table_id="notes",
        ),
    ]
    monkeypatch.setattr(
        pages_queries,
        "_dependencies",
        SimpleNamespace(get_pages_snapshot=lambda: pages),
    )

    response = asyncio.run(pages_queries.list_sidebar_tree())

    assert [page.model_dump(exclude_none=True) for page in response] == [
        {
            "id": pages[0].id,
            "title": "Root",
            "last_modified": "2026-09-04T00:00:00+00:00",
        },
        {
            "id": pages[1].id,
            "title": "Child",
            "last_modified": "2026-09-04T00:01:00+00:00",
            "parent_id": pages[0].id,
            "is_database": True,
            "metadata": {"favorite": True},
            "folder": "BD/Notes",
            "resolved_table_id": "notes",
        },
    ]


def test_sparse_sidebar_tree_reduces_repeated_structural_bytes() -> None:
    pages = [
        PageInfo(
            id=f"00000000-0000-4000-8000-{index:012d}",
            title=f"Synthetic {index}",
            metadata={},
            last_modified="2026-09-04T00:00:00+00:00",
            size=64,
        )
        for index in range(3_000)
    ]
    full = [
        SidebarPageInfo.model_validate({
            "id": page.id,
            "title": page.title,
            "parent_id": page.parent_id,
            "is_database": page.is_database,
            "metadata": {},
            "last_modified": page.last_modified,
            "folder": page.folder,
            "resolved_table_id": page.resolved_table_id,
        }).model_dump()
        for page in pages
    ]
    sparse = [
        pages_queries.SidebarTreePageInfo(
            id=page.id,
            title=page.title,
            last_modified=page.last_modified,
        ).model_dump(exclude_none=True)
        for page in pages
    ]

    full_bytes = len(json.dumps(full, separators=(",", ":")).encode())
    sparse_bytes = len(json.dumps(sparse, separators=(",", ":")).encode())

    assert sparse_bytes < full_bytes * 0.6
