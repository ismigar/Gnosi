"""Architecture and compatibility contracts for the extracted page index."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.api import vault_routes
from backend.domains.vault.pages import index_entries, index_service, resolver


def test_legacy_facade_exports_canonical_page_index_callables() -> None:
    assert vault_routes._read_frontmatter_partial is index_entries.read_frontmatter_partial
    assert vault_routes._build_page_cache_entry is index_entries.build_page_cache_entry
    assert vault_routes._get_cached_page_entries is index_service.get_cached_page_entries
    assert vault_routes._get_pages_snapshot is index_service.get_pages_snapshot
    assert vault_routes._refresh_page_index_entry is index_service.refresh_page_index_entry


def test_page_index_domain_does_not_import_the_http_facade() -> None:
    for module in (index_entries, index_service, resolver):
        source_path = Path(module.__file__ or "")
        assert source_path.is_file()
        assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")


def test_page_resolver_finds_canonical_uuid_during_cold_scan(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    page = vault / "record.md"
    page.write_text(
        "---\nid: df3614865ff34a1490055d9b7b456492\n---\nBody\n",
        encoding="utf-8",
    )
    vault_key = str(vault)
    monkeypatch.setattr(vault_routes, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(vault_routes, "get_p", lambda _name: vault)
    vault_routes._page_index_entries.pop(vault_key, None)
    vault_routes._page_index_initialized.pop(vault_key, None)
    vault_routes._page_id_to_path.pop(vault_key, None)
    try:
        resolved = vault_routes.find_page_path("df361486-5ff3-4a14-9005-5d9b7b456492")
        assert resolved == page
    finally:
        vault_routes._page_index_entries.pop(vault_key, None)
        vault_routes._page_index_initialized.pop(vault_key, None)
        vault_routes._page_id_to_path.pop(vault_key, None)


def test_page_resolver_retains_title_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    page = vault / "page.md"
    page.write_text("---\nid: page-id\ntitle: Human title\n---\n", encoding="utf-8")
    vault_key = str(vault)
    monkeypatch.setattr(vault_routes, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(vault_routes, "get_p", lambda _name: vault)
    vault_routes._page_index_entries[vault_key] = {
        str(page): {"id": "page-id", "title": "Human title"}
    }
    vault_routes._page_id_to_path[vault_key] = {}
    try:
        assert vault_routes.find_page_path("human title") == page
        assert vault_routes._page_id_to_path[vault_key]["page-id"] == str(page)
    finally:
        vault_routes._page_index_entries.pop(vault_key, None)
        vault_routes._page_id_to_path.pop(vault_key, None)
