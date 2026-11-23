"""A source audit selects its assessment evidence without retyping or decorating it."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.audit_checkpoint_provenance import audit_scope
from backend.domains.llm_wiki.independent_review import apply_changes, audit_passage, audit_payload, original_audit
from backend.domains.llm_wiki.pdf_page_context import page_context
from backend.domains.llm_wiki.pdf_review_excerpts import quote_bindings
from backend.domains.llm_wiki.review_draft_batches import AuditRanges, audit_in_batches, review_coverage
from backend.domains.llm_wiki.semantic_contracts import bind_note
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.services import agent_execution as execution
from backend.services.agent_cancellation import AgentTurnCancelled
from backend.services.agent_execution_models import AgentOperation
from backend.services.agent_execution_scope import execution_scope
from backend.services.llm_wiki_reading_runtime import ReadingRuntime, compact_structured_input
from backend.tests.test_agent_execution import install_workflow, runtime as runtime
from backend.tests.test_reading_pdf_page_context import chunk, segment
from backend.tests.test_semantic_reading import setup


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
    assert json.loads(selection.restore(encoded({**answer, "evidence_quote_id": 2.0}))) == canonical
    assert apply_changes(canonical, [], primary, [primary, support], []) == []
    for invalid in (0, 3, 1.5, True, "Source 1, page 2: La relació és incerta."):
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


@pytest.mark.parametrize("prepaid_coverage", [False, True])
def test_complete_audit_uses_the_fitting_wire_or_recovers_its_paid_coverage(prepaid_coverage, monkeypatch):
    book, _, _ = setup(count=1)
    primary = segment("primary", 1, 8, "A. B. C. " * 110 + "Final observation.")
    continuation = segment("support", 2, 1, "An explicit qualification.")
    book.chunks = [chunk("essay", primary, continuation)]
    monkeypatch.setattr(ReadingRuntime, "identity", property(lambda self: "test-reviewer"))
    runtime = ReadingRuntime("reviewer", "test", "fake", "", 100_000, SimpleNamespace(behavior_resources=True))
    key, payload, support = original_audit(book, runtime, primary, [], [primary], [])
    context = page_context(book.pdf_edges, [primary], [primary])
    request = {"phase": "source-audit", "resource": book.title, "language": book.language, **context.prompt(payload, audit=True)}
    old = quote_selection(request, number_audit_evidence=False)
    runtime.input_budget = runtime.count_tokens(compact_structured_input(old.input), output_schema=old.schema)
    assert runtime.count_tokens(encoded(request)) > runtime.input_budget
    calls = []
    def execute(operation, **kwargs):
        calls.append(operation.input)
        assert operation.output_schema == old.schema
        answer = encoded({"assessment": "The final observation has a qualification.", "evidence_quote": "Final observation.",
                          "changes": [], "unresolved_issues": []})
        return SimpleNamespace(result=kwargs["output_validator"](answer), model="fake")
    monkeypatch.setattr("backend.services.agent_execution.run_sync", execute)
    if prepaid_coverage:
        # Model a split job stopped after its final paid coverage checkpoint, before the state update.
        runtime.input_budget += 200
        scope = audit_scope(book, primary, [], [primary])
        audit_in_batches(book, runtime, primary, [], support, [], key, lambda *_: None, scope)
        runtime.input_budget -= 200
    _, result = audit_passage(book, runtime, primary, [], [primary], {"coverage": []}, {}, None)
    assert result["evidence_quote"] == "Final observation." and len(calls) == 1
    assert ("reviewed_claims" in json.loads(calls[0])) == prepaid_coverage


@pytest.mark.parametrize("paired", [False, True])
@pytest.mark.parametrize("cancel_during_restore", [False, True])
def test_paid_literal_audit_is_revalidated_after_an_interrupted_phase_write(runtime, monkeypatch, paired, cancel_during_restore):
    scope, snapshot = runtime
    request, primary, other = audit_case(paired)
    prompt = encoded(request)
    answer = {"assessment": "The author's qualification stands.", "evidence_quote": "és incerta.",
              "changes": [], "unresolved_issues": []}
    calls = install_workflow(monkeypatch, [encoded(answer)])
    previous = quote_selection(request, number_audit_evidence=False)
    checked = []
    def validate(item):
        apply_changes(item, [], primary, [primary, other], [])
        checked.append(item)
        if cancel_during_restore:
            execution.cancel_run("resumed-book-job")
    with execution_scope(scope):
        parent = execution.create_job_run(snapshot, "first-book-job", "knowledge.process-source")
        reviewer = ReadingRuntime("personal", "test", "fake", "", 100_000, parent, skill_id=parent.skill_ids[0])
        old = AgentOperation(skill_id=reviewer.skill_id, operation="knowledge.process-source.phase",
                             input=compact_structured_input(previous.input) if previous else prompt,
                             output_schema=previous.schema if previous else request["output_schema"],
                             timeout_seconds=240, origin="worker", resume_requires_parent=True,
                             options=reviewer.performance_options, max_model_calls=2)
        execution.run_sync(old, snapshot=parent)
        # Only the governed operation has been saved. The new job still checks its source before reuse.
        reviewer.snapshot = execution.create_job_run(snapshot, "resumed-book-job", "knowledge.process-source")
        if cancel_during_restore:
            with pytest.raises(AgentTurnCancelled):
                reviewer.generate_structured(prompt, validate, 240)
        else:
            result, _ = reviewer.generate_structured(prompt, validate, 240)
            assert json.loads(result) == answer
    assert checked == [answer] and len(calls) == 1


def test_coverage_operation_survives_interruption_before_any_phase_checkpoint(runtime, monkeypatch):
    scope, snapshot = runtime
    book, _, checkpoints = setup(count=1)
    primary = segment("primary", 1, 8, "A. B. C. " * 15 + "Final observation.")
    book.chunks = [chunk("essay", primary, segment("support", 2, 1, "A qualification follows."))]
    reason = "The observation is conditional."
    answer = {"assessment": reason, "evidence_quote": "Final observation.", "changes": [], "unresolved_issues": []}
    calls = install_workflow(monkeypatch, [encoded(answer)])
    with execution_scope(scope):
        parent = execution.create_job_run(snapshot, "interrupted-coverage", "knowledge.process-source")
        reviewer = ReadingRuntime("personal", "test", "fake", "", 100_000, parent, skill_id=parent.skill_ids[0])
        key, _, _ = original_audit(book, reviewer, primary, [], [primary], [reason])
        def previous_coverage(prompt, validate, timeout):
            reviewer.input_budget = reviewer.count_tokens(prompt)
            old = quote_selection(json.loads(prompt), number_audit_evidence=False)
            op = reviewer._structured_operation(compact_structured_input(old.input), old.schema, timeout, 2, {})
            paid = execution.run_sync(op, snapshot=parent)
            value = old.restore(paid.result)
            validate(json.loads(value))
            return value, paid.model
        with monkeypatch.context() as patch:
            patch.setattr(reviewer, "generate_structured", previous_coverage)
            def interrupted(*_):
                raise OSError("interrupted phase write")
            patch.setattr(book.dependencies, "save_checkpoint", interrupted)
            with pytest.raises(OSError, match="interrupted phase write"):
                review_coverage(book, reviewer, primary, [reason], [], key, lambda *_: None, None)
        assert not checkpoints
        _, restored = audit_passage(book, reviewer, primary, [], [primary],
                                    {"coverage": [{"segment_id": primary["id"], "reason": reason}]}, {}, None)
    assert restored == answer and len(calls) == 1


def test_recovered_note_range_keeps_its_original_size_when_more_notes_now_fit():
    book, _, _ = setup(count=1)
    primary = segment("primary", 1, 1, "The trial lasted two days. The author recorded its limits.")
    book.chunks = [chunk("trial", primary)]
    notes = [bind_note({"title": title, "body_md": sentence, "quotes": [sentence], "properties": {}},
                       primary, [primary], []) for title, sentence in
             [("Duration", "The trial lasted two days."), ("Limits", "The author recorded its limits.")]]
    recovered, fresh = [], []
    def reply(prompt, validate, destination):
        request = json.loads(prompt)
        destination.append([n["title"] for n in request["drafts"]])
        answer = {"assessment": "The trial has a stated duration and limits.", "changes": [],
                  "unresolved_issues": [], "evidence_quote": "The trial lasted two days."}
        validate(answer)
        return encoded(answer), "reviewer"
    reviewer = SimpleNamespace(identity="reviewer", input_budget=100_000, count_tokens=len,
                               generate_structured=lambda prompt, validate, timeout: reply(prompt, validate, fresh),
                               recover_audit=lambda prompt, validate, timeout: reply(prompt, validate, recovered))
    ranges = AuditRanges(book, reviewer, primary, "parent-key")
    ranges.save(f"audit-notes-{ranges.passage_id}-0", 0, 1)
    audit_in_batches(book, reviewer, primary, notes, [], [], "parent-key", lambda *_: None)
    assert recovered == [["Duration"]] and fresh == [["Limits"], []]
