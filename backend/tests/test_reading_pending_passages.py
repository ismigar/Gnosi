"""Unresolved passages stay durable while other source work continues."""
from copy import deepcopy
import json

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.reading_batch_recovery import PendingPassagesRemaining
from backend.services import reading_budget
from backend.tests.test_reading_passage_repair import attach_reviewer, correction
from backend.tests.test_semantic_reading import response, setup


def _draft(request):
    result = response(request)
    if request["phase"] == "interpret":
        for source, item in zip(request["primary_passages"], result["passages"], strict=True):
            if source["text"].startswith(("Argument 0:", "Argument 1:")):
                item["reason"] = "The supplied text does not include the continuation."
    return result


def _reader(checkpoints=None, resume="", generate=_draft):
    reader, calls, checkpoints = setup(count=9, checkpoints=checkpoints, resume=resume, generate=generate)
    first, second, *rest = reader.chunks
    reader.chunks = [{**first, "segments": first["segments"] + second["segments"]}, *rest]
    return reader, calls, checkpoints


def _review_handler(visits, decide):
    def review(prompt, validate, timeout):
        request = json.loads(prompt)
        phase = request["phase"]
        if phase == "source-repair":
            text = request["primary_passages"][0]["text"]
            visits.append(text.split(":")[0])
            answer = correction(request)
            answer["unresolved_issues"] = decide(text)
        elif phase == "source-audit":
            visits.append(phase)
            answer = {"assessment": "Supported by the original.", "evidence_quote": request["original"]["text"],
                      "changes": [], "unresolved_issues": []}
        else:
            visits.append(phase)
            answer = {"summary": "All proposed notes have been checked against the originals."}
        validate(answer)
        return encoded(answer), "reviewer-model"
    return review


def test_other_chunks_finish_while_one_passage_waits_and_only_that_review_is_retried():
    visits = []
    reader, calls, checkpoints = _reader()
    attach_reviewer(reader, _review_handler(visits, lambda t: ["Uncertain attribution"] if t.startswith("Argument 1:") else []))
    with pytest.raises(PendingPassagesRemaining, match="reading_passages_pending: 1"):
        reader.run()
    saved = checkpoints["new", "semantic-state"]
    held, = saved["review_drafts"].values()
    issue, = held["issues"].values()
    assert issue["locator"] == reader.origins[0]["segments"][1]["locator"] and "Uncertain attribution" in issue["reason"]
    assert not saved["completed"] and not saved["reviewed_groups"] and "notes_map" not in saved
    assert list(saved["plans"]) == [c["id"] for c in reader.chunks[1:]]
    assert visits == ["Argument 0", "Argument 1"]
    assert len([c for c in calls if c["phase"] == "interpret"]) >= 2
    approved = deepcopy(saved["plans"])

    resumed, next_calls, _ = _reader(checkpoints, "new")
    resumed.job_id = "second"
    resumed.dependencies.batch_size = 1
    visits.clear()
    attach_reviewer(resumed, _review_handler(visits, lambda _: []))
    result, _ = resumed.run()
    assert all(c["phase"] != "interpret" for c in next_calls)
    assert visits.count("Argument 1") == 1 and "Argument 0" not in visits and visits[-1] == "source-synthesis"
    final = checkpoints["second", "semantic-state"]
    assert final["completed"] and final["review_drafts"] == {}
    assert all(final["plans"][k] == v for k, v in approved.items())
    assert result["reviewed"] and len(result["coverage"]) == 9


def test_a_budget_stop_remains_global_after_a_passage_has_been_deferred():
    reader, calls, checkpoints = _reader()
    visits = []

    def decide(text):
        if text.startswith("Argument 0:"):
            return ["The cited claim is ambiguous."]
        raise reading_budget.ReadingBudgetError("reading_budget_exhausted")

    attach_reviewer(reader, _review_handler(visits, decide))
    with pytest.raises(reading_budget.ReadingBudgetError):
        reader.run()
    saved = checkpoints["new", "semantic-state"]
    staged, = saved["review_drafts"].values()
    assert len(staged["issues"]) == 1 and not saved["completed"]
    assert visits == ["Argument 0", "Argument 1"]
    assert len([c for c in calls if c["phase"] == "interpret"]) == 1


def test_skipping_a_pending_batch_on_an_interrupted_resume_preserves_its_paid_sibling():
    visited = []

    def stop_at_new_material(request):
        if request["phase"] == "interpret" and not request["primary_passages"][0]["text"].startswith("Argument 0:"):
            raise reading_budget.ReadingBudgetError("reading_budget_exhausted")
        return _draft(request)

    reader, _, checkpoints = _reader(generate=stop_at_new_material)
    attach_reviewer(reader, _review_handler(visited, lambda text: ["Ambiguous"] if text.startswith("Argument 1:") else []))
    with pytest.raises(reading_budget.ReadingBudgetError):
        reader.run()
    assert visited == ["Argument 0", "Argument 1"]
    next_reader, _, _ = _reader(checkpoints, "new", stop_at_new_material)
    next_reader.job_id = "middle"
    attach_reviewer(next_reader, _review_handler(visited, lambda _: []))
    with pytest.raises(reading_budget.ReadingBudgetError):
        next_reader.run()
    assert visited == ["Argument 0", "Argument 1"]
    final, _, _ = _reader(checkpoints, "middle")
    final.job_id = "last"
    attach_reviewer(final, _review_handler(visited, lambda _: []))
    result, _ = final.run()
    assert result["reviewed"] and len(result["coverage"]) == 9
    assert visited.count("Argument 0") == 1
    assert visited.count("Argument 1") == 2


def test_joint_review_saves_later_groups_and_only_revisits_its_pending_range():
    from backend.tests.test_semantic_review_parallel import prepared

    def unresolved(request):
        answer = response(request)
        if request["phase"] == "verify" and request["notes"][0]["note"]["title"].startswith("Argument 0:"):
            answer["unresolved_issues"] = ["The two accounts disagree on authorship."]
        return answer

    engine, overview, notes_map, _, checkpoints = prepared(unresolved, count=6, size=2)
    with pytest.raises(PendingPassagesRemaining, match="reading_passages_pending: 2"):
        engine.review(overview, notes_map)
    pending, = engine.state["pending_review_groups"].values()
    assert len(pending["passages"]) == 2 and len(engine.state["reviewed_groups"]) == 2
    assert not engine.state["completed"]
    resumed, calls, _ = setup(count=6, checkpoints=checkpoints, resume="new")
    resumed.job_id = "second"
    result, _ = resumed.run()
    checks = [c for c in calls if c["phase"] == "verify"]
    assert len(checks) == 1 and len(checks[0]["notes"]) == 2
    assert result["reviewed"] and not checkpoints["second", "semantic-state"]["pending_review_groups"]


def test_independent_audits_continue_and_synthesis_waits_for_the_last_passage():
    reader, _, checkpoints = setup(count=4)
    attempts = []
    unresolved = True

    def audit(prompt, validate, timeout):
        request = json.loads(prompt)
        if request["phase"] == "source-synthesis":
            attempts.append("synthesis")
            answer = {"summary": "The four passages were checked."}
        else:
            original = request["original"]["text"]
            attempts.append(original.split(":")[0])
            problems = ["Uncertain attribution."] if unresolved and original.startswith("Argument 0:") else []
            answer = {"assessment": "The source supports the claim.", "evidence_quote": original,
                      "unresolved_issues": problems, "changes": []}
        validate(answer)
        return encoded(answer), "reviewer-model"

    attach_reviewer(reader, audit)
    with pytest.raises(PendingPassagesRemaining, match="reading_passages_pending: 1"):
        reader.run()
    saved = checkpoints["new", "semantic-state"]
    assert len(saved["pending_audits"]) == 1 and len(saved["independent_reviews"]) == 3
    assert "synthesis" not in attempts and not saved["completed"]
    unresolved = False
    attempts.clear()
    resumed, _, _ = setup(count=4, checkpoints=checkpoints, resume="new")
    resumed.job_id = "after"
    attach_reviewer(resumed, audit)
    result, _ = resumed.run()
    assert result["reviewed"] and attempts == ["Argument 0", "synthesis"]
    assert not checkpoints["after", "semantic-state"]["pending_audits"]


def test_equal_segment_ids_in_different_chunks_keep_independent_pending_findings(monkeypatch):
    from backend.domains.llm_wiki import independent_review as review
    from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
    from backend.domains.llm_wiki.semantic_reading import SemanticReader

    reader, _, _ = setup(count=2)
    attach_reviewer(reader, lambda *args: pytest.fail("Unexpected model call"))
    engine = SemanticReader(reader)
    chunks = deepcopy(reader.chunks)
    source_id = chunks[0]["segments"][0]["id"]
    chunks[1]["segments"][0]["id"] = source_id
    reader.chunks = chunks
    rows = [(c, {"notes": [], "coverage": [{"segment_id": source_id, "reason": "Verified"}]}) for c in chunks]
    monkeypatch.setattr(review, "selected_passages", lambda *args: {source_id})
    def audit(worker, reviewer, primary, *args):
        if primary["text"].startswith("Argument 0:"):
            raise PassageReviewIssue("The first occurrence is ambiguous.")
        return "verified", {"assessment": "Supported.", "changes": [], "evidence_quote": primary["text"]}
    monkeypatch.setattr(review, "audit_passage", audit)
    with pytest.raises(PendingPassagesRemaining, match="reading_passages_pending: 1"):
        review.review_reading(engine, rows, "Overview", "Notes")
    pending, = engine.state["pending_audits"].values()
    assert pending["chunk_id"] == chunks[0]["id"] and len(engine.state["independent_reviews"]) == 1


def test_pending_joint_range_can_split_when_its_original_reservation_exceeds_the_budget():
    from backend.tests.test_semantic_review_parallel import prepared

    def unresolved(request):
        answer = response(request)
        if request["phase"] == "verify" and request["notes"][0]["note"]["title"].startswith("Argument 0:"):
            answer["unresolved_issues"] = ["Attribution requires further review."]
        return answer

    engine, overview, notes_map, _, _ = prepared(unresolved, count=4, size=2)
    with pytest.raises(PendingPassagesRemaining):
        engine.review(overview, notes_map)
    attempts = []
    def limited(prompt, validate, timeout):
        request = json.loads(prompt)
        attempts.append(len(request["notes"]))
        if attempts.count(2) > 1:
            pytest.fail("The pending range was not resized after the reservation was refused")
        if len(request["notes"]) > 1:
            raise reading_budget.ReadingBudgetError("reading_budget_exhausted")
        answer = response(request)
        validate(answer)
        return encoded(answer), "reader"
    engine.deps.generate_structured = limited
    assert len(engine.review(overview, notes_map)) == 4
    assert attempts == [2, 1, 1] and not engine.state["pending_review_groups"]
