"""Normalization and containment for internal source scopes."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Any

from sqlalchemy import func

INTERNAL_SOURCE_IDS = frozenset(
    {
        "reader",
        "mail",
        "calendar",
        "contacts",
        "planning",
        "references",
        "social",
        "meetings",
        "notion",
    }
)


MAX_SCOPE_ITEMS = 50


MAX_RESULT_ITEMS = 50


DEFAULT_RESULT_ITEMS = 12


MAX_RESULT_OFFSET = 100_000


MAX_EXCERPT_CHARS = 1_200


MAX_RECORD_CHARS = 16_000


MAX_CALENDAR_DAYS = 366


READER_READ_STATUSES = frozenset({"all", "read", "unread"})


def _bounded_strings(value: Any, *, lower: bool = False) -> list[str]:
    """Return a de-duplicated bounded list of short strings."""
    values = value if isinstance(value, list) else []
    output: list[str] = []
    seen: set[str] = set()
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


def _bounded_ints(value: Any) -> list[int]:
    """Return unique positive integer identifiers within the source ceiling."""
    output: list[int] = []
    seen: set[int] = set()
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


def _reader_scope(scope: dict[str, Any], limit: int) -> dict[str, Any]:
    read_status = str(scope.get("read_status") or "").strip().lower()
    if read_status not in READER_READ_STATUSES:
        read_status = "unread" if bool(scope.get("unread_only", True)) else "all"
    try:
        offset = int(scope.get("offset") or 0)
    except (TypeError, ValueError):
        offset = 0
    return {
        "unread_only": read_status == "unread",
        "read_status": read_status,
        "source_ids": _bounded_ints(scope.get("source_ids")),
        "source_names": _bounded_strings(scope.get("source_names")),
        "categories": _bounded_strings(scope.get("categories")),
        "date_from": _iso_datetime(scope.get("date_from")),
        "date_to": _iso_datetime(scope.get("date_to")),
        "include_full_content": bool(scope.get("include_full_content", False)),
        "limit": limit,
        "offset": max(0, min(offset, MAX_RESULT_OFFSET)),
    }


def _calendar_scope(scope: dict[str, Any], limit: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    date_from = _iso_datetime(scope.get("date_from")) or (now - timedelta(days=30)).isoformat()
    date_to = _iso_datetime(scope.get("date_to")) or (now + timedelta(days=90)).isoformat()
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


def _planning_scope(scope: dict[str, Any], limit: int) -> dict[str, Any]:
    allowed_types = {"project", "task", "resource", "assignment", "calendar", "recurrence"}
    entity_types = _bounded_strings(scope.get("entity_types"), lower=True)
    return {
        "entity_types": [value for value in entity_types if value in allowed_types],
        "project_ids": _bounded_strings(scope.get("project_ids")),
        "resource_ids": _bounded_strings(scope.get("resource_ids")),
        "include_inactive": bool(scope.get("include_inactive", False)),
        "limit": limit,
    }


def _simple_scope(
    source_id: str,
    scope: dict[str, Any],
    limit: int,
) -> dict[str, Any]:
    if source_id == "mail":
        return {
            "accounts": _bounded_strings(scope.get("accounts"), lower=True),
            "folder": str(scope.get("folder") or "INBOX").strip()[:128] or "INBOX",
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
            "object_types": [value for value in object_types if value in {"database", "page"}],
            "database_ids": _bounded_strings(scope.get("database_ids")),
            "limit": limit,
        }
    return {
        "sources": _bounded_strings(scope.get("sources"), lower=True),
        "types": _bounded_strings(scope.get("types"), lower=True),
        "limit": limit,
    }


def normalize_internal_scope(source_id: str, raw_scope: Any) -> dict[str, Any]:
    """Validate and normalize the configurable scope for one internal source."""
    source_id = str(source_id or "").strip().lower()
    if source_id not in INTERNAL_SOURCE_IDS:
        raise ValueError(f"Unknown internal source: {source_id}")
    scope: dict[str, Any] = raw_scope if isinstance(raw_scope, dict) else {}
    limit = max(1, min(int(scope.get("limit") or DEFAULT_RESULT_ITEMS), MAX_RESULT_ITEMS))

    if source_id == "reader":
        return _reader_scope(scope, limit)
    if source_id == "calendar":
        return _calendar_scope(scope, limit)
    if source_id == "planning":
        return _planning_scope(scope, limit)
    return _simple_scope(source_id, scope, limit)


def _apply_reader_scope(
    query: Any,
    scope: dict[str, Any],
    *,
    feed_source_joined: bool = False,
) -> Any:
    from backend.models.reader import Article, FeedSource

    read_status = str(scope.get("read_status") or "").strip().lower()
    if not read_status:
        read_status = "unread" if scope.get("unread_only") else "all"
    if read_status == "unread":
        query = query.filter(Article.is_read.is_(False))
    elif read_status == "read":
        query = query.filter(Article.is_read.is_(True))
    if scope["source_ids"]:
        query = query.filter(Article.source_id.in_(scope["source_ids"]))
    needs_source = bool(scope.get("categories") or scope.get("source_names"))
    if needs_source and not feed_source_joined:
        query = query.join(FeedSource, Article.source_id == FeedSource.id)
    if scope.get("categories"):
        query = query.filter(
            func.lower(FeedSource.category).in_(
                [str(value).lower() for value in scope["categories"]]
            )
        )
    if scope.get("source_names"):
        query = query.filter(
            func.lower(FeedSource.name).in_([str(value).lower() for value in scope["source_names"]])
        )
    if scope["date_from"]:
        query = query.filter(Article.published_at >= datetime.fromisoformat(scope["date_from"]))
    if scope["date_to"]:
        query = query.filter(Article.published_at <= datetime.fromisoformat(scope["date_to"]))
    return query


def _intersect_values(
    base_values: list[Any],
    requested_values: list[Any],
    *,
    casefold: bool = False,
) -> list[Any]:
    if not base_values:
        return list(requested_values)
    if not requested_values:
        return list(base_values)
    if casefold:
        requested_keys = {str(value).casefold() for value in requested_values}
        intersection = [value for value in base_values if str(value).casefold() in requested_keys]
    else:
        requested_set = set(requested_values)
        intersection = [value for value in base_values if value in requested_set]
    if not intersection:
        raise ValueError("The requested filter is outside the attached Reader scope.")
    return intersection


def intersect_reader_scope(base_scope: Any, requested_scope: Any) -> dict[str, Any]:
    """Intersect model-requested Reader filters with an attached source scope."""
    base = normalize_internal_scope("reader", base_scope)
    requested_raw = requested_scope if isinstance(requested_scope, dict) else {}
    requested = normalize_internal_scope(
        "reader",
        {
            **requested_raw,
            "read_status": requested_raw.get("read_status") or "all",
            "unread_only": False,
        },
    )

    if (
        base["read_status"] != "all"
        and requested["read_status"] != "all"
        and base["read_status"] != requested["read_status"]
    ):
        raise ValueError("The requested read state is outside the attached Reader scope.")
    read_status = requested["read_status"] if base["read_status"] == "all" else base["read_status"]

    date_from = max(
        (value for value in (base["date_from"], requested["date_from"]) if value),
        default="",
    )
    date_to = min(
        (value for value in (base["date_to"], requested["date_to"]) if value),
        default="",
    )
    if date_from and date_to and date_from > date_to:
        raise ValueError("The requested dates are outside the attached Reader scope.")

    return normalize_internal_scope(
        "reader",
        {
            "read_status": read_status,
            "source_ids": _intersect_values(base["source_ids"], requested["source_ids"]),
            "source_names": _intersect_values(
                base["source_names"],
                requested["source_names"],
                casefold=True,
            ),
            "categories": _intersect_values(
                base["categories"],
                requested["categories"],
                casefold=True,
            ),
            "date_from": date_from,
            "date_to": date_to,
            "include_full_content": bool(requested["include_full_content"]),
            "limit": requested["limit"],
            "offset": requested["offset"],
        },
    )


def reader_scope_contains(base_scope: Any, candidate_scope: Any) -> bool:
    """Return whether a persisted Reader job remains inside an attached scope."""
    candidate = normalize_internal_scope("reader", candidate_scope)
    try:
        intersection = intersect_reader_scope(base_scope, candidate)
    except ValueError:
        return False
    comparable_keys = (
        "read_status",
        "source_ids",
        "source_names",
        "categories",
        "date_from",
        "date_to",
    )
    return all(intersection[key] == candidate[key] for key in comparable_keys)


_TAG_RE = re.compile(r"<[^>]+>")


_SPACE_RE = re.compile(r"\s+")


def _plain_text(value: Any, limit: int | None) -> str:
    text = unescape(_TAG_RE.sub(" ", str(value or "")))
    normalized = _SPACE_RE.sub(" ", text).strip()
    return normalized[:limit] if limit is not None else normalized


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
