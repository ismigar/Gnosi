"""User-selected note fields survive settings, validation and deterministic writes."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.domains.configuration.llm_wiki import _prepare_source
from backend.domains.llm_wiki.dimensions import (
    DimensionDependencies, build_dimension_context, canonical_dimension_value,
    dimension_options, metadata_property_value,
)
from backend.domains.llm_wiki.planning import validate_ai_dimensions
from backend.domains.llm_wiki.reading_action_contracts import validate_note_dimensions
from backend.services import llm_wiki, llm_wiki_config


PROPS = [
    {"id": "summary", "name": "Summary", "type": "text"},
    {"id": "score", "name": "Score", "type": "number"},
    {"id": "done", "name": "Done", "type": "checkbox"},
    {"id": "when", "name": "When", "type": "date"},
    {"id": "tags", "name": "Tags", "type": "multi_select", "options": ["Known", "Other"]},
    {"id": "derived", "name": "Derived", "type": "formula"},
]
BRAIN = {"id": "brain", "properties": PROPS}
SOURCE = {"id": "resources", "properties": [
    {"id": "source-score", "name": "Score", "type": "number"},
    {"id": "source-done", "name": "Done", "type": "checkbox"},
    {"id": "files", "name": "Files", "type": "files"},
]}
DEPS = DimensionDependencies(
    table_by_id=lambda _id: BRAIN, pages_for_table=lambda _id: [],
    canonical_value=canonical_dimension_value, dimension_options=dimension_options,
    metadata_value=metadata_property_value,
)


def context(source):
    return build_dimension_context({"brain_table_id": "brain", "index_field_ids": ["tags"]},
                                   SOURCE, source, {"Score": 0, "Done": False}, dependencies=DEPS)


def test_roundtrip_independent_fields_and_false_values():
    source = {"table_id": "resources", "assignment_field_ids": ["score", "done", "summary"],
              "dimension_mappings": {"score": {"mode": "fixed", "fixed_value": 0},
                                     "done": {"mode": "fixed", "fixed_value": False},
                                     "summary": {"mode": "ai"}}}
    config = llm_wiki_config.normalize_config({"index_field_ids": ["tags"], "source_tables": [source]})
    saved = config["source_tables"][0]
    copied, specs = context(saved)
    assert copied == {"score": 0, "done": False}
    assert [spec["field_id"] for spec in specs] == ["summary"]
    assert config["index_field_ids"] == ["tags"]
    assert context({**saved, "assignment_field_ids": []}) == ({}, [])


def test_old_config_keeps_index_assignments():
    copied, specs = context({"dimension_mappings": {}})
    assert not copied
    assert [spec["field_id"] for spec in specs] == ["tags"]


def test_copy_zero_false_and_explicit_empty_are_persisted():
    copied, _ = context({"assignment_field_ids": ["score", "done", "summary"], "dimension_mappings": {
        "score": {"mode": "source", "source_property_id": "source-score"},
        "done": {"mode": "source", "source_property_id": "source-done"},
        "summary": {"mode": "empty"},
    }})
    metadata = {"Summary": "Old text", "Done": True, "Score": 5}
    llm_wiki._apply_dimensions_to_metadata(metadata, copied, {p["id"]: p for p in PROPS})
    assert metadata == {"Summary": None, "Done": False, "Score": 0}


def test_ai_fields_have_typed_contract_and_existing_categories():
    _, specs = context({"assignment_field_ids": ["summary", "score", "done", "when", "tags"]})
    values = {"summary": ["Supported idea"], "score": [0], "done": [False], "when": ["2026-09-30"], "tags": ["Known"]}
    validate_note_dimensions({"notes": [{"dimensions": values}]}, specs)
    converted = validate_ai_dimensions(values, {spec["field_id"]: spec for spec in specs})
    assert converted == {"summary": "Supported idea", "score": 0, "done": False, "when": "2026-09-30", "tags": ["Known"]}
    for key, invalid in [("score", ["zero"]), ("done", ["true"]), ("when", ["2026-02-30"]), ("tags", ["Invented"])]:
        with pytest.raises(ValueError):
            validate_note_dimensions({"notes": [{"dimensions": {**values, key: invalid}}]}, specs)
    abstain = {key: [] for key in values}
    validate_note_dimensions({"notes": [{"dimensions": abstain}]}, specs)
    assert validate_ai_dimensions(abstain, {s["field_id"]: s for s in specs}) == dict.fromkeys(values)


def prepare(ids, mappings):
    deps = SimpleNamespace(table_by_id=lambda _id: SOURCE, infer_brain_roles=lambda _brain: {},
                           property_options=lambda p: dimension_options(p, lambda _id: []))
    return _prepare_source({"table_id": "resources", "assignment_field_ids": ids,
                            "attachment_property_ids": ["files"], "dimension_mappings": mappings}, BRAIN, [], deps)


def test_save_validates_selected_fields_and_fixed_types():
    result = prepare(["done", "score"], {"done": {"mode": "fixed", "fixed_value": False}, "score": {"mode": "fixed", "fixed_value": 0}})
    assert result["dimension_mappings"]["done"]["fixed_value"] is False
    with pytest.raises(HTTPException):
        prepare(["missing"], {})
    with pytest.raises(HTTPException):
        prepare(["derived"], {})
    with pytest.raises(HTTPException):
        prepare(["score"], {"score": {"mode": "fixed", "fixed_value": "NaN"}})
