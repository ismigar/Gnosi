"""Resume a paid audit after page context changes the evidence and the note batch size."""
import json

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.independent_review import audit_passage, audit_payload
from backend.domains.llm_wiki.pdf_page_context import page_context
from backend.domains.llm_wiki.review_draft_batches import note_batch_request
from backend.domains.llm_wiki.semantic_contracts import bind_note, semantic_note
from backend.services.reading_budget import ReadingBudgetError
from backend.tests.test_reading_passage_repair import attach_reviewer
from backend.tests.test_reading_pdf_page_context import chunk, segment
from backend.tests.test_semantic_reading import setup


@pytest.mark.parametrize("whole_passage", [False, True])
@pytest.mark.parametrize("same_source_view", [False, True])
def test_paid_range_and_original_citation_survive_a_larger_prompt(whole_passage, same_source_view):
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
    def audit(worker):
        attach_reviewer(worker, review)
        worker.dependencies.reviewer.input_budget = capacity
        return audit_passage(worker, worker.dependencies.reviewer, main, drafts, sources, plan, {}, None)[1]

    if whole_passage:
        audit(reader)
    else:
        with pytest.raises(ReadingBudgetError):
            audit(reader)
    assert calls == ([titles] if whole_passage else [titles[:2], titles[2:]])
    calls.clear()
    resumed, _, _ = setup(checkpoints=checkpoints, resume=reader.job_id)
    resumed.job_id, resumed.chunks = "resumed", chunks
    answer = audit(resumed)
    assert calls == ([] if whole_passage else [titles[2:], []])
    assert answer["changes"][0]["replacement"]["quote_segment_ids"] == ["primary", "other", "right"]
