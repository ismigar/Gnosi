"""Behavior and architecture contracts for status-option persistence."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import cast

from backend.domains.vault.tables import status_options


def test_global_status_catalog_adds_only_missing_values() -> None:
    registry: status_options.Metadata = {
        "tables": [{"id": "tasks", "properties": [{"id": "status", "role": "status"}]}],
        "option_catalogs": {"global-status": [{"name": "Todo", "color": "gray"}]},
    }
    saves: list[status_options.Metadata] = []

    @contextmanager
    def mutation() -> Iterator[None]:
        yield

    def normalize(raw: object) -> list[status_options.Metadata]:
        if not isinstance(raw, list):
            return []
        return [cast(status_options.Metadata, item) for item in raw if isinstance(item, dict)]

    dependencies = status_options.StatusOptionDependencies(
        registry_mutation=mutation,
        load_registry=lambda: registry,
        save_registry=lambda value: saves.append(value),
        find_role_property=lambda table, _role: cast(
            list[status_options.Metadata], table["properties"]
        )[0],
        status_role="status",
        is_global_status_property=lambda _prop: True,
        status_catalog_reference="global-status",
        normalize_options=normalize,
        auto_color=lambda _value: "blue",
        ensure_options_exist=lambda _prop, _wanted: False,
        logger=logging.getLogger(__name__),
    )

    status_options.ensure_status_options_persisted(
        "tasks",
        ["Todo", "Doing", "", None],
        dependencies,
    )

    assert saves == [registry]
    catalogs = cast(status_options.Metadata, registry["option_catalogs"])
    assert catalogs["global-status"] == [
        {"name": "Todo", "color": "gray"},
        {"name": "Doing", "color": "blue"},
    ]


def test_status_option_failure_is_best_effort() -> None:
    @contextmanager
    def broken_mutation() -> Iterator[None]:
        raise OSError("registry unavailable")
        yield

    dependencies = status_options.StatusOptionDependencies(
        registry_mutation=broken_mutation,
        load_registry=lambda: {},
        save_registry=lambda _registry: None,
        find_role_property=lambda _table, _role: None,
        status_role="status",
        is_global_status_property=lambda _prop: False,
        status_catalog_reference="global-status",
        normalize_options=lambda _options: [],
        auto_color=lambda _value: "gray",
        ensure_options_exist=lambda _prop, _wanted: False,
        logger=logging.getLogger(__name__),
    )

    status_options.ensure_status_options_persisted("tasks", ["Doing"], dependencies)


def test_status_options_domain_does_not_import_http_facade() -> None:
    source_path = Path(status_options.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
