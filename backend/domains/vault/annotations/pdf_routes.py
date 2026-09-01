"""Typed Vault domain extracted from the historical route facade."""

import json
from typing import TypedDict

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session as _AnnSession

from backend.api.vault_routes import router as router
from backend.data.db import get_db as _ann_get_db
from backend.models.pdf_annotation import PdfAnnotation as _PdfAnnotation
from backend.services.workspace_service import require_role


class _PdfAnnotationCreate(BaseModel):
    __module__ = "backend.api.vault_routes"
    source_uri: str
    page: int
    type: str
    color: str | None = "#ffeb3b"
    rects: list[dict[str, float]] | None = None
    text: str | None = None
    comment: str | None = None
    tags: str | None = None


class _PdfAnnotationUpdate(BaseModel):
    __module__ = "backend.api.vault_routes"
    color: str | None = None
    rects: list[dict[str, float]] | None = None
    text: str | None = None
    comment: str | None = None
    tags: str | None = None


class PdfAnnotationResponse(BaseModel):
    id: int
    source_uri: str
    page: int
    type: str
    color: str | None
    rects: list[dict[str, float]]
    text: str | None
    comment: str | None
    tags: str | None
    created_at: str | None
    updated_at: str | None


class PdfAnnotationDeletedResponse(BaseModel):
    status: str
    id: int


class PdfAnnotationPayload(TypedDict):
    id: int
    source_uri: str
    page: int
    type: str
    color: str | None
    # Persisted JSON is not validated here. The existing HTTP response model
    # owns rectangle validation; direct callers retain json.loads semantics.
    rects: object
    text: str | None
    comment: str | None
    tags: str | None
    created_at: str | None
    updated_at: str | None


class PdfAnnotationDeletedPayload(TypedDict):
    status: str
    id: int


def _pdf_annotation_to_dict(ann: _PdfAnnotation) -> PdfAnnotationPayload:
    return {
        "id": ann.id,
        "source_uri": ann.source_uri,
        "page": ann.page,
        "type": ann.type,
        "color": ann.color,
        "rects": json.loads(ann.rects_json) if ann.rects_json else [],
        "text": ann.text,
        "comment": ann.comment,
        "tags": ann.tags,
        "created_at": ann.created_at.isoformat() if ann.created_at else None,
        "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
    }


@router.get("/pdf-annotations", response_model=list[PdfAnnotationResponse])
def list_pdf_annotations(
    source_uri: str = Query(..., min_length=1),
    db: _AnnSession = Depends(_ann_get_db),
) -> list[PdfAnnotationPayload]:
    """Lists all annotations associated with a PDF (by `source_uri`).

    Sorted by ascending page + creation date, so the sidebar
    can show them in natural reading order.

    """
    items = (
        db.query(_PdfAnnotation)
        .filter(_PdfAnnotation.source_uri == source_uri)
        .order_by(_PdfAnnotation.page.asc(), _PdfAnnotation.created_at.asc())
        .all()
    )
    return [_pdf_annotation_to_dict(i) for i in items]


@router.post(
    "/pdf-annotations",
    dependencies=[Depends(require_role("editor"))],
    response_model=PdfAnnotationResponse,
)
def create_pdf_annotation(
    body: _PdfAnnotationCreate, db: _AnnSession = Depends(_ann_get_db)
) -> PdfAnnotationPayload:
    if body.type not in {
        "highlight",
        "underline",
        "strikeout",
        "comment",
        "area",
        "text",
        "note",
        "ink",
        "image",
    }:
        raise HTTPException(
            status_code=400, detail=f"Unsupported annotation type: {body.type}"
        )
    ann = _PdfAnnotation(
        source_uri=body.source_uri,
        page=body.page,
        type=body.type,
        color=body.color or "#ffeb3b",
        rects_json=json.dumps(body.rects) if body.rects else None,
        text=body.text,
        comment=body.comment,
        tags=body.tags,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@router.patch(
    "/pdf-annotations/{ann_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=PdfAnnotationResponse,
)
def update_pdf_annotation(
    ann_id: int, body: _PdfAnnotationUpdate, db: _AnnSession = Depends(_ann_get_db)
) -> PdfAnnotationPayload:
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if body.color is not None:
        ann.color = body.color
    if body.comment is not None:
        ann.comment = body.comment
    if body.tags is not None:
        ann.tags = body.tags
    if body.text is not None:
        ann.text = body.text
    if body.rects is not None:
        ann.rects_json = json.dumps(body.rects)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@router.delete(
    "/pdf-annotations/{ann_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=PdfAnnotationDeletedResponse,
)
def delete_pdf_annotation(
    ann_id: int, db: _AnnSession = Depends(_ann_get_db)
) -> PdfAnnotationDeletedPayload:
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    db.delete(ann)
    db.commit()
    return {"status": "ok", "id": ann_id}
