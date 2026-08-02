"""Managed PDF highlights created from grounded Brain citations."""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from backend.data.db import _apply_lazy_migrations
from backend.models.pdf_annotation import PdfAnnotation
from backend.services import llm_wiki_pdf_annotations


def _demo_pdf() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "vendor"
        / "zotero-reader"
        / "demo"
        / "pdf"
        / "demo.pdf"
    )


def _session():
    engine = create_engine("sqlite:///:memory:")
    PdfAnnotation.__table__.create(engine)
    return sessionmaker(bind=engine)()


def _origin() -> dict:
    return {
        "kind": "pdf",
        "origin_id": "origin-1",
        "_annotation_source_uri": "file:///Library/demo.pdf",
        "_annotation_pdf_path": str(_demo_pdf()),
    }


def _citation() -> dict:
    return {
        "origin_id": "origin-1",
        "segment_id": "segment-1",
        "quote": "Trace-based Just-in-Time Type Specialization for Dynamic Languages",
        "locator": {"page": 1, "paragraph": 1},
    }


def test_pdfium_resolves_multiline_quote_to_real_pdf_rectangles():
    position = llm_wiki_pdf_annotations._find_quote_position(  # noqa: SLF001
        _demo_pdf(),
        1,
        _citation()["quote"],
    )

    assert position is not None
    assert position["page_index"] == 0
    assert len(position["rects"]) == 2
    assert all(len(rect) == 4 for rect in position["rects"])
    assert position["sort_index"].startswith("00000|")


def test_managed_highlights_are_idempotent_and_preserve_manual_annotations():
    session = _session()
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
        [_origin()],
        "resource-1",
        session=session,
    )
    second = llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
        notes,
        [_origin()],
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
        [_origin()],
        "resource-1",
        session=session,
    )
    remaining = session.query(PdfAnnotation).all()
    assert removed["removed"] == 1
    assert remaining == [manual]


def test_lazy_migration_adds_unique_managed_key_column():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE pdf_annotations ("
            "id INTEGER PRIMARY KEY, source_uri VARCHAR NOT NULL, "
            "page INTEGER NOT NULL, type VARCHAR NOT NULL)"
        ))

    _apply_lazy_migrations(engine)

    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("pdf_annotations")}
    indexes = {index["name"]: index for index in inspector.get_indexes("pdf_annotations")}
    assert "managed_key" in columns
    assert indexes["ix_pdf_annotations_managed_key"]["unique"] == 1
