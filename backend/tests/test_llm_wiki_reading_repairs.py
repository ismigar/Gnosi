"""Small reference repairs preserve the complete original draft and evidence."""
from copy import deepcopy
import json

import jsonschema
import pytest

from backend.domains.llm_wiki.reading_contracts import ReadingPlanError, validate_notes
from backend.domains.llm_wiki.reading_repairs import build_reading_repair


def repair_fixture(coverage_error=False):
    passages = [{"id": "p1", "text": "Original colur, including its spelling."},
                {"id": "p2", "text": "A distant original passage."}]
    plan = {"notes": [
        {"title": "Opening", "body_md": "Keep this **complete** idea.", "source_segment_id": "p1",
         "citations": [{"segment_id": "p1", "quote": "Original colour"}]},
        {"title": "Valid", "body_md": "A valid independent note.", "source_segment_id": "p2",
         "citations": [{"segment_id": "p2", "quote": "A distant original passage."}]},
    ], "coverage": [{"segment_id": s["id"], "reason": "read"} for s in passages], "reviewed": True}
    if coverage_error:
        plan["coverage"][1]["segment_id"] = "foreign"
    action = {"action": "save_plan", "arguments": {"chunk_id": "chunk", "plan": plan}}
    with pytest.raises(ReadingPlanError) as caught:
        validate_notes(plan, passages, passages)
    repair = build_reading_repair("Full original context and global memory", json.dumps(action), caught.value)
    assert repair is not None
    patches = [{"path": "notes/0/source_segment_id", "value": "p1"},
               {"path": "notes/0/citations", "value": [{"segment_id": "p1", "quote": "Original colur"}]}]
    if coverage_error:
        patches.append({"path": "coverage", "value": [{"segment_id": s["id"], "reason": "read"} for s in passages]})
    return action, passages, repair, {"patches": patches}


@pytest.mark.parametrize("coverage_error", [False, True])
def test_partial_repair_preserves_every_unaffected_field(coverage_error):
    action, passages, repair, patch = repair_fixture(coverage_error)
    original = deepcopy(action)
    restored = json.loads(repair.restore(json.dumps(patch)))
    validate_notes(restored["arguments"]["plan"], passages, passages)
    assert action == original
    assert restored["arguments"]["plan"]["notes"][1] == original["arguments"]["plan"]["notes"][1]
    assert restored["arguments"]["plan"]["notes"][0]["body_md"] == "Keep this **complete** idea."
    assert len(restored["arguments"]["plan"]["notes"]) == 2
    payload = json.loads(repair.input)
    assert payload["original_request"] == "Full original context and global memory"
    assert payload["reference_passages"][0] == passages[0]
    assert payload["affected_notes"][0]["note"] == original["arguments"]["plan"]["notes"][0]


@pytest.mark.parametrize("fault", ["body", "valid_note", "duplicate", "missing", "foreign_id"])
def test_patch_cannot_change_unrelated_fields_or_hide_a_missing_repair(fault):
    action, _, repair, patch = repair_fixture()
    original = deepcopy(action)
    if fault == "body":
        patch["patches"][0]["path"] = "notes/0/body_md"
    elif fault == "valid_note":
        patch["patches"][0]["path"] = "notes/1/source_segment_id"
    elif fault == "duplicate":
        patch["patches"][0] = patch["patches"][1]
    elif fault == "missing":
        patch["patches"].pop()
    else:
        patch["patches"][0]["value"] = "foreign"
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps(patch))
    assert action == original


def test_well_formed_patch_still_requires_original_grounding_validation():
    _, passages, repair, patch = repair_fixture()
    patch["patches"][1]["value"][0]["quote"] = "Still invented"
    restored = json.loads(repair.restore(json.dumps(patch)))
    with pytest.raises(ReadingPlanError):
        validate_notes(restored["arguments"]["plan"], passages, passages)


def test_unrelated_validation_uses_existing_full_response_repair():
    assert build_reading_repair("context", "not JSON", ValueError("syntax")) is None


def test_large_source_does_not_expand_provider_grammar_without_bound():
    from backend.domains.llm_wiki.reading_repairs import _repair_schema
    passages = [{"id": f"source-{i}", "text": f"Original passage {i}."} for i in range(1_000)]
    schema = _repair_schema([f"notes/{i}/citations" for i in range(1_000)], passages, passages)
    assert len(json.dumps(schema)) < 1_000
    assert "source-999" not in json.dumps(schema)


def test_many_rejected_notes_still_reject_an_unauthorized_path_locally():
    action, passages, _, _ = repair_fixture()
    action["arguments"]["plan"]["notes"] = [deepcopy(action["arguments"]["plan"]["notes"][0]) for _ in range(70)]
    with pytest.raises(ReadingPlanError) as caught:
        validate_notes(action["arguments"]["plan"], passages, passages)
    repair = build_reading_repair("original context", json.dumps(action), caught.value)
    assert repair is not None
    patches = [{"path": f"notes/{i}/{key}", "value": value} for i in range(70) for key, value in
               [("source_segment_id", "p1"), ("citations", [{"segment_id": "p1", "quote": "Original colur"}])]]
    patches[0]["path"] = "notes/0/body_md"
    jsonschema.validate({"patches": patches}, repair.output_schema)
    with pytest.raises(ValueError, match="permitted repair path"):
        repair.restore(json.dumps({"patches": patches}))
