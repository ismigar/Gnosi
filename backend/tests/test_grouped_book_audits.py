"""A full selected sample shares calls and a book cap without losing individual findings."""
from __future__ import annotations

import json

import pytest

from backend.domains.llm_wiki.audit_groups import AUDIT_BATCH_SIZE
from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue, PendingPassagesRemaining
from backend.services import reading_budget
from backend.tests.test_agent_execution import runtime as runtime
from backend.tests.test_reading_passage_repair import attach_reviewer
from backend.tests.test_semantic_reading import setup


def decisions(request):
    originals = request["originals"]
    output = {}
    for key, case in request["passages"].items():
        primary = originals[case["primary"] - 1]["text"]
        for draft in case["drafts"]:
            for number in draft["quote_ids"]:
                reference = request["quotes"][number - 1]
                assert reference.get("literal", originals[reference["source"] - 1]["text"]) == draft["title"]
        output[key] = {"assessment": "The opponent advances the claim; the author offers a counterexample.",
                       "evidence_quote": case["drafts"][0]["quote_ids"][0] if case["drafts"] else primary, "unresolved_issues": []}
    return output


def configure(reader, call):
    def ask(prompt, validate, timeout):
        req = json.loads(prompt)
        answer = call(req)
        validate(answer)
        return json.dumps(answer), "reviewer-sol-medium"
    attach_reviewer(reader, ask)
    reader.dependencies.reviewer.audit_batch_size = AUDIT_BATCH_SIZE


def test_every_selected_original_has_a_decision_and_paid_batches_survive_the_cap():
    calls = []
    def generate(request):
        calls.append(request)
        if request["phase"] == "source-synthesis":
            assert request["reviewed_passages"] == 19
            return {"summary": "The author questions the opponent's assumption."}
        assert request["phase"] == "source-audit-batch"
        if len(calls) == 2:
            raise reading_budget.ReadingBudgetError("reading_budget_pending_cost")
        return decisions(request)
    reader, _, saved = setup(count=19)
    configure(reader, generate)
    with pytest.raises(reading_budget.ReadingBudgetError):
        reader.run()
    state = saved["new", "semantic-state"]
    assert len(state["independent_reviews"]) == 8 and not state.get("independent_synthesis")
    assert not state["completed"]
    resumed, ordinary_calls, _ = setup(count=19, checkpoints=saved, resume="new")
    resumed.job_id = "resumed"
    configure(resumed, generate)
    plan, _ = resumed.run()
    assert [len(r["passages"]) for r in calls if r["phase"] == "source-audit-batch"] == [8, 8, 8, 3]
    assert calls[1]["passages"] == calls[2]["passages"]
    assert len(plan["notes"]) == 19 and not ordinary_calls and plan["reviewed"]
    assert len(saved["resumed", "semantic-state"]["independent_reviews"]) == 19


@pytest.mark.parametrize("mode", ["issue", "other-primary", "invalid-pdf-anchor"])
def test_only_the_failed_passage_is_revisited_and_its_finding_survives_a_restart(mode):
    reason = "The opposition between the author and the quoted speaker must be checked."
    attempts = []
    def generate(request):
        phase = request["phase"]
        attempts.append(phase)
        if phase == "source-synthesis":
            return {"summary": "The author preserves the distinction between voices."}
        if phase == "source-audit-batch":
            output = decisions(request)
            if mode == "issue":
                output["passage_2"]["unresolved_issues"] = [reason]
            elif mode == "other-primary":
                output["passage_2"]["evidence_quote"] = output["passage_1"]["evidence_quote"]
            else:
                output["passage_2"]["evidence_quote"] = "opponent"
            return output
        assert phase == "source-audit" and request["original"]["text"].startswith("Argument 1")
        assert any(isinstance(c, dict) and c["independent_finding"] for c in request["coverage"])
        if attempts.count(phase) == 1:
            raise PassageReviewIssue("The original still requires interpretation.")
        return {"assessment": "The passage attributes innate knowledge to the opponent.",
                "evidence_quote": request["original"]["text"], "changes": [], "unresolved_issues": []}
    def attach(reader):
        configure(reader, generate)
        reader.dependencies.citation_issues = lambda notes, _: [
            ["Unlocatable PDF anchor"] if any(c["quote"] == "opponent" for c in n["citations"]) else [] for n in notes]
    reader, _, saved = setup(count=3)
    attach(reader)
    with pytest.raises(PendingPassagesRemaining):
        reader.run()
    partial = saved["new", "semantic-state"]
    assert len(partial["pending_audits"]) == 1 and len(partial["independent_reviews"]) == 2
    assert not partial.get("independent_synthesis")
    again, ordinary, _ = setup(count=3, checkpoints=saved, resume="new")
    again.job_id = "resumed"
    attach(again)
    plan, _ = again.run()
    assert plan["reviewed"] and not ordinary
    assert attempts == ["source-audit-batch", "source-audit", "source-audit", "source-synthesis"]
    assert not saved["resumed", "semantic-state"]["pending_audits"]


def test_batch_rejects_an_omitted_or_unassigned_decision_before_synthesis():
    def generate(req):
        if req["phase"] == "source-audit-batch":
            result = decisions(req)
            result["passage_99"] = result.pop("passage_1")
            return result
        assert req["phase"] == "source-audit"
        raise PassageReviewIssue("The full source must be checked individually.")
    reader, _, saved = setup(count=2)
    configure(reader, generate)
    with pytest.raises(PendingPassagesRemaining, match=": 2"):
        reader.run()
    assert not saved["new", "semantic-state"]["independent_reviews"]
    assert not saved["new", "semantic-state"].get("independent_synthesis")


def test_interrupted_group_operation_is_restored_on_a_new_parent_without_a_second_provider_call(runtime, monkeypatch):
    from backend.domains.llm_wiki.chunking import encoded
    from backend.services import agent_execution as execution
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime
    from backend.tests.test_agent_execution import install_workflow
    scope, snapshot = runtime
    book, _, states = setup(count=2)
    decision = {"assessment": "The author attributes the claim to the opponent.",
                "evidence_quote": "The opponent claims innate knowledge", "unresolved_issues": []}
    calls = install_workflow(monkeypatch, [encoded({"passage_1": decision, "passage_2": decision}),
                                           encoded({"summary": "Experience challenges the opponent's claim."})])
    def use_governed(reader, name):
        parent = execution.create_job_run(snapshot, name, "knowledge.process-source")
        reader.dependencies.reviewer = ReadingRuntime("personal", "test", "fake", "", 48000, parent,
                                                     skill_id=parent.skill_ids[0])
        reader.dependencies.citation_issues = None
    save = book.dependencies.save_checkpoint
    def interrupt(job, key, value):
        if key.startswith("independent-batch-"):
            raise OSError("interrupted after the provider result")
        save(job, key, value)
    with execution_scope(scope):
        use_governed(book, "first-group-run")
        book.dependencies.save_checkpoint = interrupt
        with pytest.raises(OSError, match="after the provider result"):
            book.run()
        assert len(calls) == 1
        resumed, ordinary, _ = setup(count=2, checkpoints=states, resume="new")
        resumed.job_id = "resumed"
        use_governed(resumed, "second-group-run")
        plan, _ = resumed.run()
    assert not ordinary and plan["reviewed"] and len(calls) == 2
    assert len(states["resumed", "semantic-state"]["independent_reviews"]) == 2
    operations = [json.loads(json.loads(call["messages"][0].content)["input"]) for call in calls]
    assert [op["phase"] for op in operations] == ["source-audit-batch", "source-synthesis"]
    assert "output_schema" not in operations[0] and set(operations[0]["passages"]) == {"passage_1", "passage_2"}
