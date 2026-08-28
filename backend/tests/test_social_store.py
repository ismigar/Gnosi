from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import BackgroundTasks

from backend.services import social_store


def test_save_publication_uses_stable_table_and_readable_fallback_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def ensure_table() -> str:
        return social_store.SOCIAL_TABLE_ID

    async def create_page(**kwargs: Any) -> dict[str, Any]:
        captured.update(kwargs)
        return {"id": "page-1"}

    monkeypatch.setattr(social_store, "ensure_social_table", ensure_table)
    monkeypatch.setattr(social_store.vault_ports, "create_page", create_page)

    page_id = asyncio.run(
        social_store.save_publication(
            networks=["mastodon"],
            proposals={"mastodon": {"text": "First line\nSecond line"}},
            background_tasks=BackgroundTasks(),
        )
    )

    assert page_id == "page-1"
    assert captured["title"] == "First line"
    metadata = captured["metadata"]
    assert metadata["table_id"] == social_store.SOCIAL_TABLE_ID
    assert json.loads(metadata[social_store.COL_MESSAGES]) == {
        "mastodon": {"text": "First line\nSecond line"}
    }


def test_update_publication_merges_results_with_stored_message(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    page = tmp_path / "publication.md"
    page.write_text("stored", encoding="utf-8")
    captured: dict[str, Any] = {}

    monkeypatch.setattr(social_store.vault_ports, "find_page_path", lambda _page_id: page)
    monkeypatch.setattr(
        social_store.vault_ports,
        "parse_frontmatter",
        lambda _raw, _path: (
            {social_store.COL_MESSAGES: '{"mastodon": {"text": "Hello"}}'},
            "",
        ),
    )

    async def patch_page(
        page_id: str,
        metadata: dict[str, Any],
        background_tasks: BackgroundTasks,
    ) -> None:
        captured.update(page_id=page_id, metadata=metadata, tasks=background_tasks)

    monkeypatch.setattr(social_store.vault_ports, "patch_page", patch_page)

    asyncio.run(
        social_store.update_publication(
            "page-1",
            background_tasks=BackgroundTasks(),
            status=social_store.STATUS_PUBLISHED,
            results={"mastodon": {"url": "https://example.test/post/1"}},
        )
    )

    messages = json.loads(captured["metadata"][social_store.COL_MESSAGES])
    assert messages["mastodon"] == {
        "text": "Hello",
        "url": "https://example.test/post/1",
    }
    assert captured["metadata"][social_store.COL_STATUS] == social_store.STATUS_PUBLISHED


def test_list_publications_filters_other_tables_and_statuses(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    for name in ("published.md", "draft.md", "other.md"):
        (tmp_path / name).write_text(name, encoding="utf-8")

    records = {
        "published.md": {
            "database_table_id": social_store.SOCIAL_TABLE_ID,
            social_store.COL_STATUS: social_store.STATUS_PUBLISHED,
        },
        "draft.md": {
            "database_table_id": social_store.SOCIAL_TABLE_ID,
            social_store.COL_STATUS: social_store.STATUS_DRAFT,
        },
        "other.md": {"database_table_id": "other"},
    }
    monkeypatch.setattr(
        social_store.vault_ports,
        "resolve_table_folder",
        lambda _metadata: tmp_path,
    )
    monkeypatch.setattr(
        social_store.vault_ports,
        "parse_frontmatter",
        lambda _raw, path: (records[path.name], ""),
    )

    publications = asyncio.run(
        social_store.list_publications(status=social_store.STATUS_PUBLISHED)
    )

    assert publications == [records["published.md"]]
