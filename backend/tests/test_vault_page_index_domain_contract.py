"""Architecture and compatibility contracts for the extracted page index."""

from __future__ import annotations

from pathlib import Path

from backend.api import vault_routes
from backend.domains.vault.pages import index_entries, index_service


def test_legacy_facade_exports_canonical_page_index_callables() -> None:
    assert vault_routes._read_frontmatter_partial is index_entries.read_frontmatter_partial
    assert vault_routes._build_page_cache_entry is index_entries.build_page_cache_entry
    assert vault_routes._get_cached_page_entries is index_service.get_cached_page_entries
    assert vault_routes._get_pages_snapshot is index_service.get_pages_snapshot
    assert vault_routes._refresh_page_index_entry is index_service.refresh_page_index_entry


def test_page_index_domain_does_not_import_the_http_facade() -> None:
    for module in (index_entries, index_service):
        source_path = Path(module.__file__ or "")
        assert source_path.is_file()
        assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
