"""A rejected PDF sentence can yield verified, source-specific citation choices."""
from copy import deepcopy
import json

import pytest

from backend.domains.llm_wiki.pdf_review_excerpts import quote_bindings
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import TEXT, TEXTS, bind_note, interpretation_schema, obj
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key, source_key
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.services.llm_wiki_pdf_annotations import reading_citation_issues, reading_pdf_quote_excerpts
from backend.tests.test_llm_wiki_pdf_annotations import _demo_pdf, _origin


def test_specialist_selects_whole_verified_excerpts_from_the_correct_pdf(tmp_path):
    pdf = _demo_pdf(tmp_path)
    text = "Persistent citation highlights span multiple lines unread\u00ad able in this portable PDF fixture"
    primary = {"id": "first", "text": text, "origin_label": "Book", "locator": {"page": 1, "paragraph": 1}}
    context = {**primary, "id": "second", "locator": {"page": 1, "paragraph": 2}}
    good = {**primary, "id": "third", "text": "in this portable PDF fixture"}
    wrong_page = {**primary, "id": "fourth", "locator": {"page": 2}}
    unknown = {**primary, "id": "unmapped", "origin_label": "Other book"}
    origins = [{**_origin(pdf), "segments": [primary, context, good, wrong_page]}]
    sources = [primary, context, good, wrong_page, unknown]
    choices = reading_pdf_quote_excerpts(sources, origins)
    assert set(choices) == {segment_source_key(s) for s in (primary, context, wrong_page)}
    schema = obj({"passages": interpretation_schema(1, [])["properties"]["passages"],
                  "evidence_quote": TEXT, "unresolved_issues": TEXTS})
    selection = quote_selection({"phase": "source-repair", "reading_engine": "semantic",
        "primary_passages": [source_view(primary)], "neighbours": [source_view(s) for s in sources[1:]],
        "output_schema": schema, "verified_pdf_excerpts": choices, "pdf_quote_sources": quote_bindings(sources)})
    catalog = json.loads(selection.input)["source_quotes"]
    first, second = (catalog[i]["quotes"][0] for i in (0, 1))
    assert first["text"] == text and "quote_id" not in first
    assert catalog[2]["quotes"][0]["text"] == good["text"]
    assert catalog[3]["quotes"] == [{"text": text, "verified_excerpts": []}]
    assert "quote_id" in catalog[4]["quotes"][0]
    excerpts = first["verified_excerpts"]
    assert {item["text"] for item in excerpts} >= {"Persistent citation highlights span multiple lines", good["text"]}
    options = [item["quote_id"] for item in excerpts]
    foreign = second["verified_excerpts"][0]
    note = {"title": "Evidence", "body_md": "A grounded reading.", "properties": {},
            "primary_quote_ids": options, "context_quote_ids": [foreign["quote_id"]]}
    answer = {"passages": {"passage_1": {"notes": [note], "reason": "The source supports this reading."}},
              "evidence_quote": good["text"], "unresolved_issues": []}
    result = json.loads(selection.restore(json.dumps(answer)))["passages"][0]["notes"][0]
    assert result["quotes"] == [*[item["text"] for item in excerpts], foreign["text"]]
    assert result["quote_source_keys"] == [*[segment_source_key(primary)] * len(options), segment_source_key(context)]
    checked = [{"citations": [{"segment_id": "first", "quote": q}]} for q in [*result["quotes"], text]]
    failures = reading_citation_issues(checked, origins)
    assert all(not row for row in failures[:-1]) and failures[-1]
    note["primary_quote_ids"] = [foreign["quote_id"]]
    with pytest.raises(ValueError):
        selection.restore(json.dumps(answer))


def test_non_pdf_and_repeated_ambiguous_passages_never_supply_verified_options(tmp_path):
    pdf = _demo_pdf(tmp_path)
    repeated = "Ordinary surrounding prose supplies context for selective reading without highlighting everything."
    a = {"id": "a", "text": repeated, "locator": {"page": 1}}
    b = {"id": "b", "text": repeated, "locator": {"page": 1}}
    origins = [{**_origin(pdf), "segments": [a]}, {"origin_id": "text", "kind": "text", "segments": [b]}]
    ranges = reading_pdf_quote_excerpts([a, b], origins)
    assert ranges == {segment_source_key(a): {"0": []}}
    schema = obj({"passages": interpretation_schema(1, [])["properties"]["passages"],
                  "evidence_quote": TEXT, "unresolved_issues": TEXTS})
    selection = quote_selection({"phase": "source-repair", "reading_engine": "semantic",
        "primary_passages": [source_view(a)], "neighbours": [source_view(b)],
        "output_schema": schema, "verified_pdf_excerpts": ranges, "pdf_quote_sources": quote_bindings([a, b])})
    assert selection.primary_ids == [[]] and list(selection.quotes.values()) == [repeated]
    issue = "The primary PDF does not disambiguate the cited sentence."
    answer = {"passages": {"passage_1": {"reason": issue, "notes": []}}, "evidence_quote": repeated,
              "unresolved_issues": [issue]}
    assert json.loads(selection.restore(json.dumps(answer)))["unresolved_issues"] == [issue]
    assert json.loads(selection.draft_for_repair(json.dumps(answer)))["unresolved_issues"] == [issue]
    answer["passages"]["passage_1"]["notes"].append({"title": "Misattributed", "body_md": repeated,
        "properties": {}, "primary_quote_ids": [next(iter(selection.quotes))], "context_quote_ids": []})
    with pytest.raises(ValueError):
        selection.restore(json.dumps(answer))


def test_damaged_middle_word_preserves_both_unique_two_word_excerpts(tmp_path):
    text = "Persistent citation OCRERROR multiple lines"
    segment = {"id": "a", "text": text, "locator": {"page": 1}}
    origins = [{**_origin(_demo_pdf(tmp_path)), "segments": [segment]}]
    ranges = reading_pdf_quote_excerpts([segment], origins)[segment_source_key(segment)]["0"]
    assert [text[a:b] for a, b in ranges] == ["Persistent citation", "multiple lines"]


def test_two_pdfs_with_identical_visible_source_keep_their_own_geometry(tmp_path):
    sources, origins = [], []
    for name, repetitions in (("first", 6), ("second", 1)):
        folder = tmp_path / name
        folder.mkdir()
        pdf = _demo_pdf(folder, context_repetitions=repetitions)
        segment = {"id": name, "text": "Persistent citation OCRERROR Ordinary surrounding prose",
                   "origin_label": pdf.name, "locator": {"page": 1}}
        sources.append(segment)
        origins.append({**_origin(pdf), "origin_id": name, "_annotation_source_uri": pdf.as_uri(), "segments": [segment]})
    assert source_view(sources[0]) == source_view(sources[1])
    choices = reading_pdf_quote_excerpts(sources, origins, [("first", "surrounding prose"), ("second", "surrounding prose")])
    assert "retained" not in choices[segment_source_key(sources[0])]
    assert "retained" in choices[segment_source_key(sources[1])]
    schema = obj({"passages": interpretation_schema(1, [])["properties"]["passages"],
                  "evidence_quote": TEXT, "unresolved_issues": TEXTS})
    selection = quote_selection({"reading_engine": "semantic", "phase": "source-repair",
        "primary_passages": [source_view(sources[0])], "neighbours": [source_view(sources[1])],
        "output_schema": schema, "verified_pdf_excerpts": choices, "pdf_quote_sources": quote_bindings(sources)})
    primary, context = [s["quotes"][0]["verified_excerpts"] for s in json.loads(selection.input)["source_quotes"]]
    assert [choice["text"] for choice in primary] == ["Persistent citation"]
    extra = next(q for q in context if q["text"] == "Ordinary surrounding prose")
    note = {"title": "A reading", "body_md": "The source provides surrounding prose.", "properties": {},
            "primary_quote_ids": [primary[0]["quote_id"]], "context_quote_ids": [extra["quote_id"]]}
    answer = {"passages": {"passage_1": {"notes": [note], "reason": "The sources support the reading."}},
              "evidence_quote": extra["text"], "unresolved_issues": []}
    value = json.loads(selection.restore(json.dumps(answer)))["passages"][0]["notes"][0]
    bound = bind_note(value, sources[0], sources, [])
    assert [c["segment_id"] for c in bound["citations"]] == ["first", "second"]
    assert reading_citation_issues([bound], origins) == [[]]
    note["primary_quote_ids"] = [extra["quote_id"]]
    with pytest.raises(ValueError):
        selection.restore(json.dumps(answer))
    legacy = {**value, "quotes": [primary[0]["text"]], "quote_source_keys": [source_key(source_view(sources[0]))]}
    with pytest.raises(ValueError, match="identify one source"):
        bind_note(legacy, sources[0], sources, [])
    assert bind_note(legacy, sources[0], [sources[0]], [])["citations"][0]["segment_id"] == "first"


def test_only_the_bad_citation_triggers_early_review_in_a_well_formed_reader_batch(tmp_path):
    from backend.domains.llm_wiki.chunking import encoded, reading_chunks
    from backend.domains.llm_wiki.origins import finalize_origin
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.tests.test_reading_passage_repair import attach_reviewer
    from backend.tests.test_semantic_reading import setup

    reader, _, _ = setup()
    good = "Persistent citation highlights span multiple lines"
    bad = "Unreadable OCR; in this portable PDF fixture"
    origin = finalize_origin({**_origin(_demo_pdf(tmp_path)), "label": "Fixture", "input_order": 0,
        "segments": [{"text": body, "locator": {"page": 1, "paragraph": i}} for i, body in enumerate((good, bad), 1)]})
    reader.origins = [origin]
    reader.chunks = reading_chunks([origin], budget=2000, count=len)
    repairs = []
    def review(prompt, validate, timeout):
        request = json.loads(prompt)
        primary, = request["primary_passages"]
        assert primary["text"] == bad and "page 1" in request["validation_error"]
        selection = quote_selection(request)
        span = json.loads(selection.input)["source_quotes"][0]["quotes"][0]
        excerpt = next(q for q in span["verified_excerpts"] if q["text"] == "in this portable PDF fixture")
        answer = {"evidence_quote": excerpt["text"], "unresolved_issues": [],
            "passages": {"passage_1": {"reason": "The source describes the fixture.",
                "notes": [{"title": "PDF", "body_md": "It describes a portable PDF fixture.", "properties": {},
                           "primary_quote_ids": [excerpt["quote_id"]], "context_quote_ids": []}]}}}
        canonical = selection.restore(encoded(answer))
        validate(json.loads(canonical))
        repairs.append(excerpt["text"])
        return canonical, "reviewer-model"
    attach_reviewer(reader, review)
    reader.dependencies.citation_issues = reading_citation_issues
    reader.dependencies.pdf_quote_excerpts = reading_pdf_quote_excerpts
    plans = SemanticReader(reader).interpret(reader.chunks, "Overview")
    quotes = [n["citations"][0]["quote"] for plan in plans.values() for n in plan["notes"]]
    assert repairs == ["in this portable PDF fixture"] and quotes == [good, *repairs]


@pytest.mark.parametrize("saved_short_quote", [None, "in this portable PDF fixture", "portable PDF fixture"])
def test_resume_preserves_paid_extraction_and_reviews_pdf_citations_with_the_correct_agent(tmp_path, saved_short_quote):
    from backend.domains.llm_wiki.chunking import reading_chunks
    from backend.domains.llm_wiki.origins import finalize_origin
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.tests.test_reading_passage_repair import attach_reviewer
    from backend.tests.test_semantic_reading import response, setup

    whole = "Unreadable OCR; in this portable PDF fixture"
    short = saved_short_quote or "in this portable PDF fixture"
    good = "Persistent citation highlights span multiple lines"
    origin = finalize_origin({**_origin(_demo_pdf(tmp_path)), "label": "Fixture", "input_order": 0,
        "segments": [{"text": text, "locator": {"page": 1, "paragraph": i}} for i, text in enumerate((good, whole), 1)]})
    chunks = reading_chunks([origin], budget=2000, count=len)

    def earlier(request):
        result = response(request)
        for source, passage in zip(request["primary_passages"], result["passages"], strict=True):
            if saved_short_quote and source["text"] == whole:
                passage["notes"][0]["quotes"] = [short]
        return result

    previous, _, checkpoints = setup(generate=earlier)
    previous.origins, previous.chunks = [origin], chunks
    SemanticReader(previous).extract("Overview")
    paid = deepcopy(checkpoints["new", "semantic-state"]["plans"])

    resumed, _, _ = setup(checkpoints=checkpoints, resume="new")
    resumed.job_id, resumed.origins, resumed.chunks = "resumed", [origin], chunks
    roles = []

    def joint_review(role, prompt, validate):
        request = json.loads(prompt)
        assert request["phase"] == "verify"
        titles = [entry["note"]["title"] for entry in request["notes"]]
        roles.extend((role, title) for title in titles)
        if whole not in titles:
            assert "verified_pdf_excerpts" not in request
            answer = response(request)
        else:
            selection = quote_selection(request)
            wire = json.loads(selection.input)
            index = titles.index(whole)
            original = wire["notes"][index]["primary"]["source"]
            catalog = wire["source_quotes"][original - 1]
            span = catalog["quotes"][0]
            assert span["text"] == whole and "quote_id" not in span
            verified = next(choice for choice in [*span["verified_excerpts"], *catalog.get("retained_quotes", [])]
                            if choice["text"] == short)
            changes = {f"note_{i + 1}": None for i in range(len(titles))}
            changes[f"note_{index + 1}"] = {"title": "The fixture", "body_md": "The original describes a portable PDF fixture.",
                "properties": {}, "primary_quote_ids": [verified["quote_id"]], "context_quote_ids": []}
            answer = json.loads(selection.restore(json.dumps({"assessment": "The cited passage supports the description.",
                "changes": changes, "warnings": [], "unresolved_issues": [], "evidence_requests": []})))
        validate(answer)
        return json.dumps(answer), role

    attach_reviewer(resumed, lambda prompt, validate, timeout: joint_review("specialist", prompt, validate))
    resumed.dependencies.generate_structured = lambda prompt, validate, timeout: joint_review("reader", prompt, validate)
    resumed.dependencies.citation_issues = reading_citation_issues
    resumed.dependencies.pdf_quote_excerpts = reading_pdf_quote_excerpts
    engine = SemanticReader(resumed)
    engine.extract("Overview")
    reviewed = engine.review("Overview", "The notes cover the fixture.")
    assert engine.state["plans"] == paid
    assert sorted(roles) == sorted([("reader", good), ("reader" if saved_short_quote else "specialist", whole)])
    notes = [n for _, plan in reviewed for n in plan["notes"]]
    assert [n["citations"][0]["quote"] for n in notes] == [good, short]
    assert reading_citation_issues(notes, [origin]) == [[], []]
    engine.review("Overview", "The notes cover the fixture.")
    assert len(roles) == 2


def test_valid_saved_citation_crossing_span_boundary_stays_selectable_with_whole_quotes(tmp_path):
    text = "Persistent citation highlights span multiple lines\nin this portable PDF fixture"
    saved = "multiple lines\nin this portable PDF"
    segment = {"id": "p", "text": text, "locator": {"page": 1}}
    origins = [{**_origin(_demo_pdf(tmp_path)), "segments": [segment]}]
    from backend.domains.llm_wiki.pdf_review_excerpts import partial_citations
    from backend.domains.llm_wiki.semantic_repairs import quote_choices
    note = {"citations": [{"segment_id": "p", "quote": saved}]}
    assert reading_citation_issues([note], origins) == [[]]
    pairs = partial_citations([note], [segment])
    assert pairs == [("p", saved)]
    ranges = reading_pdf_quote_excerpts([segment], origins, [*pairs, ("p", "missing words")])
    catalog, quotes, _ = quote_choices([source_view(segment)], pdf_excerpts=ranges, bindings=quote_bindings([segment]))
    row, = catalog
    assert all("quote_id" in span for span in row["quotes"])
    assert [choice["text"] for choice in row["retained_quotes"]] == [saved]
    assert "missing words" not in quotes.values()


@pytest.mark.parametrize("reject_first_draft", [False, True])
def test_reader_and_reviewer_distinguish_homonymous_pdfs_even_without_shorter_choices(tmp_path, reject_first_draft):
    from backend.domains.llm_wiki.chunking import reading_chunks
    from backend.domains.llm_wiki.origins import deduplicate_origins, finalize_origin
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.tests.test_reading_passage_repair import attach_reviewer
    from backend.tests.test_semantic_reading import setup

    shared = "Ordinary surrounding prose supplies context for selective reading without highlighting everything."
    origins = []
    for label, repetitions in (("healthy", 1), ("broken", 0)):
        folder = tmp_path / label
        folder.mkdir()
        pdf = _demo_pdf(folder, context_repetitions=repetitions)
        origins.append(finalize_origin({**_origin(pdf), "label": pdf.name, "source_url": pdf.as_uri(),
            "_annotation_source_uri": pdf.as_uri(), "input_order": len(origins),
            "segments": [{"text": shared, "locator": {"page": 1}}, {"text": label, "locator": {"page": 2}}]}))
    reader, _, _ = setup()
    reader.origins = deduplicate_origins(origins)
    reader.chunks = reading_chunks(reader.origins, budget=400, count=len)
    healthy, broken = (o["segments"][0] for o in reader.origins)
    assert reading_pdf_quote_excerpts([healthy, broken], reader.origins) == {segment_source_key(broken): {"0": []}}
    calls = []

    def generate(prompt, validate, timeout):
        req = json.loads(prompt)
        calls.append(req["phase"])
        selection = quote_selection(req)
        catalog = json.loads(selection.input)["source_quotes"]
        a, b = [row["quotes"][0].get("quote_id") for row in catalog if row["quotes"][0]["text"] == shared]
        assert a in selection.primary_ids[0] and b not in selection.primary_ids[0]
        interpreting = req["phase"] == "interpret"
        assert (b is not None) == interpreting
        note = {"title": "Selective reading", "body_md": "The source describes selective reading.", "properties": {},
                "primary_quote_ids": [b if interpreting and reject_first_draft else a], "context_quote_ids": []}
        passage = {"notes": [note], "reason": "The original explains the context for reading."}
        if interpreting:
            passage["needs_specialist"] = False
            answer = {"themes": [], "questions": [], "contradictions": [], "warnings": []}
        else:
            answer = {"evidence_quote": shared, "unresolved_issues": []}
        literal = selection.restore(json.dumps({**answer, "passages": {"passage_1": passage}}),
                                    draft_schema=selection.draft_schema() if interpreting else None)
        validate(json.loads(literal))
        return literal, req["phase"]

    attach_reviewer(reader, generate)
    reader.dependencies.generate_structured = generate
    reader.dependencies.citation_issues = reading_citation_issues
    reader.dependencies.pdf_quote_excerpts = reading_pdf_quote_excerpts
    selected, = (chunk for chunk in reader.chunks if chunk["segments"][0]["id"] == healthy["id"])
    plans = SemanticReader(reader).interpret([selected], "Overview")
    note, = plans[selected["id"]]["notes"]
    assert calls == (["interpret", "source-repair"] if reject_first_draft else ["interpret"])
    assert note["citations"] == [{"segment_id": healthy["id"], "quote": shared}]


def test_two_independent_repairs_of_visually_identical_notes_resume_from_separate_checkpoints(tmp_path):
    from backend.domains.llm_wiki.chunking import reading_chunks
    from backend.domains.llm_wiki.origins import deduplicate_origins, finalize_origin
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.tests.test_reading_passage_repair import attach_reviewer
    from backend.tests.test_semantic_reading import response, setup

    whole, keep = "OCR mismatch; in this portable PDF fixture", "in this portable PDF fixture"
    origins = []
    for label in ("one", "two"):
        folder = tmp_path / label
        folder.mkdir()
        pdf = _demo_pdf(folder)
        texts = (whole, "Shared bibliography heading", f"Catalog mark {label}")
        origins.append(finalize_origin({**_origin(pdf), "label": pdf.name, "source_url": pdf.as_uri(),
            "_annotation_source_uri": pdf.as_uri(), "input_order": len(origins),
            "segments": [{"text": t, "locator": {"page": i}} for i, t in enumerate(texts, 1)]}))
    origins = deduplicate_origins(origins)
    chunks = reading_chunks(origins, budget=600, count=len)

    def earlier(request):
        answer = response(request)
        for passage, source in zip(answer["passages"], request["primary_passages"], strict=True):
            if source["text"] != whole:
                passage.update(notes=[], reason="The heading identifies a catalog section.")
        return answer

    previous, _, checkpoints = setup(generate=earlier)
    previous.origins, previous.chunks = origins, chunks
    SemanticReader(previous).extract("Overview")
    calls = []

    def specialist(prompt, validate, timeout):
        selection = quote_selection(json.loads(prompt))
        choice, = (n for n in selection.primary_ids[0] if selection.quotes[n] == keep)
        note = {"title": "Portable fixture", "body_md": "The original describes a portable PDF fixture.",
                "properties": {}, "primary_quote_ids": [choice], "context_quote_ids": []}
        literal = selection.restore(json.dumps({"assessment": "The source supports this correction.",
            "changes": {"note_1": note}, "evidence_requests": [], "warnings": [], "unresolved_issues": []}))
        validate(json.loads(literal))
        calls.append(selection.quote_sources[choice])
        return literal, "reviewer"

    for resume, job in (("new", "corrected"), ("corrected", "reused")):
        reader, ordinary, _ = setup(checkpoints=checkpoints, resume=resume)
        reader.job_id, reader.origins, reader.chunks = job, origins, chunks
        attach_reviewer(reader, specialist)
        reader.dependencies.citation_issues = reading_citation_issues
        reader.dependencies.pdf_quote_excerpts = reading_pdf_quote_excerpts
        engine = SemanticReader(reader)
        engine.state["review_size_limit"] = 1
        engine.extract("Overview")
        result = engine.review("Overview", "The two sources describe the fixture.")
        assert not ordinary and len(engine.state["reviewed_groups"]) == 2
        assert [n["citations"] for _, p in result for n in p["notes"]] == [
            [{"segment_id": o["segments"][0]["id"], "quote": keep}] for o in origins]
        assert len(calls) == len(set(calls)) == 2
