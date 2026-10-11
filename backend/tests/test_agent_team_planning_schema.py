"""Cheaper planning is opt-in for clear text; compact schemas keep constraints."""
import json

import pytest
from jsonschema import Draft202012Validator

from backend.services.agent_team_models import TeamPlan, TeamTask
from backend.services.agent_team_planning_schema import compact_plan_schema, economical_planning


@pytest.mark.parametrize("data,expected", [
    ({"request": "Hola!"}, True),
    ({"request": "Fes-ho"}, False),
    ({"request": "Correct this text", "required_operation": "writing"}, True),
    ({"request": "Translate this text", "required_operation": "translation"}, True),
    ({"request": 'Return JSON {"value":0}', "required_operation": "writing"}, False),
    ({"request": "Summarize and save", "required_operation": "writing", "authorized_tool_names": ["save"]}, False),
    ({"request": "Configure a button", "required_operation": "tables"}, False),
    ({"request": "Classify notes", "required_operation": "knowledge"}, False),
    ({"request": "Resolve this complex task"}, False),
])
def test_only_preidentified_text_without_actions_or_json_uses_lower_effort(data, expected):
    assert economical_planning(data) is expected


def test_compact_schema_keeps_validation_and_does_not_mutate_original():
    original = TeamPlan.model_json_schema()
    before = json.dumps(original)
    compact = compact_plan_schema(original, temporary=False)
    assert json.dumps(original) == before
    assert len(json.dumps(compact)) < len(before)
    plan = TeamPlan(tasks=[TeamTask(id="work", agent_id="writer", objective="Correct text", skill_ids=["writing"])], result_task="work").model_dump()
    for key, value in [(None, None), ("tasks", []), ("unknown", True), ("synthesize", "incorrect")]:
        candidate = {**plan, **({key: value} if key else {})}
        assert Draft202012Validator(original).is_valid(candidate) == Draft202012Validator(compact).is_valid(candidate)
    temporary = {"name": "A", "instructions": "Read only", "provider": "local", "model": "m", "skill_ids": ["read"], "acceptance": ["Accurate"]}
    plan["tasks"][0]["temporary"] = temporary
    assert not Draft202012Validator(compact).is_valid(plan)
    assert Draft202012Validator(compact_plan_schema(original, temporary=True)).is_valid(plan)


def test_compacting_annotations_preserves_literal_property_names_and_data():
    schema = TeamPlan.model_json_schema()
    literal = {"title": "keep me", "default": "keep this too"}
    schema["properties"]["title"] = {"type": "object", "const": literal, "properties": {"default": {"type": "string"}}}
    compact = compact_plan_schema(schema, temporary=True)
    assert compact["properties"]["title"]["const"] == literal
    assert "default" in compact["properties"]["title"]["properties"]
