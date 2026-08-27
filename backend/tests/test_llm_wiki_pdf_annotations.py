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
