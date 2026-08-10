"""Tests for the dry-run/apply Notion view registry cleanup."""
from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "pipeline/skills/notion_clone/scripts/cleanup_notion_views.py"
)
SPEC = importlib.util.spec_from_file_location("cleanup_notion_views", SCRIPT)
assert SPEC and SPEC.loader
cleanup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cleanup)


def test_compact_registry_rewrites_aliases_and_prunes_only_unreferenced_embeds():
    registry = {
        "views": [
            {
                "id": "global-1", "table_id": "t", "name": "Shared",
                "type": "table", "embedded": True, "source_view_id": "source-1",
            },
            {
                "id": "global-2", "table_id": "t", "name": "Shared",
                "type": "table", "embedded": True, "source_view_id": "source-1",
            },
            {
                "id": "orphan", "table_id": "t", "name": "Orphan",
                "type": "table", "embedded": True, "source_view_id": "source-2",
            },
            {
                "id": "user", "table_id": "t", "name": "User view", "type": "table",
            },
        ]
    }
    compacted, aliases, orphans = cleanup.compact_registry(
        registry, "t", True, {"global-2"}
    )
    assert aliases == {"global-2": "global-1"}
    assert orphans == ["orphan"]
    assert [view["id"] for view in compacted["views"]] == ["global-1", "user"]
