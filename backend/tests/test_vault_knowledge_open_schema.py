"""Synthetic characterization of Knowledge's open documents and callbacks."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from pathlib import Path
from uuid import UUID

import pytest

from backend.config.validation_runtime import validation_runtime_enabled
from backend.domains.vault.registry.state import RegistryData


@pytest.fixture(autouse=True)
def require_isolation() -> None:
    assert validation_runtime_enabled(), "Run through verify_typed_drawings.py"


def test_schema_dependency_keeps_late_registry_and_property_callbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.knowledge import schema_service as schema

    opaque = object()
    table: RegistryData = {"id": "brain", "properties": [], 7: opaque}
    registry: RegistryData = {"tables": [table]}
    events: list[str] = []

    @contextmanager
    def mutation() -> Iterator[None]:
        events.append("enter")
        yield
        events.append("exit")

    def save(value: RegistryData) -> None:
        assert value is registry and table[7] is opaque
        events.append("save")

    def new_property(role: str, name: str, ptype: str, brain_table_id: str = "") -> RegistryData:
        events.append(role)
        return {"id": role, "name": name, "type": ptype, "extension": opaque}

    monkeypatch.setattr(facade, "registry_mutation", mutation)
    monkeypatch.setattr(facade, "load_registry", lambda: registry)
    monkeypatch.setattr(facade, "save_registry", save)
    monkeypatch.setattr(schema, "_brain_property", new_property)
    assert schema.ensure_brain_table_schema("brain", "ca") == 8
    assert events[0] == "enter" and events[-2:] == ["save", "exit"]
    events.clear()
    assert schema.ensure_brain_table_schema("brain", "ca") == 0
    assert events == ["enter", "exit"]


@pytest.mark.parametrize("entry", [None, 7, False, "bad", []])
def test_default_group_preserves_native_entry_error(
    entry: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.knowledge import schema_service as schema

    registry: RegistryData = {"databases": [entry]}
    monkeypatch.setattr(facade, "load_registry", lambda: registry)
    monkeypatch.setattr(facade, "registry_mutation", nullcontext)
    with pytest.raises(AttributeError) as actual:
        schema._ensure_default_db_group()
    with pytest.raises(AttributeError) as expected:
        eval("entry.get('id')", {}, {"entry": entry})
    assert actual.value.args == expected.value.args


def test_source_filter_preserves_structure_and_native_json_errors() -> None:
    from backend.domains.vault.knowledge import schema_service as schema

    remaining: RegistryData = {"field": "Tags", "value": "x"}
    view: RegistryData = {
        "filter": {"field": "Fonts", "value": "old"},
        "filterTree": {"rules": [{"field": "Fonts"}, remaining]},
    }
    assert schema._normalize_brain_source_view(view, "Font", {"Fonts"})
    assert view == {
        "filters": [{"field": "Font", "value": "this"}],
        "filterTree": {
            "conjunction": "and",
            "rules": [
                {"field": "Font", "value": "this"},
                remaining,
            ],
        },
    }
    assert not schema._normalize_brain_source_view(view, "Font", {"Font", "Fonts"})
    opaque = object()
    invalid: RegistryData = {"extension": opaque}
    with pytest.raises(TypeError):
        schema._normalize_brain_source_view(invalid, "Font", set())
    assert invalid == {"extension": opaque}


def test_source_titles_and_relations_keep_opaque_values() -> None:
    from backend.domains.vault.knowledge import jobs_routes as jobs, schema_service as schema

    metadata: RegistryData = {"Name": [None, {"label": "  Synthetic  "}], "title": "fallback"}
    assert (
        jobs._llm_wiki_source_title(
            metadata,
            Path("fallback.md"),
            {"properties": [{"id": "name", "name": "Name"}]},
            {"title_property_id": "name"},
        )
        == "Synthetic"
    )
    opaque = object()
    result = schema._merge_relation_values(["[[First|id]]", opaque], ["[[Second|id]]", opaque])
    assert result == ["[[First|id]]", opaque] and result[1] is opaque
    assert jobs._resource_processed_value({jobs.LLM_WIKI_PROCESSED_COL: 0}) == "0"


@pytest.mark.parametrize("options", [7, True, object()])
def test_property_options_retain_native_iteration_errors(options: object) -> None:
    from backend.domains.vault.knowledge import config_routes as config

    with pytest.raises(TypeError) as actual:
        config._llm_wiki_property_options({"options": options})
    with pytest.raises(TypeError) as expected:
        eval("[item for item in options]", {}, {"options": options})
    assert actual.value.args == expected.value.args


def test_property_options_keep_mapping_values_and_fallback_order() -> None:
    from backend.domains.vault.knowledge import config_routes as config

    assert config._llm_wiki_property_options({"options": [None, {}, "  ", {"name": 0}]}) == [
        {"label": "None", "value": "None"},
        {"label": "None", "value": "None"},
        {"label": "0", "value": "0"},
    ]
    assert config._llm_wiki_property_options({"options": [], "config": {"options": "ab"}}) == [
        {"label": "a", "value": "a"},
        {"label": "b", "value": "b"},
    ]


def test_record_service_is_captured_before_dependency_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.configuration import llm_wiki_records as records
    from backend.domains.vault.knowledge import schema_service as schema

    dependencies = schema._brain_record_dependencies()
    original = records.normalize_brain_page_contract
    events: list[str] = []

    def selected(
        metadata: RegistryData,
        config: RegistryData,
        table: RegistryData,
        titles: dict[tuple[str, str], str],
        deps: records.BrainRecordDependencies,
    ) -> bool:
        events.append("selected")
        assert deps is dependencies
        return True

    def factory() -> records.BrainRecordDependencies:
        events.append("factory")
        monkeypatch.setattr(records, "normalize_brain_page_contract", original)
        return dependencies

    monkeypatch.setattr(records, "normalize_brain_page_contract", selected)
    monkeypatch.setattr(schema, "_brain_record_dependencies", factory)
    assert schema._normalize_brain_page_contract({}, {}, {}, {})
    assert events == ["factory", "selected"]


def test_processed_column_captures_append_before_uuid(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.knowledge import jobs_routes as jobs

    events: list[str] = []

    class Properties(list[object]):
        def append(self, value: object) -> None:
            events.append("captured append")
            super().append(value)

    properties = Properties()
    registry: RegistryData = {"tables": [{"id": "source", "properties": properties}]}

    def replacement(value: object) -> None:
        raise AssertionError("append was looked up after uuid4")

    def new_uuid() -> UUID:
        events.append("uuid")
        monkeypatch.setattr(properties, "append", replacement)
        return UUID(int=1)

    def save(value: RegistryData) -> None:
        assert value is registry
        events.append("save")

    monkeypatch.setattr(facade, "registry_mutation", nullcontext)
    monkeypatch.setattr(facade, "load_registry", lambda: registry)
    monkeypatch.setattr(facade, "save_registry", save)
    monkeypatch.setattr(facade.uuid, "uuid4", new_uuid)
    assert jobs.ensure_llm_wiki_column("source")
    assert events == ["uuid", "captured append", "save"]
    assert len(properties) == 1
