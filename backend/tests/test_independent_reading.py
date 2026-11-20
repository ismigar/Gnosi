"""Drive the whole checkpointed reader with separate, metered stage doubles."""
import json
from types import SimpleNamespace

import pytest

from backend.domains.llm_wiki.independent_review import sample_passages
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
        calls.append(request["phase"])
        assert reading_budget.active()
        if request["phase"] == "source-synthesis":
            answer = {"summary": "The author rejects the opponent's claim."}
        else:
            original = request["original"]["text"]
            if len(calls) == 2:
                raise reading_budget.ReadingBudgetError("reading_budget_exhausted")
            answer = {"assessment": "The author qualifies the claim.", "evidence_quote": original,
                      "changes": [{"position": 0, "reason": "The objection is missing.",
                                   "replacement": {"title": "A qualification", "body_md": "The author qualifies the claim.",
                                                   "properties": {}, "quotes": [original]}}]}
        validate(answer)
        return json.dumps(answer), "audit-model"

    def configure(reader, revision="review-1"):
        reader.dependencies.reviewer = SimpleNamespace(identity=revision, input_budget=48000, count_tokens=len,
                                                       generate_structured=generate)
        reader.dependencies.reader_instructions = "Keep the contrast with the opponent."
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
