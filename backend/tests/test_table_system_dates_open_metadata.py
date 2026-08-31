"""Synthetic metadata identity and native protocol tests for system dates."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import date

import pytest

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.services import table_system_dates as dates

NOW = "2026-08-31T12:00:00+00:00"


def _outcome(operation: Callable[[], object]) -> tuple[object, ...]:
    try:
        return ("value", operation())
    except Exception as error:
        return (type(error), error.args)


class IterationProbe(Iterator[object]):
    def __init__(self, values: list[object]) -> None:
        self.values = values
        self.position = 0
        self.events: list[str] = []

    def __iter__(self) -> Iterator[object]:
        self.events.append("iter")
        return self

    def __next__(self) -> object:
        self.events.append("next")
        if self.position >= len(self.values):
            raise StopIteration
        result = self.values[self.position]
        self.position += 1
        return result

    def __deepcopy__(self, memo: dict[int, object]) -> IterationProbe:
        self.events.append("deepcopy")
        return self


def test_schema_preserves_root_identity_and_existing_deepcopy_semantics() -> None:
    nested = [False, None, {"nested": 7}]
    prop: RegistryData = {
        "id": "legacy-created",
        "name": "Date Added",
        "type": "date",
        None: nested,
    }
    table: RegistryData = {"id": "synthetic", 7: nested, "alias": nested, "properties": [prop]}
    identity = id(table)
    report = dates.ensure_system_date_properties(table, "en")
    assert id(table) == identity and table[7] == nested and table[7] is not nested
    assert table[7] is table["alias"]
    properties = table["properties"]
    assert is_object_list(properties)
    canonical = properties[-2]
    assert is_record(canonical) and canonical is not prop and canonical[None] is table[7]
    assert canonical["name"] == "Creation date" and prop["name"] == "Date Added"
    assert report["created"]["old_names"] == ["Date Added"]
    assert dates.ensure_system_date_properties(table, "en")["created"]["old_names"] == []


def test_property_iteration_occurs_once_after_deepcopy() -> None:
    prop: RegistryData = {"id": "created", "name": "Created", "type": "created_time"}
    properties = IterationProbe([prop])
    table: RegistryData = {"id": "synthetic", "properties": properties}
    dates.ensure_system_date_properties(table, "en")
    assert properties.events == ["deepcopy", "iter", "next", "next"]


def test_stamp_iterates_properties_and_aliases_once_without_length_hints() -> None:
    opaque = object()
    aliases = IterationProbe(["Legacy creation"])
    created: RegistryData = {"name": "Created", "type": "created_time", "aliases": aliases}
    modified: RegistryData = {"name": "Modified", "type": "last_edited_time"}
    properties = IterationProbe([created, modified])
    metadata: RegistryData = {"Legacy creation": "original", date(2026, 8, 31): opaque}
    assert (
        dates.stamp_system_dates(metadata, {"properties": properties}, is_create=False, now=NOW)
        is metadata
    )
    assert metadata == {date(2026, 8, 31): opaque, "Created": "original", "Modified": NOW}
    assert properties.events == ["iter", "next", "next", "next"]
    assert aliases.events == ["iter", "next", "next"]


@pytest.mark.parametrize("metadata", [None, False, 0, "scalar", [], ()])
def test_stamp_returns_nonrecord_metadata_without_conversion(metadata: object) -> None:
    assert (
        dates.stamp_system_dates(metadata, {"properties": [7]}, is_create=True, now=NOW) is metadata
    )


@pytest.mark.parametrize("canonical", [False, 0, [False], {7: "opaque"}])
def test_existing_creation_value_keeps_identity(canonical: object) -> None:
    metadata: RegistryData = {"Created": canonical, 7: "unknown"}
    table: RegistryData = {
        "properties": [{"name": "Created", "type": "created_time", "aliases": ["Old"]}]
    }
    assert dates.stamp_system_dates(metadata, table, is_create=False, now=NOW) is metadata
    assert metadata["Created"] is canonical and metadata[7] == "unknown"


@pytest.mark.parametrize("root", [None, False, 0, "bad", [], ()])
def test_ensure_preserves_native_failure_on_malformed_table_root(root: object) -> None:
    def ensure() -> object:
        result: object = eval(
            "ensure(root)", {}, {"ensure": dates.ensure_system_date_properties, "root": root}
        )
        return result

    assert _outcome(ensure) == _outcome(
        lambda: eval("root.get('properties', [])", {}, {"root": root})
    )


@pytest.mark.parametrize("properties", [7, True, object()])
def test_properties_preserve_noniterable_errors_without_mutating_table(properties: object) -> None:
    table: RegistryData = {"properties": properties, 7: "keep"}
    expected = _outcome(lambda: eval("iter(properties)", {}, {"properties": properties}))
    assert _outcome(lambda: dates.ensure_system_date_properties(table)) == expected
    assert table == {"properties": properties, 7: "keep"}
    assert _outcome(lambda: dates.system_date_properties(table)) == expected


@pytest.mark.parametrize("aliases", [7, True, object()])
def test_stamping_aliases_keep_native_iteration_failure(aliases: object) -> None:
    table: RegistryData = {
        "properties": [{"name": "Created", "type": "created_time", "aliases": aliases}]
    }
    metadata: RegistryData = {7: "opaque"}
    assert _outcome(
        lambda: dates.stamp_system_dates(metadata, table, is_create=True, now=NOW)
    ) == _outcome(lambda: eval("iter(aliases)", {}, {"aliases": aliases}))
    assert metadata == {7: "opaque"}


def test_system_properties_preserve_selected_property_identity_and_invalid_entries() -> None:
    prop: RegistryData = {"name": "Created", "type": "created_time", 7: object()}
    duplicate: RegistryData = {"name": "Date Added", "type": "created_time"}
    found = dates.system_date_properties({"properties": [None, 7, "invalid", prop, duplicate]})
    assert found == {"created": prop} and found["created"] is prop


def test_system_properties_keep_role_callback_result_without_new_shape_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    opaque = object()
    monkeypatch.setattr(dates, "property_role", lambda _prop: "created")
    assert dates.system_date_properties({"properties": [opaque]})["created"] is opaque


@pytest.mark.parametrize("aliases", [None, 7, "legacy", ("Old",)])
def test_schema_keeps_existing_alias_repair_policy(aliases: object) -> None:
    prop: RegistryData = {"name": "Date Added", "type": "created_time", "aliases": aliases}
    table: RegistryData = {"id": "synthetic", "properties": [prop]}
    dates.ensure_system_date_properties(table, "en")
    properties = table["properties"]
    assert is_object_list(properties)
    created = properties[-2]
    assert is_record(created) and created["aliases"] == ["Date Added"]
    assert prop["aliases"] is aliases
