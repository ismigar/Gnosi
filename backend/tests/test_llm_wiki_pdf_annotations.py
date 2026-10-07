"""Managed PDF highlights created from grounded Brain citations."""
from __future__ import annotations

import ctypes
import json
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from backend.migrations.runner import _run_alembic, ensure_database_schema
from backend.models.pdf_annotation import PdfAnnotation
from backend.services import llm_wiki_pdf_annotations

_TEST_QUOTE = "Persistent citation highlights span multiple lines in this portable PDF fixture"


def _demo_pdf(tmp_path: Path) -> Path:
    """Create a searchable two-line PDF without relying on vendor submodules."""
    import pypdfium2
    from pypdfium2 import raw as pdfium_c

    pdf_path = tmp_path / "citation-fixture.pdf"
    document = pypdfium2.PdfDocument.new()
    page = document.new_page(612, 792)
    try:
        for text_value, y_position in (
            ("Persistent citation highlights span multiple lines", 700),
            ("in this portable PDF fixture", 680),
            *[("Ordinary surrounding prose supplies context for selective reading without highlighting everything.",
               650 - index * 20) for index in range(6)],
        ):
            text_object = pdfium_c.FPDFPageObj_NewTextObj(
                document.raw,
                b"Helvetica",
                14,
            )
            encoded = (text_value + "\x00").encode("utf-16-le")
            encoded_pointer = ctypes.cast(encoded, pdfium_c.FPDF_WIDESTRING)
            assert pdfium_c.FPDFText_SetText(text_object, encoded_pointer)
            pdfium_c.FPDFPageObj_Transform(
                text_object,
                1,
                0,
                0,
                1,
                72,
                y_position,
            )
            assert pdfium_c.FPDFPage_InsertObject(page.raw, text_object)
        assert pdfium_c.FPDFPage_GenerateContent(page.raw)
        document.save(pdf_path)
    finally:
        page.close()
        document.close()
    return pdf_path


def _session():
    engine = create_engine("sqlite:///:memory:")
    PdfAnnotation.__table__.create(engine)
    return sessionmaker(bind=engine)()


def _origin(pdf_path: Path) -> dict:
    return {
        "kind": "pdf",
        "origin_id": "origin-1",
        "_annotation_source_uri": "file:///Library/demo.pdf",
        "_annotation_pdf_path": str(pdf_path),
    }


def _citation() -> dict:
    return {
        "origin_id": "origin-1",
        "segment_id": "segment-1",
        "quote": _TEST_QUOTE,
        "locator": {"page": 1, "paragraph": 1},
    }


def test_pdfium_resolves_multiline_quote_to_real_pdf_rectangles(tmp_path: Path):
    position = llm_wiki_pdf_annotations._find_quote_position(  # noqa: SLF001
        _demo_pdf(tmp_path),
        1,
        _citation()["quote"],
    )

    assert position is not None
    assert position["page_index"] == 0
    assert len(position["rects"]) == 2
    assert all(len(rect) == 4 for rect in position["rects"])
    assert position["sort_index"].startswith("00000|")


def test_reading_geometry_check_reports_ambiguous_quotes_before_publication_without_writing(tmp_path, monkeypatch):
    from copy import deepcopy
    import pytest
    origin = {**_origin(_demo_pdf(tmp_path)), 'segments': [
        {'id': 'segment-1', 'text': _TEST_QUOTE, 'locator': {'page': 1, 'paragraph': 1}}]}
    notes = [{'citations': [{'segment_id': 'segment-1', 'quote': quote}]} for quote in ['in', _TEST_QUOTE]]
    before = deepcopy((notes, origin))
    monkeypatch.setattr(llm_wiki_pdf_annotations, '_annotation_session', lambda *_: pytest.fail('read-only check wrote annotations'))
    issues = llm_wiki_pdf_annotations.reading_citation_issues(notes, [origin])
    assert len(issues[0]) == 1 and 'unambiguous highlight' in issues[0][0]
    assert issues[1] == []
    assert (notes, origin) == before


def test_managed_highlights_are_idempotent_and_preserve_manual_annotations(tmp_path: Path):
    session = _session()
    pdf_path = _demo_pdf(tmp_path)
    manual = PdfAnnotation(
        source_uri="file:///Library/demo.pdf",
        page=1,
        type="highlight",
        color="#ff6666",
        text="Manual highlight",
    )
    session.add(manual)
    session.commit()

    notes = [{"citations": [_citation(), _citation()]}]
    first = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        notes,
        [_origin(pdf_path)],
        "resource-1",
        session=session,
    )
    second = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        notes,
        [_origin(pdf_path)],
        "resource-1",
        session=session,
    )

    items = session.query(PdfAnnotation).order_by(PdfAnnotation.id).all()
    managed = next(item for item in items if item.managed_key)
    payload = json.loads(managed.comment.removeprefix("__ZOTERO_JSON__"))
    assert first["created"] == 1
    assert first["requested"] == 1
    assert second["created"] == 0
    assert second["updated"] == 1
    assert len(items) == 2
    assert payload["type"] == "highlight"
    assert len(payload["position"]["rects"]) == 2
    assert payload["tags"] == [{"name": "Brain citation"}]

    removed = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        [],
        [_origin(pdf_path)],
        "resource-1",
        session=session,
    )
    remaining = session.query(PdfAnnotation).all()
    assert removed["removed"] == 1
    assert remaining == [manual]


def test_sparse_highlights_preserve_full_evidence_and_remove_previous_saturation(tmp_path):
    """A heavily cited page must retain readable prose and its complete notes."""
    from copy import deepcopy

    session = _session()
    pdf_path = _demo_pdf(tmp_path)
    quotes = [
        "Listening to the Spirit requires personal responsibility for the search for truth.",
        "Faith cannot be reduced to blind obedience to the ecclesiastical institution.",
        "The written word alone cannot replace a living search for understanding.",
        "A historical example offers further context for this account of the tradition.",
        "The paragraph supplies another illustration within the wider discussion of authority.",
        "An additional reference situates this idea in its historical context and tradition.",
    ]
    notes = [
        {"title": "Personal responsibility in listening to the Spirit", "source_segment_id": "segment-0",
         "body_md": "Faith requires responsibility and listening, beyond blind institutional obedience.",
         "citations": [{**_citation(), "quote": quote, "segment_id": f"segment-{index}"}
                       for index, quote in enumerate(quotes)]}
    ]
    before = deepcopy(notes)
    raw = llm_wiki_pdf_annotations._citation_candidates(notes, [_origin(pdf_path)], "resource-1")
    for key, candidate in raw.items():
        session.add(PdfAnnotation(managed_key=key, source_uri=candidate["source_uri"],
                                  page=1, type="highlight", text=candidate["quote"]))
    manual = PdfAnnotation(source_uri="file:///Library/demo.pdf", page=1, type="highlight", text="My choice")
    unrelated = PdfAnnotation(managed_key="llm-wiki:other-resource:key", source_uri="file:///Library/demo.pdf",
                              page=1, type="highlight", text="Other resource")
    session.add_all([manual, unrelated])
    session.commit()

    def resolve(_path, _page, quote):
        index = quotes.index(quote)
        return {"page_index": 0, "rects": [[0, index * 15, 300, index * 15 + 10]],
                "sort_index": f"00000|{index:06}|00000", "page_text_length": 1200}

    report = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        notes, [_origin(pdf_path)], "resource-1", session=session, position_resolver=resolve,
    )
    kept = session.query(PdfAnnotation).filter(PdfAnnotation.managed_key.like("llm-wiki:resource-1:%")).all()
    assert len(kept) == 2
    assert sum(len(item.text) for item in kept) <= 0.15 * 1200
    assert {item.text for item in kept} == set(quotes[:2])
    assert report["removed"] == 4 and report["citation_matches"] == 6
    assert notes == before
    assert session.get(PdfAnnotation, manual.id) is manual
    assert session.get(PdfAnnotation, unrelated.id) is unrelated


def test_highlights_deduplicate_overlapping_quotes_from_distinct_source_segments(tmp_path):
    pdf_path = _demo_pdf(tmp_path)
    notes = [{"citations": [{**_citation(), "segment_id": f"segment-{i}"} for i in range(6)]}]
    session = _session()
    report = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        notes, [_origin(pdf_path)], "resource-1", session=session,
    )
    assert report["citation_matches"] == 6
    assert report["selected"] == 1


def test_unsuitable_quotes_leave_page_unmarked_and_still_require_full_citation_geometry(tmp_path):
    pdf_path = _demo_pdf(tmp_path)
    quote = " ".join([_TEST_QUOTE] * 8)
    origin = {**_origin(pdf_path), "segments": [
        {"id": "segment-1", "text": quote, "locator": {"page": 1}}]}
    notes = [{"citations": [{**_citation(), "quote": quote}]}]
    session = _session()
    calls = []

    def resolve(_path, _page, value):
        calls.append(value)
        return {"page_index": 0, "rects": [[0, 0, 100, 10]], "sort_index": "00000|000000|00000",
                "page_text_length": 5000}

    report = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        notes, [origin], "resource-1", session=session, position_resolver=resolve,
    )
    assert report["selected"] == 0 and report["citation_matches"] == 1
    assert calls == [quote]  # A display limit must never weaken evidence checks.
    assert session.query(PdfAnnotation).count() == 0
    assert llm_wiki_pdf_annotations.reading_citation_issues(notes, [origin])[0]


def test_unavailable_pdf_preserves_previously_generated_highlights(tmp_path):
    pdf_path = tmp_path / "unavailable.pdf"
    session = _session()
    notes = [{"citations": [_citation()]}]
    key = llm_wiki_pdf_annotations._managed_key("resource-1", _citation())
    saved = PdfAnnotation(managed_key=key, source_uri="file:///Library/demo.pdf",
                          page=1, type="highlight", text=_TEST_QUOTE)
    session.add(saved)
    session.commit()
    report = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        notes, [_origin(pdf_path)], "resource-1", session=session,
    )
    assert report["removed"] == 0
    assert session.get(PdfAnnotation, saved.id) is saved


def test_alembic_migration_adds_unique_managed_key_column(tmp_path: Path):
    database = tmp_path / "system" / "vault_dbs" / "gnosi_vault_test.db"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", "vault_0002")
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE alembic_version")

    ensure_database_schema(database, "vault", tmp_path)

    engine = create_engine(f"sqlite:///{database}")
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("pdf_annotations")}
    indexes = {index["name"]: index for index in inspector.get_indexes("pdf_annotations")}
    assert "managed_key" in columns
    assert indexes["ix_pdf_annotations_managed_key"]["unique"] == 1
