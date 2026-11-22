"""A source audit selects its assessment evidence without retyping or decorating it."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.independent_review import apply_changes, audit_payload
from backend.domains.llm_wiki.pdf_review_excerpts import quote_bindings
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.services.llm_wiki_reading_runtime import ReadingRuntime, compact_structured_input


def audit_case(paired):
    primary = {"id": "a", "origin_label": "Book", "locator": {"page": 2}, "text": "Observació prèvia.  La rela\u00ad ció és incerta."}
    support = {"id": "b", "origin_label": "Book", "locator": {"page": 1}, "text": "The condition appears on the preceding page."}
    request = {"phase": "source-audit", **audit_payload(primary, [], [support], [], [])}
    if paired:
        request.update(pdf_page_pairs=[[2, 1]], pdf_quote_sources=quote_bindings([primary, support]))
    return request, primary, support


@pytest.mark.parametrize("paired", [False, True], ids=["text", "page-pair"])
def test_assessment_evidence_uses_one_index_from_the_exact_primary_original(paired):
    request, primary, support = audit_case(paired)
    before = deepcopy(request)
    selection = quote_selection(request)
    wire = json.loads(selection.input)
    excerpts = wire["original"]["evidence_excerpts"]
    assert "".join(excerpts.values()) == primary["text"] and "text" not in wire["original"]
    assert wire["support"][0]["text"] == support["text"]
    assert request == before and "evidence_quote" not in selection.schema["properties"]
    answer = {"assessment": "The author retains a qualification.", "evidence_quote_id": 2,
              "unresolved_issues": [], "changes": []}
    canonical = json.loads(selection.restore(encoded(answer)))
    assert canonical["evidence_quote"] == "  La rela\u00ad ció és incerta."
    assert "evidence_quote_id" not in canonical
    assert apply_changes(canonical, [], primary, [primary, support], []) == []
    for invalid in (0, 3, "Source 1, page 2: La relació és incerta."):
        with pytest.raises(ValueError):
            selection.restore(encoded({**answer, "evidence_quote_id": invalid}))
    unresolved = json.loads(selection.restore(encoded({**answer, "unresolved_issues": ["Uncertain attribution."]})))
    with pytest.raises(ValueError, match="Uncertain attribution"):
        apply_changes(unresolved, [], primary, [primary, support], [])


@pytest.mark.parametrize("paired", [False, True])
def test_audit_with_a_tight_window_keeps_the_prior_literal_operation(paired, monkeypatch):
    request, primary, _ = audit_case(paired)
    if not paired:
        request["original"]["text"] = primary["text"] + " A. B." * 360
    prompt = encoded(request)
    runtime = ReadingRuntime("reviewer", "test", "fake", "", 100_000, SimpleNamespace(behavior_resources=True))
    legacy = quote_selection(request, number_audit_evidence=False)
    old_input = compact_structured_input(legacy.input) if legacy else prompt
    old_schema = legacy.schema if legacy else request["output_schema"]
    numbered = quote_selection(request)
    runtime.input_budget = runtime.count_tokens(old_input, output_schema=old_schema)
    assert runtime.count_tokens(compact_structured_input(numbered.input), output_schema=numbered.schema) > runtime.input_budget
    operations = []
    def execute(operation, **kwargs):
        operations.append(operation)
        assert operation.input == old_input and operation.output_schema == old_schema
        answer = encoded({"assessment": "A qualified statement.", "evidence_quote": primary["text"],
                          "changes": [], "unresolved_issues": []})
        kwargs["output_validator"](answer)
        return SimpleNamespace(result=answer, model="fake")
    monkeypatch.setattr("backend.services.agent_execution.run_sync", execute)
    result, _ = runtime.generate_structured(prompt, lambda _: None, 240)
    assert json.loads(result)["evidence_quote"] == primary["text"]
    runtime.input_budget -= 1
    with pytest.raises(RuntimeError, match="context budget"):
        runtime.generate_structured(prompt, lambda _: None, 240)
    assert len(operations) == 1
