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


def resolved(request):
    return {"finding_resolutions": {row["finding_id"]: {"status": "addressed",
            "reason": "The primary attributes the thesis to the opponent and describes experience as contrary evidence."}
            for row in request["coverage"] if isinstance(row, dict) and "finding_id" in row}}


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
        return {**resolved(request), "assessment": "The passage attributes innate knowledge to the opponent.",
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
    with pytest.raises(PendingPassagesRemaining, match=": 1"):
        reader.run()
    assert len(saved["new", "semantic-state"]["independent_reviews"]) == 1
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


def test_open_findings_survive_malformed_siblings_and_restarts_until_each_has_a_disposition():
    group_issue = "Is the opponent the speaker?"
    individual_issue = "Does the draft retain the qualification on experience?"
    calls = []
    def generate(req):
        phase = req["phase"]
        calls.append(phase)
        if phase == "source-audit-batch":
            result = decisions(req)
            result["passage_1"]["unresolved_issues"] = [group_issue]
            result["passage_2"]["assessment"] = None
            return result
        if phase == "source-synthesis":
            return {"summary": "Claims and objections have been separated."}
        answer = {"assessment": "The opponent claims what experience contradicts.", "changes": [],
                  "evidence_quote": req["original"]["text"], "unresolved_issues": []}
        if req["original"]["text"].startswith("Argument 0"):
            assert group_issue in json.dumps(req["coverage"])
            if calls.count(phase) == 1:
                raise PassageReviewIssue(individual_issue)
            assert individual_issue in json.dumps(req["coverage"])
            if calls.count(phase) == 3:
                return answer  # A generic approval cannot close named findings.
        return {**answer, **resolved(req)}
    first, _, store = setup(count=3)
    configure(first, generate)
    with pytest.raises(PendingPassagesRemaining):
        first.run()
    pending, = store["new", "semantic-state"]["pending_audits"].values()
    assert pending["audit_findings"] == [group_issue, individual_issue]
    assert len(store["new", "semantic-state"]["independent_reviews"]) == 2
    for previous, job in [("new", "partial"), ("partial", "finished")]:
        again, ordinary, _ = setup(count=3, checkpoints=store, resume=previous)
        again.job_id = job
        configure(again, generate)
        if job == "partial":
            with pytest.raises(PendingPassagesRemaining):
                again.run()
            assert not store[job, "semantic-state"].get("independent_synthesis")
        else:
            plan, _ = again.run()
            assert plan["reviewed"] and not store[job, "semantic-state"]["pending_audits"]
        assert not ordinary
    receipts = store["finished", "semantic-state"]["independent_reviews"]
    matching = next(r for r in receipts.values() if group_issue in r.get("audit_findings", []))
    assert individual_issue in matching["audit_findings"] and len(matching["answer"]["finding_resolutions"]) >= 2
    assert calls.count("source-audit-batch") == calls.count("source-synthesis") == 1


def test_governed_batch_keeps_an_open_finding_when_a_sibling_has_a_schema_error(runtime, monkeypatch):
    from backend.services import agent_execution as execution
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime
    from backend.tests.test_agent_execution import install_workflow
    scope, snapshot = runtime
    issue = "Check the role assigned to experience."
    base = {"assessment": "The passage attributes the assertion to the opponent.",
            "evidence_quote": "The opponent", "unresolved_issues": []}
    grouped = {"passage_1": {**base, "unresolved_issues": [issue]}, "passage_2": {**base, "assessment": None},
               "passage_3": base}
    targeted = {"assessment": "The opponent makes the claim and experience challenges it.",
                "evidence_quote_id": 1, "unresolved_issues": [], "changes": [], "finding_resolutions": {
                    "issue_1": {"status": "addressed", "reason": "The original names experience as the counterexample."}}}
    calls = install_workflow(monkeypatch, [json.dumps(x) for x in
        (grouped, targeted, targeted, {"summary": "The original attributes each claim to its speaker."})])
    reader, _, states = setup(count=3)
    with execution_scope(scope):
        parent = execution.create_job_run(snapshot, "batch-with-findings", "knowledge.process-source")
        reader.dependencies.reviewer = ReadingRuntime("personal", "test", "fake", "", 48000, parent,
                                                     skill_id=parent.skill_ids[0])
        reader.dependencies.citation_issues = None
        plan, _ = reader.run()
    requests = [json.loads(json.loads(call["messages"][0].content)["input"]) for call in calls]
    assert [r["phase"] for r in requests] == ["source-audit-batch", "source-audit", "source-audit", "source-synthesis"]
    assert issue in json.dumps(requests[1]["coverage"]) and issue not in json.dumps(requests[2]["coverage"])
    assert issue in json.dumps(states["new", "semantic-state"]["independent_reviews"]) and plan["reviewed"]


def test_a_paid_individual_assessment_with_an_unlocatable_pdf_quote_reopens_only_that_original(tmp_path):
    from backend.domains.llm_wiki.chunking import reading_chunks
    from backend.domains.llm_wiki.origins import finalize_origin
    from backend.services.llm_wiki_pdf_annotations import reading_citation_issues
    from backend.tests.test_llm_wiki_pdf_annotations import _demo_pdf, _origin
    from backend.tests.test_semantic_reading import response
    valid, invalid = "in this portable PDF fixture", "A cached OCR error"
    source = finalize_origin({**_origin(_demo_pdf(tmp_path)), "label": "Fixture", "input_order": 0, "segments": [
        {"text": f"{invalid}. {valid}", "locator": {"page": 1, "paragraph": 1}}]})
    chunks = reading_chunks([source], budget=2000, count=len)
    def extract(req):
        answer = response(req)
        if req["phase"] == "interpret":
            for passage in answer["passages"]:
                passage["notes"][0].update(title="The PDF fixture", body_md="The text refers to a PDF fixture.", quotes=[valid])
        return answer
    def historical(req):
        if req["phase"] == "source-synthesis":
            raise reading_budget.ReadingBudgetError("paused_before_synthesis")
        return {"assessment": "The passage concerns a PDF fixture.", "evidence_quote": invalid, "changes": [], "unresolved_issues": []}
    reader, _, store = setup(generate=extract)
    reader.origins, reader.chunks = [source], chunks
    configure(reader, historical)
    reader.dependencies.reviewer.audit_batch_size = 1
    reader.dependencies.citation_issues = None  # An older receipt covered only the note quotations.
    with pytest.raises(reading_budget.ReadingBudgetError):
        reader.run()
    resumed, ordinary, _ = setup(generate=extract, checkpoints=store, resume="new")
    resumed.job_id = "resumed"
    resumed.origins, resumed.chunks = [source], chunks
    phases = []
    def corrected(req):
        phases.append(req["phase"])
        if req["phase"] == "source-synthesis":
            assert req["findings"][0]["quote"] == valid
            return {"summary": "The cited wording appears in the PDF fixture."}
        assert req["phase"] == "source-audit"
        return {"assessment": "The passage concerns the portable PDF fixture.", "evidence_quote": valid, "changes": [], "unresolved_issues": []}
    configure(resumed, corrected)
    resumed.dependencies.citation_issues = reading_citation_issues
    plan, _ = resumed.run()
    assert plan["reviewed"] and not ordinary and phases == ["source-audit", "source-synthesis"]
    receipt, = store["resumed", "semantic-state"]["independent_reviews"].values()
    assert receipt["answer"]["evidence_quote"] == valid


@pytest.mark.parametrize("stop", ["budget", "budget_with_open_disposition", "invalid_amendment", "revised_audit", "unresolved_patch", "listed_reasons"])
def test_every_paid_objection_survives_an_interrupted_amendment(runtime, monkeypatch, tmp_path, stop):
    from backend.services import agent_execution as execution, ai_usage_ledger as ledger
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime
    from backend.tests.test_agent_execution import install_workflow
    scope, snapshot = runtime
    monkeypatch.setattr(ledger, "resolve_data_dir", lambda **_: tmp_path)
    identifier = reading_budget.configure(5, book=reading_budget.BookAccount("fixture-book", ()))
    rates = {"cost_in": 0, "cost_out": 1}
    findings = ["Who advances the claim?", "Is the qualification retained?", "What is the role of experience?"]
    grouped = {"passage_1": {"assessment": "The passage discusses a claim.", "evidence_quote": "The opponent",
                              "unresolved_issues": findings[:1]}}
    reasons = [{"status": "addressed", "reason": text} for text in
               ("The opponent advances it.", "The draft retains the qualification.", "Experience challenges the claim.")]
    def decision(count):
        return {"assessment": "The opponent advances the claim and experience contradicts it.",
                "changes": [], "evidence_quote_id": 1, "unresolved_issues": findings[count:],
                "finding_resolutions": {f"issue_{i + 1}": v for i, v in enumerate(reasons[:count])}}
    first_audit = decision(1)
    if stop == "budget_with_open_disposition":
        first_audit.update(unresolved_issues=findings[1:2], finding_resolutions={"issue_1": {
            "status": "unresolved", "reason": findings[2]}})
    amendment = {"findings": {}, "correction": {"keep_changes": {}}}
    if stop == "revised_audit":
        new_issues = ["What kind of experience?", "Does the author offer an alternative?"]
        revised = {**decision(1), "unresolved_issues": new_issues}
        amendment = {"findings": {name: {"status": "addressed", "reason": reason, "evidence_excerpt": 1}
                                  for name, reason in (("issue_1", " "), ("issue_2", "The text attributes the claim."))},
                     "correction": {"revised_audit": revised, "prior_changes": {}}}
        findings.extend(new_issues)
        reasons.extend([{"status": "source_limitation", "reason": "The short original does not specify this."}] * 2)
    if stop == "unresolved_patch":
        findings.append("Does the opponent qualify the claim?")
        reasons.append({"status": "addressed", "reason": "The original attributes an unqualified position to the opponent."})
        amendment["findings"] = {"issue_1": {"status": "unresolved", "reason": findings[-1], "evidence_excerpt": 1}}
    if stop == "listed_reasons":
        extra = ["What kind of experience?", "Does the author offer an alternative?"]
        findings.extend(extra)
        reasons.extend([{"status": "source_limitation", "reason": "The original does not specify this."}] * len(extra))
        amendment["findings"] = {"issue_1": {"status": "unresolved", "reason": extra, "evidence_excerpt": 1},
                                 "issue_2": {"status": "addressed", "reason": "Experience contradicts the claim.", "evidence_excerpt": 1}}
    answers = [grouped, first_audit, amendment, decision(len(findings)), {"summary": "Experience qualifies the opponent's claim."}]
    class Responses:
        def __getitem__(self, index):
            if stop.startswith("budget"):
                reading_budget.reserve(f"call-{index}", [], {"max_tokens": 1_000_000}, rates, "test")
            return json.dumps(answers[index])
    calls = install_workflow(monkeypatch, Responses())
    def attach(reader, name):
        parent = execution.create_job_run(snapshot, name, "knowledge.process-source")
        reader.dependencies.reviewer = ReadingRuntime("personal", "test", "fake", "", 48000, parent, skill_id=parent.skill_ids[0])
        reader.dependencies.citation_issues = None
    with execution_scope(scope), reading_budget.session(identifier):
        if stop.startswith("budget"):
            reading_budget.reserve("historical", [], {"max_tokens": 2_400_000}, rates, "test")
            with ledger.connect() as db:
                reading_budget.settle(db, "historical", 2.4)
        first, _, store = setup(count=1)
        attach(first, "initial")
        with pytest.raises(reading_budget.ReadingBudgetError if stop.startswith("budget") else PendingPassagesRemaining):
            first.run()
        state = store["new", "semantic-state"]
        pending, = state["pending_audits"].values()
        assert pending["audit_findings"] == findings and not state["completed"] and not state["independent_synthesis"]
        if stop.startswith("budget"):
            assert reading_budget.status(identifier)["remaining_usd"] == .4
            with ledger.connect() as db:
                for call in ("call-0", "call-1"):
                    reading_budget.settle(db, call, .01)
        next_book, ordinary, _ = setup(count=1, checkpoints=store, resume="new")
        next_book.job_id = "resumed"
        attach(next_book, "resumed")
        plan, _ = next_book.run()
    assert plan["reviewed"] and not ordinary and not store["resumed", "semantic-state"]["pending_audits"]
    requests = [json.loads(json.loads(call["messages"][0].content)["input"]) for call in calls]
    assert [item["independent_finding"] for item in requests[3]["coverage"] if isinstance(item, dict)] == findings
    assert [r["finding"] for r in requests[-1]["findings"][0]["review_findings"]] == findings
