"""Open document metadata and legacy cache guards at page-write boundaries."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

import pytest

from backend.domains.vault.links import document_inventory as inventory
from backend.domains.vault.pages import cache
from backend.domains.vault.pages.state import PreviewCacheEntry, page_state
from backend.utils.open_values import set_value


def test_inventory_preserves_unknown_metadata_and_replaces_stale_envelope(tmp_path: Path) -> None:
    path = tmp_path / "Synthetic.md"
    path.touch()
    metadata: dict[object, object] = {7: "nontext", "opaque": [False, None]}
    documents: list[inventory.LinkableDocument] = [(path, metadata, "Body", False)]
    cache_entries: inventory.DocumentCache = {"synthetic": {"docs": documents, "ts": 1.0}}
    now = [2.0]
    dependencies = inventory.DocumentInventoryDependencies(
        now=lambda: now[0],
        current_vault_key=lambda: "synthetic",
        cache=cache_entries,
        cache_lock=threading.Lock(),
        cache_ttl=60.0,
        vault_path=lambda: tmp_path,
        list_markdown=lambda path: [path / "Synthetic.md"],
        parsed_document=lambda path: (metadata, "Updated"),
        dashboards_path=lambda: None,
        read_dashboard=lambda path: ({}, ""),
        logger=logging.getLogger(__name__),
    )
    assert inventory.linkable_documents(dependencies) is documents
    now[0] = 62.0
    refreshed = inventory.linkable_documents(dependencies)
    assert refreshed is not documents
    assert refreshed[0][1] is metadata and refreshed[0][2] == "Updated"
    assert refreshed[0][1][7] == "nontext"
    assert cache_entries["synthetic"]["docs"] is refreshed


@pytest.mark.parametrize("bad_value", [None, False, 7, "malformed", []])
def test_preview_cache_keeps_corruption_guard_and_lru_refresh(
    monkeypatch: pytest.MonkeyPatch, bad_value: object
) -> None:
    from collections import OrderedDict

    entry: PreviewCacheEntry = {"mtime": 1.0, "short": {}}
    # Deliberate corruption through a native boundary, not a false payload cast.
    set_value(entry, "short", bad_value)
    monkeypatch.setattr(
        page_state,
        "preview_cache",
        OrderedDict(
            [
                ("a", entry),
                ("b", {"mtime": 2.0, "short": {}}),
            ]
        ),
    )
    assert cache.get_cached_preview("a", 1.0, False) is None
    assert list(page_state.preview_cache) == ["b", "a"]


def test_read_only_table_ports_preserve_nontext_keys_and_iteration_errors() -> None:
    from backend.domains.llm_wiki import dimensions
    from backend.domains.notebooks import catalog
    from backend.services import llm_wiki_config

    prop = {"id": "title", "type": "title", "name": "Title"}
    table: dict[object, object] = {7: "opaque key", "id": "synthetic", "properties": [prop]}
    assert llm_wiki_config.auto_detect_source(table)["title_property_id"] == "title"
    assert llm_wiki_config._properties(table)[0] is prop
    assert dimensions._properties_by_id(table)["title"] == prop
    catalog._resource_filter_properties(table)
    assert table[7] == "opaque key" and table["properties"] == [prop]
    for operation in (
        llm_wiki_config._properties,
        dimensions._properties_by_id,
        catalog._resource_filter_properties,
    ):
        with pytest.raises(TypeError):
            operation({"properties": 7})
