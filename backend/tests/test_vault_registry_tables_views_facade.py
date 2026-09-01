"""Compatibility facade contracts for the extracted registry subdomains."""

from __future__ import annotations

import asyncio

import pytest

from backend.api import vault_routes


HELPER_EXPORTS = (
    "load_registry",
    "save_registry",
    "registry_mutation",
    "_update_registry_cache",
    "_normalize_table_view_name",
    "_normalize_registry_table_view_names",
    "_ensure_main_view",
    "_create_table_locked",
    "_rename_table_locked",
    "_patch_table_property_locked",
    "_find_table_and_prop",
    "_rewrite_option_in_rows",
    "_resolve_subpath_within_vault",
)


def test_legacy_facade_keeps_domain_helper_exports() -> None:
    assert all(callable(getattr(vault_routes, name)) for name in HELPER_EXPORTS)


def test_domain_adapters_resolve_monkeypatched_facade_callbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registry = {
        "databases": [{"id": "db", "name": "Database"}],
        "tables": [{"id": "table", "name": "Table", "database_id": "db"}],
        "views": [],
    }
    monkeypatch.setattr(vault_routes, "load_registry", lambda: registry)

    assert asyncio.run(vault_routes.list_databases()) == registry["databases"]
    assert asyncio.run(vault_routes.list_tables("db")) == registry["tables"]
    response = asyncio.run(vault_routes.get_registry())
    assert response["databases"] == registry["databases"]
