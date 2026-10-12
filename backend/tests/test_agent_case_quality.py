"""The same overall score cannot hide a newly failed case or missing evidence."""
import pytest

from backend.services.agent_team_evaluations import compare_case_quality


def case(identifier, passed, *, completed=True):
    return {"id": identifier, "completed": completed, "content_checks_pass": passed,
            "prompt": identifier + " input", "checks": {"expected": identifier}}


def test_equal_scores_do_not_compensate_for_regressions():
    result = compare_case_quality([case("plural", True), case("button", False)],
                                  [case("plural", False), case("button", True)])
    assert result["accepted"] is False
    assert result["regressions"] == [{"id": "plural", "criterion": "content_checks_pass"}]


def test_improvement_is_accepted_only_when_every_candidate_case_passes():
    baseline = [case("plural", False), case("button", True)]
    assert compare_case_quality(baseline, [case("plural", True), case("button", True)])["accepted"]
    assert not compare_case_quality(baseline, baseline)["accepted"]


@pytest.mark.parametrize("value", [None, "true", 1])
def test_unknown_or_untyped_evidence_blocks_acceptance(value):
    changed = {**case("plural", True), "content_checks_pass": value}
    assert not compare_case_quality([case("plural", True)], [changed])["accepted"]
    assert not compare_case_quality([changed], [case("plural", True)])["accepted"]


def test_failures_cannot_be_dropped_or_case_definitions_changed():
    reference = [case("plural", True), case("button", True)]
    missing = compare_case_quality(reference, [reference[0]])
    assert not missing["accepted"] and missing["missing_cases"] == ["button"]
    changed = compare_case_quality(reference, [{**reference[0], "checks": {}}, reference[1]])
    assert not changed["accepted"] and changed["changed_case_definitions"] == ["plural"]
    unexpected = compare_case_quality(reference, [*reference, case("new", True)])
    assert not unexpected["accepted"] and unexpected["unexpected_cases"] == ["new"]


def test_execution_and_selected_additional_quality_checks_are_per_case():
    before = [{**case("text", True), "route_valid": True}]
    failed = [{**case("text", True, completed=False), "route_valid": False}]
    result = compare_case_quality(before, failed, criteria=("completed", "content_checks_pass", "route_valid"))
    assert not result["accepted"] and len(result["regressions"]) == 2


def test_empty_or_duplicate_cases_and_empty_criteria_cannot_certify_quality():
    assert not compare_case_quality([], [])["accepted"]
    for rows in [[case("same", True), case("same", True)], [{"id": ""}]]:
        with pytest.raises(ValueError, match="case_ids"):
            compare_case_quality(rows, rows)
    with pytest.raises(ValueError, match="criteria"):
        compare_case_quality([case("same", True)], [case("same", True)], criteria=())
