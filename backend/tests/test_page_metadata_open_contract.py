"""Synthetic contracts for page metadata and precise native boundaries."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import date
from typing import get_type_hints, get_overloads

import pytest

from backend.domains.vault.pages.foundation_values import copy_metadata, metadata_value
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.views import snapshot_markup, snapshot_materialization
from backend.services import field_resolver, page_sidecar, relation_links, view_snapshot


def _outcome(operation: Callable[[], object]) -> tuple[object, ...]:
    try:
        return ("value", operation())
    except Exception as error:
        return (type(error), error.args)


def _native_get(value: object, key: object) -> object:
    # Fixed test-owned expressions compare Python's own protocols and exceptions.
    result: object = eval("value.get(key)", {}, {"value": value, "key": key})
    return result


def _native_copy(value: object) -> object:
    result: object = eval("dict(value)", {}, {"value": value})
    return result


@pytest.mark.parametrize("value", [None, False, 3, "text", [], (), {7: [None, False]}])
@pytest.mark.parametrize("key", ["missing", 7, (1, 2), []])
def test_metadata_get_retains_native_result_and_errors(value: object, key: object) -> None:
    assert _outcome(lambda: metadata_value(value, key)) == _outcome(lambda: _native_get(value, key))


@pytest.mark.parametrize(
    "value",
    [None, False, 3, "text", [], (), [["key", 1]], [["a"]], [[1, 2, 3]], [1], {7: [None]}],
)
def test_metadata_copy_retains_native_constructor_errors(value: object) -> None:
    assert _outcome(lambda: copy_metadata(value)) == _outcome(lambda: _native_copy(value))


def test_metadata_copy_is_shallow_and_keeps_nontext_keys() -> None:
    payload = [None, False, {"nested": 0}]
    source: RegistryData = {date(2026, 8, 31): payload, None: payload, 7: "number"}
    result = copy_metadata(source)
    assert result == source and result is not source
    assert result[None] is payload and result[date(2026, 8, 31)] is payload


def test_metadata_get_invokes_custom_method_once_and_preserves_exception_identity() -> None:
    error = LookupError("synthetic native failure")
    calls: list[object] = []

    class Custom:
        def get(self, key: object) -> object:
            calls.append(key)
            raise error

    with pytest.raises(LookupError) as caught:
        metadata_value(Custom(), 7)
    assert caught.value is error and calls == [7]


def test_metadata_copy_uses_mapping_protocol_without_schema_filtering() -> None:
    payload = object()
    calls: list[object] = []

    class Custom:
        def keys(self) -> list[object]:
            calls.append("keys")
            return [7, None]

        def __getitem__(self, key: object) -> object:
            calls.append(key)
            return payload

    result = copy_metadata(Custom())
    assert list(result) == [7, None]
    assert result[7] is result[None] is payload
    assert calls == ["keys", 7, None]


@pytest.mark.parametrize("value", [None, 3, False, "scalar", []])
def test_sidecar_and_relation_boundaries_keep_existing_scalar_policies(value: object) -> None:
    assert page_sidecar.apply_sidecar_to(value, None) == {}
    assert page_sidecar.split_metadata(value) == ({}, {})
    assert page_sidecar.persist_sidecar_from(value, None) == {}
    assert relation_links.strip_relation_wikilinks(value, {"Related"}) is value
    assert relation_links.decorate_relation_wikilinks(value, {"Related"}) is value


def test_field_alias_priority_order_and_opaque_identity() -> None:
    opaque = [False, None, {"nested": 0}]
    table: RegistryData = {
        "properties": [{"id": "fld_12345678", "name": "Current", "aliases": ["Old"]}]
    }
    metadata: RegistryData = {
        None: opaque,
        "Old": "alias",
        7: opaque,
        "fld_12345678": "id",
        "Current": "name",
    }
    result, changed = field_resolver.to_storage_names(metadata, table)
    assert changed and list(result) == [None, "Current", 7]
    assert result["Current"] == "name" and result[None] is result[7] is opaque
    assert list(metadata) == [None, "Old", 7, "fld_12345678", "Current"]


def test_field_keys_equal_to_current_names_are_not_filtered_by_type() -> None:
    class NameKey:
        def __hash__(self) -> int:
            return hash("Current")

        def __eq__(self, other: object) -> bool:
            return other == "Current"

    key = NameKey()
    value = object()
    metadata: RegistryData = {key: value}
    table: RegistryData = {"properties": [{"name": "Current", "id": "fld_12345678"}]}
    result, _ = field_resolver.to_storage_names(metadata, table)
    assert next(iter(result)) is key and result[key] is value


class LegacyAliases:
    def __getitem__(self, index: int) -> str:
        return ["Old", "Former"][index]


def test_aliases_preserve_legacy_sequence_iteration_and_membership() -> None:
    prop: RegistryData = {"name": "Current", "type": "relation", "aliases": LegacyAliases()}
    table: RegistryData = {"properties": [prop]}
    assert field_resolver.get_property_by_name(table, "Old") is prop
    assert field_resolver.to_storage_names({"Former": 7}, table) == ({"Current": 7}, True)
    assert relation_links.relation_keys_from_table(table) == {"Current", "Old", "Former"}


@pytest.mark.parametrize("aliases", [7, True, object()])
def test_aliases_preserve_native_noniterable_failures(aliases: object) -> None:
    table: RegistryData = {"properties": [{"name": "Current", "aliases": aliases}]}
    with pytest.raises(TypeError):
        field_resolver.get_property_by_name(table, "Missing")
    with pytest.raises(TypeError):
        field_resolver.to_storage_names({7: "opaque"}, table)
    table["properties"] = [{"name": "Current", "type": "relation", "aliases": aliases}]
    with pytest.raises(TypeError):
        relation_links.relation_keys_from_table(table)


def test_relations_mutate_only_selected_fields_and_preserve_opaque_values() -> None:
    opaque = object()
    metadata: RegistryData = {7: opaque, "Related": ["[[Title|id]]", opaque], "Text": "[[T|id]]"}
    assert relation_links.strip_relation_wikilinks(metadata, {"Related"}) is metadata
    assert metadata["Related"] == ["id", opaque] and metadata[7] is opaque
    assert metadata["Text"] == "[[T|id]]"
    assert (
        relation_links.decorate_relation_wikilinks(metadata, {"Related"}, lambda _: "New title")
        is metadata
    )
    assert metadata["Related"] == ["[[New title|id]]", opaque]


@pytest.mark.parametrize("host_id", [7, False, date(2026, 8, 31), ["opaque"]])
def test_snapshot_callbacks_receive_exact_host_value(host_id: object) -> None:
    calls: list[tuple[str, object]] = []

    def resolve_ids(view_id: str, host: object) -> list[str]:
        calls.append((view_id, host))
        return ["synthetic-row"]

    def resolve_table(view_id: str, host: object) -> None:
        calls.append((view_id, host))
        return None

    body = '```gnosi-view\n{"view_id":"synthetic-view"}\n```'
    result = view_snapshot.inject_view_snapshots(
        body, resolve_ids, host_page_id=host_id, resolve_table=resolve_table
    )
    assert isinstance(result, str) and "synthetic-row" in result
    assert len(calls) == 2 and all(host is host_id for _, host in calls)


@pytest.mark.parametrize("raw", [None, 7, False, [], {}])
def test_snapshot_scalar_passthrough_keeps_identity(raw: object) -> None:
    for transform in (
        snapshot_markup.compact_view_fences,
        snapshot_markup.restore_view_fences,
        snapshot_markup.strip_view_snapshots,
        snapshot_markup.render_view_snapshots,
        snapshot_markup.flatten_view_columns,
    ):
        assert transform(raw) is raw
    assert view_snapshot.inject_view_snapshots(raw, lambda _view, _host: []) is raw
    assert view_snapshot.rematerialize_md(raw, 7, lambda _view, _host: []) is raw


def test_snapshot_overloads_describe_actual_text_results() -> None:
    for function in (
        snapshot_markup.compact_view_fences,
        snapshot_markup.restore_view_fences,
        snapshot_markup.strip_view_snapshots,
        snapshot_markup.render_view_snapshots,
        snapshot_markup.flatten_view_columns,
        snapshot_materialization.inject_view_snapshots,
        snapshot_materialization.rematerialize_md,
        view_snapshot.inject_view_snapshots,
        view_snapshot.rematerialize_md,
    ):
        variants = get_overloads(function)
        assert len(variants) == 2
        assert get_type_hints(variants[0])["return"] is str
        assert get_type_hints(variants[1])["return"] is object


def test_sidecar_split_preserves_nontext_keys_and_values() -> None:
    value = [False, None]
    metadata: RegistryData = {"id": "synthetic", "is_template": True, 7: value, None: value}
    frontmatter, sidecar = page_sidecar.split_metadata(metadata)
    assert frontmatter[7] is frontmatter[None] is value
    assert sidecar == {"is_template": True}
    assert page_sidecar.apply_sidecar_to(metadata, None) is metadata
    fallback = page_sidecar.persist_sidecar_from(metadata, None)
    assert fallback == metadata and fallback is not metadata and fallback[7] is value


def test_properties_generator_keeps_native_consumption_order() -> None:
    seen: list[str] = []

    def properties() -> Iterator[object]:
        seen.append("first")
        yield {"name": "Related", "type": "relation", "aliases": ["Old"]}
        seen.append("second")
        yield {"name": "Text", "type": "text"}

    assert relation_links.relation_keys_from_table({"properties": properties()}) == {
        "Related",
        "Old",
    }
    assert seen == ["first", "second"]
