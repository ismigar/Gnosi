"""Canonical mail attachment routes."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import HTTPException, Query
from fastapi.responses import Response

from backend.domains.mail import schemas as mail_schemas
from backend.domains.mail.routing import router
from backend.domains.mail.services.attachments import (
    _collect_original_inline_parts,
    _gmail_get_attachment_bytes,
    _imap_fetch_raw,
)
from backend.utils.errors import safe_error_detail

log = logging.getLogger(__name__)


@router.get(
    "/messages/{message_id}/attachments/{att_id:path}",
    response_class=Response,
    response_model=None,
)
async def get_attachment(
    message_id: str,
    att_id: str,
    email: str = Query(...),
    folder: str = Query("INBOX"),
    inline: bool = Query(False),
    content_type_hint: Optional[str] = Query(None, alias="content_type"),
    filename_hint: Optional[str] = Query(None, alias="filename"),
) -> Any:
    "Downloads an attachment — works for Gmail (att_id=attachmentId) and IMAP (att_id=part_index)."
    from backend.services.integration_manager import integration_manager

    disposition = "inline" if inline else "attachment"
    acc = integration_manager.get_mail_account(email)

    # All IMAP providers (including Google with refresh_token) use part_index.
    # Microsoft Graph keeps the original API; Gmail API remains only as a fallback
    # for Google accounts without refresh_token (degraded case).
    if acc and integration_manager.is_imap_account(acc):
        pass  # Fall back to the IMAP path.
    elif acc and integration_manager.is_google_account(acc):
        data, _ = await _gmail_get_attachment_bytes(email, message_id, att_id)
        if not data:
            raise HTTPException(status_code=404, detail="Adjunt no trobat")
        media_type = content_type_hint or "application/octet-stream"
        safe_filename = filename_hint or "attachment"
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f'{disposition}; filename="{safe_filename}"'},
        )

    # IMAP path
    import email as email_lib

    from backend.services.hybrid_mail_service import (
        _decode_mime,
        _imap_pool_invalidate,
        _imap_pool_release,
    )

    raw_bytes, imap = await _imap_fetch_raw(email, message_id, folder)
    if not raw_bytes:
        if imap:
            _imap_pool_release(email)
        raise HTTPException(status_code=404, detail="Missatge no trobat")
    try:
        msg = email_lib.message_from_bytes(raw_bytes)
        parts = list(msg.walk())
        idx = int(att_id)
        if idx >= len(parts):
            raise HTTPException(status_code=404, detail="Adjunt no trobat")
        part = parts[idx]
        payload = part.get_payload(decode=True)
        if not payload:
            raise HTTPException(status_code=404, detail="Adjunt buit")
        filename = _decode_mime(part.get_filename() or f"attachment_{idx}")
        content_type = part.get_content_type() or "application/octet-stream"
        return Response(
            content=payload,
            media_type=content_type,
            headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        _imap_pool_invalidate(email)
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /messages attachment"),
        )
    finally:
        _imap_pool_release(email)


@router.get(
    "/messages/{message_id}/cid/{cid:path}",
    response_class=Response,
    response_model=None,
)
async def get_cid_image(
    message_id: str,
    cid: str,
    email: str = Query(...),
    folder: str = Query("INBOX"),
) -> Any:
    """Serves an inline CID image — works for Gmail, IMAP and Microsoft."""
    try:
        parts = await _collect_original_inline_parts(email, message_id, {cid}, folder)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /messages CID image"),
        )
    if parts is None:
        raise HTTPException(status_code=404, detail="Missatge no trobat")
    part = parts.get(cid.strip("<>"))
    if not part:
        raise HTTPException(status_code=404, detail="Imatge CID no trobada")
    return Response(content=part["data"], media_type=part.get("content_type") or "image/png")


@router.patch(
    "/accounts/{email:path}/enabled",
    response_model=mail_schemas.MailAccountEnabledResponse,
)
async def set_account_enabled(
    email: str,
    body: mail_schemas.MailAccountEnabledRequest,
) -> Any:
    enabled = body.enabled
    from backend.services.integration_manager import integration_manager

    found = integration_manager.set_mail_account_enabled(email, bool(enabled))
    if not found:
        raise HTTPException(status_code=404, detail="Compte no trobat")
    return {"email": email, "enabled": bool(enabled)}
