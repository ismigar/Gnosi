"""Compatibility contracts for database rules, catalogs, views and lookups."""

from __future__ import annotations

import inspect
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any, cast

import pytest

from backend.domains.vault.citations.normalizers import crossref as crossref_domain
from backend.domains.vault.tables.catalogs import core as catalogs_domain
from backend.services import lookup_normalizers, option_catalogs, rule_engine, view_snapshot


class _ResolverSpy:
    def __init__(self, resolved: Path) -> None:
        self.resolved = resolved
        self.calls: list[tuple[str, Path]] = []

    def find_path(self, record_id: str, vault_path: Path) -> Path | None:
        self.calls.append((record_id, vault_path))
        return self.resolved

    def list_all_files(self, vault_path: Path) -> list[Path]:
        return []


def test_historical_lookup_and_catalog_exports_are_stable() -> None:
    lookup_names = {
        "_CROSSREF_TYPE_TO_ZOTERO",
        "_DOI_RE_LOCAL",
        "_normalize_doi_local",
        "_normalize_isbn_local",
        "_parse_meta_tags",
        "_pubmed_name_to_creator",
        "_split_full_name",
        "arxiv_to_zotero_item",
        "crossref_to_zotero_item",
        "html_meta_to_zotero_item",
        "openlibrary_to_zotero_item",
        "pubmed_to_zotero_item",
    }
    catalog_names = {
        "BASE_STATUS_SEED",
        "DEFAULT_STATUS_GROUPS",
        "OPTION_COLOR_PALETTE",
        "OPTION_TYPES",
        "ROLE_LANGUAGE",
        "ROLE_STATUS",
        "ROLE_TAGS",
        "STATUS_CATALOG_REF",
        "assign_roles",
        "auto_color",
        "ensure_global_status_catalog",
        "ensure_options_exist",
        "ensure_status_seed",
        "ensure_table_seeds",
        "find_role_prop",
        "get_prop_config",
        "get_prop_options",
        "is_global_status_prop",
        "normalize_option",
        "normalize_options",
        "normalize_table_options",
        "option_names",
        "prop_role",
        "set_prop_options",
        "table_has_social_column",
    }
    assert lookup_names <= set(vars(lookup_normalizers))
    assert catalog_names <= set(vars(option_catalogs))
    assert lookup_normalizers.crossref_to_zotero_item is crossref_domain.crossref_to_zotero_item
    assert option_catalogs.normalize_options is catalogs_domain.normalize_options


def test_historical_import_globals_remain_available() -> None:
    expected_by_module: tuple[tuple[ModuleType, set[str]], ...] = (
        (lookup_normalizers, {"Any", "Optional", "re"}),
        (
            option_catalogs,
            {"Any", "Dict", "List", "Optional", "Tuple", "re", "unicodedata"},
        ),
        (
            rule_engine,
            {
                "Any",
                "Dict",
                "List",
                "NameNotDefined",
                "Optional",
                "Path",
                "Set",
                "SimpleEval",
                "Tuple",
                "_datetime",
                "datetime",
                "deque",
                "json",
                "logging",
                "math",
                "path_resolver",
                "re",
                "relation_keys_from_table",
                "strip_relation_wikilinks",
                "threading",
                "yaml",
            },
        ),
        (
            view_snapshot,
            {
                "Any",
                "Callable",
                "Dict",
                "List",
                "Optional",
                "Sequence",
                "_decorate_item",
                "cmp_to_key",
                "date",
                "json",
                "re",
                "unicodedata",
            },
        ),
    )
    for module, names in expected_by_module:
        assert names <= set(vars(module))


def test_historical_call_signatures_keep_parameter_order() -> None:
    expected = {
        lookup_normalizers.crossref_to_zotero_item: ("work",),
        lookup_normalizers.html_meta_to_zotero_item: ("html", "url"),
        option_catalogs.get_prop_options: ("prop", "option_catalogs"),
        option_catalogs.ensure_global_status_catalog: ("registry",),
        view_snapshot.inject_view_snapshots: (
            "body",
            "resolve_ids",
            "id_to_title",
            "host_page_id",
            "max_items",
            "config_for",
            "resolve_table",
        ),
        view_snapshot.apply_joins: ("base_rows", "joins", "loader"),
    }
    for function, parameter_names in expected.items():
        subject = function
        assert (
            tuple(inspect.signature(cast(Callable[..., Any], subject)).parameters)
            == parameter_names
        )
    assert tuple(inspect.signature(rule_engine.RuleEngine).parameters) == ("vault_path",)


def test_rule_engine_resolves_the_current_historical_path_global(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved = tmp_path / "row.md"
    resolved.write_text("---\nid: row\n---\n", encoding="utf-8")
    resolver = _ResolverSpy(resolved)
    monkeypatch.setattr(rule_engine, "path_resolver", resolver)

    engine = rule_engine.RuleEngine(tmp_path)

    assert engine._find_record_path("row") == resolved
    assert resolver.calls == [("row", tmp_path)]


def test_view_snapshot_uses_the_current_historical_decorator_global(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def decorate(
        value: Any,
        id_to_title: object = None,
        title_to_id: object = None,
    ) -> str:
        del id_to_title, title_to_id
        calls.append(str(value))
        return f"[[Decorated|{value}]]"

    monkeypatch.setattr(view_snapshot, "_decorate_item", decorate)
    body = '```gnosi-view\n{"view_id":"view-1"}\n```'

    materialized = view_snapshot.inject_view_snapshots(
        body,
        lambda view_id, host_page_id: ["row-1"],
    )

    assert calls == ["row-1"]
    assert "[[Decorated|row-1]]" in str(materialized)
