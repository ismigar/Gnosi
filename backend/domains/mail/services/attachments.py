"""Canonical mail attachment service."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional, cast

from backend.domains.mail.services.accounts import _is_microsoft_account
from backend.services.mail_inline_images import (
    InlineImage,
    MimeAsset,
    extract_inline_parts_from_mime,
    find_cid_srcs,
    find_mail_cid_refs,
    new_content_id,
    rewrite_cid_srcs,
    rewrite_mail_cid_srcs,
)

log = logging.getLogger(__name__)


async def _gmail_get_attachment_bytes(
    email: str, message_id: str, attachment_id: str
) -> tuple[bytes | None, str | None]:
    """Returns (data_bytes, content_type) for a Gmail attachment."""
    import base64

    from backend.services.google_mail_service import get_gmail_service

    service = get_gmail_service(email)
    if not service:
        return None, None
    att = (
        service.users()
        .messages()
        .attachments()
        .get(userId="me", messageId=message_id, id=attachment_id)
        .execute()
    )
    data = base64.urlsafe_b64decode(att.get("data", "") + "==")
    return data, None


async def _imap_fetch_raw(email: str, message_id: str, folder: str) -> Any:
    """Returns (raw_bytes, imap_conn) for an IMAP message. Caller must release the pool."""
    from backend.services.hybrid_mail_service import (
        _get_imap_account,
        _imap_folder_name,
        _imap_pool_acquire,
        _imap_pool_invalidate,
        _imap_pool_release,
    )

    acc = _get_imap_account(email)
    if not acc:
        return None, None
    imap = _imap_pool_acquire(acc)
    if not imap:
        return None, None
    try:
        uid = message_id[5:] if message_id.startswith("imap_") else message_id
        folder_name = _imap_folder_name(imap, folder)
        imap.select(f'"{folder_name}"', readonly=True)
        status, data = imap.uid("fetch", uid, "(BODY[])")
        if status != "OK" or not data:
            return None, imap
        raw_bytes = next((p[1] for p in data if isinstance(p, tuple)), None)
        return raw_bytes, imap
    except Exception:
        # select()/uid() can raise (imaplib.abort/OSError) if the connection drops
        # AFTER the validation noop in _imap_pool_acquire, with the pool lock already
        # held. Since callers place this call OUTSIDE their try/finally, without
        # this rescue the lock would stay held forever → deadlock of ALL
        # the account's IMAP operations (attachments, CID images, reply with quoted images).
        # We invalidate the broken connection and release the lock (release is idempotent);
        # we return (None, None) so callers treat it as "not found".
        _imap_pool_invalidate(email)
        _imap_pool_release(email)
        return None, None


async def _collect_original_inline_parts(
    email: str, message_id: str, wanted_cids: set[str], folder: str = "INBOX"
) -> dict[str, MimeAsset] | None:
    """Retrieves the inline parts of an existing message by Content-ID.

    Same provider selection as get_attachment: IMAP-eligible (including
    Google with refresh_token) → fetch RAW + walk; Google without refresh_token →
    Gmail API; Microsoft → Graph; unknown → IMAP (historical behavior).

    Returns:
        Dict cid (without ``<>``) → {filename, content_type, data}; ``None`` if
        the message couldn't be retrieved. Transport exceptions
        propagate to the caller (the IMAP pool is invalidated and released).

    """
    from backend.services.integration_manager import integration_manager

    wanted = {c.strip("<>") for c in wanted_cids if c}
    if not wanted:
        return {}
    from backend.domains.mail.cache import _get_cached_inline_parts

    cached = _get_cached_inline_parts(email, message_id, folder)
    if cached is not None:
        return {
            cid: cast(MimeAsset, cached[cid])
            for cid in wanted
            if cid in cached
        }
    acc = integration_manager.get_mail_account(email)

    if not (acc and integration_manager.is_imap_account(acc)):
        if acc and integration_manager.is_google_account(acc):
            # Gmail API: full message for the CID → attachmentId mapping.
            from backend.services.hybrid_mail_service import gmail_get_message

            mail = await asyncio.to_thread(gmail_get_message, email, message_id)
            if not mail:
                return None
            parts: dict[str, MimeAsset] = {}
            for img in mail.get("inline_images") or []:
                img_cid = (img.get("cid") or "").strip("<>")
                if not img_cid or img_cid not in wanted or img_cid in parts:
                    continue
                data, _ = await _gmail_get_attachment_bytes(email, message_id, img["attachment_id"])
                if data:
                    parts[img_cid] = {
                        "filename": str(img.get("filename") or "image"),
                        "content_type": str(img.get("content_type") or "image/png"),
                        "data": data,
                    }
            return parts
        if _is_microsoft_account(email):
            from backend.services.microsoft_mail_service import microsoft_get_inline_parts

            return await asyncio.to_thread(microsoft_get_inline_parts, email, message_id, wanted)

    # IMAP path
    from backend.services.hybrid_mail_service import _imap_pool_invalidate, _imap_pool_release

    raw_bytes, imap = await _imap_fetch_raw(email, message_id, folder)
    if not raw_bytes:
        if imap:
            _imap_pool_release(email)
        return None
    try:
        return extract_inline_parts_from_mime(raw_bytes, wanted)
    except Exception:
        _imap_pool_invalidate(email)
        raise
    finally:
        _imap_pool_release(email)


async def _embed_quoted_cid_images(
    email: str,
    body: str,
    inline_images: list[InlineImage],
    source_message_id: Optional[str] | None = None,
    source_folder: str = "INBOX",
    *,
    collector: Any = _collect_original_inline_parts,
) -> str:
    """Embeds the quoted images of a received message as parts of its own.

    The quotedHtml of a reply/forward references the inline images of the
    quoted email as ``src="/api/mail/messages/{id}/cid/{cid}?email=..&folder=.."``
    (self-contained URL that the composer can display; it also arrives this way
    from a draft resumed via /send) or, in bodies generated outside the viewer, as
    raw ``src="cid:..."`` — this fallback needs ``source_message_id``.
    In the outgoing message neither form has a MIME part nor resolves outside
    Gnosi: the original's bytes are retrieved, added to
    ``inline_images`` (in place) with a new Content-ID, and the body is rewritten.
    Unrecoverable references are left untouched and sending is never
    blocked.

    """
    api_refs = find_mail_cid_refs(body)
    own_cids = {img["content_id"].strip("<>") for img in inline_images}
    residual = (
        {c for c in find_cid_srcs(body) if c.strip("<>") not in own_cids}
        if source_message_id
        else set()
    )
    if not api_refs and not residual:
        return body

    # A single fetch per source message (the email/folder from the URL dictate:
    # the quoted message may be from a different account/folder than the sending one).
    groups: dict[tuple[str, str, str], set[str]] = {}
    for ref in api_refs:
        key = (
            ref["email"] or email,
            ref["message_id"],
            ref["folder"] or source_folder,
        )
        groups.setdefault(key, set()).add(ref["cid"])
    source_message_key: tuple[str, str, str] | None = None
    if residual:
        source_message_key = (email, cast(str, source_message_id), source_folder)
        groups.setdefault(source_message_key, set()).update(residual)

    parts_by_key: dict[tuple[str, str, str], dict[str, MimeAsset]] = {}
    for (src_email, src_mid, src_folder), cids in groups.items():
        try:
            parts = await collector(src_email, src_mid, cids, src_folder)
        except Exception as e:
            log.warning(
                "Quoted images from %s could not be retrieved and will remain unchanged: %s",
                src_mid,
                e,
            )
            parts = {}
        if parts is None:
            log.warning(
                "Quoted images from %s remain unchanged because the original message was not found",
                src_mid,
            )
            parts = {}
        parts_by_key[(src_email, src_mid, src_folder)] = cast(dict[str, MimeAsset], parts)

    def _attach(key: tuple[str, str, str], cid: str) -> str | None:
        part = parts_by_key[key].get(cid.strip("<>"))
        if not part:
            log.warning("Quoted image has no matching part in original message %s: %r", key[1], cid)
            return None
        new_cid = new_content_id()
        inline_images.append(
            {
                "filename": part.get("filename", "image"),
                "content_type": part.get("content_type", "application/octet-stream"),
                "data": part["data"],
                "content_id": new_cid,
            }
        )
        return new_cid

    url_mapping = {}
    for ref in api_refs:
        key = (
            ref["email"] or email,
            ref["message_id"],
            ref["folder"] or source_folder,
        )
        new_cid = _attach(key, ref["cid"])
        if new_cid:
            url_mapping[ref["url"]] = new_cid
    cid_mapping = {}
    if source_message_key is not None:
        for old_cid in residual:
            new_cid = _attach(source_message_key, old_cid)
            if new_cid:
                cid_mapping[old_cid] = new_cid

    body = rewrite_mail_cid_srcs(body, url_mapping)
    return rewrite_cid_srcs(body, cid_mapping)
