"""Canonical mail tags."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from backend.data.db import get_db
from backend.domains.mail.routing import router
from backend.domains.mail.schemas import (
    MailMessageTagsSetSchema,
    MailMessageTagsResponse,
    MailTagCreateSchema,
    MailTaggedMessagesResponse,
    MailTagResponse,
    MailTagsBatchRequest,
    MailTagsByMessageResponse,
    MailTagUpdateSchema,
)
from backend.models.mail import MailMessageTag, MailTag
from backend.services.workspace_service import require_role

log = logging.getLogger(__name__)


def _tag_to_dict(tag: MailTag) -> dict[str, Any]:
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "created_at": tag.created_at.isoformat() if tag.created_at else None,
    }


@router.get("/tags", response_model=list[MailTagResponse])
async def list_tags(db: Session = Depends(get_db)) -> Any:
    tags = db.query(MailTag).order_by(MailTag.created_at).all()
    return [_tag_to_dict(t) for t in tags]


@router.post("/tags", status_code=201, response_model=MailTagResponse)
async def create_tag(payload: MailTagCreateSchema, db: Session = Depends(get_db)) -> Any:
    tag = MailTag(name=payload.name, color=payload.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _tag_to_dict(tag)


@router.put("/tags/{tag_id}", response_model=MailTagResponse)
async def update_tag(
    tag_id: str, payload: MailTagUpdateSchema, db: Session = Depends(get_db)
) -> Any:
    tag = db.query(MailTag).filter(MailTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Etiqueta no trobada")
    if payload.name is not None:
        setattr(tag, "name", payload.name)
    if payload.color is not None:
        setattr(tag, "color", payload.color)
    db.commit()
    db.refresh(tag)
    return _tag_to_dict(tag)


@router.delete(
    "/tags/{tag_id}",
    status_code=204,
    response_model=None,
    dependencies=[Depends(require_role("editor"))],
)
async def delete_tag(tag_id: str, db: Session = Depends(get_db)) -> Any:
    tag = db.query(MailTag).filter(MailTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Etiqueta no trobada")
    db.query(MailMessageTag).filter(MailMessageTag.tag_id == tag_id).delete()
    db.delete(tag)
    db.commit()


@router.get("/messages/{message_id}/tags", response_model=list[str])
async def get_message_tags(message_id: str, db: Session = Depends(get_db)) -> Any:
    rows = db.query(MailMessageTag).filter(MailMessageTag.message_id == message_id).all()
    return [row.tag_id for row in rows]


@router.post(
    "/messages/{message_id}/tags",
    response_model=MailMessageTagsResponse,
)
async def set_message_tags(
    message_id: str, payload: MailMessageTagsSetSchema, db: Session = Depends(get_db)
) -> Any:
    db.query(MailMessageTag).filter(MailMessageTag.message_id == message_id).delete()
    for tag_id in payload.tag_ids:
        tag_exists = db.query(MailTag).filter(MailTag.id == tag_id).first()
        if not tag_exists:
            raise HTTPException(status_code=404, detail=f"Etiqueta {tag_id} no trobada")
        assoc = MailMessageTag(
            message_id=message_id,
            tag_id=tag_id,
            account_email=payload.account_email,
            subject=payload.subject,
            sender=payload.sender,
            date_str=payload.date_str,
        )
        db.add(assoc)
    db.commit()
    return {"status": "success", "tag_ids": payload.tag_ids}


@router.get(
    "/tags/{tag_id}/messages",
    response_model=MailTaggedMessagesResponse,
)
async def get_tagged_messages(tag_id: str, db: Session = Depends(get_db)) -> Any:
    tag = db.query(MailTag).filter(MailTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Etiqueta no trobada")
    rows = db.query(MailMessageTag).filter(MailMessageTag.tag_id == tag_id).all()
    return {
        "tag": _tag_to_dict(tag),
        "messages": [
            {
                "message_id": r.message_id,
                "account_email": r.account_email,
                "subject": r.subject,
                "sender": r.sender,
                "date_str": r.date_str,
            }
            for r in rows
        ],
    }


@router.post(
    "/tags/messages/batch",
    response_model=MailTagsByMessageResponse,
)
async def get_tags_for_messages(
    payload: MailTagsBatchRequest,
    db: Session = Depends(get_db),
) -> Any:
    message_ids = payload.message_ids
    if not message_ids:
        return {}
    rows = db.query(MailMessageTag).filter(MailMessageTag.message_id.in_(message_ids)).all()
    result: dict[str, Any] = {mid: [] for mid in message_ids}
    for row in rows:
        result[str(row.message_id)].append(row.tag_id)
    return result
