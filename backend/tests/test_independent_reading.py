"""Drive the whole checkpointed reader with separate, metered stage doubles."""
import json
from types import SimpleNamespace

import pytest

from backend.domains.llm_wiki.review_selection import sample_passages
from backend.services import reading_budget
from backend.tests.test_semantic_reading import setup


def test_stratified_passages_include_every_chapter_and_long_unsectioned_documents():
    chunks = [{"origin_id": origin, "segments": [
        {"id": f"{origin}-{i}", "locator": {"section": chapter}} for i, chapter in enumerate(sections)]}
        for origin, sections in [("book", ["A"] * 24 + ["B"]), ("scan", [""] * 25)]]
    assert sample_passages(chunks) == {"book-6", "book-18", "book-24", "scan-6", "scan-18", "scan-24"}


def test_resuming_independent_review_preserves_reader_work_and_uses_the_same_book_budget(monkeypatch, tmp_path):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    budget = reading_budget.configure(0.25)
    calls = []
    def generate(prompt, validate, timeout):
        request = json.loads(prompt)
        assert "PRIVATE reader context marker" not in prompt
        calls.append(request["phase"])
        assert reading_budget.active()
        if request["phase"] == "source-synthesis":
            answer = {"summary": "The author rejects the opponent's claim."}
        else:
            original = request["original"]["text"]
            if len(calls) == 2:
                raise reading_budget.ReadingBudgetError("reading_budget_exhausted")
            answer = {"assessment": "The author qualifies the claim.", "evidence_quote": original, "unresolved_issues": [],
                      "changes": [{"position": 0, "reason": "The objection is missing.",
                                   "replacement": {"title": "A qualification", "body_md": "The author qualifies the claim.",
                                                   "properties": {}, "quotes": [original]}}]}
        validate(answer)
        return json.dumps(answer), "audit-model"

    def configure(reader, revision="review-1"):
        reader.dependencies.reviewer = SimpleNamespace(identity=revision, input_budget=48000, count_tokens=len,
                                                       generate_structured=generate)
        reader.dependencies.reader_instructions = "PRIVATE reader context marker"
        reader.dependencies.citation_issues = None

    reader, reader_calls, records = setup(count=3)
    configure(reader)
    with reading_budget.session(budget), pytest.raises(reading_budget.ReadingBudgetError):
        reader.run()
    assert "verify" in [value["phase"] for value in reader_calls]
    assert len(records["new", "semantic-state"]["independent_reviews"]) == 1
    resumed, reader_calls, _ = setup(count=3, checkpoints=records, resume="new")
    resumed.job_id = "second"
    configure(resumed)
    with reading_budget.session(budget):
        plan, models = resumed.run()
    assert reader_calls == []
    assert calls == ["source-audit"] * 4 + ["source-synthesis"]
    assert plan["summary"] == "The author rejects the opponent's claim." and "audit-model" in models
    assert sum(note["title"] == "A qualification" for note in plan["notes"]) == 3
    assert all(row["reason"] == "The author qualifies the claim." for row in plan["coverage"])
    changed, reader_calls, _ = setup(count=3, checkpoints=records, resume="second")
    changed.job_id = "third"
    configure(changed, "edited-reviewer")
    with reading_budget.session(budget):
        changed.run()
    assert reader_calls == []
    assert calls[-4:] == ["source-audit"] * 3 + ["source-synthesis"]


def test_repeated_section_names_and_distinct_signals_keep_both_originals():
    from backend.domains.llm_wiki.documents import extract_html
    from backend.domains.llm_wiki.origins import finalize_origin
    from backend.domains.llm_wiki.chunking import reading_chunks
    from backend.domains.llm_wiki.review_selection import flagged_passages
    html = "<h1>Alpha</h1><h2>Overview</h2><p>First.</p><h1>Beta</h1><h2>Overview</h2><p>Second.</p>"
    origin = finalize_origin({"kind": "html", "label": "Book", "input_order": 0, "segments": extract_html(html)})
    chunks = reading_chunks([origin], budget=4096, count=len)
    assert sample_passages(chunks) == {s["id"] for s in origin["segments"]}
    passages = [{"id": "a", "text": "Cyanium hypothesis"}, {"id": "b", "text": "Ordinary"},
                {"id": "c", "text": "Vermillion counterexample"}]
    assert flagged_passages(passages, {"questions": ["Cyanium hypothesis?"], "warnings": ["Vermillion."]}) == {"a", "c"}


def test_revision_only_migration_keeps_paid_verification_and_sends_grounded_corrections_to_synthesis():
    reader, _, states = setup(count=1, revision="old")
    reader.run()
    resumed, reader_calls, _ = setup(count=1, revision="compatible", checkpoints=states, resume="new")
    resumed.job_id = "upgrade"
    resumed.dependencies.legacy_reader_revision = lambda _: "old"
    resumed.dependencies.citation_issues = None
    def review(prompt, validate, timeout):
        req = json.loads(prompt)
        if req["phase"] == "source-synthesis":
            correction = req["findings"][0]["corrections"][0]
            assert correction["replacement"]["body_md"] == "Revised attribution."
            assert correction["replacement"]["quotes"] == [original]
            assert correction["reason"] == "The author attributes the objection to the opponent."
            with pytest.raises(ValueError, match="substantive synthesis"):
                validate({"summary": " "})
            answer = {"summary": "The opponent supplies the objection."}
        else:
            change = {"position": 1, "reason": "The author attributes the objection to the opponent.",
                      "replacement": {"title": "Objection", "body_md": "Revised attribution.", "properties": {}, "quotes": [original]}}
            answer = {"assessment": "The author attributes the objection.", "evidence_quote": original, "unresolved_issues": [], "changes": [change]}
            with pytest.raises(ValueError, match="resolve outstanding"):
                validate({**answer, "unresolved_issues": ["Who is speaking?"]})
        validate(answer)
        return json.dumps(answer), "review-model"
    original = reader.chunks[0]["segments"][0]["text"]
    resumed.dependencies.reviewer = SimpleNamespace(identity="revisor", input_budget=48000, count_tokens=len, generate_structured=review)
    result, _ = resumed.run()
    assert result["notes"][0]["body_md"] == "Revised attribution."
    assert not reader_calls


def test_undersized_reviewer_is_detected_before_any_model_calls():
    reader, calls, _ = setup(count=1)
    reader.chunks[0]["segments"][0]["text"] = "Attribution, exception and qualification remain in this original. " * 50
    reader.dependencies.reviewer = SimpleNamespace(identity="narrow", input_budget=5000, count_tokens=len)
    with pytest.raises(RuntimeError, match="reviewer needs more context"):
        reader.run()
    assert calls == []


def test_large_synthesis_sends_all_findings_in_checkpointed_batches():
    from backend.domains.llm_wiki.review_synthesis import synthesize
    reader, _, _ = setup(count=1)
    prompts = []
    def review(prompt, validate, timeout):
        request = json.loads(prompt)
        prompts.append(request)
        answer = {"summary": "All these source qualifications have been reviewed."}
        validate(answer)
        return json.dumps(answer), "reviewer"
    runtime = SimpleNamespace(identity="narrow", input_budget=2200, count_tokens=len, generate_structured=review)
    material = [{"quote": str(i) + "a" * 550, "corrections": [{"reason": f"correction-{i}"}]} for i in range(9)]
    engine = SimpleNamespace(reader=reader, state={}, save=lambda: None)
    assert synthesize(engine, reader, runtime, "Source map", "Notes map", material).strip()
    assert all(any(item in request.get("material", []) for request in prompts) for item in material)
    assert "reviewed_evidence" in prompts[-1]
    count = len(prompts)
    synthesize(engine, reader, runtime, "Source map", "Notes map", material)
    assert len(prompts) == count


def test_reader_routes_only_identified_difficult_passages_plus_distributed_sample():
    from backend.tests.test_semantic_reading import response
    def reading(request):
        answer = response(request)
        if request["phase"] == "interpret":
            for passage, original in zip(answer["passages"], request["primary_passages"]):
                passage["needs_specialist"] = original["text"].startswith(("Argument 0:", "Argument 6:"))
        return answer
    reader, _, _ = setup(count=7, generate=reading)
    for chunk in reader.chunks:
        chunk["segments"][0]["locator"] = {"section": "One chapter"}
    seen = []
    def reviewing(prompt, validate, timeout):
        request = json.loads(prompt)
        if request["phase"] == "source-audit":
            quote = request["original"]["text"]
            seen.append(quote.split(":")[0])
            answer = {"assessment": "The passage supports the reading.", "evidence_quote": quote, "changes": [], "unresolved_issues": []}
        else:
            answer = {"summary": "The reviewed qualifications are grounded in the originals."}
        validate(answer)
        return json.dumps(answer), "reviewer"
    reader.dependencies.reviewer = SimpleNamespace(identity="reviewer", input_budget=48000, count_tokens=len, generate_structured=reviewing)
    reader.dependencies.citation_issues = None
    reader.run()
    assert seen == ["Argument 0", "Argument 3", "Argument 6"]
