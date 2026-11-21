"""A rejected PDF sentence can yield verified, source-specific citation choices."""
import json

import pytest

from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import TEXT, TEXTS, interpretation_schema, obj
from backend.domains.llm_wiki.semantic_quote_contracts import source_key
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
    assert set(choices) == {source_key(source_view(s)) for s in (primary, context)}
    schema = obj({"passages": interpretation_schema(1, [])["properties"]["passages"],
                  "evidence_quote": TEXT, "unresolved_issues": TEXTS})
    selection = quote_selection({"phase": "source-repair", "reading_engine": "semantic",
        "primary_passages": [source_view(primary)], "neighbours": [source_view(s) for s in sources[1:]],
        "output_schema": schema, "verified_pdf_excerpts": choices})
    catalog = json.loads(selection.input)["source_quotes"]
    first, second = (catalog[i]["quotes"][0] for i in (0, 1))
    assert first["text"] == text and "quote_id" not in first
    assert catalog[2]["quotes"][0]["text"] == good["text"]
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
    assert result["quote_source_keys"] == [*[source_key(source_view(primary))] * len(options), source_key(source_view(context))]
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
    assert reading_pdf_quote_excerpts([a, b], origins) == {}


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
