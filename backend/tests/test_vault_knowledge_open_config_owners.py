"""Synthetic characterization of the explicitly assigned configuration owners."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest

from backend.config.validation_runtime import validation_runtime_enabled
from backend.domains.vault.registry.records import RecordReader
from backend.domains.vault.registry.state import RegistryData


@pytest.fixture(autouse=True)
def require_isolation(isolated_validation_runtime: Path) -> None:
    assert isolated_validation_runtime.is_dir() and validation_runtime_enabled()


def test_normalized_config_retains_original_coercions_and_deduplication() -> None:
    from backend.services import llm_wiki_config as config

    value: RegistryData = {
        "target_table": " brain ",
        "source_tables": ["source", {"table_id": "source"}, False],
        "ui_locale": "ca-ES",
        "brain_roles": {7: " id "},
        "index_field_ids": [" a ", "a", 2, None],
        "source_contract_revision": "invalid",
        7: object(),
    }
    result = config.normalize_config(value)
    assert result == {
        "version": 2, "ui_locale": "ca", "brain_table_id": "brain", "target_table": "brain",
        "source_tables": [{"table_id": "source", "title_property_id": "",
                           "attachment_property_ids": [], "url_property_ids": [],
                           "language_property_id": "", "include_body": False,
                           "relation_property_id": "", "dimension_mappings": {}}],
        "index_field_ids": ["a", "2", "None"], "brain_roles": {"7": "id"},
        "source_contract_revision": 0, "configured": True,
    }
    assert value["target_table"] == " brain " and 7 in value


def test_property_lookup_preserves_identity_and_eligible_copy() -> None:
    from backend.services import llm_wiki_config as config

    nested: list[object] = ["opaque"]
    prop: RegistryData = {"id": "field", "type": "select", 7: nested}
    table: RegistryData = {"properties": [None, prop]}
    assert config.property_by_id(table, " field ") is prop
    result = config.eligible_index_properties(table)
    assert len(result) == 1 and result[0] == prop and result[0] is not prop
    assert result[0][7] is not nested


def test_autodetection_preserves_custom_values_and_empty_source_index_error() -> None:
    from backend.services import llm_wiki_config as config

    table: RegistryData = {
        "id": "source", "properties": [
            {"id": "name", "type": "title"}, {"id": "pdf", "type": "files"},
            {"id": "web", "type": "url"}, {"id": "language", "name": "Idioma"},
        ],
    }
    result = config.auto_detect_source(table)
    assert result["title_property_id"] == "name"
    assert result["attachment_property_ids"] == ["pdf"]
    assert result["url_property_ids"] == ["web"]
    assert result["language_property_id"] == "language"
    with pytest.raises(IndexError, match="list index out of range"):
        config.auto_detect_source(table, current={"table_id": ""})


def test_put_config_only_invokes_local_callbacks_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.configuration import llm_wiki as domain
    from backend.domains.vault.knowledge import config_routes
    from backend.services import llm_wiki_config as config, llm_wiki_indices as indices

    source: RegistryData = {"id": "source", "properties": []}
    brain: RegistryData = {"id": "brain", "properties": []}
    tables = {"brain": brain, "source": source}
    events: list[str] = []
    receipt: dict[str, object] = {"config": object()}
    saved: list[object] = []

    def save(value: object) -> object:
        events.append("save")
        saved.append(value)
        return value

    def system_pages(table_id: object, value: object) -> dict[str, str]:
        assert table_id == "brain" and value is saved[0]
        events.append("pages")
        return {}

    def response(value: RecordReader) -> dict[str, object]:
        assert value is saved[0]
        events.append("response")
        return receipt

    dependencies = replace(
        config_routes._LLM_WIKI_CONFIG_DEPENDENCIES,
        table_by_id=lambda table_id: tables.get(table_id),
        infer_brain_roles=lambda table: {},
        ensure_default_db_group=lambda: events.append("group"),
        ensure_brain_schema=lambda table_id, locale: 0,
        ensure_source_relation=lambda brain_id, source_id, locale: "relation",
        config_response=response,
    )
    monkeypatch.setattr(config, "set_full_config", save)
    monkeypatch.setattr(indices, "ensure_system_pages", system_pages)
    assert asyncio.run(domain.put_config(
        {"brain_table_id": "brain", "source_tables": ["source"]}, dependencies,
    )) is receipt
    assert events == ["group", "save", "pages", "response"]
