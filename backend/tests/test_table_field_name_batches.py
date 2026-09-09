"""Batch field resolution keeps name precedence, freshness and HTTP validation."""

from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo
from backend.domains.vault.tables.rows import TableRowQueryDependencies, enrich_table_query_pages
from backend.services import field_resolver


def _table(name: str = "Current") -> RegistryData:
    return {"id": "same-table-id", "properties": [
        {"id": "fld_12345678", "name": name, "aliases": ["Old", "Former"]},
        {"id": "fld_87654321", "name": "Other", "aliases": ["Current"]},
    ]}


def test_prepared_rows_keep_collision_priority_key_order_and_opaque_values() -> None:
    opaque = object()
    metadata: RegistryData = {None: opaque, "Old": "alias", 7: opaque,
                             "fld_12345678": "id", "Current": "name"}
    resolve = field_resolver.prepare_response_names(_table())
    result = resolve(metadata)
    assert list(result) == [None, "Current", 7]
    assert result["Current"] == "name"
    assert result[None] is result[7] is opaque
    assert list(metadata) == [None, "Old", 7, "fld_12345678", "Current"]
    assert resolve({"fld_12345678": "id", "Former": "alias"}) == {"Current": "id"}
    assert resolve({"Former": "first", "Old": "second"}) == {"Current": "first"}


def test_canonical_rows_return_independent_dicts_with_same_order_and_values() -> None:
    nested = {"retained": True}
    source: RegistryData = {"Other": nested, None: nested, "Current": "value"}
    result, changed = field_resolver.to_storage_names(source, _table())
    assert not changed and result is not source
    assert list(result) == list(source)
    assert result[None] is result["Other"] is nested
    result["Current"] = "changed"
    assert source["Current"] == "value"


def test_batches_prepare_schema_once_and_do_not_mix_equal_table_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = field_resolver._field_name_maps
    prepared: list[RegistryData] = []

    def track(table: RegistryData) -> field_resolver.FieldNameMaps:
        prepared.append(table)
        return original(table)

    monkeypatch.setattr(field_resolver, "_field_name_maps", track)
    first_table, second_table = _table(), _table("Another vault")
    first = field_resolver.prepare_response_names(first_table)
    second = field_resolver.prepare_response_names(second_table)
    for index in range(100):
        assert first({"Old": index}) == {"Current": index}
        assert second({"Old": index}) == {"Another vault": index}
    assert prepared == [first_table, second_table]


@pytest.mark.parametrize("metadata", [None, 3, False, "scalar", [], {}])
def test_empty_or_nonrecord_metadata_does_not_inspect_invalid_aliases(metadata: object) -> None:
    resolve = field_resolver.prepare_response_names({"properties": [{"name": "Current", "aliases": 7}]})
    assert resolve(metadata) == {}
    with pytest.raises(TypeError):
        resolve({"Old": "value"})


def _dependencies(table: RegistryData) -> TableRowQueryDependencies:
    return TableRowQueryDependencies(
        vault_cache_key=lambda: "fixture", cache_get=lambda _: None,
        cache_set=lambda _key, _pages: None, cached_entries=lambda: [],
        load_registry=lambda: {}, hidden_event_ids=set,
        humanize_title=lambda title, _metadata: str(title), table_by_id=lambda _: table,
        refresh_metadata=lambda _: None, inject_virtual_fields=lambda _table, _pages, _loader: None,
        response_names=field_resolver.to_response_names,
        prepare_response_names=field_resolver.prepare_response_names,
        vault_root=lambda: Path("/fixture"), logger=logging.getLogger(__name__),
    )


def test_table_reads_rebuild_resolution_after_a_column_rename() -> None:
    table = _table()
    dependencies = _dependencies(table)
    page = PageInfo(id="row", title="Row", metadata={"Old": "value"}, last_modified="date", size=1)
    enrich_table_query_pages("same-table-id", [page], dependencies)
    assert page.metadata == {"Current": "value"}
    table["properties"] = [{"id": "fld_12345678", "name": "Renamed", "aliases": ["Current"]}]
    enrich_table_query_pages("same-table-id", [page], dependencies)
    assert page.metadata == {"Renamed": "value"}


def test_prepared_resolution_keeps_http_metadata_validation() -> None:
    metadata = {7: "invalid HTTP key"}
    page = PageInfo.model_construct(id="row", title="Row", metadata=metadata, last_modified="date", size=1)
    with pytest.warns(UserWarning, match="serializer warnings"):
        with pytest.raises(ValidationError) as error:
            enrich_table_query_pages("same-table-id", [page], _dependencies(_table()))
    assert error.value.errors()[0]["loc"] == ("metadata", 7, "[key]")
    assert page.metadata is metadata


def test_custom_single_row_resolvers_remain_supported() -> None:
    seen: list[object] = []

    def resolve(metadata: object, _table: RegistryData) -> RegistryData:
        seen.append(metadata)
        return {"Custom": "result"}

    page = PageInfo(id="row", title="Row", metadata={"Old": "value"}, last_modified="date", size=1)
    dependencies = replace(_dependencies(_table()), prepare_response_names=None, response_names=resolve)
    enrich_table_query_pages("same-table-id", [page], dependencies)
    assert seen == [{"Old": "value"}]
    assert page.metadata == {"Custom": "result"}
