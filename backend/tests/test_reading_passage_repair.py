"""An extraction rejection reaches the independent reviewer before any chunk is accepted."""

import json
from types import SimpleNamespace

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.services import reading_budget
from backend.tests.test_semantic_reading import response, setup


def rejected_drafts(request):
    answer = response(request)
    if request["phase"] == "interpret":
        for primary, passage in zip(request["primary_passages"], answer["passages"], strict=True):
            if primary["text"].startswith(("Argument 4:", "Argument 5:")):
                passage["reason"] = "El fragmento está truncado."
    return answer


def correction(request):
    original = request["primary_passages"][0]["text"]
    note = {"title": "The objection and its qualification", "body_md": original, "quotes": [original], "properties": {}}
    answer = {"passages": [{"reason": "The author qualifies the objection by appealing to experience.", "notes": [note]}],
              "unresolved_issues": [], "evidence_quote": original}
    if request.get("retained_notes"):
        answer["amendments"] = [{"retained_note": 1, "replacement_note": 1, "reason": "Make the author's qualification explicit.",
                                 "evidence_quote": original}]
    return answer


def attach_reviewer(reader, generate):
    reader.dependencies.citation_issues = None
    reader.dependencies.reviewer = SimpleNamespace(identity="reviewer-sol-medium", input_budget=48000,
                                                   count_tokens=len, generate_structured=generate)


def test_early_repair_preserves_reader_work_and_uses_same_budget_on_resume(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    budget = reading_budget.configure(0.25)
    repairs = []
    phases = []
    def reviewer(prompt, validate, timeout):
        request = json.loads(prompt)
        phases.append(request["phase"])
        assert reading_budget.active()
        if request["phase"] == "source-repair":
            original, = request["primary_passages"]
            repairs.append(original["text"].split(":")[0])
            assert "truncado" in request["rejected_draft"]["reason"]
            assert "source-grounded" in request["validation_error"]
            assert len(request["neighbours"]) == 2
            assert "brain_notes" not in request
            if repairs == ["Argument 4", "Argument 5"]:
                raise reading_budget.ReadingBudgetError("reading_budget_exhausted")
            result = correction(request)
        elif request["phase"] == "source-audit":
            result = {"assessment": "The original supports the retained claims.", "evidence_quote": request["original"]["text"],
                      "changes": [], "unresolved_issues": []}
        else:
            result = {"summary": "The claims were checked against the originals."}
        validate(result)
        return encoded(result), "reviewer-model"

    reader, _, checkpoints = setup(count=8, generate=rejected_drafts)
    attach_reviewer(reader, reviewer)
    with reading_budget.session(budget), pytest.raises(reading_budget.ReadingBudgetError):
        reader.run()
    saved = checkpoints["new", "semantic-state"]
    assert list(saved["plans"]) == [f"chunk-{i}" for i in range(1, 5)]
    assert phases == ["source-repair", "source-repair"]

    resumed, calls, _ = setup(count=8, generate=rejected_drafts, checkpoints=checkpoints, resume="new")
    resumed.job_id = "resumed"
    attach_reviewer(resumed, reviewer)
    discovered = []
    def discover(evidence, origins, retained):
        discovered.append(evidence[0]["text"].split(":")[0])
        return {}
    resumed.dependencies.pdf_quote_excerpts = discover
    with reading_budget.session(budget):
        result, models = resumed.run()
    assert "interpret" not in [call["phase"] for call in calls]
    assert repairs == ["Argument 4", "Argument 5", "Argument 5"]
    assert discovered == ["Argument 5"]
    assert "reviewer-model" in models and phases[-1] == "source-synthesis"
    assert len(result["coverage"]) == len(result["notes"]) == 8
    assert sum(n["title"] == "The objection and its qualification" for n in result["notes"]) == 2
    assert checkpoints["resumed", "semantic-state"]["plans"]["chunk-1"] == saved["plans"]["chunk-1"]


def test_reviewer_must_resolve_the_defect_and_ground_its_answer_in_the_primary():
    reader, _, checkpoints = setup(count=5, generate=rejected_drafts)
    def reviewer(prompt, validate, timeout):
        request = json.loads(prompt)
        valid = correction(request)
        with pytest.raises(ValueError, match="resolve"):
            validate({**valid, "unresolved_issues": ["Attribution remains uncertain"]})
        with pytest.raises(ValueError, match="exact quotation"):
            validate({**valid, "evidence_quote": "Invented evidence"})
        with pytest.raises(ValueError, match="source-grounded review"):
            validate({**valid, "amendments": [], "passages": [{"reason": "A truncated passage.", "notes": []}]})
        original = request["primary_passages"][0]["text"]
        quote = quote_selection(request)
        assert quote is not None
        wire = json.loads(quote.input)
        assert wire["phase"] == "source-repair"
        value = {"passages": {"passage_1": {"reason": valid["passages"][0]["reason"], "notes": [{
            "title": "A grounded idea", "body_md": original, "properties": {}, "primary_quote_ids": [1], "context_quote_ids": []}]}},
            "evidence_quote": original, "unresolved_issues": [], "amendments": valid["amendments"]}
        validate(json.loads(quote.restore(encoded(value))))
        neighbour = wire["source_quotes"][1]["quotes"][0]["quote_id"]
        value["passages"]["passage_1"]["notes"][0]["primary_quote_ids"] = [neighbour]
        with pytest.raises(ValueError):
            quote.restore(encoded(value))
        validate({**valid, "passages": [{"reason": "Grounded.", "notes": [
            {**valid["passages"][0]["notes"][0], "quotes": ["A quotation absent from the original"]}]}]})
        pytest.fail("An ungrounded correction must not pass validation")
    attach_reviewer(reader, reviewer)
    with pytest.raises(ValueError, match="verbatim"):
        reader.run()
    assert len(checkpoints["new", "semantic-state"]["plans"]) == 4


def test_oversized_correction_is_rejected_before_caching_and_retried_alone():
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.services.llm_wiki_reading_runtime import token_bound

    def draft(request):
        result = response(request)
        result["passages"][0]["reason"] = "The passage is truncated."
        return result

    attempts = []
    def review(prompt, validate, timeout):
        request = json.loads(prompt)
        attempts.append(request["phase"])
        answer = correction(request)
        if len(attempts) == 1:
            answer["passages"][0]["notes"][0]["body_md"] = "The author disagrees with the objection. " * 104
        validate(answer)
        return encoded(answer), "reviewer-model"

    def engine(book):
        attach_reviewer(book, review)
        book.dependencies.reviewer.input_budget = 4700
        book.dependencies.reviewer.count_tokens = token_bound
        return SemanticReader(book)

    book, _, checkpoints = setup(count=3, generate=draft)
    with pytest.raises(ValueError, match="exceed the reviewer's context"):
        engine(book).extract("Argument")
    assert not any(key.startswith("passage-repair-") for _, key in checkpoints)
    resumed, reader_calls, _ = setup(count=3, checkpoints=checkpoints, resume="new", generate=draft)
    resumed.job_id = "resumed"
    active = engine(resumed)
    active.extract("Argument")
    assert not reader_calls and attempts == ["source-repair", "source-repair"] and len(active.state["plans"]) == 3


def test_boundary_and_oversized_drafts_in_same_batch_are_independently_repaired():
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.services.llm_wiki_reading_runtime import token_bound

    def draft(request):
        answer = response(request)
        answer["passages"][0]["reason"] = "El fragmento está truncado."
        answer["passages"][1]["notes"][0]["body_md"] = "The author disagrees with the objection. " * 104
        return answer

    originals = []
    def reviewer(prompt, validate, timeout):
        request = json.loads(prompt)
        originals.append(request["primary_passages"][0]["text"])
        if len(originals) == 2:
            assert "omitted" in request["rejected_draft"]
        answer = correction(request)
        validate(answer)
        return encoded(answer), "reviewer-model"

    book, calls, _ = setup(count=3, generate=draft)
    attach_reviewer(book, reviewer)
    book.dependencies.reviewer.input_budget = 4700
    book.dependencies.reviewer.count_tokens = token_bound
    active = SemanticReader(book)
    active.extract("Argument")
    assert len(calls) == 1 and originals == [s["text"] for s in book.origins[0]["segments"][:2]]
    assert len(active.state["plans"]) == 3
    assert active.state["plans"]["chunk-3"]["notes"][0]["title"] != "The objection and its qualification"


def test_specialist_cannot_silently_drop_a_supported_sibling_note():
    from backend.domains.llm_wiki.semantic_reading import SemanticReader

    def draft(request):
        answer = response(request)
        valid, = answer["passages"][0]["notes"]
        valid["title"] = "The editors signed the objections"
        answer["passages"][0]["notes"].append({**valid, "title": "Publication year", "quotes": ["Invented year"]})
        return answer

    def review(prompt, validate, timeout):
        request = json.loads(prompt)
        assert request["retained_notes"] == [{"number": 1, "title": "The editors signed the objections"}]
        fixed = correction(request)
        fixed["passages"][0]["notes"][0]["title"] = "Corrected publication year"
        with pytest.raises(ValueError, match="exact primary quotation"):
            validate({**fixed, "amendments": [{"retained_note": 1, "replacement_note": 0, "reason": "Drop it.",
                                                "evidence_quote": "Not in the source"}]})
        fixed["amendments"] = []
        validate(fixed)
        return encoded(fixed), "reviewer-model"

    book, _, _ = setup(count=2, generate=draft)
    attach_reviewer(book, review)
    active = SemanticReader(book)
    active.extract("Argument")
    assert [n["title"] for n in active.state["plans"]["chunk-1"]["notes"]] == [
        "The editors signed the objections", "Corrected publication year"]
