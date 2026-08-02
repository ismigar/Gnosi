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
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import func, or_

from backend.config.logger_config import get_logger


log = get_logger(__name__)

INTERNAL_SOURCE_IDS = frozenset({
    "reader",
    "mail",
    "calendar",
    "contacts",
    "planning",
    "references",
    "social",
    "meetings",
    "notion",
})
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
    if source_id == "planning":
        entity_types = _bounded_strings(scope.get("entity_types"), lower=True)
        allowed_types = {
            "project", "task", "resource", "assignment", "calendar", "recurrence"
        }
        return {
            "entity_types": [value for value in entity_types if value in allowed_types],
            "project_ids": _bounded_strings(scope.get("project_ids")),
            "resource_ids": _bounded_strings(scope.get("resource_ids")),
            "include_inactive": bool(scope.get("include_inactive", False)),
            "limit": limit,
        }
    if source_id == "references":
        return {
            "item_types": _bounded_strings(scope.get("item_types"), lower=True),
            "languages": _bounded_strings(scope.get("languages"), lower=True),
            "limit": limit,
        }
    if source_id == "social":
        return {
            "networks": _bounded_strings(scope.get("networks"), lower=True),
            "statuses": _bounded_strings(scope.get("statuses"), lower=True),
            "limit": limit,
        }
    if source_id == "meetings":
        return {
            "date_from": _iso_datetime(scope.get("date_from")),
            "date_to": _iso_datetime(scope.get("date_to")),
            "limit": limit,
        }
    if source_id == "notion":
        object_types = _bounded_strings(scope.get("object_types"), lower=True)
        return {
            "object_types": [
                value for value in object_types if value in {"database", "page"}
            ],
            "database_ids": _bounded_strings(scope.get("database_ids")),
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


def _planning_snapshot() -> Dict[str, Any]:
    """Load authoritative planning state and rebuildable schedule for one Vault."""
    from backend.services.context_vars import get_active_vault_path
    from backend.services.planning_engine import ScheduleIndex
    from backend.services.project_planning import PlanningStore, calculate_allocation

    vault_path = Path(get_active_vault_path()).resolve()
    state = PlanningStore(vault_path / ".gnosi").load()
    schedule = ScheduleIndex(vault_path).load() or {"projects": {}}
    return {
        "state": state,
        "schedule": schedule,
        "allocation": calculate_allocation(state),
    }


def _planning_records(scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    snapshot = _planning_snapshot()
    state = snapshot["state"]
    projects = (snapshot["schedule"].get("projects") or {})
    entity_types = set(scope["entity_types"] or [
        "project", "task", "resource", "assignment", "calendar", "recurrence"
    ])
    project_ids = set(scope["project_ids"])
    resource_ids = set(scope["resource_ids"])
    rows: List[Dict[str, Any]] = []

    if "project" in entity_types:
        for project_id, project in projects.items():
            if project_ids and str(project_id) not in project_ids:
                continue
            rows.append({
                "id": f"project|{project_id}",
                "entity_type": "project",
                "project_id": str(project_id),
                "title": str(project.get("title") or project_id)[:500],
                "schedule_revision": project.get("scheduleRevision"),
                "diagnostics": list(project.get("diagnostics") or [])[:20],
                "critical_task_ids": list(project.get("criticalTaskIds") or [])[:100],
            })
    if "task" in entity_types:
        for project_id, project in projects.items():
            if project_ids and str(project_id) not in project_ids:
                continue
            for task in project.get("tasks") or []:
                task_id = str(task.get("id") or "")
                if not task_id:
                    continue
                rows.append({
                    "id": f"task|{project_id}|{task_id}",
                    "entity_type": "task",
                    "project_id": str(project_id),
                    "task_id": task_id,
                    "title": str(task.get("title") or task_id)[:500],
                    "start": task.get("start"),
                    "end": task.get("end"),
                    "percent_complete": task.get("percentComplete"),
                    "critical": task_id in set(project.get("criticalTaskIds") or []),
                    "source_etag": task.get("sourceEtag"),
                })
    if "resource" in entity_types:
        for resource in state.get("resources") or []:
            resource_id = str(resource.get("id") or "")
            if resource_ids and resource_id not in resource_ids:
                continue
            if not scope["include_inactive"] and resource.get("active") is False:
                continue
            rows.append({
                **resource,
                "id": f"resource|{resource_id}",
                "entity_type": "resource",
                "rate_history": list(resource.get("rate_history") or [])[:50],
            })
    if "assignment" in entity_types:
        for assignment in state.get("assignments") or []:
            if project_ids and str(assignment.get("project_id") or "") not in project_ids:
                continue
            if resource_ids and str(assignment.get("resource_id") or "") not in resource_ids:
                continue
            rows.append({
                **assignment,
                "id": f"assignment|{assignment.get('id')}",
                "entity_type": "assignment",
            })
    if "calendar" in entity_types:
        rows.extend({
            **calendar,
            "id": f"calendar|{calendar.get('id')}",
            "entity_type": "calendar",
        } for calendar in state.get("calendars") or [])
    if "recurrence" in entity_types:
        rows.extend({
            **recurrence,
            "id": f"recurrence|{recurrence.get('id')}",
            "entity_type": "recurrence",
        } for recurrence in state.get("recurrences") or [])
    return rows


def _planning_inventory(scope: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = _planning_snapshot()
    records = _planning_records(scope)
    counts: Dict[str, int] = {}
    for record in records:
        kind = str(record.get("entity_type") or "unknown")
        counts[kind] = counts.get(kind, 0) + 1
    allocation = snapshot["allocation"]
    return {
        "source": "planning",
        "count": len(records),
        "counts": counts,
        "revision": snapshot["state"].get("revision", 0),
        "warning_count": len(allocation.get("warnings") or []),
        "total_estimated_cost": allocation.get("total_estimated_cost", 0),
        "scope": scope,
    }


def _planning_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = _planning_records(scope)
    if term:
        records = [
            record for record in records
            if term in json.dumps(record, ensure_ascii=False, default=str).casefold()
        ]
    return {"source": "planning", "query": term, "records": records[:scope["limit"]]}


def _planning_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
    record = next(
        (row for row in _planning_records(scope) if row.get("id") == str(record_id)),
        None,
    )
    if record is None:
        raise KeyError(record_id)
    return record


def _reference_table() -> Optional[Dict[str, Any]]:
    """Resolve the deliberately configured References table in this Vault."""
    from backend.api.vault_routes import load_registry
    from backend.services.reference_table_config import (
        CONFIG_PATH,
        DEFAULT_CONFIG,
        load_json,
    )

    config = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
    table_id = str(config.get("target_table") or "").strip()
    if not table_id:
        return None
    return next(
        (
            table for table in (load_registry().get("tables") or [])
            if str(table.get("id") or "") == table_id
        ),
        None,
    )


def _metadata_value(metadata: Dict[str, Any], *names: str) -> Any:
    wanted = {name.casefold().replace(" ", "").replace("_", "") for name in names}
    for key, value in (metadata or {}).items():
        normalized = str(key).casefold().replace(" ", "").replace("_", "")
        if normalized in wanted:
            return value
    return None


def _reference_page_body(page: Any) -> str:
    from backend.services.context_vars import get_active_vault_path

    root = Path(get_active_vault_path()).resolve()
    path_value = getattr(page, "path", None)
    if not path_value:
        return ""
    path = Path(path_value).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise PermissionError("Reference record path is outside the active Vault.") from error
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    return raw.split("---", 2)[2] if raw.startswith("---") else raw


def _reference_payload(page: Any, *, include_body: bool = False) -> Dict[str, Any]:
    metadata = dict(getattr(page, "metadata", {}) or {})
    payload = {
        "id": str(getattr(page, "id", "") or ""),
        "title": str(getattr(page, "title", "") or "")[:1_000],
        "citation_key": str(_metadata_value(metadata, "Citation Key") or "")[:500],
        "authors": _metadata_value(metadata, "Authors", "Author"),
        "item_type": str(_metadata_value(metadata, "Item Type", "Type") or "")[:200],
        "year": _metadata_value(metadata, "Year", "Date", "Any"),
        "language": str(_metadata_value(metadata, "Language", "Idioma") or "")[:100],
        "doi": str(_metadata_value(metadata, "DOI") or "")[:500],
        "url": str(_metadata_value(metadata, "URL") or "")[:2_000],
        "abstract": _plain_text(
            _metadata_value(metadata, "Abstract", "Summary", "Resum") or "",
            MAX_EXCERPT_CHARS,
        ),
    }
    if include_body:
        payload["body"] = _plain_text(_reference_page_body(page), MAX_RECORD_CHARS)
        payload["metadata"] = {
            str(key): _bounded_json_value(value)
            for key, value in metadata.items()
            if not str(key).startswith("_")
        }
    return payload


def _bounded_json_value(value: Any, depth: int = 0) -> Any:
    if depth >= 4:
        return str(value)[:500]
    if isinstance(value, dict):
        return {
            str(key)[:200]: _bounded_json_value(item, depth + 1)
            for key, item in list(value.items())[:50]
        }
    if isinstance(value, list):
        return [_bounded_json_value(item, depth + 1) for item in value[:50]]
    if isinstance(value, str):
        return value[:2_000]
    return value


def _reference_pages(scope: Dict[str, Any]) -> List[Any]:
    from backend.api.vault_routes import _get_pages_for_table

    table = _reference_table()
    if not table:
        return []
    pages = _get_pages_for_table(str(table["id"]))
    output = []
    for page in pages:
        metadata = dict(getattr(page, "metadata", {}) or {})
        item_type = str(_metadata_value(metadata, "Item Type", "Type") or "").casefold()
        language = str(_metadata_value(metadata, "Language", "Idioma") or "").casefold()
        if scope["item_types"] and item_type not in scope["item_types"]:
            continue
        if scope["languages"] and language not in scope["languages"]:
            continue
        output.append(page)
    return output


def _references_inventory(scope: Dict[str, Any]) -> Dict[str, Any]:
    table = _reference_table()
    pages = _reference_pages(scope)
    counts: Dict[str, int] = {}
    for page in pages:
        item_type = _reference_payload(page).get("item_type") or "Unspecified"
        counts[str(item_type)] = counts.get(str(item_type), 0) + 1
    return {
        "source": "references",
        "configured": table is not None,
        "table_id": str((table or {}).get("id") or ""),
        "count": len(pages),
        "item_types": counts,
        "scope": scope,
    }


def _references_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = [_reference_payload(page) for page in _reference_pages(scope)]
    if term:
        records = [
            record for record in records
            if term in json.dumps(record, ensure_ascii=False, default=str).casefold()
        ]
    return {"source": "references", "query": term, "records": records[:scope["limit"]]}


def _references_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
    page = next(
        (page for page in _reference_pages(scope) if str(getattr(page, "id", "")) == str(record_id)),
        None,
    )
    if page is None:
        raise KeyError(record_id)
    return _reference_payload(page, include_body=True)


def _social_records(scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    from backend.services import social_store

    _assert_personal_workspace()
    publications = _run_async(social_store.list_publications())
    records = []
    for publication in publications:
        networks = [
            item.strip().lower()
            for item in str(publication.get(social_store.COL_NETWORKS) or "").split(",")
            if item.strip()
        ]
        status = str(publication.get(social_store.COL_STATUS) or "").lower()
        if scope["networks"] and not set(networks).intersection(scope["networks"]):
            continue
        if scope["statuses"] and status not in scope["statuses"]:
            continue
        try:
            messages = json.loads(publication.get(social_store.COL_MESSAGES) or "{}")
        except (TypeError, ValueError):
            messages = {}
        records.append({
            "id": str(publication.get("id") or ""),
            "title": str(publication.get("title") or "")[:500],
            "status": status,
            "networks": networks,
            "scheduled_at": str(publication.get(social_store.COL_SCHEDULED) or "")[:100],
            "published_at": str(publication.get(social_store.COL_PUBLISHED) or "")[:100],
            "source_page_id": str(publication.get(social_store.COL_ORIGIN) or "")[:200],
            "messages": {
                str(network)[:50]: {
                    "text": _plain_text((value or {}).get("text") or "", MAX_EXCERPT_CHARS),
                    "status": str((value or {}).get("status") or "")[:100],
                    "url": str((value or {}).get("url") or "")[:2_000],
                }
                for network, value in list(messages.items())[:20]
                if isinstance(value, dict)
            },
        })
    return records


def _social_inventory(scope: Dict[str, Any]) -> Dict[str, Any]:
    records = _social_records(scope)
    statuses: Dict[str, int] = {}
    for record in records:
        statuses[record["status"]] = statuses.get(record["status"], 0) + 1
    return {"source": "social", "count": len(records), "statuses": statuses, "scope": scope}


def _social_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = _social_records(scope)
    if term:
        records = [
            record for record in records
            if term in json.dumps(record, ensure_ascii=False).casefold()
        ]
    return {"source": "social", "query": term, "records": records[:scope["limit"]]}


def _social_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
    record = next(
        (item for item in _social_records(scope) if item["id"] == str(record_id)), None
    )
    if record is None:
        raise KeyError(record_id)
    return record


def _meeting_pages(scope: Dict[str, Any]) -> List[Any]:
    from backend.api.vault_routes import _get_pages_snapshot

    start = scope.get("date_from") or ""
    end = scope.get("date_to") or ""
    pages = []
    for page in _get_pages_snapshot():
        metadata = dict(getattr(page, "metadata", {}) or {})
        title = str(getattr(page, "title", "") or metadata.get("title") or "")
        if metadata.get("icon") != "🎙️" and not title.startswith(("Acta —", "Minutes —")):
            continue
        modified = str(
            metadata.get("date") or metadata.get("created_at")
            or getattr(page, "modified", "") or ""
        )
        normalized = _iso_datetime(modified)
        if start and normalized and normalized < start:
            continue
        if end and normalized and normalized > end:
            continue
        pages.append(page)
    return pages


def _meeting_payload(page: Any, *, include_body: bool = False) -> Dict[str, Any]:
    payload = {
        "id": str(getattr(page, "id", "") or ""),
        "title": str(getattr(page, "title", "") or "")[:1_000],
        "modified": str(getattr(page, "modified", "") or "")[:100],
    }
    if include_body:
        payload["body"] = _plain_text(_reference_page_body(page), MAX_RECORD_CHARS)
    return payload


def _meetings_inventory(scope: Dict[str, Any]) -> Dict[str, Any]:
    pages = _meeting_pages(scope)
    return {"source": "meetings", "count": len(pages), "scope": scope}


def _meetings_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = [_meeting_payload(page) for page in _meeting_pages(scope)]
    if term:
        records = [item for item in records if term in item["title"].casefold()]
    return {"source": "meetings", "query": term, "records": records[:scope["limit"]]}


def _meetings_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
    page = next(
        (item for item in _meeting_pages(scope) if str(getattr(item, "id", "")) == str(record_id)),
        None,
    )
    if page is None:
        raise KeyError(record_id)
    return _meeting_payload(page, include_body=True)


def _notion_client():
    from backend.api.notion_routes import _get_token
    from backend.services.notion_importer import NotionClient

    _assert_personal_workspace()
    token = _get_token()
    if not token:
        raise PermissionError("Notion is not connected.")
    return NotionClient(token)


def _notion_records(scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    from backend.services.notion_importer import _plain_title

    client = _notion_client()
    types = set(scope["object_types"] or ["database", "page"])
    records = []
    if "database" in types:
        for database in client.search_databases():
            database_id = str(database.get("id") or "")
            if scope["database_ids"] and database_id not in scope["database_ids"]:
                continue
            records.append({
                "id": f"database::{database_id}",
                "object_type": "database",
                "notion_id": database_id,
                "title": _plain_title(database.get("title")) or "Untitled",
                "url": str(database.get("url") or "")[:2_000],
            })
    if "page" in types:
        for page in client.search_pages():
            page_id = str(page.get("id") or "")
            parent = page.get("parent") or {}
            database_id = str(parent.get("database_id") or "")
            if scope["database_ids"] and database_id not in scope["database_ids"]:
                continue
            title = ""
            for prop in (page.get("properties") or {}).values():
                if prop.get("type") == "title":
                    title = _plain_title(prop.get("title"))
                    break
            records.append({
                "id": f"page::{page_id}",
                "object_type": "page",
                "notion_id": page_id,
                "database_id": database_id or None,
                "title": title or "Untitled",
                "url": str(page.get("url") or "")[:2_000],
                "last_edited_time": str(page.get("last_edited_time") or "")[:100],
            })
    return records


def _notion_inventory(scope: Dict[str, Any]) -> Dict[str, Any]:
    records = _notion_records(scope)
    return {
        "source": "notion",
        "count": len(records),
        "counts": {
            kind: sum(1 for item in records if item["object_type"] == kind)
            for kind in ("database", "page")
        },
        "scope": scope,
    }


def _notion_search(scope: Dict[str, Any], query_text: str) -> Dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = _notion_records(scope)
    if term:
        records = [item for item in records if term in item["title"].casefold()]
    return {"source": "notion", "query": term, "records": records[:scope["limit"]]}


def _notion_read(scope: Dict[str, Any], record_id: str) -> Dict[str, Any]:
    from backend.services.notion_importer import blocks_to_md, map_database_schema, page_to_values

    record = next(
        (item for item in _notion_records(scope) if item["id"] == str(record_id)), None
    )
    if record is None:
        raise KeyError(record_id)
    client = _notion_client()
    if record["object_type"] == "database":
        database = client.get_database(record["notion_id"])
        record["schema"] = _bounded_json_value(map_database_schema(database))
    else:
        page = client.get_page(record["notion_id"])
        record["properties"] = _bounded_json_value(page_to_values(page))
        record["body"] = blocks_to_md(
            client.get_block_children(record["notion_id"])
        )[:MAX_RECORD_CHARS]
    return record


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
    elif source_id == "planning":
        payload = _planning_inventory(scope)
    elif source_id == "references":
        payload = _references_inventory(scope)
    elif source_id == "social":
        payload = _social_inventory(scope)
    elif source_id == "meetings":
        payload = _meetings_inventory(scope)
    elif source_id == "notion":
        payload = _notion_inventory(scope)
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
    elif source_id == "planning":
        payload = _planning_search(scope, query)
    elif source_id == "references":
        payload = _references_search(scope, query)
    elif source_id == "social":
        payload = _social_search(scope, query)
    elif source_id == "meetings":
        payload = _meetings_search(scope, query)
    elif source_id == "notion":
        payload = _notion_search(scope, query)
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
    elif source_id == "planning":
        payload = _planning_read(scope, record_id)
    elif source_id == "references":
        payload = _references_read(scope, record_id)
    elif source_id == "social":
        payload = _social_read(scope, record_id)
    elif source_id == "meetings":
        payload = _meetings_read(scope, record_id)
    elif source_id == "notion":
        payload = _notion_read(scope, record_id)
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
        {
            "id": "planning",
            "name": "Planning",
            "description": "Vault projects, tasks, resources, assignments, and schedules.",
            "scope": {
                "entity_types": [],
                "project_ids": [],
                "resource_ids": [],
                "include_inactive": False,
            },
            "options": {
                "entity_types": [
                    "project", "task", "resource", "assignment", "calendar", "recurrence"
                ],
                "projects": [],
                "resources": [],
            },
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
    try:
        planning = _planning_snapshot()
        projects = (planning["schedule"].get("projects") or {})
        descriptors[4]["options"]["projects"] = [
            {
                "id": str(project_id),
                "name": str(project.get("title") or project_id),
            }
            for project_id, project in projects.items()
        ]
        descriptors[4]["options"]["resources"] = [
            {"id": str(resource.get("id")), "name": str(resource.get("name") or "")}
            for resource in planning["state"].get("resources") or []
            if resource.get("id")
        ]
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build Planning source options: %s", error)
    try:
        table = _reference_table()
        if table:
            reference_scope = normalize_internal_scope("references", {})
            reference_pages = _reference_pages(reference_scope)
            descriptors.append({
                "id": "references",
                "name": "References",
                "description": "Configured bibliographic references and exact evidence records.",
                "scope": {"item_types": [], "languages": []},
                "options": {
                    "item_types": sorted({
                        str(_reference_payload(page).get("item_type") or "")
                        for page in reference_pages
                        if _reference_payload(page).get("item_type")
                    }),
                    "languages": sorted({
                        str(_reference_payload(page).get("language") or "")
                        for page in reference_pages
                        if _reference_payload(page).get("language")
                    }),
                },
            })
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build References source options: %s", error)
    try:
        meeting_scope = normalize_internal_scope("meetings", {})
        if _meeting_pages(meeting_scope):
            descriptors.append({
                "id": "meetings",
                "name": "Meetings",
                "description": "Recorded meeting minutes and exact transcripts in this Vault.",
                "scope": {"date_from": "", "date_to": ""},
                "options": {},
            })
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build Meetings source options: %s", error)
    if workspace_id == "personal":
        descriptors[1]["options"]["accounts"] = _configured_accounts()
        descriptors[2]["options"]["accounts"] = _configured_accounts(calendar=True)
        try:
            from backend.api.notion_routes import _get_token
            from backend.services.notion_importer import _plain_title

            if _get_token():
                databases = _notion_client().search_databases()
                descriptors.append({
                    "id": "notion",
                    "name": "Notion",
                    "description": "Pages and databases shared with the connected Notion integration.",
                    "scope": {"object_types": [], "database_ids": []},
                    "options": {
                        "object_types": ["database", "page"],
                        "databases": [
                            {
                                "id": str(item.get("id") or ""),
                                "name": _plain_title(item.get("title")) or "Untitled",
                            }
                            for item in databases[:100]
                        ],
                    },
                })
        except Exception as error:  # noqa: BLE001
            log.warning("Could not build Notion source options: %s", error)
        descriptors.append({
            "id": "social",
            "name": "Social",
            "description": "Saved drafts, scheduled posts, and publication history.",
            "scope": {"networks": [], "statuses": []},
            "options": {
                "networks": ["mastodon", "bluesky", "linkedin", "facebook", "telegram"],
                "statuses": [
                    "esborrany", "programada", "publicant", "publicada",
                    "parcial", "error", "cancelada",
                ],
            },
        })
    else:
        descriptors = [
            item for item in descriptors
            if item["id"] in {
                "reader", "contacts", "planning", "references", "meetings"
            }
        ]
    return descriptors
