"""Relation labels and both page index builders use the schema's actual title."""

from types import SimpleNamespace
import logging

import pytest

from backend.domains.vault.pages import foundation, index_entries
from backend.domains.vault.links import runtime as links


@pytest.mark.parametrize("name", ["Títol", "Título", "Title", "Titre"])
@pytest.mark.parametrize("key_kind", ["name", "id", "alias"])
def test_disk_memory_and_global_titles_match_schema_names_and_aliases(tmp_path, monkeypatch, name, key_kind):
    table = {"id": "qa", "properties": [{"id": "fld_12345678", "name": name, "type": "title", "aliases": ["Previous"]}]}
    key = {"name": name, "id": "fld_12345678", "alias": "Previous"}[key_kind]
    metadata = {"id": "page", "table_id": "qa", key: "Actual record title"}
    original = dict(metadata)
    path = tmp_path / "Unrelated filename.md"; path.write_text("Preserve source")
    monkeypatch.setattr(foundation, "_legacy", SimpleNamespace(_table_by_id=lambda _id: table))
    monkeypatch.setattr(foundation, "_resolve_page_context_from_path", lambda *_args: ("QA", "qa"))
    ports = index_entries.PageIndexEntryDependencies(parse_frontmatter=lambda *_args: (dict(metadata), "Body"),
        is_dashboard_file=lambda _: False, read_dashboard_file=lambda _: ({}, ""),
        process_metadata_paths=lambda value: value, vault_root=lambda: tmp_path,
        logger=logging.getLogger("fixture"), resolve_title=foundation._query_page_title)
    monkeypatch.setattr(index_entries, "_dependencies", ports)
    monkeypatch.setattr(index_entries, "_load_page_metadata", lambda _: (dict(metadata), "Body", False))
    disk = index_entries.build_page_cache_entry(path, path.stat())
    memory = index_entries.build_cache_entry_from_memory(path, path.stat(), metadata, "Body")
    monkeypatch.setattr(links, "_iter_linkable_page_documents", lambda: iter([(path, metadata, "Body", False)]))
    assert disk["title"] == memory["title"] == links._compute_id_title_index()["page"] == "Actual record title"
    assert metadata == original and path.read_text() == "Preserve source"


def test_dashboard_global_titles_keep_their_own_contract(tmp_path, monkeypatch):
    path = tmp_path / "dashboard.md"
    monkeypatch.setattr(links, "_iter_linkable_page_documents", lambda: iter([(path, {"id": "d", "title": "Dashboard"}, "", True)]))
    monkeypatch.setattr(foundation, "_query_page_title", lambda *_: pytest.fail("Dashboard must not use table schema"))
    assert links._compute_id_title_index() == {"d": "Dashboard"}
