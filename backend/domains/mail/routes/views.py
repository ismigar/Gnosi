"""Canonical mail views."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from backend.data.db import get_db
from backend.domains.mail.routing import router
from backend.domains.mail.schemas import (
    MailViewCreateSchema,
    MailViewResponse,
    MailViewUpdateSchema,
)
from backend.models.mail import MailView
from backend.services.workspace_service import require_role

log = logging.getLogger(__name__)


def _view_to_dict(view: MailView) -> dict[str, Any]:
    return {
        "id": view.id,
        "name": view.name,
        "fields": json.loads(str(view.fields or "[]")),
        "filters": json.loads(str(view.filters or "[]")),
        "filter_logic": view.filter_logic,
        "group_by": view.group_by,
        "sort_by": view.sort_by,
        "sort_dir": view.sort_dir,
        "actions": json.loads(str(view.actions or "[]")),
        "created_at": view.created_at.isoformat() if view.created_at else None,
        "updated_at": view.updated_at.isoformat() if view.updated_at else None,
    }


@router.get(
    "/views",
    response_model=list[MailViewResponse],
    response_model_exclude_unset=True,
)
async def list_views(db: Session = Depends(get_db)) -> Any:
    views = db.query(MailView).order_by(MailView.created_at).all()
    return [_view_to_dict(v) for v in views]


@router.post(
    "/views",
    status_code=201,
    response_model=MailViewResponse,
    response_model_exclude_unset=True,
)
async def create_view(payload: MailViewCreateSchema, db: Session = Depends(get_db)) -> Any:
    view = MailView(
        name=payload.name,
        fields=json.dumps([f.model_dump() for f in payload.fields]),
        filters=json.dumps([f.model_dump() for f in payload.filters]),
        filter_logic=payload.filter_logic,
        group_by=payload.group_by,
        sort_by=payload.sort_by,
        sort_dir=payload.sort_dir,
        actions=json.dumps(payload.actions),
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return _view_to_dict(view)


@router.put(
    "/views/{view_id}",
    response_model=MailViewResponse,
    response_model_exclude_unset=True,
)
async def update_view(
    view_id: str, payload: MailViewUpdateSchema, db: Session = Depends(get_db)
) -> Any:
    view = db.query(MailView).filter(MailView.id == view_id).first()
    if not view:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    if payload.name is not None:
        setattr(view, "name", payload.name)
    setattr(view, "fields", json.dumps([f.model_dump() for f in payload.fields]))
    setattr(view, "filters", json.dumps([f.model_dump() for f in payload.filters]))
    setattr(view, "filter_logic", payload.filter_logic)
    setattr(view, "group_by", payload.group_by)
    setattr(view, "sort_by", payload.sort_by)
    setattr(view, "sort_dir", payload.sort_dir)
    setattr(view, "actions", json.dumps(payload.actions))
    db.commit()
    db.refresh(view)
    return _view_to_dict(view)


@router.delete(
    "/views/{view_id}",
    status_code=204,
    response_model=None,
    dependencies=[Depends(require_role("editor"))],
)
async def delete_view(view_id: str, db: Session = Depends(get_db)) -> Any:
    view = db.query(MailView).filter(MailView.id == view_id).first()
    if not view:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    db.delete(view)
    db.commit()
