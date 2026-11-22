"""A second governed source review may amend a proposal without losing its evidence."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.domains.agent.structured_output import _has_dynamic_object
from backend.domains.llm_wiki.audit_amendments import build_audit_amendment
from backend.domains.llm_wiki.audit_citation_repairs import AuditCitationIssue, SourceAuditValidator, citation_slots, validate_revision_origins
from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.independent_review import apply_changes, audit_passage
from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key
from backend.domains.llm_wiki.semantic_quote_selection import QuoteSelection, quote_selection
from backend.services import agent_execution as execution
from backend.services.agent_execution_scope import execution_scope
from backend.services.llm_wiki_reading_runtime import ReadingRuntime
from backend.tests.test_agent_execution import install_workflow, runtime as runtime
from backend.tests.test_reading_audit_evidence import audit_case
from backend.tests.test_semantic_reading import setup


def previous():
    return {"assessment": "The author qualifies the observation.", "evidence_quote_id": 2,
            "unresolved_issues": ["Can the first edition be identified?", "Does the conclusion retain uncertainty?"],
            "changes": [{"position": 0, "reason": "Retain the author's qualification.",
                         "replacement": {"title": "A qualification", "body_md": "The author describes uncertainty.",
                                         "quotes": ["és incerta."], "properties": {}}}]}


def findings():
    return {"issue_1": {"status": "source_limitation", "reason": "The edition is unspecified.", "evidence_excerpt": 1.0},
            "issue_2": {"status": "addressed", "reason": "The note already qualifies the claim.", "evidence_excerpt": 2}}


def test_governed_amendment_keeps_the_first_proposal_and_resumes_without_rebilling(runtime, monkeypatch):
    scope, snapshot = runtime
    request, primary, support = audit_case(False)
    proposal = previous()
    amended = {"findings": findings(), "correction": {"keep_changes": {}}}
    calls = install_workflow(monkeypatch, list(map(encoded, (proposal, amended))))
    def validate(answer):
        apply_changes(answer, [], primary, [primary, support], [])
    with execution_scope(scope):
        parent = execution.create_job_run(snapshot, "first-reading", "knowledge.process-source")
        reviewer = ReadingRuntime("personal", "test", "fake", "", 100_000, parent, skill_id=parent.skill_ids[0])
        result, _ = reviewer.generate_structured(encoded(request), validate, 120)
        first = json.loads(result)
        assert first["changes"] == proposal["changes"] and first["unresolved_issues"] == []
        assert first["evidence_quote"] == "  La rela\u00ad ció és incerta."
        assert all(d["reason"] in first["assessment"] for d in findings().values())
        assert "Observació prèvia." in first["assessment"]
        repair = json.loads(calls[1]["messages"][0].content)
        assert not _has_dynamic_object(repair["output_schema"])
        assert json.loads(repair["input"])["previous_audit"] == proposal
        assert len(calls[1]["messages"]) == 1
        reviewer.snapshot = execution.create_job_run(snapshot, "resumed-reading", "knowledge.process-source")
        assert json.loads(reviewer.generate_structured(encoded(request), validate, 120)[0]) == first
    assert len(calls) == 2


@pytest.mark.parametrize("action", ["open", "missing", "extra", "foreign_evidence", "whitespace", "new_error", "resolved"])
def test_each_previous_finding_is_required_even_when_the_reviewer_revises_the_whole_audit(action):
    request, primary, support = audit_case(False)
    selection = quote_selection(request)
    def validate(answer):
        apply_changes(answer, [], primary, [primary, support], [])
    proposal = previous()
    amendment = build_audit_amendment(selection, encoded(proposal), validate, ValueError())
    revised = {**deepcopy(proposal), "unresolved_issues": []}
    revised["changes"][0]["replacement"]["body_md"] = "A corrected and qualified conclusion."
    answers = findings()
    if action == "open":
        answers["issue_1"]["status"] = "unresolved"
    elif action == "missing":
        del answers["issue_2"]
    elif action == "extra":
        answers["issue_3"] = answers["issue_2"]
    elif action == "foreign_evidence":
        answers["issue_2"]["evidence_excerpt"] = 3
    elif action == "whitespace":
        answers["issue_2"]["reason"] = " "
    elif action == "new_error":
        revised["changes"][0]["replacement"]["quotes"] = ["invented"]
    response = encoded({"findings": answers, "correction": {"revised_audit": revised, "prior_changes": {
        "change_1": {"reason": "The revised note retains the qualification.", "evidence_excerpt": 2}}}})
    if action == "resolved":
        actual = json.loads(selection.restore(amendment.restore(response)))
        validate(actual)
        assert actual["changes"] == revised["changes"]
    else:
        with pytest.raises(ValueError):
            validate(json.loads(selection.restore(amendment.restore(response))))


@pytest.mark.parametrize("paired", [True, False])
def test_only_the_rejected_quote_can_change_and_keeps_its_owner(paired):
    request, primary, support = audit_case(paired)
    short = "the preceding page."
    bounds = [(support["text"].index(short), len(support["text"]))]
    worker = SimpleNamespace(dimensions=[], origins=[], dependencies=SimpleNamespace(pdf_quote_excerpts=lambda *_: {
        segment_source_key(support): {"0": bounds, "retained": bounds}}))
    def check(notes, _):
        return [["no highlight" for c in n["citations"] if c["quote"] == support["text"]] for n in notes]
    proposal = previous()
    citations = ["és incerta.", support["text"]]
    if paired:
        citations = [{"source": i + 1, "text": q} for i, q in enumerate(citations)]
    proposal["changes"][0]["replacement"]["quotes"] = citations
    selection = quote_selection(request)
    def validate(answer):
        notes = apply_changes(answer, [], primary, [primary, support], [])
        if any(check(notes, [])):
            raise AuditCitationIssue(lambda: citation_slots(worker, answer, primary, [primary, support], check))
    amend = build_audit_amendment(selection, encoded(proposal), validate, ValueError())
    choices = json.loads(amend.input)["citation_choices"]
    assert choices == {"change_1_quote_2": {"1": short}}
    answer = json.loads(amend.restore(encoded({"findings": findings(), "correction": {"keep_changes": {"change_1_quote_2": 1.0}}})))
    assert answer["changes"][0]["replacement"]["quotes"] == [citations[0], {"source": 2, "text": short} if paired else short]
    validate(json.loads(selection.restore(encoded(answer))))
    assert proposal["changes"][0]["replacement"]["quotes"] == citations
    # A shortened support quote cannot silently bind to a second original.
    duplicate = {**support, "id": "another", "text": short}
    canonical = json.loads(selection.restore(encoded(proposal)))
    slots = citation_slots(worker, canonical, primary, [primary, support, duplicate], check)
    assert bool(slots) == paired


@pytest.mark.parametrize("available", [True, False])
def test_misspelled_literal_can_only_be_replaced_from_the_numbered_source_with_positive_geometry(available):
    request, primary, support = audit_case(True)
    selection = quote_selection(request)
    proposal = previous()
    proposal["changes"][0]["replacement"]["quotes"] = [{"source": 1, "text": "és incerta."}, {"source": 2, "text": "…"}]
    short = "preceding page."
    bounds = [(support["text"].index(short), len(support["text"]))]
    worker = SimpleNamespace(origins=[], dependencies=SimpleNamespace(citation_issues=lambda notes, _: [[] for _ in notes],
        pdf_quote_excerpts=lambda *_: {segment_source_key(support): {"retained": bounds}} if available else {}))
    check = SourceAuditValidator(lambda a: apply_changes(a, [], primary, [primary, support], []), worker, [primary, support])
    amendment = build_audit_amendment(selection, encoded(proposal), check, ValueError())
    if not available:
        assert "keep_changes" not in encoded(amendment.output_schema)
        assert json.loads(amendment.input)["findings"] == dict(zip(findings(), proposal["unresolved_issues"]))
        return
    assert json.loads(amendment.input)["citation_choices"] == {"change_1_quote_2": {"1": short}}
    fixed = amendment.restore(encoded({"findings": findings(), "correction": {"keep_changes": {"change_1_quote_2": 1}}}))
    assert json.loads(fixed)["changes"][0]["replacement"]["quotes"] == [{"source": 1, "text": "és incerta."}, {"source": 2, "text": short}]
    check(json.loads(selection.restore(fixed)))


def test_native_passage_validation_exposes_citation_options_only_after_a_rejection():
    worker, _, _ = setup(count=1)
    primary = {**worker.chunks[0]["segments"][0], "origin_label": "Argument"}
    sources = [primary]
    full = primary["text"]
    short = "experience contradicts this."
    before = full.index(short)
    def finder(evidence, *_):
        assert evidence == [primary]
        return {segment_source_key(primary): {"retained": [(before, len(full))]}}
    worker.dependencies.pdf_quote_excerpts = finder
    def check(notes, _):
        return [["unlocatable" for c in n["citations"] if c["quote"] != short] for n in notes]
    value = {"assessment": "Experience challenges the claim.", "evidence_quote_id": 1,
             "unresolved_issues": [], "changes": [{"position": 0, "reason": "Retain the objection.",
                 "replacement": {"title": "An objection", "body_md": short, "quotes": [full], "properties": {}}}]}
    def generate(prompt, validate, timeout):
        selection = quote_selection(json.loads(prompt))
        with pytest.raises(AuditCitationIssue) as reject:
            validate(json.loads(selection.restore(encoded(value))))
        amend = build_audit_amendment(selection, encoded(value), validate, reject.value)
        result = selection.restore(amend.restore(encoded({"findings": {}, "correction": {"keep_changes": {"change_1_quote_1": 1}}})))
        validate(json.loads(result))
        return result, "reviewer"
    reviewer = SimpleNamespace(identity="reviewer", input_budget=100_000, count_tokens=len, generate_structured=generate)
    _, answer = audit_passage(worker, reviewer, primary, [], sources, {"coverage": []}, {}, check)
    assert answer["changes"][0]["replacement"]["quotes"] == [short]


def test_a_tight_repair_budget_or_a_second_defect_preserves_the_reviewers_open_findings():
    request, primary, other = audit_case(False)
    selection = quote_selection(request)
    reviewer = ReadingRuntime("r", "test", "fake", "", 64, SimpleNamespace(behavior_resources=True))
    def validate(item):
        apply_changes(item, [], primary, [primary, other], [])
    proposal = previous()
    with pytest.raises(PassageReviewIssue, match="first edition"):
        reviewer._repair_structured("", request, selection, validate, encoded(proposal), ValueError())
    proposal["changes"][0]["replacement"]["quotes"] = ["absent"]
    full = build_audit_amendment(selection, encoded(proposal), validate, ValueError())
    assert "keep_changes" not in encoded(full.output_schema)
    with pytest.raises(ValueError):
        full.restore(encoded({**proposal, "unresolved_issues": [], "changes": []}))


@pytest.mark.parametrize("paired", [False, True])
def test_literal_first_operation_can_fully_revise_a_malformed_proposal_only_after_addressing_its_findings(paired):
    request, primary, support = audit_case(paired)
    selection = quote_selection(request, number_audit_evidence=False) or QuoteSelection(
        encoded(request), request["output_schema"], {}, "source-audit", [])
    original = previous()
    original["evidence_quote"] = "és incerta."
    del original["evidence_quote_id"]
    original["changes"][0]["replacement"]["quotes"] = [{"source": 1, "text": "és incerta."}] if paired else ["és incerta."]
    first = {**original, "assessment": None}
    bind = lambda a: apply_changes(a, [], primary, [primary, support], [])
    plan = build_audit_amendment(selection, encoded(first), bind, ValueError())
    assert "keep_changes" not in encoded(plan.output_schema)
    assert "".join(json.loads(plan.input)["original"]["evidence_excerpts"].values()) == primary["text"]
    second = {"correction": {"revised_audit": {**original, "unresolved_issues": []}, "prior_changes": {
        "change_1": {"reason": "The note retains the author's qualification.", "evidence_excerpt": 2}}}, "findings": findings()}
    accepted = json.loads(selection.restore(plan.restore(encoded(second))))
    bind(accepted)
    assert accepted["evidence_quote"] == original["evidence_quote"]
    assert "The edition is unspecified." in accepted["assessment"]
    del second["correction"]["prior_changes"]["change_1"]
    with pytest.raises(ValueError):
        plan.restore(encoded(second))


def test_full_review_fits_without_repeating_first_proposals_citations_or_ignoring_findings():
    request, primary, support = audit_case(False)
    selection = quote_selection(request)
    first = previous()
    seen = []
    def fits(plan):
        seen.append(json.loads(plan.input))
        return "prior_proposals" in seen[-1]
    plan = build_audit_amendment(selection, encoded(first),
        lambda a: apply_changes(a, [], primary, [primary, support], []), ValueError(), fits)
    assert len(seen) == 2 and seen[1]["findings"] == seen[0]["findings"]
    assert seen[1]["prior_proposals"]["change_1"]["replacement"]["body_md"] == first["changes"][0]["replacement"]["body_md"]
    assert "keep_changes" not in encoded(plan.output_schema)


@pytest.mark.parametrize("wrap", [lambda s: "```json\n" + s + "\n```", lambda s: s + "}", lambda s: s + "<function"])
def test_a_schema_invalid_audit_keeps_its_findings_through_governed_json_normalization(runtime, monkeypatch, wrap):
    scope, snapshot = runtime
    request, primary, support = audit_case(False)
    first = previous()
    calls = install_workflow(monkeypatch, [wrap(encoded({**first, "assessment": None})),
        encoded({**first, "changes": [], "unresolved_issues": []})])
    with execution_scope(scope):
        parent = execution.create_job_run(snapshot, "normalization", "knowledge.process-source")
        reviewer = ReadingRuntime("personal", "test", "fake", "", 100_000, parent, skill_id=parent.skill_ids[0])
        with pytest.raises(PassageReviewIssue, match="first edition"):
            reviewer.generate_structured(encoded(request), lambda a: apply_changes(a, [], primary, [primary, support], []), 120)
    assert len(calls) == 2
    assert json.loads(json.loads(calls[1]["messages"][0].content)["input"])["findings"]["issue_2"] == first["unresolved_issues"][1]


@pytest.mark.parametrize("different_claim", [True, False])
def test_full_revision_cannot_silently_reassign_a_citation_only_edit(different_claim):
    request, primary, support = audit_case(True)
    selection = quote_selection(request)
    first = previous()
    first["changes"][0]["replacement"]["quotes"] = [{"source": 1, "text": "és incerta."}, {"source": 2, "text": support["text"]}]
    plan = build_audit_amendment(selection, encoded(first),
        lambda a: apply_changes(a, [], primary, [primary, support], []), ValueError())
    next_audit = {**deepcopy(first), "unresolved_issues": []}
    note = next_audit["changes"][0]["replacement"]
    note["quotes"][1] = {"source": 1, "text": "Observació prèvia."}
    note["title"] = "Corrected title"
    if different_claim:
        note["body_md"] = "The preliminary observation in the primary passage is explicitly uncertain."
    changed = encoded({"findings": findings(), "correction": {"revised_audit": next_audit, "prior_changes": {
        "change_1": {"reason": "Both quotations now address the primary observation.", "evidence_excerpt": 1}}}})
    if different_claim:
        accepted = json.loads(selection.restore(plan.restore(changed)))
        apply_changes(accepted, [], primary, [primary, support], [])
    else:
        with pytest.raises(PassageReviewIssue, match="original source"):
            plan.restore(changed)


@pytest.mark.parametrize("positions,titles", [([1, 2], ["I", "II"]), ([0, 0], ["I", "II"]), ([0, 0], ["I", "I"])])
def test_identical_note_bodies_keep_their_own_citations_in_full_revisions(positions, titles):
    request, _, _ = audit_case(True)
    selection = quote_selection(request)
    def change(pos, title, owners):
        return {"position": pos, "replacement": {"title": title, "body_md": "Shared wording.",
                "quotes": [{"source": owner, "text": str(owner)} for owner in owners]}}
    first = {"changes": [change(positions[0], titles[0], [1]), change(positions[1], titles[1], [1, 2])]}
    reordered = deepcopy(first)
    reordered["changes"][1]["replacement"]["quotes"] = [{"source": 2, "text": "new B"}, {"source": 1, "text": "new A"}]
    reordered["changes"].reverse()
    validate_revision_origins(first, reordered, selection)
    replaced = deepcopy(reordered)
    replaced["changes"][0]["replacement"]["quotes"][0]["source"] = 1
    with pytest.raises(PassageReviewIssue, match="original source"):
        validate_revision_origins(first, replaced, selection)
