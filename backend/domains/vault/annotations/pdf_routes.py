"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")

from sqlalchemy.orm import Session as _AnnSession

from backend.data.db import get_db as _ann_get_db
from backend.models.pdf_annotation import PdfAnnotation as _PdfAnnotation


class _PdfAnnotationCreate(_legacy.BaseModel):
    __module__ = "backend.api.vault_routes"
    source_uri: str
    page: int
    type: str
    color: _legacy.Optional[str] = "#ffeb3b"
    rects: _legacy.Optional[_legacy.List[_legacy.Dict[str, float]]] = None
    text: _legacy.Optional[str] = None
    comment: _legacy.Optional[str] = None
    tags: _legacy.Optional[str] = None


class _PdfAnnotationUpdate(_legacy.BaseModel):
    __module__ = "backend.api.vault_routes"
    color: _legacy.Optional[str] = None
    rects: _legacy.Optional[_legacy.List[_legacy.Dict[str, float]]] = None
    text: _legacy.Optional[str] = None
    comment: _legacy.Optional[str] = None
    tags: _legacy.Optional[str] = None


def _pdf_annotation_to_dict(ann: _PdfAnnotation) -> _legacy.Dict[str, _legacy.Any]:
    return {
        "id": ann.id,
        "source_uri": ann.source_uri,
        "page": ann.page,
        "type": ann.type,
        "color": ann.color,
        "rects": _legacy.json.loads(ann.rects_json) if ann.rects_json else [],
        "text": ann.text,
        "comment": ann.comment,
        "tags": ann.tags,
        "created_at": ann.created_at.isoformat() if ann.created_at else None,
        "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
    }


@_legacy.router.get("/pdf-annotations", response_model=None)
def list_pdf_annotations(
    source_uri: str = _legacy.Query(..., min_length=1),
    db: _AnnSession = _legacy.Depends(_ann_get_db),
) -> _LegacyAny:
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


@_legacy.router.post(
    "/pdf-annotations",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
def create_pdf_annotation(
    body: _PdfAnnotationCreate, db: _AnnSession = _legacy.Depends(_ann_get_db)
) -> _LegacyAny:
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
        raise _legacy.HTTPException(
            status_code=400, detail=f"Unsupported annotation type: {body.type}"
        )
    ann = _PdfAnnotation(
        source_uri=body.source_uri,
        page=body.page,
        type=body.type,
        color=body.color or "#ffeb3b",
        rects_json=_legacy.json.dumps(body.rects) if body.rects else None,
        text=body.text,
        comment=body.comment,
        tags=body.tags,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@_legacy.router.patch(
    "/pdf-annotations/{ann_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
def update_pdf_annotation(
    ann_id: int, body: _PdfAnnotationUpdate, db: _AnnSession = _legacy.Depends(_ann_get_db)
) -> _LegacyAny:
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise _legacy.HTTPException(status_code=404, detail="Annotation not found")
    if body.color is not None:
        ann.color = body.color
    if body.comment is not None:
        ann.comment = body.comment
    if body.tags is not None:
        ann.tags = body.tags
    if body.text is not None:
        ann.text = body.text
    if body.rects is not None:
        ann.rects_json = _legacy.json.dumps(body.rects)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@_legacy.router.delete(
    "/pdf-annotations/{ann_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
def delete_pdf_annotation(
    ann_id: int, db: _AnnSession = _legacy.Depends(_ann_get_db)
) -> _LegacyAny:
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise _legacy.HTTPException(status_code=404, detail="Annotation not found")
    db.delete(ann)
    db.commit()
    return {"status": "ok", "id": ann_id}
