"""Status catalog and propagation contracts with real open-record owners."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables import status_options
from backend.domains.vault.tables.catalogs import core, roles, seeds
from backend.domains.vault.translation import staleness
from backend.services import translation_helpers


@contextmanager
def mutation() -> Iterator[None]:
    yield


def option_dependencies(registry: RegistryData, saves: list[RegistryData]) -> status_options.StatusOptionDependencies:
    return status_options.StatusOptionDependencies(
        registry_mutation=mutation, load_registry=lambda: registry,
        save_registry=saves.append, find_role_property=roles.find_role_prop,
        status_role=roles.ROLE_STATUS, is_global_status_property=core.is_global_status_prop,
        status_catalog_reference="status", normalize_options=core.normalize_options,
        auto_color=core.auto_color, ensure_options_exist=seeds.ensure_options_exist,
        logger=logging.getLogger(__name__),
    )


@pytest.mark.parametrize("global_status", [True, False])
def test_status_options_use_real_catalog_contracts_and_preserve_unknown_keys(global_status: bool) -> None:
    opaque = object()
    prop: RegistryData = {9: opaque, "id": "status", "name": "Status", "type": "status" if global_status else "select"}
    table: RegistryData = {8: opaque, "id": "table", "properties": [prop]}
    registry: RegistryData = {7: opaque, "tables": [table]}
    saves: list[RegistryData] = []
    deps = option_dependencies(registry, saves)
    status_options.ensure_status_options_persisted("table", ["Ready", "Ready", "", None], deps)
    assert saves == [registry] and saves[0] is registry
    assert registry[7] is table[8] is prop[9] is opaque
    assert status_options._table(registry, "table") is table
    if global_status:
        catalogs = registry["option_catalogs"]
        assert is_record(catalogs)
        normalized = core.normalize_options(catalogs["status"])
    else:
        normalized = core.get_prop_options(prop)
    assert [option["name"] for option in normalized] == ["Ready"]
    saves.clear()
    status_options.ensure_status_options_persisted("table", ["Ready"], deps)
    assert saves == []


@pytest.mark.parametrize("catalog", [None, 7, "malformed", {}, ["Ready"]])
def test_global_catalog_keeps_existing_list_or_original_repair_policy(catalog: object) -> None:
    registry: RegistryData = {"option_catalogs": {5: "unknown", "status": catalog}}
    result = status_options._global_catalog(registry, "status")
    catalogs = registry["option_catalogs"]
    assert is_record(catalogs) and catalogs[5] == "unknown"
    if isinstance(catalog, list):
        assert result is catalog
    else:
        assert result == [] and catalogs["status"] is result


def test_status_option_failure_after_mutation_does_not_undo_shared_record() -> None:
    prop: RegistryData = {"id": "status", "name": "Status", "type": "status"}
    registry: RegistryData = {"tables": [{"id": "table", "properties": [prop]}]}
    saves: list[RegistryData] = []
    deps = option_dependencies(registry, saves)

    def failed_save(value: RegistryData) -> None:
        saves.append(value)
        raise OSError("synthetic failure")

    status_options.ensure_status_options_persisted("table", ["Ready"], replace(deps, save_registry=failed_save))
    assert saves[0] is registry
    catalogs = registry["option_catalogs"]
    assert is_record(catalogs) and core.normalize_options(catalogs["status"])[0]["name"] == "Ready"


def test_staleness_keeps_raw_paths_status_and_callback_order(tmp_path: Path) -> None:
    path = tmp_path / "child.md"
    path.write_text("synthetic", encoding="utf-8")
    prop: RegistryData = {7: "opaque property", "id": "status"}
    table: RegistryData = {8: "opaque table", "id": "table"}
    original: RegistryData = {9: "opaque metadata", "title": "old"}
    current: RegistryData = {9: "opaque metadata", "title": "new"}
    trace: list[object] = []
    translations: dict[str, object] = {
        "es": {"id": 42, "path": path},
        "fr": SimpleNamespace(id="child", path=None),
        "de": {"id": None, "path": path},
    }

    def status(received: RegistryData) -> tuple[RegistryData, str, bool]:
        assert received is table
        trace.append("status")
        return prop, "Draft", True

    def stale(page_id: str, received_path: Path, value: tuple[RegistryData, object] | None) -> bool:
        assert value is not None and value[0] is prop and value[1] == "Draft"
        trace.append(("stale", page_id, received_path))
        return True

    def find(page_id: str) -> Path:
        trace.append(("find", page_id))
        return path

    deps = staleness.TranslationStalenessDependencies(
        table_id=lambda _metadata: "table", table_by_id=lambda _id: table,
        content_changed=translation_helpers.translatable_content_changed,
        find_translations=lambda _origin, _pages: translations, page_snapshot=lambda: [],
        on_stale_effect=status, persist_status_options=lambda table_id, values: trace.append(("options", table_id, values)),
        find_page=find,
        set_stale=stale, logger=logging.getLogger(__name__),
    )
    staleness.propagate_translation_staleness("origin", original, current, "body", "body", deps)
    assert trace == ["status", ("options", "table", ["Draft"]),
                     ("stale", "42", path), ("find", "child"), ("stale", "child", path)]
    assert current == {9: "opaque metadata", "title": "new"}


def test_staleness_alias_unpack_retains_length_hint_failure() -> None:
    events: list[str] = []

    class Aliases:
        def __bool__(self) -> bool:
            events.append("bool")
            return True

        def __iter__(self) -> Iterator[str]:
            events.append("iter")
            return iter(["alias"])

        def __len__(self) -> int:
            events.append("len")
            raise RuntimeError("native length hint")

    with pytest.raises(RuntimeError, match="native length hint"):
        staleness._translatable_keys({"properties": [{"translatable": True, "aliases": Aliases()}]})
    assert events == ["bool", "iter", "len"]
