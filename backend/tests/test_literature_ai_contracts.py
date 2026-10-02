"""Consumer contracts must reject malformed or invented literature evidence."""

import pytest
import jsonschema

from backend.services.literature_ai_contracts import literature_output_schema
from backend.services.literature_ai_service import OPERATIONS


@pytest.mark.parametrize("operation", sorted(OPERATIONS))
@pytest.mark.parametrize("works", [[], [{"id": "work-1"}]])
def test_each_output_schema_is_valid_and_rejects_an_empty_object(operation, works):
    schema = literature_output_schema(operation, works)
    jsonschema.Draft202012Validator.check_schema(schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({}, schema)


def test_screening_rejects_unknown_identifiers_and_unbounded_confidence():
    schema = literature_output_schema("screen", [{"id": "work-1"}])
    suggestion = {
        "id": "work-1", "suggestion": "uncertain", "rationale": "Abstract absent",
        "confidence": 0.5, "evidence_level": "title_only",
    }
    jsonschema.validate({"suggestions": [suggestion]}, schema)
    for changed in ({"id": "invented"}, {"confidence": 2}, {"suggestion": "approved"}):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"suggestions": [{**suggestion, **changed}]}, schema)


def test_synthesis_rejects_citations_outside_the_supplied_works():
    schema = literature_output_schema("synthesize", [{"id": "work-1"}])
    result = {
        "summary": "Evidence is limited", "themes": [], "contradictions": [],
        "gaps": [], "next_searches": [], "citations": ["work-1"],
    }
    jsonschema.validate(result, schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({**result, "citations": ["invented"]}, schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, literature_output_schema("synthesize", []))
