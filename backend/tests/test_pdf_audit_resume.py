"""Resume a paid audit after page context changes the evidence and the note batch size."""
import json

import pytest

from backend.domains.llm_wiki.audit_checkpoint_provenance import passage_sources
from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.independent_review import audit_passage, audit_payload
from backend.domains.llm_wiki.pdf_page_context import page_context
from backend.domains.llm_wiki.reading_quality import adjacent_originals
from backend.domains.llm_wiki.review_draft_batches import note_batch_request
from backend.domains.llm_wiki.semantic_contracts import bind_note, semantic_note
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key
from backend.domains.llm_wiki.semantic_reading import SemanticReader
from backend.services.reading_budget import ReadingBudgetError
from backend.tests.test_reading_passage_repair import attach_reviewer
from backend.tests.test_reading_pdf_page_context import chunk, segment
from backend.tests.test_semantic_reading import setup


@pytest.mark.parametrize("whole_passage,same_source_view,change_pending", [
    (False, False, False), (True, False, False), (False, True, False), (True, True, False),
    (False, True, True),
])
def test_paid_range_and_original_citation_survive_a_larger_prompt(whole_passage, same_source_view, change_pending):
    main = segment("primary", 5, 2, "The probes record different times of arrival.")
    shared = "Under the same pressure"
    left = segment("left", 4, 3, shared)
    right = segment("right", 5, 1, "the probes differed by two seconds.")
    other = segment("other", 4 if same_source_view else 12, 3,
                    shared if same_source_view else shared + ", the first probe responded immediately.")
    chunks = [chunk("field-log", left, right, main), chunk("appendix", other)]
    sources = [main, other, right]
    titles = ["First probe", "Second probe", "Third probe"][:2 if whole_passage else 3]
    drafts = [bind_note({"title": title, "body_md": (main["text"] + " ") * 65, "properties": {},
                         "quotes": [s["text"] for s in sources]}, main, sources, []) for title in titles]
    reason = "The report compares independent readings at constant pressure."
    plan = {"coverage": [{"segment_id": main["id"], "reason": reason}]}
    reader, _, checkpoints = setup()
    reader.chunks = chunks
    if whole_passage:
        base = audit_payload(main, [semantic_note(n, []) for n in drafts], sources[1:], [reason], [])
    else:
        base, _ = note_batch_request(main, drafts[:2], sources[1:], [reason], [])
    def size(payload):
        return len(encoded({"phase": "source-audit", "resource": reader.title, "language": reader.language, **payload}))
    expanded = page_context(reader.pdf_edges, sources, sources).prompt(base, audit=True)
    capacity = (size(base) + size(expanded)) // 2
    assert size(base) < capacity < size(expanded)
    reader.pdf_edges = {}  # Evidence the earlier reader supplied before page pairs were introduced.
    replacement = {"title": titles[0], "body_md": main["text"], "properties": {},
                   "quotes": [main["text"], shared, right["text"]]}
    calls = []
    def review(prompt, validate, timeout):
        request = json.loads(prompt)
        batch = [n["title"] for n in request["drafts"]]
        calls.append(batch)
        if batch == ["Third probe"] and len(calls) == 2:
            raise ReadingBudgetError("interrupted after the first two paid notes")
        changes = [{"position": 1, "reason": "Keep the pressure condition.", "replacement": replacement}] if batch == titles[:2] else []
        answer = {"assessment": reason, "evidence_quote": main["text"], "changes": changes, "unresolved_issues": []}
        validate(answer)
        return encoded(answer), "reviewer"
    def audit(worker, current_drafts, evidence):
        attach_reviewer(worker, review)
        worker.dependencies.reviewer.input_budget = capacity
        return audit_passage(worker, worker.dependencies.reviewer, main, current_drafts, evidence, plan, {}, None)[1]

    if whole_passage:
        audit(reader, drafts, sources)
    else:
        with pytest.raises(ReadingBudgetError):
            audit(reader, drafts, sources)
    assert calls == ([titles] if whole_passage else [titles[:2], titles[2:]])
    calls.clear()
    resumed, _, _ = setup(checkpoints=checkpoints, resume=reader.job_id)
    resumed.job_id, resumed.chunks = "resumed", chunks
    if change_pending:
        # The unpaid third note now cites the homonym in the other document.
        # Its visible quote remains identical. Only the previous two notes were audited.
        revised = bind_note(semantic_note(drafts[2], []), main, [main, left, right], [])
        drafts, sources = [*drafts[:2], revised], [*sources, left]
    answer = audit(resumed, drafts, sources)
    assert calls == ([] if whole_passage else [titles[2:], []])
    assert answer["changes"][0]["replacement"]["quote_segment_ids"] == ["primary", "other", "right"]


@pytest.mark.parametrize("joint_changed_owner", [False, True])
def test_legacy_homonym_reuses_only_the_document_verified_before_the_paid_audit(joint_changed_owner):
    shared = "The calibrated probe recorded a delay."
    a, b = [segment(name, 4, 2, shared) for name in ("A", "B")]
    right = segment("right", 5, 1, "A second observation followed.")
    main = segment("main", 5, 2, "The author describes a separate experiment.")
    chunks = [chunk("first", a, right, main), chunk("second", b)]
    reason = "The observations give the conditions of the experiment."
    def note(source):
        sources = [main, source, right]
        return {"title": "Field experiment", "body_md": main["text"], "properties": {},
                "quotes": [s["text"] for s in sources], "quote_source_keys": [segment_source_key(s) for s in sources]}
    def reader_review(request):
        assert request["phase"] == "verify"
        changes = [{"note": 1, "replacement": note(b)}] if joint_changed_owner else []
        return {"assessment": reason, "changes": changes, "warnings": [], "unresolved_issues": [], "evidence_requests": []}
    old, _, checkpoints = setup(generate=reader_review)
    old.chunks = chunks
    old.pdf_edges, old.ambiguous_pdf_segments = {}, set()  # Historical phase records contained only the visible prompt.
    observed = []
    def audit_model(prompt, validate, timeout):
        observed.append(json.loads(prompt)["phase"])
        answer = {"assessment": reason, "evidence_quote": main["text"], "changes": [], "unresolved_issues": []}
        validate(answer)
        return encoded(answer), "reviewer"
    attach_reviewer(old, audit_model)
    engine = SemanticReader(old)
    for c in chunks:
        notes = [bind_note(note(a if joint_changed_owner else b), main, [main, a, b, right], [])] if c == chunks[0] else []
        engine.state["plans"][c["id"]] = {"notes": notes, "evidence_segments": [main, a, b, right],
            "coverage": [{"segment_id": s["id"], "reason": reason} for s in c["segments"]], "warnings": []}
    [(_, plan), _] = engine.review("Field observations", "The two probes")
    assert plan["notes"][0]["citations"][1]["segment_id"] == "B"
    neighbours = adjacent_originals(chunks)[main["id"]]
    def audit(worker, drafts):
        _, sources = passage_sources(main, drafts, plan, neighbours)
        return audit_passage(worker, worker.dependencies.reviewer, main, drafts, sources, plan, {}, None)
    audit(old, plan["notes"])
    assert observed == ["source-audit"]
    for source, keep_upstream, expected in ((b, True, []), (a, True, ["source-audit"]), (b, False, ["source-audit"])):
        old_records = {k: v for k, v in checkpoints.items() if keep_upstream or k[1] != "semantic-state"}
        resumed, replay_calls, _ = setup(checkpoints=old_records, resume=old.job_id)
        resumed.job_id, resumed.chunks = "resume", chunks
        attach_reviewer(resumed, audit_model)
        observed.clear()
        audit(resumed, [bind_note(note(source), main, [main, source, right], [])])
        assert observed == expected
        assert replay_calls == []
