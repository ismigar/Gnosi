"""Stable first-party Gnosi tools exposed to tool-capable chat models.

The functions in this module deliberately operate through the active Vault
context. They never trust a model-supplied filesystem path and they return
bounded JSON so a read tool cannot accidentally export an entire Vault.
"""
from __future__ import annotations

import json
import re
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


def _vault() -> Path:
    from backend.services.context_vars import get_active_vault_path

    vault = get_active_vault_path()
    if not vault:
        raise RuntimeError("There is no active Vault.")
    return Path(vault).resolve()


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
    """Moves a page to Vault trash. Bind only after explicit user confirmation."""
    from backend.api.vault_routes import _move_page_to_trash

    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, _body = _parse(path)
    _move_page_to_trash(str(metadata.get("id") or ""), path)
    return _json({"status": "trashed", "page": path.stem})


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
        contacts = ContactsService(db, "personal").list_contacts(
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
    """Creates a calendar event after an explicit user request."""
    import asyncio
    from backend.api.calendar_routes import _invalidate_calendar_cache
    from backend.services.google_calendar_service import create_google_calendar_event

    payload = {
        "summary": title,
        "start": {"dateTime": start},
        "end": {"dateTime": end},
        "description": description,
        "location": location,
    }
    event = await asyncio.to_thread(
        create_google_calendar_event, account, payload, calendar_id
    )
    if event:
        _invalidate_calendar_cache()
    return _json(event or {"error": "The calendar event could not be created."})


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
        contact = ContactsService(db, "personal").create_contact(
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
    """Saves a mail draft after an explicit user request; it never sends mail."""
    from backend.api.mail_routes import save_draft

    result = await save_draft(
        {
            "account": account,
            "to": to,
            "subject": subject,
            "body": body,
            "cc": cc,
            "bcc": bcc,
        }
    )
    return _json(result)


READ_TOOLS.extend([list_calendar_events, search_mail, list_contacts])
EXPLICIT_WRITE_TOOLS.extend(
    [create_calendar_event, create_contact, save_mail_draft]
)


@tool
def delete_contact(contact_id: str) -> str:
    """Deletes a local contact. Bind only after explicit user confirmation."""
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        service = ContactsService(db, "personal")
        if not service.get_contact(contact_id):
            return _json({"error": "Contact not found."})
        return _json(
            {"status": "deleted" if service.delete_contact(contact_id) else "failed"}
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
    """Sends mail without attachments. Bind only after explicit user confirmation."""
    from backend.api.mail_routes import send_mail as route_send_mail

    result = await route_send_mail(
        email=account,
        to=to,
        subject=subject,
        body=body,
        cc=cc or None,
        bcc=bcc or None,
        from_name=None,
        from_email=None,
        attachments=[],
    )
    return _json(result)


@tool
async def archive_mail(account: str, message_id: str, folder: str = "") -> str:
    """Archives one mail message. Bind only after explicit user confirmation."""
    from backend.api.mail_routes import archive_msg

    return _json(await archive_msg(message_id, account, folder or None))


@tool
async def move_mail(
    account: str,
    message_id: str,
    target_folder: str,
) -> str:
    """Moves one mail message. Bind only after explicit user confirmation."""
    from backend.api.mail_routes import move_message

    return _json(
        await move_message(message_id, account, {"target_folder": target_folder})
    )


@tool
async def invite_attendees(
    account: str,
    event_id: str,
    attendees: List[str],
    calendar_id: str = "primary",
) -> str:
    """Invites attendees to an event. Bind only after explicit confirmation."""
    from backend.api.calendar_routes import invite_to_event

    return _json(
        await invite_to_event(
            event_id,
            {
                "email": account,
                "attendees": [{"email": address} for address in attendees],
                "calendar_id": calendar_id,
            },
        )
    )


CONFIRMED_WRITE_TOOLS.extend(
    [delete_contact, send_mail, archive_mail, move_mail, invite_attendees]
)
