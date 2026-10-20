"""Exact criterion identity and observable evidence for text-only trials."""

import json
from typing import Any

from jsonschema import ValidationError

from backend.services.agent_learning_models import CriterionResult
from backend.services.json_contracts import validate_json_value


def review_schema(criteria: list[str]) -> dict[str, Any]:
    items = []
    for criterion in criteria:
        items.append({"type": "object", "properties": {
            "criterion": {"const": criterion}, "met": {"type": "boolean"},
            "evidence": {"type": "string", "minLength": 1, "maxLength": 2000},
            "input_quote": {"type": "string", "maxLength": 2000},
            "output_quote": {"type": "string", "maxLength": 2000},
        }, "required": ["criterion", "met", "evidence", "input_quote", "output_quote"],
            "additionalProperties": False})
    return {"type": "object", "properties": {"checks": {
        "type": "array", "prefixItems": items, "items": False,
        "minItems": len(criteria), "maxItems": len(criteria),
    }}, "required": ["checks"], "additionalProperties": False}


def validate_review(raw: str, *, criteria: list[str], source: str, output: str) -> str:
    value = json.loads(raw)
    checks = value.get("checks") if isinstance(value, dict) else None
    if not isinstance(checks, list) or len(checks) != len(criteria):
        raise ValueError("The trial did not evaluate every acceptance criterion")
    try:
        validate_json_value(value, review_schema(criteria))
    except ValidationError as exc:
        raise ValueError("Preserve each acceptance criterion exactly and in its original order; return all required evidence fields") from exc
    for check in checks:
        if not check["evidence"].strip():
            raise ValueError("Each criterion requires an explanation")
        for key, document in (("input_quote", source), ("output_quote", output)):
            quote = check[key]
            if quote and (not quote.strip() or quote not in document):
                raise ValueError(f"{key} must be an exact fragment of the corresponding document")
        if check["met"] and not check["output_quote"].strip():
            raise ValueError("A fulfilled criterion requires observable evidence in the trial output")
    return json.dumps(value, ensure_ascii=False)


def review_results(raw: str) -> list[CriterionResult]:
    return [CriterionResult.model_validate(check) for check in json.loads(raw)["checks"]]
