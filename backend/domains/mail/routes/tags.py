"""Canonical mail tags."""

from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.data.db import get_db
from backend.domains.mail.routing import router
from backend.domains.mail.schemas import (
    MailMessageIdentityScope,
    MailMessageTagDescriptor,
    MailMessageTagsSetSchema,
    MailMessageTagsResponse,
    MailTagCreateSchema,
    MailTaggedMessagesResponse,
    MailTagResponse,
    MailTagsBatchRequest,
    MailTagsByMessageResponse,
    MailTagUpdateSchema,
)
from backend.domains.mail.tag_identity import (
    ResolvedMailTagIdentity,
    legacy_mail_tag_identity,
    scoped_mail_tag_identity,
)
from backend.models.mail import MailMessageTag, MailTag
from backend.services.workspace_service import require_role

log = logging.getLogger(__name__)


def _tag_to_dict(tag: MailTag) -> dict[str, object]:
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "created_at": tag.created_at.isoformat() if tag.created_at else None,
    }


def _resolve_scope(
    message_id: str,
    scope: MailMessageIdentityScope,
) -> ResolvedMailTagIdentity:
    try:
        return scoped_mail_tag_identity(
            message_id,
            account_email=scope.account_email,
            source=scope.source,
            imap_folder=scope.imap_folder,
            imap_uid=scope.imap_uid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _query_scope(
    account_email: str | None,
    source: str | None,
    imap_folder: str | None,
    imap_uid: str | None,
) -> MailMessageIdentityScope | None:
    values = (account_email, source, imap_folder, imap_uid)
    if not any(value is not None for value in values):
        return None
    try:
        return MailMessageIdentityScope(
            account_email=account_email or "",
            source=source or "",
            imap_folder=imap_folder,
            imap_uid=imap_uid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Incomplete mail identity scope") from exc


def _validate_tags(db: Session, tag_ids: list[str]) -> None:
    existing = {
        str(tag_id)
        for (tag_id,) in db.query(MailTag.id).filter(MailTag.id.in_(tag_ids)).all()
    }
    missing = next((tag_id for tag_id in tag_ids if tag_id not in existing), None)
    if missing is not None:
        raise HTTPException(status_code=404, detail=f"Etiqueta {missing} no trobada")


def _scoped_descriptor_identity(
    descriptor: MailMessageTagDescriptor,
) -> ResolvedMailTagIdentity:
    return _resolve_scope(descriptor.message_id, descriptor)


def _unique_tag_ids(rows: list[MailMessageTag]) -> list[str]:
    return list(dict.fromkeys(str(row.tag_id) for row in rows))


def _materializable_legacy_rows(
    db: Session,
    message_id: str,
    account_email: str,
) -> list[MailMessageTag]:
    account = account_email.strip().lower()
    if not account:
        return []
    rows = db.query(MailMessageTag).filter(
        MailMessageTag.message_id == message_id,
        MailMessageTag.identity_kind == "legacy",
        func.lower(func.trim(MailMessageTag.account_email)) == account,
    ).order_by(MailMessageTag.message_identity, MailMessageTag.tag_id).all()
    identities = {str(row.message_identity) for row in rows}
    return rows if len(identities) == 1 else []


def _scoped_tags_with_legacy_fallback(
    db: Session,
    message_id: str,
    identity: ResolvedMailTagIdentity,
) -> list[str]:
    scoped_rows = db.query(MailMessageTag).filter(
        MailMessageTag.message_identity == identity.key
    ).order_by(MailMessageTag.tag_id).all()
    if scoped_rows:
        return _unique_tag_ids(scoped_rows)
    return _unique_tag_ids(
        _materializable_legacy_rows(db, message_id, identity.account_email)
    )


@router.get("/tags", response_model=list[MailTagResponse])
async def list_tags(db: Session = Depends(get_db)) -> list[dict[str, object]]:
    tags = db.query(MailTag).order_by(MailTag.created_at).all()
    return [_tag_to_dict(t) for t in tags]


@router.post("/tags", status_code=201, response_model=MailTagResponse)
async def create_tag(
    payload: MailTagCreateSchema,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    tag = MailTag(name=payload.name, color=payload.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _tag_to_dict(tag)


@router.put("/tags/{tag_id}", response_model=MailTagResponse)
async def update_tag(
    tag_id: str, payload: MailTagUpdateSchema, db: Session = Depends(get_db)
) -> dict[str, object]:
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
async def delete_tag(tag_id: str, db: Session = Depends(get_db)) -> None:
    tag = db.query(MailTag).filter(MailTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Etiqueta no trobada")
    db.query(MailMessageTag).filter(MailMessageTag.tag_id == tag_id).delete()
    db.delete(tag)
    db.commit()


@router.get("/messages/{message_id}/tags", response_model=list[str])
async def get_message_tags(
    message_id: str,
    account_email: str | None = Query(default=None),
    source: str | None = Query(default=None),
    imap_folder: str | None = Query(default=None),
    imap_uid: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[str]:
    scope = _query_scope(account_email, source, imap_folder, imap_uid)
    query = db.query(MailMessageTag)
    if scope is None:
        query = query.filter(
            MailMessageTag.message_id == message_id,
            MailMessageTag.identity_kind == "legacy",
        )
    else:
        return _scoped_tags_with_legacy_fallback(
            db,
            message_id,
            _resolve_scope(message_id, scope),
        )
    rows = query.all()
    return _unique_tag_ids(rows)


@router.post(
    "/messages/{message_id}/tags",
    response_model=MailMessageTagsResponse,
)
async def set_message_tags(
    message_id: str, payload: MailMessageTagsSetSchema, db: Session = Depends(get_db)
) -> dict[str, object]:
    _validate_tags(db, payload.tag_ids)
    scope = payload.identity_scope
    if scope is None:
        identity = legacy_mail_tag_identity(message_id, payload.account_email)
        db.query(MailMessageTag).filter(
            MailMessageTag.message_identity == identity
        ).delete(synchronize_session=False)
        identity_kind = "legacy"
        account_email = payload.account_email
        provider = ""
        folder = ""
        provider_uid = ""
    else:
        resolved = _resolve_scope(message_id, scope)
        identity = resolved.key
        legacy_rows = _materializable_legacy_rows(
            db,
            message_id,
            resolved.account_email,
        )
        db.query(MailMessageTag).filter(
            MailMessageTag.message_identity == identity
        ).delete(synchronize_session=False)
        if legacy_rows:
            db.query(MailMessageTag).filter(
                MailMessageTag.message_identity
                == str(legacy_rows[0].message_identity),
                MailMessageTag.message_id == message_id,
                MailMessageTag.identity_kind == "legacy",
                func.lower(func.trim(MailMessageTag.account_email))
                == resolved.account_email,
            ).delete(synchronize_session=False)
        identity_kind = "scoped"
        account_email = resolved.account_email
        provider = resolved.provider
        folder = resolved.folder
        provider_uid = resolved.provider_uid

    tag_ids = payload.tag_ids
    for tag_id in tag_ids:
        assoc = MailMessageTag(
            message_identity=identity,
            message_id=message_id,
            tag_id=tag_id,
            identity_kind=identity_kind,
            account_email=account_email,
            provider=provider,
            folder=folder,
            provider_uid=provider_uid,
            subject=payload.subject,
            sender=payload.sender,
            date_str=payload.date_str,
        )
        db.add(assoc)
    db.commit()
    return {"status": "success", "tag_ids": tag_ids}


@router.get(
    "/tags/{tag_id}/messages",
    response_model=MailTaggedMessagesResponse,
)
async def get_tagged_messages(
    tag_id: str,
    db: Session = Depends(get_db),
) -> dict[str, object]:
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
                "message_identity": r.message_identity,
                "identity_kind": r.identity_kind,
                "source": r.provider or None,
                "imap_folder": r.folder or None,
                "provider_uid": r.provider_uid or None,
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
) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {
        message_id: [] for message_id in payload.message_ids
    }
    if payload.message_ids:
        legacy_rows = db.query(MailMessageTag).filter(
            MailMessageTag.message_id.in_(payload.message_ids),
            MailMessageTag.identity_kind == "legacy",
        ).all()
        for row in legacy_rows:
            tag_ids = result[str(row.message_id)]
            tag_id = str(row.tag_id)
            if tag_id not in tag_ids:
                tag_ids.append(tag_id)

    scoped_identities = [
        _scoped_descriptor_identity(item) for item in payload.messages
    ]
    for identity in scoped_identities:
        result[identity.key] = []
    if scoped_identities:
        scoped_rows = db.query(MailMessageTag).filter(
            MailMessageTag.message_identity.in_(
                [identity.key for identity in scoped_identities]
            )
        ).all()
        for row in scoped_rows:
            result[str(row.message_identity)].append(str(row.tag_id))
        present = {str(row.message_identity) for row in scoped_rows}
        for descriptor, identity in zip(
            payload.messages,
            scoped_identities,
            strict=True,
        ):
            if identity.key not in present:
                result[identity.key] = _unique_tag_ids(
                    _materializable_legacy_rows(
                        db,
                        descriptor.message_id,
                        identity.account_email,
                    )
                )
    return result
