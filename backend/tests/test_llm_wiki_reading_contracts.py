"""A bounded repair sees every independent evidence error in its original draft."""
from copy import deepcopy

import pytest

from backend.domains.llm_wiki.reading_contracts import validate_notes


def sample():
    primary = [{"id": "p1", "text": "Original opening."}, {"id": "p2", "text": "Original conclusion."}]
    plan = {
        "notes": [{"title": "Idea", "body_md": "Supported reading.", "source_segment_id": "p1",
                   "citations": [{"segment_id": "p2", "quote": "Original conclusion."}]} for _ in range(2)],
        "coverage": [{"segment_id": s["id"], "reason": "read"} for s in primary],
        "warnings": [],
    }
    return primary, plan


def test_one_repair_receives_coverage_and_every_note_attribution_error():
    primary, plan = sample()
    plan["coverage"].append({"segment_id": "foreign", "reason": "read"})
    original = deepcopy(plan)
    with pytest.raises(ValueError) as caught:
        validate_notes(plan, primary, primary)
    message = str(caught.value)
    assert "unknown=['foreign']" in message
    for index in range(2):
        assert f"notes[{index}]: Cite the primary passage" in message
    assert "source_segment_id must match a citation's segment_id" in message
    assert "Original opening." not in message and "Original conclusion." not in message
    assert plan == original
    # The model can correct all reported errors in its one permitted repair.
    plan["coverage"].pop()
    for note in plan["notes"]:
        note["source_segment_id"] = "p2"
    validate_notes(plan, primary, primary)


def test_all_bad_quotes_and_missing_primary_anchor_are_reported_together():
    primary, plan = sample()
    plan["notes"] = [plan["notes"][0]]
    plan["notes"][0]["citations"] = [{"segment_id": "p2", "quote": "invented"}, {"segment_id": "p1"}]
    with pytest.raises(ValueError) as caught:
        validate_notes(plan, primary, primary)
    message = str(caught.value)
    assert "citations[0]: Citations must be exact" in message
    assert "citations[1]: Every citation needs an exact quote" in message
    assert "Cite the primary passage" in message
    assert "invented" not in message


@pytest.mark.parametrize("coverage", [None, [None], [{"segment_id": ["p1"], "reason": "read"}],
    [{"segment_id": "p1", "reason": "read"}, {"segment_id": "p1", "reason": "read"}],
    [{"segment_id": "p1", "reason": " "}, {"segment_id": "p2", "reason": "read"}]])
def test_malformed_or_duplicate_coverage_is_rejected_without_losing_note_diagnostics(coverage):
    primary, plan = sample()
    plan["coverage"] = coverage
    with pytest.raises(ValueError) as caught:
        validate_notes(plan, primary, primary)
    assert "Account for every primary segment" in str(caught.value)
    assert "notes[1]: Cite the primary passage" in str(caught.value)
