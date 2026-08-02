"""Scoped read adapters for first-party Gnosi data modules.

Internal sources expose bounded inventory, search, and exact-read operations.
They never grant mutation rights: writes remain governed agent tools.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import func, or_

from backend.config.logger_config import get_logger


log = get_logger(__name__)

INTERNAL_SOURCE_IDS = frozenset({"reader", "mail", "calendar", "contacts"})
MAX_SCOPE_ITEMS = 50
MAX_RESULT_ITEMS = 50
DEFAULT_RESULT_ITEMS = 12
MAX_EXCERPT_CHARS = 1_200
MAX_RECORD_CHARS = 16_000
MAX_CALENDAR_DAYS = 366


def _bounded_strings(value: Any, *, lower: bool = False) -> List[str]:
    """Return a de-duplicated bounded list of short strings."""
    values = value if isinstance(value, list) else []
    output: List[str] = []
    seen = set()
    for item in values:
        text = str(item or "").strip()
        if not text or len(text) > 256:
            continue
        normalized = text.lower() if lower else text
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        output.append(normalized)
        if len(output) >= MAX_SCOPE_ITEMS:
            break
    return output


def _bounded_ints(value: Any) -> List[int]:
    """Return unique positive integer identifiers within the source ceiling."""
    output: List[int] = []
    seen = set()
    for item in value if isinstance(value, list) else []:
        try:
            identifier = int(item)
        except (TypeError, ValueError):
            continue
        if identifier <= 0 or identifier in seen:
            continue
        seen.add(identifier)
        output.append(identifier)
        if len(output) >= MAX_SCOPE_ITEMS:
            break
    return output


def _iso_datetime(value: Any) -> str:
    """Normalize an optional ISO timestamp and reject malformed values."""
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) > 64:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def normalize_internal_scope(source_id: str, raw_scope: Any) -> Dict[str, Any]:
    """Validate and normalize the configurable scope for one internal source."""
    source_id = str(source_id or "").strip().lower()
    if source_id not in INTERNAL_SOURCE_IDS:
        raise ValueError(f"Unknown internal source: {source_id}")
    scope = raw_scope if isinstance(raw_scope, dict) else {}
    limit = max(1, min(int(scope.get("limit") or DEFAULT_RESULT_ITEMS), MAX_RESULT_ITEMS))

    if source_id == "reader":
        return {
            "unread_only": bool(scope.get("unread_only", True)),
            "source_ids": _bounded_ints(scope.get("source_ids")),
            "categories": _bounded_strings(scope.get("categories")),
            "date_from": _iso_datetime(scope.get("date_from")),
            "date_to": _iso_datetime(scope.get("date_to")),
            "include_full_content": bool(scope.get("include_full_content", False)),
            "limit": limit,
        }
    if source_id == "mail":
        return {
            "accounts": _bounded_strings(scope.get("accounts"), lower=True),
            "folder": str(scope.get("folder") or "INBOX").strip()[:128] or "INBOX",
            "limit": limit,
        }
    if source_id == "calendar":
        now = datetime.now(timezone.utc)
        date_from = _iso_datetime(scope.get("date_from")) or (
            now - timedelta(days=30)
        ).isoformat()
        date_to = _iso_datetime(scope.get("date_to")) or (
            now + timedelta(days=90)
        ).isoformat()
        start = datetime.fromisoformat(date_from)
        end = datetime.fromisoformat(date_to)
        if end <= start:
            end = start + timedelta(days=1)
        if end - start > timedelta(days=MAX_CALENDAR_DAYS):
            end = start + timedelta(days=MAX_CALENDAR_DAYS)
        return {
            "accounts": _bounded_strings(scope.get("accounts"), lower=True),
            "calendar_ids": _bounded_strings(scope.get("calendar_ids")),
            "date_from": start.isoformat(),
            "date_to": end.isoformat(),
            "include_vault": bool(scope.get("include_vault", True)),
            "limit": limit,
        }
    return {
        "sources": _bounded_strings(scope.get("sources"), lower=True),
        "types": _bounded_strings(scope.get("types"), lower=True),
        "limit": limit,
    }


def _request_scope() -> Dict[str, str]:
    """Resolve the authenticated chat execution scope or fail closed."""
    from backend.agent.action_confirmations import current_confirmation_scope

    return current_confirmation_scope()


def _workspace_id() -> str:
    return _request_scope()["workspace_id"]


def _assert_personal_workspace() -> None:
    if _workspace_id() != "personal":
        raise PermissionError(
            "Installation-global integrations are unavailable outside the personal workspace."
        )


def _configured_accounts(*, calendar: bool = False) -> List[str]:
    """Return enabled, credential-free configured account identifiers."""
    from backend.services.integration_manager import integration_manager

    safe = integration_manager.get_all_safe()
    sections = ("calendars", "emails", "mail_accounts") if calendar else (
        "emails",
        "mail_accounts",
    )
    accounts: List[str] = []
    for section in sections:
        for item in safe.get(section, []) or []:
            if not isinstance(item, dict) or item.get("enabled", True) is False:
                continue
            account = str(item.get("email") or item.get("username") or "").strip().lower()
            if account and account not in accounts:
                accounts.append(account)
    return accounts


def _allowed_accounts(requested: Iterable[str], *, calendar: bool = False) -> List[str]:
    _assert_personal_workspace()
    configured = _configured_accounts(calendar=calendar)
    requested_values = [str(value).strip().lower() for value in requested if str(value).strip()]
    if not requested_values:
        return configured
    unknown = sorted(set(requested_values) - set(configured))
    if unknown:
        raise PermissionError("The requested integration account is unavailable.")
    return list(dict.fromkeys(requested_values))


def _reader_session():
    from backend.data.db import get_engine_for_path
    from backend.services.context_vars import get_active_vault_path

    _engine, session_factory = get_engine_for_path(get_active_vault_path())
    return session_factory()


def _apply_reader_scope(
    query,
    scope: Dict[str, Any],
    *,
    feed_source_joined: bool = False,
):
    from backend.models.reader import Article, FeedSource

    if scope["unread_only"]:
        query = query.filter(Article.is_read.is_(False))
    if scope["source_ids"]:
        query = query.filter(Article.source_id.in_(scope["source_ids"]))
    if scope["categories"]:
        if not feed_source_joined:
            query = query.join(FeedSource, Article.source_id == FeedSource.id)
        query = query.filter(FeedSource.category.in_(scope["categories"]))
    if scope["date_from"]:
        query = query.filter(Article.published_at >= datetime.fromisoformat(scope["date_from"]))
    if scope["date_to"]:
        query = query.filter(Article.published_at <= datetime.fromisoformat(scope["date_to"]))
    return query


_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


def _plain_text(value: Any, limit: int) -> str:
    text = unescape(_TAG_RE.sub(" ", str(value or "")))
    return _SPACE_RE.sub(" ", text).strip()[:limit]


def _article_payload(article: Any, *, full: bool = False) -> Dict[str, Any]:
    source = getattr(article, "source", None)
    body = article.full_content if full and article.full_content else article.content
    return {
        "id": str(article.id),
        "title": str(article.title or ""),
        "source_id": article.source_id,
        "source": str(getattr(source, "name", "") or ""),
        "category": str(getattr(source, "category", "") or ""),
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "is_read": bool(article.is_read),
        "url": str(article.url or ""),
        "content": _plain_text(body, MAX_RECORD_CHARS if full else MAX_EXCERPT_CHARS),
    }


def _reader_inventory(scope: Dict[str, Any]) -> Dict[str, Any]:
    from backend.models.reader import Article, FeedSource

    db = _reader_session()
    try:
        base = _apply_reader_scope(db.query(Article), scope)
        count = int(base.with_entities(func.count(Article.id)).scalar() or 0)
        oldest, newest = base.with_entities(
            func.min(Article.published_at), func.max(Article.published_at)
        ).one()
        breakdown_query = _apply_reader_scope(
            db.query(
                FeedSource.id,
                FeedSource.name,
                FeedSource.category,
                func.count(Article.id),
            ).join(Article, Article.source_id == FeedSource.id),
            scope,
            feed_source_joined=True,
        )
        sources = [
            {"id": row[0], "name": row[1], "category": row[2], "count": int(row[3])}
            for row in breakdown_query.group_by(
                FeedSource.id, FeedSource.name, FeedSource.category
            ).order_by(func.count(Article.id).desc()).limit(100)
        ]
        return {
            "source": "reader",
            "count": count,
            "oldest": oldest.isoformat() if oldest else None,
            "newest": newest.isoformat() if newest else None,
            "feeds": sources,
            "scope": scope,
        }
    finally:
        db.close()


def _reader_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    from sqlalchemy.orm import joinedload

    from backend.models.reader import Article

    db = _reader_session()
    try:
        query = db.query(Article).options(joinedload(Article.source))
        query = _apply_reader_scope(query, scope)
        term = str(query_text or "").strip()
        if term:
            pattern = f"%{term}%"
            query = query.filter(or_(
                Article.title.ilike(pattern),
                Article.content.ilike(pattern),
                Article.full_content.ilike(pattern),
            ))
        rows = query.order_by(Article.published_at.desc()).limit(scope["limit"]).all()
        return {
            "source": "reader",
            "query": term,
            "records": [
                _article_payload(row, full=scope["include_full_content"])
                for row in rows
            ],
        }
    finally:
        db.close()


def _reader_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
    from sqlalchemy.orm import joinedload

    from backend.models.reader import Article

    try:
        article_id = int(record_id)
    except (TypeError, ValueError) as error:
        raise ValueError("Invalid Reader article id.") from error
    db = _reader_session()
    try:
        query = db.query(Article).options(joinedload(Article.source)).filter(
            Article.id == article_id
        )
        article = _apply_reader_scope(query, scope).first()
        if not article:
            raise KeyError(record_id)
        return _article_payload(article, full=True)
    finally:
        db.close()


def _run_async(coroutine):
    """Run an async provider helper from a synchronous LangChain tool."""
    return asyncio.run(coroutine)


def _mail_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    from backend.api.mail_routes import get_messages

    accounts = _allowed_accounts(scope["accounts"])
    rows: List[Dict[str, Any]] = []
    for account in accounts:
        result = _run_async(get_messages(
            email=account,
            folder=scope["folder"],
            category=None,
            limit=scope["limit"],
            offset=0,
            page_token=None,
            search=str(query_text or "").strip(),
            force=False,
        ))
        for message in list(result.get("messages") or []):
            rows.append({
                "id": f"{account}::{message.get('id')}",
                "account": account,
                "subject": str(message.get("subject") or "")[:500],
                "sender": str(message.get("sender") or "")[:500],
                "date": str(message.get("date") or "")[:100],
                "preview": _plain_text(
                    message.get("body_text") or message.get("snippet") or "",
                    MAX_EXCERPT_CHARS,
                ),
            })
    rows.sort(key=lambda row: row.get("date") or "", reverse=True)
    return {"source": "mail", "records": rows[:scope["limit"]]}


def _mail_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
    from backend.api.mail_routes import get_message

    if "::" not in record_id:
        raise ValueError("Mail record ids must come from a previous search.")
    account, message_id = record_id.split("::", 1)
    if account not in _allowed_accounts(scope["accounts"]):
        raise PermissionError("The requested mail account is outside this source scope.")
    message = _run_async(get_message(message_id, email=account, folder=scope["folder"]))
    return {
        "id": record_id,
        "account": account,
        "subject": str(message.get("subject") or "")[:500],
        "sender": str(message.get("sender") or "")[:500],
        "recipient": str(message.get("recipient") or "")[:500],
        "date": str(message.get("date") or "")[:100],
        "body": _plain_text(message.get("body_text") or "", MAX_RECORD_CHARS),
    }


def _calendar_rows(scope: Dict[str, Any], query_text: str) -> List[Dict[str, Any]]:
    from backend.api.calendar_routes import collect_all_events

    accounts = _allowed_accounts(scope["accounts"], calendar=True)
    calendar_ids = scope["calendar_ids"] or [None]
    rows: List[Dict[str, Any]] = []
    account_values: List[Optional[str]] = accounts or [None]
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
                rows.append({
                    "id": record_id,
                    "event_id": provider_event_id,
                    "account": event_account or None,
                    "title": str(event.get("title") or event.get("summary") or "")[:500],
                    "start": event.get("start"),
                    "end": event.get("end"),
                    "calendar_id": event_calendar_id or None,
                    "location": str(event.get("location") or "")[:500],
                    "description": _plain_text(event.get("description") or "", MAX_EXCERPT_CHARS),
                })
    unique = {row["id"]: row for row in rows}
    return sorted(unique.values(), key=lambda row: str(row.get("start") or ""))


def _calendar_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    rows = _calendar_rows(scope, query_text)
    return {"source": "calendar", "records": rows[:scope["limit"]]}


def _contacts_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
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
                    rows.append({
                        "id": str(contact.id),
                        "name": str(contact.name or "")[:500],
                        "email": str(contact.email or "")[:500],
                        "phone": str(contact.phone or "")[:100],
                        "company": str(contact.company or "")[:500],
                        "job_title": str(contact.job_title or "")[:500],
                        "source": str(contact.source or ""),
                        "type": str(contact.type or ""),
                    })
        unique = {row["id"]: row for row in rows}
        return {"source": "contacts", "records": list(unique.values())[:scope["limit"]]}
    finally:
        db.close()


def _contacts_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
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


def describe_internal_source(source_id: str, raw_scope: Any) -> str:
    """Return a bounded inventory for a scoped internal source."""
    source_id = str(source_id or "").strip().lower()
    scope = normalize_internal_scope(source_id, raw_scope)
    if source_id == "reader":
        payload = _reader_inventory(scope)
    elif source_id == "mail":
        payload = {
            "source": "mail",
            "accounts": _allowed_accounts(scope["accounts"]),
            "folder": scope["folder"],
        }
    elif source_id == "calendar":
        payload = {
            "source": "calendar",
            "accounts": _allowed_accounts(scope["accounts"], calendar=True),
            "date_from": scope["date_from"],
            "date_to": scope["date_to"],
        }
    else:
        payload = _contacts_search(scope, "")
        payload["count"] = len(payload.pop("records", []))
    return json.dumps(payload, ensure_ascii=False, default=str)


def search_internal_source(source_id: str, raw_scope: Any, query: str) -> str:
    """Search one scoped internal source and return bounded JSON records."""
    source_id = str(source_id or "").strip().lower()
    scope = normalize_internal_scope(source_id, raw_scope)
    if source_id == "reader":
        payload = _reader_search(scope, query)
    elif source_id == "mail":
        payload = _mail_search(scope, query)
    elif source_id == "calendar":
        payload = _calendar_search(scope, query)
    else:
        payload = _contacts_search(scope, query)
    return json.dumps(payload, ensure_ascii=False, default=str)


def read_internal_record(source_id: str, raw_scope: Any, record_id: str) -> str:
    """Read one exact record that remains inside the configured source scope."""
    source_id = str(source_id or "").strip().lower()
    scope = normalize_internal_scope(source_id, raw_scope)
    if source_id == "reader":
        payload = _reader_read(scope, record_id)
    elif source_id == "mail":
        payload = _mail_read(scope, record_id)
    elif source_id == "calendar":
        rows = _calendar_rows(scope, "")
        payload = next(
            (row for row in rows if str(row.get("id")) == str(record_id)),
            None,
        )
        if payload is None:
            raise KeyError(record_id)
    else:
        payload = _contacts_read(scope, record_id)
    return json.dumps(payload, ensure_ascii=False, default=str)


def internal_source_catalog(workspace_id: str) -> List[Dict[str, Any]]:
    """Return source descriptors and safe scope options for Settings."""
    descriptors: List[Dict[str, Any]] = [
        {
            "id": "reader",
            "name": "Reader",
            "description": "Unread and historical feed or newsletter articles.",
            "scope": {
                "unread_only": True,
                "source_ids": [],
                "categories": [],
                "date_from": "",
                "date_to": "",
                "include_full_content": False,
            },
            "options": {"sources": [], "categories": []},
        },
        {
            "id": "mail",
            "name": "Mail",
            "description": "Bounded headers, previews, and exact messages.",
            "scope": {"accounts": [], "folder": "INBOX"},
            "options": {"accounts": []},
        },
        {
            "id": "calendar",
            "name": "Calendars",
            "description": "Events inside a bounded time range.",
            "scope": {"accounts": [], "calendar_ids": [], "include_vault": True},
            "options": {"accounts": []},
        },
        {
            "id": "contacts",
            "name": "Contacts",
            "description": "Workspace contacts with optional source and type filters.",
            "scope": {"sources": [], "types": []},
            "options": {"sources": ["local", "google", "apple"], "types": ["personal", "b2b"]},
        },
    ]
    try:
        db = _reader_session()
        try:
            from backend.models.reader import FeedSource

            feeds = db.query(FeedSource).order_by(FeedSource.name).all()
            descriptors[0]["options"]["sources"] = [
                {"id": feed.id, "name": feed.name, "category": feed.category}
                for feed in feeds
            ]
            descriptors[0]["options"]["categories"] = sorted({
                str(feed.category) for feed in feeds if feed.category
            })
        finally:
            db.close()
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build Reader source options: %s", error)
    if workspace_id == "personal":
        descriptors[1]["options"]["accounts"] = _configured_accounts()
        descriptors[2]["options"]["accounts"] = _configured_accounts(calendar=True)
    else:
        descriptors = [item for item in descriptors if item["id"] in {"reader", "contacts"}]
    return descriptors
