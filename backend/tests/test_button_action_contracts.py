"""Generated buttons must match the table's fields and allowed values."""

import jsonschema
import pytest

from backend.services.button_action_contracts import button_action_schema
from backend.services.agent_execution import _validate_output


FIELDS = [
    {"id": "f1", "name": "estat", "type": "status", "options": [{"name": "En revisió"}]},
    {"id": "f2", "name": "puntuació", "type": "number"},
    {"id": "f3", "name": "fet", "type": "checkbox"},
    {"id": "f4", "name": "resum", "type": "text"},
    {"id": "f5", "name": "calculat", "type": "formula"},
]


def button(action, config):
    return {"button_label": "Revisar", "button_action": action, "button_config": config}


@pytest.mark.parametrize("field,value", [("estat", "En revisió"), ("puntuació", 0), ("fet", False), ("resum", "")])
def test_valid_assignments_preserve_types_and_empty_values(field, value):
    schema = button_action_schema(FIELDS, [])
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.validate(button("set_fields", {"assignments": [{"field": field, "value": value}]}), schema)


@pytest.mark.parametrize("field,value", [("estat", "Inventat"), ("puntuació", "0"), ("fet", 0),
                                       ("inexistent", "x"), ("f1", "En revisió"), ("calculat", "x")])
def test_wrong_field_or_value_is_rejected(field, value):
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(button("set_fields", {"assignments": [{"field": field, "value": value}]}),
                            button_action_schema(FIELDS, []))


@pytest.mark.parametrize("result", [
    {}, button("ai_prompt", {"assignments": [{"field": "resum", "value": "x"}]}),
    button("ai_prompt", {"prompt": "Resumeix", "target_field": "calculat"}),
    button("ai_prompt", {"prompt": "", "target_field": "resum"}),
    button("run_skill", {"skill_id": "invented"}),
    button("set_fields", {"assignments": []}),
    {**button("ai_prompt", {"prompt": "Resumeix", "target_field": "resum"}), "button_label": "x" * 21},
])
def test_malformed_configs_and_unknown_skills_are_rejected(result):
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, button_action_schema(FIELDS, ["core.gnosi-writing"]))


def test_known_skill_and_ai_target_pass():
    schema = button_action_schema(FIELDS, ["core.gnosi-writing"])
    jsonschema.validate(button("run_skill", {"skill_id": "core.gnosi-writing"}), schema)
    jsonschema.validate(button("ai_prompt", {"prompt": "Resumeix", "target_field": "resum"}), schema)


def test_duplicate_field_names_are_ambiguous():
    with pytest.raises(ValueError, match="unique"):
        button_action_schema([FIELDS[0], FIELDS[0]], [])


def test_conflicting_assignments_to_the_same_field_are_rejected():
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(button("set_fields", {"assignments": [
            {"field": "resum", "value": "first"}, {"field": "resum", "value": "second"},
        ]}), button_action_schema(FIELDS, []))


def test_empty_table_contract_is_valid_but_cannot_invent_fields():
    schema = button_action_schema([], [])
    jsonschema.Draft202012Validator.check_schema(schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(button("ai_prompt", {"prompt": "x", "target_field": "invented"}), schema)


@pytest.mark.parametrize("value", ['"2026-02-30"', '"yesterday"', '"2026-02-30T12:00:00Z"', 'NaN', 'Infinity', '1e999'])
def test_date_and_number_invalid_values_are_rejected_by_operation_validation(value):
    from backend.services.button_action_contracts import field_value_schema
    schema = field_value_schema({"type": "date" if value.startswith('"') else "number"})
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        _validate_output('{"value":' + value + '}', {
            "type": "object", "properties": {"value": schema}, "required": ["value"]})


@pytest.mark.parametrize("value", ['"2024-02-29"', '"2026-03-15T12:00:00Z"', '"2026-03-15T12:00:00+02:00"'])
def test_valid_calendar_dates_and_timestamps_pass(value):
    from backend.services.button_action_contracts import field_value_schema
    assert _validate_output('{"value":' + value + '}', {
            "type": "object", "properties": {"value": field_value_schema({"type": "date"})}, "required": ["value"]})


def test_relation_contract_exposes_cardinality_and_does_not_allow_nonstring_items():
    from backend.services.button_action_contracts import field_value_schema
    schema = field_value_schema({"type": "relation", "cardinality": "many-to-one"})
    for value in (None, "", [], ["id"], "[[Title|id]]"):
        jsonschema.validate(value, schema)
    for value in (0, [0], [""], ["id", "other"], ["id", "id"]):
        with pytest.raises(jsonschema.ValidationError): jsonschema.validate(value, schema)


@pytest.mark.parametrize("limit", [2, "2"])
def test_relation_limit_is_enforced_for_numeric_and_saved_string_limits(limit):
    from backend.services.button_action_contracts import field_value_schema
    schema = field_value_schema({"type": "relation", "limit": limit})
    jsonschema.validate(["first", "second"], schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(["first", "second", "third"], schema)


@pytest.mark.parametrize("field", [
    {"type": []}, {"type": {}},
    {"type": "relation", "cardinality": {}},
    *[{"type": "relation", "limit": value} for value in (True, -1, 1.5, "bad", {}, [], "1" * 5000)],
    *[{"type": "status", "options": value} for value in ("En revisió", {}, 0)],
])
def test_malformed_field_definitions_return_a_controlled_error(field):
    from fastapi import HTTPException
    from backend.services.button_action_contracts import field_value_schema
    with pytest.raises(HTTPException) as caught:
        field_value_schema(field)
    assert caught.value.status_code == 422


def test_untyped_field_remains_unassignable():
    from backend.services.button_action_contracts import field_value_schema
    assert field_value_schema({"name": "legacy"}) is False
