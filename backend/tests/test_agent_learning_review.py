"""A review cannot silently rewrite criteria or invent supporting excerpts."""

import json

import pytest
from jsonschema import ValidationError

from backend.services.agent_learning_review import review_schema, validate_review
from backend.services.agent_execution import _validate_output


CRITERIA = ["Conserva el nombre de participants", "No inventa el pressupost"]
SOURCE = "Hi participaran 12 persones i el pressupost és de 240 euros."
OUTPUT = "Taller amb 12 persones i pressupost de 500 euros."


def results():
    return {"checks": [
        {"criterion": CRITERIA[0], "met": True, "evidence": "El recompte es conserva",
         "input_quote": "12 persones", "output_quote": "12 persones"},
        {"criterion": CRITERIA[1], "met": False, "evidence": "El pressupost ha canviat",
         "input_quote": "240 euros", "output_quote": "500 euros"},
    ]}


def check(value):
    return validate_review(json.dumps(value), criteria=CRITERIA, source=SOURCE, output=OUTPUT)


def test_grounded_checks_preserve_exact_criteria_and_order():
    assert json.loads(check(results())) == results()


@pytest.mark.parametrize("change", ["rewrite", "reorder", "missing", "extra", "invented_source", "invented_output", "empty_success", "empty_reason"])
def test_unverifiable_or_misidentified_review_is_rejected(change):
    value = results()
    if change == "rewrite":
        value["checks"][0]["criterion"] = "Conserva el nom de participants"
    elif change == "reorder":
        value["checks"].reverse()
    elif change == "missing":
        value["checks"].pop()
    elif change == "extra":
        value["checks"].append(value["checks"][0])
    elif change == "invented_source":
        value["checks"][0]["input_quote"] = "20 persones"
    elif change == "invented_output":
        value["checks"][1]["output_quote"] = "240 euros"
    elif change == "empty_success":
        value["checks"][0]["output_quote"] = ""
    else:
        value["checks"][0]["evidence"] = "   "
    with pytest.raises(ValueError):
        check(value)


def test_missing_evidence_can_support_failure_but_not_success():
    value = results()
    value["checks"][0].update(met=False, evidence="El resultat no informa del recompte", output_quote="")
    assert json.loads(validate_review(json.dumps(value), criteria=CRITERIA, source=SOURCE, output="Pressupost de 500 euros"))["checks"][0]["met"] is False


def test_order_is_enforced_inside_the_operation_executor_before_acceptance():
    value = results()
    value["checks"].reverse()
    with pytest.raises(ValidationError):
        _validate_output(json.dumps(value), review_schema(CRITERIA))
