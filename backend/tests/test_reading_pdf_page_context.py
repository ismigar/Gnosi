"""A reviewer can read and cite both sides of a page break in the original book."""
from __future__ import annotations

import json

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.passage_repair import bind_reviewed_interpretation
from backend.domains.llm_wiki.pdf_page_context import page_context, page_edges
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_review_evidence import references, restore
from backend.tests.test_reading_passage_repair import attach_reviewer
from backend.tests.test_semantic_reading import setup


def segment(id_, page, paragraph, text, **locator):
    return {"id": id_, "text": text, "origin_label": "Essays",
            "locator": {"page": page, "paragraph": paragraph, **locator}}


def chunk(origin, *segments, kind="pdf"):
    return {"id": origin + str(segments[0]["id"]), "origin_id": origin, "kind": kind,
            "origin_label": "Essays", "segments": list(segments)}


def test_edges_are_physical_local_and_keep_slices_with_the_same_segment_id():
    start = segment("p6", 6, 1, "Previous independent sentence", char_start=0, char_end=29)
    tail = segment("p6", 6, 1, "puisque", char_start=30, char_end=37)
    head = segment("p7", 7, 1, "le choix suppose une raison.")
    gap = segment("p9", 9, 1, "Page eight is unavailable.")
    other = segment("other-p7", 7, 1, head["text"])
    alien = segment("other-p6", 6, 1, "An unrelated premise.")
    plain = segment("not-a-pdf", 8, 1, "An ebook's location is not a physical PDF edge.")
    edges = page_edges([chunk("a", start, tail), chunk("b", alien, other),
                        chunk("a", head, gap), chunk("text", other, plain, kind="text")])
    assert page_context(edges, [head], [head]).additions == [tail]
    assert page_context(edges, [tail], [tail]).additions == [head]
    assert page_context(edges, [other], [other]).additions == [alien]
    assert not page_context(edges, [start, gap, plain], [start, gap, plain]).pairs
    repeated = page_context(edges, [head, head, tail], [head, tail])
    assert not repeated.additions and len(repeated.pairs) == 1
    assert restore([start, tail, head], references([tail, start])) == [tail, start]


@pytest.mark.parametrize("side", [0, 1])
def test_bound_preview_restores_both_originals_in_reading_order(side):
    left = segment("a", 6, 4, "La condició per aplicar aquesta hipòtesi")
    right = segment("b", 7, 1, "és que les dues mostres siguin independents.")
    edges = page_edges([chunk("book", left), chunk("book", right)])
    full = (left, right)[side]
    text = full["text"]
    preview = {**full, "text": text[5:14], "locator": {**full["locator"], "char_start": 5, "char_end": 14}}
    received = [preview, right if side == 0 else left]
    context = page_context(edges, received, [preview])
    originals = [*received, *context.additions]
    pair, = context.pairs
    assert [originals[i - 1] for i in pair] == [left, right]
    wrong = {**preview, "text": "x" * len(preview["text"])}
    assert not page_context(edges, [wrong], [wrong]).pairs


@pytest.mark.parametrize("left,right", [
    ("The trial only improved the", "secondary outcome, with wide uncertainty."),
    ("No era una obliga-", "CAPÍTOL TERCER ció absoluta, sinó condicional."),
    ("Il distingue", "l’hypothèse de sa confirmation."),
])
def test_review_of_a_cited_neighbour_gets_both_pages_and_keeps_paid_work(left, right):
    previous = segment("left", 6, 3, left)
    context = segment("right", 7, 1, right)
    primary = segment("primary", 7, 2, "The author qualifies the conclusion.")
    next_ = segment("next", 7, 3, "A new argument begins.")
    other = segment("other", 6, 3, "These are different studies.")
    homonym = segment("homonym", 7, 1, right)
    chunks = [chunk("one", previous), chunk("one", context), chunk("one", primary, next_),
              chunk("two", other, homonym)]
    draft = {"reason": "The passage is truncated.", "needs_specialist": True,
             "notes": [{"title": "Original", "body_md": primary["text"], "properties": {},
                        "quotes": [primary["text"], context["text"]]}]}
    second = {"reason": "New argument.", "needs_specialist": False, "notes": []}
    batch = {"passages": [draft, second], "questions": [], "warnings": [], "themes": [], "contradictions": []}
    calls = []
    def review(prompt, validate, timeout):
        selection = quote_selection(json.loads(prompt))
        wire = json.loads(selection.input)
        catalog = wire["source_quotes"]
        pair, = wire["pdf_page_pairs"]
        before, after = [catalog[i - 1] for i in pair]
        assert [s["location"]["page"] for s in (before, after)] == [6, 7]
        assert before["quotes"][0]["text"] == left and after["quotes"][0]["text"] == right
        assert other["text"] not in prompt
        own = catalog[wire["primary_passages"]["passage_1"]["source"] - 1]["quotes"][0]["quote_id"]
        support = [s["quotes"][0]["quote_id"] for s in (before, after)]
        value = {"evidence_quote": primary["text"], "unresolved_issues": [],
                 "amendments": [{"retained_note": 1, "replacement_note": 1,
                                 "reason": "Qualify the finding using its stated condition.", "evidence_quote": primary["text"]}],
                 "passages": {"passage_1": {"reason": "The original makes its conclusion conditional.", "notes": [{
                     "title": "A conditional result", "body_md": primary["text"], "properties": {},
                     "primary_quote_ids": [own], "context_quote_ids": support}]}}}
        answer = selection.restore(encoded(value))
        validate(json.loads(answer))
        calls.append(prompt)
        return answer, "reviewer"

    book, _, checkpoints = setup()
    book.chunks = chunks
    attach_reviewer(book, review)
    evidence = [primary, context, next_]
    plans, _ = bind_reviewed_interpretation(book, book.dependencies.reviewer, [chunks[2]], evidence, batch)
    note, = plans[chunks[2]["id"]]["notes"]
    assert [(c["segment_id"], c["quote"]) for c in note["citations"]] == [
        ("primary", primary["text"]), ("left", left), ("right", right)]
    resumed, _, _ = setup(checkpoints=checkpoints, resume="new")
    resumed.chunks, resumed.job_id = chunks, "resumed"
    attach_reviewer(resumed, lambda *args: pytest.fail("A completed correction was billed twice"))
    assert bind_reviewed_interpretation(resumed, resumed.dependencies.reviewer, [chunks[2]], evidence, batch)[0] == plans
    assert len(calls) == 1


def test_audit_and_joint_review_both_preserve_a_citation_from_the_other_page():
    from backend.domains.llm_wiki.independent_review import apply_changes, audit_passage
    from backend.domains.llm_wiki.semantic_context import source_view
    from backend.domains.llm_wiki.semantic_contracts import bind_note, review_schema, semantic_note
    from backend.domains.llm_wiki.semantic_review_execution import ReviewBatch, ask_batch

    left = segment("a", 3, 4, "The apparent relation holds only")
    right = segment("b", 4, 1, "while water remains liquid.")
    primary = segment("c", 4, 2, "The author qualifies the observation.")
    book, _, _ = setup()
    book.chunks = [chunk("paper", left, right, primary)]
    source_note = {"title": "Condition", "body_md": primary["text"], "properties": {},
                   "quotes": [primary["text"], right["text"]]}
    note = bind_note(source_note, primary, [primary, right], [])
    corrected = {**source_note, "quotes": [primary["text"], left["text"], right["text"]]}
    calls = []
    def review(prompt, validate, timeout):
        request = json.loads(prompt)
        calls.append(request["phase"])
        if request["phase"] == "source-audit":
            originals = [request["original"], *request["support"]]
            before, after = request["pdf_page_pairs"][0]
            assert [originals[n - 1]["text"] for n in (before, after)] == [left["text"], right["text"]]
            answer = {"assessment": "The author limits the observation to liquid water.", "unresolved_issues": [],
                      "evidence_quote": primary["text"], "changes": [{"position": 1, "reason": "Retain the condition.",
                                                                     "replacement": corrected}]}
        else:
            selection = quote_selection(request)
            wire = json.loads(selection.input)
            catalog = wire["source_quotes"]
            ids = [catalog[i - 1]["quotes"][0]["quote_id"] for i in wire["pdf_page_pairs"][0]]
            p = catalog[wire["notes"][0]["primary"]["source"] - 1]["quotes"][0]["quote_id"]
            replacement = {"title": corrected["title"], "body_md": corrected["body_md"], "properties": {},
                           "primary_quote_ids": [p], "context_quote_ids": ids}
            answer = json.loads(selection.restore(encoded({"assessment": "The phase condition is retained.",
                "changes": {"note_1": replacement}, "warnings": [], "unresolved_issues": [], "evidence_requests": []})))
        validate(answer)
        return encoded(answer), "reviewer"

    attach_reviewer(book, review)
    rv = book.dependencies.reviewer
    evidence = [primary, right]
    plan = {"coverage": [{"segment_id": "c", "reason": "The qualification is substantive."}]}
    key, answer = audit_passage(book, rv, primary, [note], evidence, plan, {}, None)
    fixed, = apply_changes(answer, [note], primary, [*evidence, left], [])
    assert [c["segment_id"] for c in fixed["citations"]] == ["c", "a", "b"]
    assert audit_passage(book, rv, primary, [note], evidence, plan, {"key": key, "answer": answer}, None)[0] == key
    entry = {"note": semantic_note(note, []), "primary": source_view(primary), "support": [source_view(right)]}
    batch = ReviewBatch(0, [entry], [(0, 0, note, primary, evidence)], [],
        {"notes": [entry], "retrieved_originals": [], "instruction": "Review the source."},
        review_schema(1, [], require_resolution=True, allow_requests=True), "case", True)
    answer, _, retrieved = ask_batch(book, batch)
    assert retrieved == [left]
    assert answer["changes"][0]["replacement"]["quotes"] == corrected["quotes"]
    assert calls == ["source-audit", "verify"]


def test_lookalike_pages_in_separate_books_do_not_share_a_contextual_checkpoint():
    from backend.domains.llm_wiki.semantic_context import source_view
    a = segment("a", 2, 1, "The argument applies.")
    b = segment("b", 2, 1, a["text"])
    first = chunk("first", segment("a1", 1, 1, "An observation in summer."), a)
    second = chunk("second", segment("b1", 1, 1, "An observation in winter."), b)
    book, _, _ = setup()
    book.chunks = [first, second]
    observed = []
    def review(prompt, validate, timeout):
        source = json.loads(prompt)["support"][0]["text"]
        observed.append(source)
        answer = {"assessment": source}
        validate(answer)
        return encoded(answer), "reviewer"
    attach_reviewer(book, review)
    for s, expected in ((a, "summer"), (b, "winter"), (a, "summer"), (b, "winter")):
        answer = book.ask("same-visible-input", "source-audit", {"original": source_view(s), "support": []},
                          lambda answer: None, {"type": "object"}, executor=book.dependencies.reviewer,
                          page_context=page_context(book.pdf_edges, [s], [s]))
        assert expected in answer["assessment"]
    assert len(observed) == 2


def test_a_paid_legacy_review_of_a_unique_primary_survives_a_shared_secondary():
    primary = segment("primary", 4, 2, "This observation belongs to the first book.")
    right = segment("right", 4, 1, "under the stated conditions.")
    left = segment("left", 3, 1, "The observation applies")
    other = segment("other", 4, 1, right["text"])
    chunks = [chunk("paper", left, right, primary), chunk("other", segment("other-left", 3, 1, "It applies"), other)]
    old, _, checkpoints = setup()
    old.chunks = chunks
    decision = {"assessment": "The primary describes a conditional observation."}
    attach_reviewer(old, lambda prompt, validate, timeout: (encoded(decision), "reviewer"))
    payload = {"original": source_view(primary), "support": [source_view(right)]}
    old.ask("paid", "source-audit", payload, lambda value: None, {"type": "object"}, executor=old.dependencies.reviewer)
    new, _, _ = setup(checkpoints=checkpoints, resume="new")
    new.job_id, new.chunks = "resumed", chunks
    attach_reviewer(new, lambda *args: pytest.fail("The unique prior review was repeated"))
    context = page_context(new.pdf_edges, [primary, right], [primary, right])
    assert new.ask("paid", "source-audit", payload, lambda value: None, {"type": "object"},
                   executor=new.dependencies.reviewer, page_context=context) == decision


@pytest.mark.parametrize("lookalike", [False, True])
def test_numbered_audit_citations_bind_to_the_selected_original_and_slice(lookalike):
    from backend.domains.llm_wiki.independent_review import apply_changes, audit_passage
    from backend.domains.llm_wiki.semantic_contracts import bind_note
    primary = segment("primary", 8, 2, "The author describes a conditional effect.")
    right = segment("right", 8, 1, "only at low temperatures.")
    left = segment("left", 7, 2, "Measurements were repeated", char_start=45, char_end=71)
    other = (segment("different-book", 7, 2, left["text"], char_start=45, char_end=71) if lookalike else
             segment("left", 7, 2, "Earlier observations", char_start=0, char_end=20))
    chunks = [chunk("first", left, right, primary), chunk("second", other)] if lookalike else [
        chunk("first", other, left, right, primary)]
    evidence = [primary, other, right]
    note = {"title": "Effect", "body_md": primary["text"], "properties": {}, "quotes": [s["text"] for s in evidence]}
    drafts = [bind_note(note, primary, evidence, [])]
    def review(prompt, validate, timeout):
        selection = quote_selection(json.loads(prompt))
        wire = json.loads(selection.input)
        before, after = wire["pdf_page_pairs"][0]
        assert before != 2 and after == 3
        sources = wire["support"]
        assert sources[before - 2]["text"] == left["text"]
        choice = {"evidence_quote": primary["text"], "assessment": "The observation is conditional.", "unresolved_issues": [],
                  "changes": [{"position": 1, "reason": "Retain the observed condition.", "replacement": {**note, "quotes": [
                      {"source": 1, "text": primary["text"]}, {"source": 2, "text": other["text"]},
                      {"source": before, "text": left["text"]}, {"source": after, "text": right["text"]}]}}]}
        answer = selection.restore(encoded(choice))
        validate(json.loads(answer))
        return answer, "reviewer"
    book, _, _ = setup()
    book.chunks = chunks
    attach_reviewer(book, review)
    plan = {"coverage": [{"segment_id": primary["id"], "reason": "The observations are qualified."}]}
    key, result = audit_passage(book, book.dependencies.reviewer, primary, drafts, evidence, plan, {}, None)
    replacement = result["changes"][0]["replacement"]
    identities = list(zip(replacement["quote_segment_ids"], replacement["quote_source_keys"], strict=True))
    assert identities[1] != identities[2]
    assert replacement["quote_segment_ids"] == [primary["id"], other["id"], left["id"], right["id"]]
    assert apply_changes(result, drafts, primary, [*evidence, left], [])[0]["citations"][-1]["segment_id"] == right["id"]
    assert audit_passage(book, book.dependencies.reviewer, primary, drafts, evidence, plan,
                         {"key": key, "answer": result}, None)[1] == result
