"""Stable persistence identities for mail-tag associations."""

from __future__ import annotations

from dataclasses import dataclass
import json


@dataclass(frozen=True)
class ResolvedMailTagIdentity:
    """Normalized scope persisted alongside one mail-tag association."""

    key: str
    account_email: str
    provider: str
    folder: str
    provider_uid: str


def _normalized(value: str | None) -> str:
    return (value or "").strip().lower()


def legacy_mail_tag_identity(
    message_id: str,
    account_email: str | None = "",
) -> str:
    """Namespace an incomplete historical association without inventing scope."""
    return json.dumps(
        ["legacy-tag", _normalized(account_email), message_id],
        ensure_ascii=True,
        separators=(",", ":"),
    )


def scoped_mail_tag_identity(
    message_id: str,
    *,
    account_email: str,
    source: str,
    imap_folder: str | None = None,
    imap_uid: str | None = None,
) -> ResolvedMailTagIdentity:
    """Build the same composite message identity used by the frontend."""
    account = _normalized(account_email)
    provider = _normalized(source)
    if not account or not provider or not message_id:
        raise ValueError("account_email, source and message_id are required")

    folder = ""
    provider_uid = message_id
    if provider == "imap":
        folder = (imap_folder or "").strip()
        provider_uid = (imap_uid or "").strip()
        if not folder or not provider_uid:
            raise ValueError("IMAP tag identity requires imap_folder and imap_uid")

    key = json.dumps(
        ["message", account, provider, folder, provider_uid],
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return ResolvedMailTagIdentity(
        key=key,
        account_email=account,
        provider=provider,
        folder=folder,
        provider_uid=provider_uid,
    )
