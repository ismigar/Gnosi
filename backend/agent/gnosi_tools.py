"""Stable first-party Gnosi tools exposed to tool-capable chat models.

The functions in this module deliberately operate through the active Vault
context. They never trust a model-supplied filesystem path and they return
bounded JSON so a read tool cannot accidentally export an entire Vault.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import yaml

from backend.utils.safe_io import sanitize_rel_folder, sanitize_vault_title

try:
    from langchain_core.tools import tool
except Exception:  # pragma: no cover - keeps pure helpers importable in lean tests
    def tool(fn=None, **_kwargs):
        return fn if fn else (lambda function: function)


MAX_LIST_ITEMS = 100
MAX_BODY_CHARS = 12_000
_BULK_UPDATE_LOCK = threading.RLock()


class ActionConflictError(RuntimeError):
    """Raised when a confirmed target changed before execution."""


def _confirmation(
    action: str,
    arguments: Dict[str, Any],
    details: Dict[str, Any],
    *,
    destructive: bool = True,
) -> str:
    from backend.agent.action_confirmations import request_confirmation

    prefix = f"chat.confirmations.actions.{action}"
    return request_confirmation(
        action,
        arguments,
        title_key=f"{prefix}.title",
        summary_key=f"{prefix}.summary",
        details=details,
        destructive=destructive,
    )


def _vault() -> Path:
    from backend.services.context_vars import get_active_vault_path

    vault = get_active_vault_path()
    if not vault:
        raise RuntimeError("There is no active Vault.")
    return Path(vault).resolve()


def _confirmation_scope() -> Dict[str, str]:
    """Return the authenticated workspace bound to the current chat turn."""
    from backend.agent.action_confirmations import current_confirmation_scope

    return current_confirmation_scope()


def _workspace_id() -> str:
    return _confirmation_scope()["workspace_id"]


def _assert_global_integration_access(account: str, *, calendar: bool = False) -> str:
    """Confine installation-global mail/calendar accounts to personal workspaces."""
    scope = _confirmation_scope()
    if scope["workspace_id"] != "personal":
        raise PermissionError(
            "Installation-global integrations are unavailable outside "
            "the personal workspace."
        )
    normalized = str(account or "").strip().lower()
    if not normalized:
        raise ValueError("A configured integration account is required.")

    from backend.services.integration_manager import integration_manager

    if calendar:
        integrations = integration_manager.get_all_safe()
        candidates = (
            list(integrations.get("calendars") or [])
            + list(integrations.get("emails") or [])
            + list(integrations.get("mail_accounts") or [])
        )
        matched = next(
            (
                item
                for item in candidates
                if str(item.get("email") or item.get("username") or "")
                .strip()
                .lower()
                == normalized
            ),
            None,
        )
    else:
        matched = integration_manager.get_mail_account(normalized)
    if not matched or matched.get("enabled", True) is False:
        raise PermissionError("The integration account is unavailable.")
    return normalized


def _file_revision(path: Path) -> str:
    """Return an immutable content digest for optimistic concurrency checks."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _value_revision(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()


def _require_file_revision(path: Path, expected: str, target: str) -> None:
    if not path.exists() or _file_revision(path) != str(expected or ""):
        raise ActionConflictError(
            f"{target} changed after the confirmation preview."
        )


def _contact_snapshot(contact: Any) -> Dict[str, Any]:
    return {
        "id": str(contact.id),
        "name": str(contact.name or ""),
        "email": str(contact.email or ""),
        "phone": str(contact.phone or ""),
        "company": str(contact.company or ""),
        "job_title": str(contact.job_title or ""),
    }


def _mail_message_preview(message_id: str) -> Dict[str, str]:
    """Resolve bounded local mail metadata for a human-readable preview."""
    try:
        from backend.api.mail_routes import (
            _find_message_files,
            get_frontmatter,
            get_mail_vault_path,
        )

        files = _find_message_files(get_mail_vault_path(), message_id)
        if not files:
            return {"message_id": message_id}
        raw = files[0].read_text(encoding="utf-8", errors="replace")
        metadata, _body = get_frontmatter(raw)
        return {
            "message_id": message_id,
            "subject": str(metadata.get("subject") or "")[:500],
            "sender": str(metadata.get("sender") or metadata.get("from") or "")[:500],
            "date": str(metadata.get("date") or "")[:100],
        }
    except Exception:
        return {"message_id": message_id}


def _trash_snapshot() -> List[Dict[str, str]]:
    root = _vault() / ".trash"
    if not root.exists():
        return []
    snapshot = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if not entry.is_dir():
            continue
        sidecar = entry / "_trash.json"
        revision_source = sidecar if sidecar.exists() else entry / "page.md"
        revision = _file_revision(revision_source) if revision_source.exists() else ""
        title = entry.name
        if sidecar.exists():
            try:
                title = str(
                    json.loads(sidecar.read_text(encoding="utf-8")).get("title")
                    or entry.name
                )
            except Exception:
                pass
        snapshot.append({
            "id": entry.name,
            "revision": revision,
            "title": title[:500],
        })
    return snapshot


def _page_files() -> Iterable[Path]:
    vault = _vault()
    for path in vault.rglob("*.md"):
        relative_parts = path.relative_to(vault).parts
        if any(part.startswith(".") for part in relative_parts):
            continue
        yield path


def _parse(path: Path) -> tuple[Dict[str, Any], str]:
    from backend.api.vault_routes import parse_frontmatter

    return parse_frontmatter(path.read_text(encoding="utf-8"), path)


def _resolve_page(identifier: str) -> Optional[Path]:
    needle = str(identifier or "").strip()
    if not needle:
        return None
    lowered = needle.casefold()
    title_match = None
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        if str(metadata.get("id") or "") == needle:
            return path
        title = str(metadata.get("title") or path.stem)
        if title.casefold() == lowered or path.stem.casefold() == lowered:
            title_match = path
    return title_match


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _bounded_limit(limit: int) -> int:
    return max(1, min(int(limit or 20), MAX_LIST_ITEMS))


def _serialize_page(path: Path, *, include_body: bool = False) -> Dict[str, Any]:
    metadata, body = _parse(path)
    result = {
        "id": str(metadata.get("id") or ""),
        "title": str(metadata.get("title") or path.stem),
        "table_id": str(
            metadata.get("table_id") or metadata.get("database_table_id") or ""
        ),
        "metadata": metadata,
    }
    if include_body:
        result["content"] = body[:MAX_BODY_CHARS]
        result["truncated"] = len(body) > MAX_BODY_CHARS
    return result


def _write_page(path: Path, metadata: Dict[str, Any], body: str) -> None:
    from backend.api.vault_routes import _create_page_version, register_page_in_index

    if path.exists():
        _create_page_version(str(metadata.get("id") or ""), path, force=True)
    frontmatter = yaml.safe_dump(
        metadata, allow_unicode=True, sort_keys=False
    ).strip()
    path.write_text(f"---\n{frontmatter}\n---\n\n{body.rstrip()}\n", encoding="utf-8")
    register_page_in_index(path)


def _table(table_id_or_name: str) -> Optional[Dict[str, Any]]:
    from backend.config.app_config import load_params

    registry_path = load_params(strict_env=False).paths.get("REGISTRY")
    if not registry_path or not registry_path.exists():
        return None
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    needle = str(table_id_or_name or "").strip().casefold()
    return next(
        (
            table
            for table in registry.get("tables", [])
            if str(table.get("id") or "").casefold() == needle
            or str(table.get("name") or "").casefold() == needle
        ),
        None,
    )


def _table_folder(table: Dict[str, Any]) -> str:
    return str(
        table.get("folder")
        or table.get("path")
        or table.get("name")
        or "Databases"
    )


@tool
def list_table_rows(table_id_or_name: str, limit: int = 50) -> str:
    """Lists bounded rows from a Gnosi table, including row ids and properties."""
    table = _table(table_id_or_name)
    if not table:
        return _json({"error": "Table not found."})
    table_id = str(table.get("id") or "")
    rows = []
    for path in _page_files():
        try:
            page = _serialize_page(path)
        except Exception:
            continue
        if page["table_id"] == table_id:
            rows.append(page)
        if len(rows) >= _bounded_limit(limit):
            break
    return _json({"table": {"id": table_id, "name": table.get("name")}, "rows": rows})


@tool
def get_table_row(row_id_or_title: str) -> str:
    """Gets one table row with its complete properties and bounded page content."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Row not found."})
    page = _serialize_page(path, include_body=True)
    if not page["table_id"]:
        return _json({"error": "The page is not a table row."})
    return _json(page)


@tool
def list_tags(limit: int = 100) -> str:
    """Lists tags used by Vault pages with usage counts."""
    counts: Dict[str, int] = {}
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        tags = metadata.get("tags") or []
        if isinstance(tags, str):
            tags = [item.strip() for item in re.split(r"[,;]", tags)]
        for tag in tags:
            clean = str(tag).strip().lstrip("#")
            if clean:
                counts[clean] = counts.get(clean, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold()))
    return _json([{"tag": tag, "count": count} for tag, count in ranked[:_bounded_limit(limit)]])


@tool
def find_pages_by_tag(tag: str, limit: int = 50) -> str:
    """Finds bounded Vault pages carrying an exact tag."""
    needle = str(tag or "").strip().lstrip("#").casefold()
    pages = []
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        tags = metadata.get("tags") or []
        if isinstance(tags, str):
            tags = re.split(r"[,;]", tags)
        if needle in {str(item).strip().lstrip("#").casefold() for item in tags}:
            pages.append(_serialize_page(path))
        if len(pages) >= _bounded_limit(limit):
            break
    return _json(pages)


@tool
def get_page_links(page_id_or_title: str, limit: int = 50) -> str:
    """Returns bounded outgoing links, backlinks, and unlinked title mentions."""
    target = _resolve_page(page_id_or_title)
    if not target:
        return _json({"error": "Page not found."})
    metadata, body = _parse(target)
    target_id = str(metadata.get("id") or "")
    title = str(metadata.get("title") or target.stem)
    outgoing = re.findall(r"\[\[([^\]|#]+)", body)
    backlinks: List[Dict[str, str]] = []
    mentions: List[Dict[str, str]] = []
    link_pattern = re.compile(r"\[\[([^\]|#]+)", re.IGNORECASE)
    title_pattern = re.compile(rf"(?<![\w[])({re.escape(title)})(?![\w\]])", re.IGNORECASE)
    for path in _page_files():
        if path == target:
            continue
        try:
            source_meta, source_body = _parse(path)
        except Exception:
            continue
        refs = {item.strip().casefold() for item in link_pattern.findall(source_body)}
        source = {
            "id": str(source_meta.get("id") or ""),
            "title": str(source_meta.get("title") or path.stem),
        }
        if title.casefold() in refs or (target_id and target_id.casefold() in refs):
            backlinks.append(source)
        elif title_pattern.search(source_body):
            mentions.append(source)
        if len(backlinks) + len(mentions) >= _bounded_limit(limit):
            break
    return _json(
        {
            "outgoing": outgoing[:_bounded_limit(limit)],
            "backlinks": backlinks[:_bounded_limit(limit)],
            "unlinked_mentions": mentions[:_bounded_limit(limit)],
        }
    )


@tool
def get_page_history(page_id_or_title: str, limit: int = 20) -> str:
    """Lists available saved versions of a Vault page without restoring them."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, _body = _parse(path)
    page_id = str(metadata.get("id") or "")
    history = _vault() / ".history" / page_id
    versions = []
    if history.exists():
        for version in sorted(history.glob("*.md"), reverse=True)[:_bounded_limit(limit)]:
            versions.append(
                {
                    "timestamp": version.stem,
                    "size": version.stat().st_size,
                }
            )
    return _json({"page_id": page_id, "versions": versions})


@tool
def create_table_row(
    table_id_or_name: str,
    title: str,
    properties: Optional[Dict[str, Any]] = None,
    content: str = "",
) -> str:
    """Creates a row in a Gnosi table. Use only after an explicit user request."""
    import uuid

    table = _table(table_id_or_name)
    if not table:
        return _json({"error": "Table not found."})
    table_id = str(table.get("id") or "")
    page_id = str(uuid.uuid4())
    metadata = dict(properties or {})
    metadata.update(
        {
            "id": page_id,
            "title": title,
            "table_id": table_id,
            "database_table_id": table_id,
        }
    )
    folder = sanitize_rel_folder(_table_folder(table), fallback="Databases")
    destination = (_vault() / folder).resolve()
    vault = _vault()
    if destination != vault and vault not in destination.parents:
        return _json({"error": "The table folder is outside the active Vault."})
    destination.mkdir(parents=True, exist_ok=True)
    safe_title = sanitize_vault_title(title)
    path = destination / f"{safe_title}.md"
    if path.exists():
        path = destination / f"{safe_title} {page_id[:8]}.md"
    _write_page(path, metadata, content)
    return _json({"status": "created", "id": page_id, "title": title, "table_id": table_id})


@tool
def update_page(
    page_id_or_title: str,
    content: Optional[str] = None,
    properties: Optional[Dict[str, Any]] = None,
) -> str:
    """Updates page content and/or merges properties after an explicit user request."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, old_body = _parse(path)
    protected = {"id"}
    for key, value in (properties or {}).items():
        if key not in protected:
            metadata[key] = value
    _write_page(path, metadata, old_body if content is None else content)
    return _json({"status": "updated", "id": metadata.get("id"), "title": metadata.get("title")})


@tool
def append_to_page(page_id_or_title: str, content: str) -> str:
    """Appends content to a Vault page after an explicit user request."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, body = _parse(path)
    separator = "\n\n" if body.strip() else ""
    _write_page(path, metadata, f"{body.rstrip()}{separator}{content.strip()}")
    return _json({"status": "appended", "id": metadata.get("id"), "title": metadata.get("title")})


@tool
def update_table_row(row_id_or_title: str, properties: Dict[str, Any]) -> str:
    """Merges properties into a table row while preserving unknown metadata."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Row not found."})
    metadata, body = _parse(path)
    if not (metadata.get("table_id") or metadata.get("database_table_id")):
        return _json({"error": "The page is not a table row."})
    for key, value in properties.items():
        if key not in {"id", "table_id", "database_table_id"}:
            metadata[key] = value
    _write_page(path, metadata, body)
    return _json({"status": "updated", "id": metadata.get("id")})


@tool
def add_tags(page_id_or_title: str, tags: List[str]) -> str:
    """Adds tags to a page without removing existing tags."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, body = _parse(path)
    current = metadata.get("tags") or []
    if isinstance(current, str):
        current = re.split(r"[,;]", current)
    merged = {str(item).strip().lstrip("#") for item in [*current, *tags] if str(item).strip()}
    metadata["tags"] = sorted(merged, key=str.casefold)
    _write_page(path, metadata, body)
    return _json({"status": "updated", "tags": metadata["tags"]})


@tool
def add_page_comment(page_id_or_title: str, comment: str) -> str:
    """Adds a timestamped agent comment to a page's metadata."""
    from datetime import datetime, timezone

    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, body = _parse(path)
    comments = metadata.get("comments") or []
    if not isinstance(comments, list):
        comments = []
    comments.append(
        {
            "author": "agent",
            "content": comment.strip(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    metadata["comments"] = comments
    _write_page(path, metadata, body)
    return _json({"status": "created", "comment_count": len(comments)})


@tool
def mark_task_complete(row_id_or_title: str) -> str:
    """Marks a task page or table row complete, preserving all other properties."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Task not found."})
    metadata, body = _parse(path)
    metadata["completed"] = True
    if "status" in metadata:
        metadata["status"] = "done"
    _write_page(path, metadata, body)
    return _json({"status": "completed", "id": metadata.get("id")})


@tool
def delete_page(page_id_or_title: str) -> str:
    """Prepares moving a page to trash and waits for interactive confirmation."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, _body = _parse(path)
    page_id = str(metadata.get("id") or "")
    title = str(metadata.get("title") or path.stem)
    return _confirmation(
        "delete_page",
        {
            "page_id": page_id,
            "page_revision": _file_revision(path),
        },
        {
            "page": title,
            "page_id": page_id,
            "page_revision": _file_revision(path),
        },
    )


READ_TOOLS = [
    list_table_rows,
    get_table_row,
    list_tags,
    find_pages_by_tag,
    get_page_links,
    get_page_history,
]

EXPLICIT_WRITE_TOOLS = [
    create_table_row,
    update_page,
    append_to_page,
    update_table_row,
    add_tags,
    add_page_comment,
    mark_task_complete,
]

CONFIRMED_WRITE_TOOLS = [delete_page]


@tool
async def list_calendar_events(
    time_min: str,
    time_max: str,
    search: str = "",
    limit: int = 50,
) -> str:
    """Lists bounded calendar and Vault events in an ISO-8601 time range."""
    import asyncio
    from backend.api.calendar_routes import collect_all_events

    if _workspace_id() != "personal":
        raise PermissionError(
            "Installation-global calendar integrations are unavailable "
            "outside the personal workspace."
        )
    events = await asyncio.to_thread(
        collect_all_events,
        time_min,
        time_max,
        search or None,
        None,
        True,
        None,
    )
    return _json(events[:_bounded_limit(limit)])


@tool
async def search_mail(
    account: str,
    query: str,
    folder: str = "INBOX",
    limit: int = 20,
) -> str:
    """Searches bounded mail headers and previews for one configured account."""
    from backend.api.mail_routes import get_messages

    account = _assert_global_integration_access(account)
    result = await get_messages(
        email=account,
        folder=folder,
        category=None,
        limit=_bounded_limit(limit),
        offset=0,
        page_token=None,
        search=query,
        force=False,
    )
    messages = list(result.get("messages") or [])[:_bounded_limit(limit)]
    for message in messages:
        for key in ("body_html", "raw", "attachments"):
            message.pop(key, None)
        if "body_text" in message:
            message["body_text"] = str(message["body_text"])[:1000]
    return _json({"messages": messages, "total": result.get("total", len(messages))})


@tool
def list_contacts(search: str = "", limit: int = 50) -> str:
    """Lists bounded local Gnosi contacts, optionally filtered by name or email."""
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        contacts = ContactsService(db, _workspace_id()).list_contacts(
            None, search or None, None
        )
        rows = []
        for contact in contacts[:_bounded_limit(limit)]:
            rows.append(
                {
                    "id": contact.id,
                    "name": contact.name,
                    "email": contact.email,
                    "phone": contact.phone,
                    "company": contact.company,
                    "job_title": contact.job_title,
                    "source": contact.source,
                }
            )
        return _json(rows)
    finally:
        db.close()


@tool
async def create_calendar_event(
    account: str,
    title: str,
    start: str,
    end: str,
    calendar_id: str = "primary",
    description: str = "",
    location: str = "",
) -> str:
    """Prepare an external calendar event and wait for confirmation."""
    account = _assert_global_integration_access(account, calendar=True)
    return _confirmation(
        "create_calendar_event",
        {
            "account": account,
            "title": title,
            "start": start,
            "end": end,
            "calendar_id": calendar_id,
            "description": description,
            "location": location,
        },
        {
            "account": account,
            "title": title,
            "start": start,
            "end": end,
            "calendar_id": calendar_id,
            "description": description,
            "location": location,
        },
        destructive=False,
    )


@tool
def create_contact(
    name: str,
    email: str,
    phone: str = "",
    company: str = "",
    notes: str = "",
) -> str:
    """Creates a local Gnosi contact after an explicit user request."""
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        contact = ContactsService(db, _workspace_id()).create_contact(
            {
                "name": name,
                "email": email,
                "phone": phone,
                "company": company,
                "notes": notes,
                "source": "local",
            }
        )
        return _json({"status": "created", "id": contact.id, "name": contact.name})
    finally:
        db.close()


@tool
async def save_mail_draft(
    account: str,
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
) -> str:
    """Prepare an external mail draft and wait for confirmation."""
    account = _assert_global_integration_access(account)
    return _confirmation(
        "save_mail_draft",
        {
            "account": account,
            "to": to,
            "subject": subject,
            "body": body,
            "cc": cc,
            "bcc": bcc,
        },
        {
            "account": account,
            "to": to,
            "cc": cc,
            "bcc": bcc,
            "subject": subject,
            "body": body,
        },
        destructive=False,
    )


READ_TOOLS.extend([list_calendar_events, search_mail, list_contacts])
EXPLICIT_WRITE_TOOLS.append(create_contact)
CONFIRMED_WRITE_TOOLS.extend([create_calendar_event, save_mail_draft])


@tool
def delete_contact(contact_id: str) -> str:
    """Prepares deleting a contact and waits for interactive confirmation."""
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        service = ContactsService(db, _workspace_id())
        contact = service.get_contact(contact_id)
        if not contact:
            return _json({"error": "Contact not found."})
        snapshot = _contact_snapshot(contact)
        return _confirmation(
            "delete_contact",
            {
                "contact_id": contact_id,
                "contact_revision": _value_revision(snapshot),
            },
            {
                "contact": contact.name,
                "email": contact.email,
                "phone": contact.phone,
                "company": contact.company,
            },
        )
    finally:
        db.close()


@tool
async def send_mail(
    account: str,
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
) -> str:
    """Prepares sending mail and waits for interactive confirmation."""
    account = _assert_global_integration_access(account)
    return _confirmation(
        "send_mail",
        {
            "account": account,
            "to": to,
            "subject": subject,
            "body": body,
            "cc": cc,
            "bcc": bcc,
        },
        {
            "account": account,
            "to": to,
            "cc": cc,
            "bcc": bcc,
            "subject": subject,
            "body": body,
            "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        },
        destructive=False,
    )


@tool
async def archive_mail(account: str, message_id: str, folder: str = "") -> str:
    """Prepares archiving mail and waits for interactive confirmation."""
    account = _assert_global_integration_access(account)
    return _confirmation(
        "archive_mail",
        {"account": account, "message_id": message_id, "folder": folder},
        {
            "account": account,
            "folder": folder,
            **_mail_message_preview(message_id),
        },
        destructive=False,
    )


@tool
async def move_mail(
    account: str,
    message_id: str,
    target_folder: str,
) -> str:
    """Prepares moving mail and waits for interactive confirmation."""
    account = _assert_global_integration_access(account)
    return _confirmation(
        "move_mail",
        {
            "account": account,
            "target_folder": target_folder,
            **_mail_message_preview(message_id),
        },
        {
            "account": account,
            "message_id": message_id,
            "target_folder": target_folder,
        },
        destructive=False,
    )


@tool
async def invite_attendees(
    account: str,
    event_id: str,
    attendees: List[str],
    calendar_id: str = "primary",
) -> str:
    """Prepares invitations and waits for interactive confirmation."""
    import asyncio

    from backend.services.hybrid_calendar_service import get_event

    account = _assert_global_integration_access(account, calendar=True)
    event = await asyncio.to_thread(
        get_event,
        account,
        event_id,
        calendar_id,
    )
    if not event:
        return _json({"error": "Calendar event not found."})
    event_snapshot = {
        "id": str(event.get("id") or event_id),
        "title": str(event.get("title") or ""),
        "start": str(event.get("start") or ""),
        "end": str(event.get("end") or ""),
        "calendar_id": str(event.get("calendar_id") or calendar_id),
        "attendees": list(event.get("attendees") or []),
    }
    return _confirmation(
        "invite_attendees",
        {
            "account": account,
            "event_id": event_id,
            "attendees": attendees,
            "calendar_id": calendar_id,
            "event_revision": _value_revision(event_snapshot),
        },
        {
            "account": account,
            "event_id": event_id,
            "title": event_snapshot["title"],
            "start": event_snapshot["start"],
            "end": event_snapshot["end"],
            "calendar_id": calendar_id,
            "attendees": ", ".join(attendees),
            "existing_attendee_count": len(event_snapshot["attendees"]),
        },
        destructive=False,
    )


CONFIRMED_WRITE_TOOLS.extend(
    [delete_contact, send_mail, archive_mail, move_mail, invite_attendees]
)


@tool
def delete_table(table_id_or_name: str) -> str:
    """Prepares deleting a table and waits for interactive confirmation."""
    table = _table(table_id_or_name)
    if not table:
        return _json({"error": "Table not found."})
    table_id = str(table.get("id") or "")
    row_count = 0
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        if str(
            metadata.get("table_id")
            or metadata.get("database_table_id")
            or ""
        ) == table_id:
            row_count += 1
    return _confirmation(
        "delete_table",
        {
            "table_id": table_id,
            "table_revision": _value_revision(table),
        },
        {
            "table": str(table.get("name") or table_id),
            "table_id": table_id,
            "folder": str(table.get("folder") or ""),
            "row_count": row_count,
        },
    )


@tool
def restore_page_version(page_id_or_title: str, timestamp: str) -> str:
    """Prepares restoring a page version and waits for confirmation."""
    from backend.api.vault_routes import (
        _validate_history_timestamp,
        _validate_safe_page_id,
    )

    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, _body = _parse(path)
    page_id = _validate_safe_page_id(str(metadata.get("id") or ""))
    safe_timestamp = _validate_history_timestamp(timestamp)
    version = _vault() / ".history" / page_id / f"{safe_timestamp}.md"
    if not version.exists():
        return _json({"error": "Page version not found."})
    return _confirmation(
        "restore_page_version",
        {
            "page_id": page_id,
            "timestamp": safe_timestamp,
            "current_revision": _file_revision(path),
            "version_revision": _file_revision(version),
        },
        {
            "page": str(metadata.get("title") or path.stem),
            "page_id": page_id,
            "timestamp": safe_timestamp,
            "current_revision": _file_revision(path),
            "version_revision": _file_revision(version),
        },
    )


@tool
def empty_trash() -> str:
    """Prepares permanently emptying Vault trash and waits for confirmation."""
    snapshot = _trash_snapshot()
    snapshot_digest = _value_revision(snapshot)
    return _confirmation(
        "empty_trash",
        {
            "entries": snapshot,
            "snapshot_digest": snapshot_digest,
        },
        {
            "count": len(snapshot),
            "entries": [
                {"id": item["id"], "title": item["title"]}
                for item in snapshot[:50]
            ],
            "entries_truncated": len(snapshot) > 50,
            "snapshot_digest": snapshot_digest,
        },
    )


@tool
def change_schema(folder: str, schema_definition: Dict[str, Any]) -> str:
    """Prepares replacing a folder schema and waits for confirmation."""
    safe_folder = sanitize_rel_folder(folder, fallback="")
    if not safe_folder:
        return _json({"error": "A valid schema folder is required."})
    schema_path = (_vault() / safe_folder / "schema.json").resolve()
    vault = _vault()
    if schema_path != vault and vault not in schema_path.parents:
        return _json({"error": "The schema folder is outside the active Vault."})
    current_revision = _file_revision(schema_path) if schema_path.exists() else ""
    properties = schema_definition.get("properties") or []
    return _confirmation(
        "change_schema",
        {
            "folder": safe_folder,
            "schema_definition": schema_definition,
            "current_revision": current_revision,
        },
        {
            "folder": safe_folder,
            "property_count": len(properties),
            "properties": [
                str(item.get("name") or item.get("id") or "")
                for item in properties
                if isinstance(item, dict)
            ][:100],
            "schema_sha256": _value_revision(schema_definition),
        },
    )


@tool
def bulk_update_rows(updates: List[Dict[str, Any]]) -> str:
    """Prepares up to 100 row updates and waits for confirmation."""
    if not updates or len(updates) > MAX_LIST_ITEMS:
        return _json(
            {"error": f"Between 1 and {MAX_LIST_ITEMS} row updates are required."}
        )
    normalized = []
    for update in updates:
        identifier = str(update.get("id") or update.get("title") or "").strip()
        properties = update.get("properties")
        if not identifier or not isinstance(properties, dict):
            return _json({"error": "Each row update requires an id and properties."})
        path = _resolve_page(identifier)
        if not path:
            return _json({"error": f"Row not found: {identifier}"})
        metadata, _body = _parse(path)
        if not (
            metadata.get("table_id")
            or metadata.get("database_table_id")
        ):
            return _json({"error": f"The page is not a table row: {identifier}"})
        normalized.append({
            "id": str(metadata.get("id") or identifier),
            "title": str(metadata.get("title") or path.stem),
            "properties": properties,
            "revision": _file_revision(path),
        })
    return _confirmation(
        "bulk_update_rows",
        {"updates": normalized},
        {
            "count": len(normalized),
            "updates": [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "properties": item["properties"],
                }
                for item in normalized
            ],
        },
    )


CONFIRMED_WRITE_TOOLS.extend(
    [delete_table, restore_page_version, empty_trash, change_schema, bulk_update_rows]
)


async def execute_confirmed_action(
    action: str,
    arguments: Dict[str, Any],
    *,
    workspace_id: str,
    background_tasks: Any = None,
) -> Dict[str, Any]:
    """Executes one allowlisted action after the confirmation store claims it."""
    if action == "delete_page":
        from backend.api.vault_routes import _move_page_to_trash

        path = _resolve_page(str(arguments["page_id"]))
        if not path:
            raise LookupError("Page not found.")
        _require_file_revision(
            path,
            str(arguments.get("page_revision") or ""),
            "The page",
        )
        _move_page_to_trash(str(arguments["page_id"]), path)
        return {"status": "trashed", "page_id": str(arguments["page_id"])}

    if action == "delete_contact":
        from backend.data.management_db import get_mgmt_session
        from backend.services.contacts_service import ContactsService

        db = get_mgmt_session()
        try:
            service = ContactsService(db, workspace_id)
            contact_id = str(arguments["contact_id"])
            contact = service.get_contact(contact_id)
            if not contact:
                raise LookupError("Contact not found.")
            if _value_revision(_contact_snapshot(contact)) != str(
                arguments.get("contact_revision") or ""
            ):
                raise ActionConflictError(
                    "The contact changed after the confirmation preview."
                )
            if not service.delete_contact(contact_id):
                raise RuntimeError("The contact could not be deleted.")
            return {"status": "deleted", "contact_id": contact_id}
        finally:
            db.close()

    if action == "send_mail":
        from backend.api.mail_routes import send_mail as route_send_mail

        account = _assert_global_integration_access(str(arguments["account"]))
        return await route_send_mail(
            email=account,
            to=str(arguments["to"]),
            subject=str(arguments.get("subject") or ""),
            body=str(arguments["body"]),
            cc=str(arguments.get("cc") or "") or None,
            bcc=str(arguments.get("bcc") or "") or None,
            from_name=None,
            from_email=None,
            attachments=[],
        )

    if action == "save_mail_draft":
        from backend.api.mail_routes import save_draft

        account = _assert_global_integration_access(str(arguments["account"]))
        return await save_draft(
            {
                "account": account,
                "to": str(arguments["to"]),
                "subject": str(arguments.get("subject") or ""),
                "body": str(arguments["body"]),
                "cc": str(arguments.get("cc") or ""),
                "bcc": str(arguments.get("bcc") or ""),
            }
        )

    if action == "archive_mail":
        from backend.api.mail_routes import archive_msg

        account = _assert_global_integration_access(str(arguments["account"]))
        return await archive_msg(
            str(arguments["message_id"]),
            account,
            str(arguments.get("folder") or "") or None,
        )

    if action == "move_mail":
        from backend.api.mail_routes import move_message

        account = _assert_global_integration_access(str(arguments["account"]))
        return await move_message(
            str(arguments["message_id"]),
            account,
            {"target_folder": str(arguments["target_folder"])},
        )

    if action == "invite_attendees":
        import asyncio

        from backend.api.calendar_routes import invite_to_event
        from backend.services.hybrid_calendar_service import get_event

        account = _assert_global_integration_access(
            str(arguments["account"]),
            calendar=True,
        )
        event_id = str(arguments["event_id"])
        calendar_id = str(arguments.get("calendar_id") or "primary")
        event = await asyncio.to_thread(
            get_event,
            account,
            event_id,
            calendar_id,
        )
        if not event:
            raise LookupError("Calendar event not found.")
        event_snapshot = {
            "id": str(event.get("id") or event_id),
            "title": str(event.get("title") or ""),
            "start": str(event.get("start") or ""),
            "end": str(event.get("end") or ""),
            "calendar_id": str(event.get("calendar_id") or calendar_id),
            "attendees": list(event.get("attendees") or []),
        }
        if _value_revision(event_snapshot) != str(
            arguments.get("event_revision") or ""
        ):
            raise ActionConflictError(
                "The calendar event changed after the confirmation preview."
            )
        return await invite_to_event(
            event_id,
            {
                "email": account,
                "attendees": [
                    {"email": str(address)}
                    for address in arguments.get("attendees") or []
                ],
                "calendar_id": calendar_id,
            },
        )

    if action == "create_calendar_event":
        import asyncio

        from backend.api.calendar_routes import _invalidate_calendar_cache
        from backend.services.google_calendar_service import (
            create_google_calendar_event,
        )

        account = _assert_global_integration_access(
            str(arguments["account"]),
            calendar=True,
        )
        payload = {
            "summary": str(arguments.get("title") or ""),
            "start": {"dateTime": str(arguments["start"])},
            "end": {"dateTime": str(arguments["end"])},
            "description": str(arguments.get("description") or ""),
            "location": str(arguments.get("location") or ""),
        }
        event = await asyncio.to_thread(
            create_google_calendar_event,
            account,
            payload,
            str(arguments.get("calendar_id") or "primary"),
        )
        if not event:
            raise RuntimeError("The calendar event could not be created.")
        _invalidate_calendar_cache()
        return {"status": "created", "event_id": str(event.get("id") or "")}

    if action == "delete_table":
        from fastapi import BackgroundTasks
        from backend.api.vault_routes import delete_table as route_delete_table

        table = _table(str(arguments["table_id"]))
        if not table:
            raise LookupError("Table not found.")
        if _value_revision(table) != str(arguments.get("table_revision") or ""):
            raise ActionConflictError(
                "The table changed after the confirmation preview."
            )
        tasks = background_tasks or BackgroundTasks()
        result = await route_delete_table(str(arguments["table_id"]), tasks)
        return {
            **(result if isinstance(result, dict) else {}),
            "cleanup_status": "queued" if tasks.tasks else "not_required",
        }

    if action == "restore_page_version":
        from fastapi import BackgroundTasks
        from backend.api.vault_routes import (
            restore_page_version as route_restore_page_version,
        )

        page_id = str(arguments["page_id"])
        timestamp = str(arguments["timestamp"])
        path = _resolve_page(page_id)
        if not path:
            raise LookupError("Current page not found.")
        version = _vault() / ".history" / page_id / f"{timestamp}.md"
        _require_file_revision(
            path,
            str(arguments.get("current_revision") or ""),
            "The current page",
        )
        _require_file_revision(
            version,
            str(arguments.get("version_revision") or ""),
            "The saved version",
        )
        tasks = background_tasks or BackgroundTasks()
        result = await route_restore_page_version(
            page_id,
            timestamp,
            tasks,
        )
        return {
            **(result if isinstance(result, dict) else {}),
            "cleanup_status": "queued" if tasks.tasks else "not_required",
        }

    if action == "empty_trash":
        import asyncio

        from backend.api.vault_routes import _purge_trash_entry

        expected_entries = list(arguments.get("entries") or [])
        if _value_revision(expected_entries) != str(
            arguments.get("snapshot_digest") or ""
        ):
            raise ActionConflictError("The trash snapshot is invalid.")
        current = {item["id"]: item for item in _trash_snapshot()}
        purged = 0
        failed_ids: List[str] = []
        freed = 0
        for expected in expected_entries:
            entry_id = str(expected.get("id") or "")
            actual = current.get(entry_id)
            if (
                not actual
                or str(actual.get("revision") or "")
                != str(expected.get("revision") or "")
            ):
                failed_ids.append(entry_id)
                continue
            try:
                result = await asyncio.to_thread(_purge_trash_entry, entry_id)
                purged += 1
                freed += int(result.get("freed_bytes") or 0)
            except Exception:
                failed_ids.append(entry_id)
        return {
            "status": "partial" if failed_ids else "completed",
            "purged_count": purged,
            "failed_count": len(failed_ids),
            "failed_ids": failed_ids,
            "freed_bytes": freed,
        }

    if action == "change_schema":
        from backend.api.vault_routes import save_schema

        schema_path = (
            _vault() / str(arguments["folder"]) / "schema.json"
        ).resolve()
        current_revision = _file_revision(schema_path) if schema_path.exists() else ""
        if current_revision != str(arguments.get("current_revision") or ""):
            raise ActionConflictError(
                "The schema changed after the confirmation preview."
            )
        return await save_schema(
            str(arguments["folder"]),
            dict(arguments.get("schema_definition") or {}),
        )

    if action == "bulk_update_rows":
        updates = list(arguments.get("updates") or [])
        if not updates or len(updates) > MAX_LIST_ITEMS:
            raise ValueError("The bulk update size is invalid.")
        with _BULK_UPDATE_LOCK:
            prepared = []
            seen_ids = set()
            for update in updates:
                row_id = str(update["id"])
                if row_id in seen_ids:
                    raise ValueError(f"Duplicate row update: {row_id}")
                seen_ids.add(row_id)
                path = _resolve_page(row_id)
                if not path:
                    raise LookupError(f"Row not found: {row_id}")
                _require_file_revision(
                    path,
                    str(update.get("revision") or ""),
                    f"Row {row_id}",
                )
                metadata, body = _parse(path)
                if not (
                    metadata.get("table_id")
                    or metadata.get("database_table_id")
                ):
                    raise ValueError(f"The page is not a table row: {row_id}")
                new_metadata = dict(metadata)
                for key, value in dict(update.get("properties") or {}).items():
                    if key not in {"id", "table_id", "database_table_id"}:
                        new_metadata[key] = value
                prepared.append({
                    "id": row_id,
                    "path": path,
                    "original": path.read_bytes(),
                    "metadata": new_metadata,
                    "body": body,
                })

            written = []
            try:
                for item in prepared:
                    _write_page(
                        item["path"],
                        item["metadata"],
                        item["body"],
                    )
                    written.append(item)
            except Exception as error:
                rollback_failed = []
                from backend.api.vault_routes import register_page_in_index

                for item in reversed(written):
                    try:
                        item["path"].write_bytes(item["original"])
                        register_page_in_index(item["path"])
                    except Exception:
                        rollback_failed.append(item["id"])
                if rollback_failed:
                    return {
                        "status": "partial",
                        "updated_count": len(written),
                        "rollback_failed_ids": rollback_failed,
                        "error": str(error)[:500],
                    }
                raise RuntimeError(
                    "The bulk update failed and all changed rows were rolled back."
                ) from error
        return {
            "status": "completed",
            "updated_count": len(prepared),
            "row_ids": [item["id"] for item in prepared],
        }

    raise ValueError(f"Unsupported confirmed action: {action}")
