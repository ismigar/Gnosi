"""Mail, calendar and contacts read adapters."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine, Iterable
from typing import Any, TypeVar

from backend.domains.agent.sources.mail import _mail_read as _mail_read, _mail_search as _mail_search
from backend.domains.agent.sources.scopes import (
    MAX_EXCERPT_CHARS,
    MAX_RECORD_CHARS,
    _plain_text,
)

_T = TypeVar("_T")


def _run_async(coroutine: Coroutine[Any, Any, _T]) -> _T:
    """Run an async provider helper from a synchronous LangChain tool."""
    return asyncio.run(coroutine)


def _allowed_accounts(
    requested: Iterable[str],
    *,
    calendar: bool = False,
) -> list[str]:
    """Resolve the legacy account seam lazily for compatibility tests."""
    from backend.agent import internal_sources

    return internal_sources._allowed_accounts(requested, calendar=calendar)


def _workspace_id() -> str:
    """Resolve the request-scoped workspace through the legacy seam."""
    from backend.agent import internal_sources

    return internal_sources._workspace_id()


def _calendar_rows(scope: dict[str, Any], query_text: str) -> list[dict[str, Any]]:
    from backend.api.calendar_routes import collect_all_events

    accounts = _allowed_accounts(scope["accounts"], calendar=True)
    calendar_ids = scope["calendar_ids"] or [None]
    rows: list[dict[str, Any]] = []
    account_values: list[str | None]
    if accounts:
        account_values = list(accounts)
    else:
        account_values = [None]
    for account in account_values:
        for calendar_id in calendar_ids:
            events = collect_all_events(
                scope["date_from"],
                scope["date_to"],
                str(query_text or "").strip() or None,
                calendar_id,
                scope["include_vault"],
                account,
            )
            for event in events:
                provider_event_id = str(event.get("id") or "")
                if not provider_event_id:
                    continue
                provider = str(event.get("provider") or "")
                event_account = str(event.get("account") or account or "")
                if provider == "vault":
                    event_account = ""
                event_calendar_id = str(event.get("calendar_id") or calendar_id or "")
                record_id = f"{event_account}::{event_calendar_id}::{provider_event_id}"
                rows.append(
                    {
                        "id": record_id,
                        "event_id": provider_event_id,
                        "account": event_account or None,
                        "title": str(event.get("title") or event.get("summary") or "")[:500],
                        "start": event.get("start"),
                        "end": event.get("end"),
                        "calendar_id": event_calendar_id or None,
                        "location": str(event.get("location") or "")[:500],
                        "description": _plain_text(
                            event.get("description") or "", MAX_EXCERPT_CHARS
                        ),
                    }
                )
    unique = {row["id"]: row for row in rows}
    return sorted(unique.values(), key=lambda row: str(row.get("start") or ""))


def _calendar_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    rows = _calendar_rows(scope, query_text)
    return {"source": "calendar", "records": rows[: scope["limit"]]}


def _contacts_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        service = ContactsService(db, _workspace_id())
        rows = []
        source_filters = scope["sources"] or [None]
        type_filters = scope["types"] or [None]
        for source in source_filters:
            for contact_type in type_filters:
                for contact in service.list_contacts(
                    contact_type,
                    str(query_text or "").strip() or None,
                    source,
                ):
                    rows.append(
                        {
                            "id": str(contact.id),
                            "name": str(contact.name or "")[:500],
                            "email": str(contact.email or "")[:500],
                            "phone": str(contact.phone or "")[:100],
                            "company": str(contact.company or "")[:500],
                            "job_title": str(contact.job_title or "")[:500],
                            "source": str(contact.source or ""),
                            "type": str(contact.type or ""),
                        }
                    )
        unique = {row["id"]: row for row in rows}
        return {"source": "contacts", "records": list(unique.values())[: scope["limit"]]}
    finally:
        db.close()


def _contacts_read(scope: dict[str, Any], record_id: str) -> dict[str, Any]:
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        contact = ContactsService(db, _workspace_id()).get_contact(record_id)
        if not contact:
            raise KeyError(record_id)
        if scope["sources"] and str(contact.source or "").lower() not in scope["sources"]:
            raise PermissionError("The contact is outside this source scope.")
        if scope["types"] and str(contact.type or "").lower() not in scope["types"]:
            raise PermissionError("The contact is outside this source scope.")
        return {
            "id": str(contact.id),
            "name": str(contact.name or "")[:500],
            "email": str(contact.email or "")[:500],
            "phone": str(contact.phone or "")[:100],
            "company": str(contact.company or "")[:500],
            "job_title": str(contact.job_title or "")[:500],
            "address": str(contact.address or "")[:1_000],
            "notes": _plain_text(contact.notes or "", MAX_RECORD_CHARS),
            "source": str(contact.source or ""),
            "type": str(contact.type or ""),
        }
    finally:
        db.close()
