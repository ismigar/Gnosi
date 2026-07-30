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
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import yaml

from backend.services.content_revision import tree_revision
from backend.utils.safe_io import (
    safe_write_bytes,
    safe_write_text,
    sanitize_rel_folder,
    sanitize_vault_title,
)

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


def _mail_message_preview(
    account: str,
    message_id: str,
) -> Optional[Dict[str, str]]:
    """Resolve one account-bound local message and its immutable revision."""
    try:
        from backend.api.mail_routes import (
            _find_message_files,
            get_mail_vault_path,
            parse_frontmatter,
        )

        files = _find_message_files(get_mail_vault_path(), message_id)
        normalized_account = str(account or "").strip().lower()
        for path in files:
            raw = path.read_text(encoding="utf-8", errors="replace")
            # Confirmation preparation is read-only; omitting the path keeps
            # the mail parser from repairing malformed frontmatter in place.
            metadata, _body = parse_frontmatter(raw)
            message_account = str(metadata.get("account") or "").strip().lower()
            if message_account != normalized_account:
                continue
            return {
                "message_id": message_id,
                "message_source": "vault",
                "subject": str(
                    metadata.get("subject") or metadata.get("title") or ""
                )[:500],
                "sender": str(
                    metadata.get("sender") or metadata.get("from") or ""
                )[:500],
                "date": str(metadata.get("date") or "")[:100],
                "imap_uid": str(metadata.get("imap_uid") or ""),
                "imap_folder": str(metadata.get("imap_folder") or ""),
                "message_revision": _file_revision(path),
            }
    except Exception:
        return None
    return None


async def _mail_message_snapshot(
    account: str,
    message_id: str,
    folder: str = "",
) -> Optional[Dict[str, str]]:
    """Resolve an account-bound message locally or from its remote provider."""
    local = _mail_message_preview(account, message_id)
    if local:
        return local

    import asyncio

    from backend.api.mail_routes import get_message

    try:
        message = await asyncio.wait_for(
            get_message(
                message_id,
                email=account,
                folder=folder or None,
            ),
            timeout=30,
        )
    except Exception:
        return None
    if not isinstance(message, dict):
        return None

    normalized_account = str(account or "").strip().lower()
    returned_account = str(message.get("account") or "").strip().lower()
    if returned_account and returned_account != normalized_account:
        return None
    source = str(message.get("source") or "").strip().lower()
    if source == "vault":
        return None

    canonical = {
        "account": normalized_account,
        "message_id": str(message.get("id") or message_id),
        "thread_id": str(message.get("thread_id") or ""),
        "subject": str(message.get("subject") or ""),
        "sender": str(message.get("sender") or ""),
        "recipient": str(message.get("recipient") or ""),
        "cc": str(message.get("cc") or ""),
        "date": str(message.get("date") or ""),
        "body_text": str(message.get("body_text") or ""),
        "body_html": str(message.get("body_html") or ""),
        "has_attachments": bool(message.get("has_attachments")),
        "imap_uid": str(message.get("imap_uid") or ""),
        "imap_folder": str(
            message.get("imap_folder") or folder or ""
        ),
        "provider_source": source,
    }
    return {
        "message_id": str(message_id),
        "message_source": "provider",
        "subject": canonical["subject"][:500],
        "sender": canonical["sender"][:500],
        "date": canonical["date"][:100],
        "imap_uid": canonical["imap_uid"],
        "imap_folder": canonical["imap_folder"],
        "message_revision": _value_revision(canonical),
    }


async def _require_mail_message_revision(
    account: str,
    message_id: str,
    expected_revision: str,
    *,
    expected_source: str,
    folder: str = "",
) -> Dict[str, str]:
    current = await _mail_message_snapshot(account, message_id, folder)
    if (
        not current
        or current.get("message_revision") != str(expected_revision or "")
        or current.get("message_source") != str(expected_source or "")
    ):
        raise ActionConflictError(
            "The mail message changed after the confirmation preview."
        )
    return current


def _trash_snapshot() -> List[Dict[str, str]]:
    root = _vault() / ".trash"
    if not root.exists():
        return []
    snapshot = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if not entry.is_dir():
            continue
        sidecar = entry / "_trash.json"
        revision = tree_revision(entry)
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
    from backend.services.path_resolver import path_resolver

    vault = _vault()
    for path in path_resolver.list_all_files(vault):
        relative_parts = path.relative_to(vault).parts
        if any(part.startswith(".") for part in relative_parts):
            continue
        yield path


def _parse(path: Path) -> tuple[Dict[str, Any], str]:
    from backend.api.vault_routes import parse_frontmatter

    return parse_frontmatter(path.read_text(encoding="utf-8"), path)


def _resolve_page(identifier: str) -> Optional[Path]:
    from backend.services.path_resolver import path_resolver

    needle = str(identifier or "").strip()
    if not needle:
        return None
    lowered = needle.casefold()
    indexed = path_resolver.find_path(needle, _vault())
    if indexed:
        return indexed
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


def _bounded_json_value(value: Any, *, depth: int = 0) -> Any:
    """Recursively bound metadata before it enters a model tool result."""
    if depth >= 4:
        return str(value)[:500]
    if isinstance(value, str):
        return value[:2_000]
    if isinstance(value, dict):
        return {
            str(key)[:128]: _bounded_json_value(item, depth=depth + 1)
            for key, item in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple, set)):
        return [
            _bounded_json_value(item, depth=depth + 1)
            for item in list(value)[:100]
        ]
    return value


def _serialize_page(path: Path, *, include_body: bool = False) -> Dict[str, Any]:
    metadata, body = _parse(path)
    bounded_metadata = _bounded_json_value(metadata)
    result = {
        "id": str(metadata.get("id") or ""),
        "title": str(metadata.get("title") or path.stem),
        "table_id": str(
            metadata.get("table_id") or metadata.get("database_table_id") or ""
        ),
        "metadata": bounded_metadata,
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
    safe_write_text(path, f"---\n{frontmatter}\n---\n\n{body.rstrip()}\n")
    register_page_in_index(path)


def _rollback_page_items(items: Iterable[Dict[str, Any]]) -> List[str]:
    """Restore attempted page writes and return IDs that could not be restored."""
    from backend.api.vault_routes import register_page_in_index

    failed: List[str] = []
    for item in reversed(list(items)):
        try:
            safe_write_bytes(item["path"], item["original"])
            register_page_in_index(item["path"])
        except Exception:
            failed.append(str(item["id"]))
    return failed


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


def _table_rows_snapshot(table_id: str) -> List[Dict[str, str]]:
    """Return an exact, path-contained snapshot of all rows in one table."""
    vault = _vault()
    rows: List[Dict[str, str]] = []
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        current_table_id = str(
            metadata.get("table_id")
            or metadata.get("database_table_id")
            or ""
        )
        if current_table_id != str(table_id):
            continue
        rows.append({
            "id": str(metadata.get("id") or ""),
            "title": str(metadata.get("title") or path.stem)[:500],
            "relative_path": path.relative_to(vault).as_posix(),
            "revision": _file_revision(path),
        })
    return sorted(rows, key=lambda row: row["relative_path"])


def _table_delete_snapshot(table: Dict[str, Any]) -> Dict[str, Any]:
    """Bind table, views, rows, and active assets to one confirmation."""
    from backend.api.vault_routes import (
        _table_asset_revision,
        _table_views_revision,
        load_registry,
    )

    registry = load_registry()
    table_id = str(table.get("id") or "")
    current_table = next(
        (
            item
            for item in registry.get("tables", [])
            if str(item.get("id") or "") == table_id
        ),
        None,
    )
    if not current_table:
        raise LookupError("Table not found.")
    database = next(
        (
            item
            for item in registry.get("databases", [])
            if str(item.get("id") or "")
            == str(current_table.get("database_id") or "")
        ),
        None,
    )
    rows = _table_rows_snapshot(table_id)
    views = [
        item
        for item in registry.get("views", [])
        if str(item.get("table_id") or "") == table_id
    ]
    return {
        "table_revision": _value_revision(current_table),
        "views_revision": _table_views_revision(registry, table_id),
        "views_count": len(views),
        "rows": rows,
        "rows_revision": _value_revision(rows),
        "row_count": len(rows),
        "asset_revision": _table_asset_revision(current_table, database),
    }


def _resolve_snapshotted_row_path(relative_path: str) -> Path:
    vault = _vault()
    candidate = (vault / str(relative_path or "")).resolve()
    if candidate == vault or vault not in candidate.parents:
        raise ValueError("The snapshotted row path is outside the Vault.")
    return candidate


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
    with _page_lock(path):
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
    def mutate(metadata, old_body):
        for key, value in (properties or {}).items():
            if key != "id":
                metadata[key] = value
        return metadata, old_body if content is None else content
    metadata = _mutate_page(path, mutate)
    return _json({"status": "updated", "id": metadata.get("id"), "title": metadata.get("title")})


@tool
def append_to_page(page_id_or_title: str, content: str) -> str:
    """Appends content to a Vault page after an explicit user request."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    def mutate(metadata, body):
        separator = "\n\n" if body.strip() else ""
        return metadata, f"{body.rstrip()}{separator}{content.strip()}"
    metadata = _mutate_page(path, mutate)
    return _json({"status": "appended", "id": metadata.get("id"), "title": metadata.get("title")})


@tool
def update_table_row(row_id_or_title: str, properties: Dict[str, Any]) -> str:
    """Merges properties into a table row while preserving unknown metadata."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Row not found."})
    def mutate(metadata, body):
        if not (metadata.get("table_id") or metadata.get("database_table_id")):
            raise ValueError("The page is not a table row.")
        for key, value in properties.items():
            if key not in {"id", "table_id", "database_table_id"}:
                metadata[key] = value
        return metadata, body
    try:
        metadata = _mutate_page(path, mutate)
    except ValueError as error:
        return _json({"error": str(error)})
    return _json({"status": "updated", "id": metadata.get("id")})


@tool
def add_tags(page_id_or_title: str, tags: List[str]) -> str:
    """Adds tags to a page without removing existing tags."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    def mutate(metadata, body):
        current = metadata.get("tags") or []
        if isinstance(current, str):
            current = re.split(r"[,;]", current)
        merged = {str(item).strip().lstrip("#") for item in [*current, *tags] if str(item).strip()}
        metadata["tags"] = sorted(merged, key=str.casefold)
        return metadata, body
    metadata = _mutate_page(path, mutate)
    return _json({"status": "updated", "tags": metadata["tags"]})


@tool
def add_page_comment(page_id_or_title: str, comment: str) -> str:
    """Adds a timestamped agent comment to a page's metadata."""
    from datetime import datetime, timezone

    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    def mutate(metadata, body):
        comments = metadata.get("comments") or []
        if not isinstance(comments, list):
            comments = []
        comments.append({
            "author": "agent",
            "content": comment.strip(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        metadata["comments"] = comments
        return metadata, body
    metadata = _mutate_page(path, mutate)
    comments = metadata["comments"]
    return _json({"status": "created", "comment_count": len(comments)})


@tool
def mark_task_complete(row_id_or_title: str) -> str:
    """Marks a task page or table row complete, preserving all other properties."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Task not found."})
    def mutate(metadata, body):
        metadata["completed"] = True
        if "status" in metadata:
            metadata["status"] = "done"
        return metadata, body
    metadata = _mutate_page(path, mutate)
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
    message = await _mail_message_snapshot(account, message_id, folder)
    if not message:
        return _json({"error": "Mail message not found for this account."})
    return _confirmation(
        "archive_mail",
        {
            "account": account,
            "message_id": message_id,
            "folder": folder,
            "message_revision": message["message_revision"],
            "message_source": message["message_source"],
        },
        {
            "account": account,
            "folder": folder,
            **message,
        },
        destructive=False,
    )


@tool
async def move_mail(
    account: str,
    message_id: str,
    target_folder: str,
    folder: str = "",
) -> str:
    """Prepares moving mail and waits for interactive confirmation."""
    account = _assert_global_integration_access(account)
    message = await _mail_message_snapshot(account, message_id, folder)
    if not message:
        return _json({"error": "Mail message not found for this account."})
    return _confirmation(
        "move_mail",
        {
            "account": account,
            "message_id": message_id,
            "target_folder": target_folder,
            "folder": folder,
            "imap_uid": message["imap_uid"],
            "imap_folder": message["imap_folder"],
            "message_revision": message["message_revision"],
            "message_source": message["message_source"],
        },
        {
            "account": account,
            "target_folder": target_folder,
            "folder": folder,
            **message,
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
def delete_table(table_id_or_name: str, row_action: str = "") -> str:
    """Prepares deleting a table after choosing `unlink` or `delete` for rows."""
    table = _table(table_id_or_name)
    if not table:
        return _json({"error": "Table not found."})
    normalized_row_action = str(row_action or "").strip().lower()
    if normalized_row_action not in {"unlink", "delete"}:
        return _json({
            "error": (
                "Choose row_action='unlink' to keep the pages without the table "
                "or row_action='delete' to move every row page to trash."
            )
        })
    table_id = str(table.get("id") or "")
    snapshot = _table_delete_snapshot(table)
    return _confirmation(
        "delete_table",
        {
            "table_id": table_id,
            "table_revision": snapshot["table_revision"],
            "views_revision": snapshot["views_revision"],
            "rows_revision": snapshot["rows_revision"],
            "asset_revision": snapshot["asset_revision"],
            "row_action": normalized_row_action,
        },
        {
            "table": str(table.get("name") or table_id),
            "table_id": table_id,
            "folder": str(table.get("folder") or ""),
            "row_action": normalized_row_action,
            "row_count": snapshot["row_count"],
            "views_count": snapshot["views_count"],
            "table_revision": snapshot["table_revision"],
            "views_revision": snapshot["views_revision"],
            "rows_revision": snapshot["rows_revision"],
            "asset_revision": snapshot["asset_revision"],
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
        await _require_mail_message_revision(
            account,
            str(arguments["message_id"]),
            str(arguments.get("message_revision") or ""),
            expected_source=str(arguments.get("message_source") or ""),
            folder=str(arguments.get("folder") or ""),
        )
        return await archive_msg(
            str(arguments["message_id"]),
            account,
            str(arguments.get("folder") or "") or None,
        )

    if action == "move_mail":
        from backend.api.mail_routes import move_message

        account = _assert_global_integration_access(str(arguments["account"]))
        await _require_mail_message_revision(
            account,
            str(arguments["message_id"]),
            str(arguments.get("message_revision") or ""),
            expected_source=str(arguments.get("message_source") or ""),
            folder=str(arguments.get("folder") or ""),
        )
        return await move_message(
            str(arguments["message_id"]),
            account,
            {
                "target_folder": str(arguments["target_folder"]),
                "imap_uid": str(arguments.get("imap_uid") or ""),
                "imap_folder": str(arguments.get("imap_folder") or ""),
            },
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
        import asyncio

        from fastapi import BackgroundTasks, HTTPException
        from backend.api.vault_routes import (
            _move_page_to_trash,
            delete_table as route_delete_table,
        )

        table = _table(str(arguments["table_id"]))
        if not table:
            raise LookupError("Table not found.")
        snapshot = _table_delete_snapshot(table)
        revision_fields = (
            "table_revision",
            "views_revision",
            "rows_revision",
            "asset_revision",
        )
        if any(
            str(snapshot[field]) != str(arguments.get(field) or "")
            for field in revision_fields
        ):
            raise ActionConflictError(
                "The table, its views, rows, or assets changed after the preview."
            )
        row_action = str(arguments.get("row_action") or "").strip().lower()
        if row_action not in {"unlink", "delete"}:
            raise ValueError("The confirmed table row action is invalid.")

        prepared_rows = []
        for row in snapshot["rows"]:
            path = _resolve_snapshotted_row_path(row["relative_path"])
            _require_file_revision(
                path,
                row["revision"],
                f"Table row {row['id']}",
            )
            metadata, body = _parse(path)
            current_table_id = str(
                metadata.get("table_id")
                or metadata.get("database_table_id")
                or ""
            )
            if current_table_id != str(arguments["table_id"]):
                raise ActionConflictError(
                    f"Table row {row['id']} changed membership after the preview."
                )
            prepared_rows.append({
                "id": row["id"],
                "path": path,
                "original": path.read_bytes(),
                "metadata": metadata,
                "body": body,
            })

        tasks = background_tasks or BackgroundTasks()
        changed_rows = []
        if row_action == "unlink":
            try:
                with _BULK_UPDATE_LOCK:
                    for item in prepared_rows:
                        new_metadata = dict(item["metadata"])
                        new_metadata.pop("table_id", None)
                        new_metadata.pop("database_table_id", None)
                        changed_rows.append(item)
                        _write_page(item["path"], new_metadata, item["body"])
            except Exception as error:
                rollback_failed = _rollback_page_items(changed_rows)
                if rollback_failed:
                    return {
                        "status": "partial",
                        "updated_count": len(rollback_failed),
                        "rollback_failed_ids": rollback_failed,
                        "error": str(error)[:500],
                    }
                raise RuntimeError(
                    "Table row unlinking failed and all rows were rolled back."
                ) from error
        else:
            failed_ids = []
            for item in prepared_rows:
                try:
                    await asyncio.to_thread(
                        _move_page_to_trash,
                        str(item["id"]),
                        item["path"],
                    )
                    changed_rows.append(item)
                except Exception:
                    failed_ids.append(str(item["id"]))
                    break
            if failed_ids:
                return {
                    "status": "partial",
                    "updated_count": len(changed_rows),
                    "failed_count": len(failed_ids),
                    "failed_ids": failed_ids,
                    "row_ids": [str(item["id"]) for item in changed_rows],
                }

        try:
            result = await route_delete_table(
                str(arguments["table_id"]),
                tasks,
                expected_table_revision=str(arguments["table_revision"]),
                expected_views_revision=str(arguments["views_revision"]),
                expected_asset_revision=str(arguments["asset_revision"]),
            )
        except HTTPException as error:
            if row_action == "unlink":
                rollback_failed = _rollback_page_items(changed_rows)
                if rollback_failed:
                    return {
                        "status": "partial",
                        "updated_count": len(rollback_failed),
                        "rollback_failed_ids": rollback_failed,
                        "error": str(error.detail)[:500],
                    }
            elif error.status_code == 409:
                return {
                    "status": "partial",
                    "updated_count": len(changed_rows),
                    "failed_count": 1,
                    "failed_ids": [str(arguments["table_id"])],
                    "row_ids": [str(item["id"]) for item in changed_rows],
                }
            raise
        except Exception:
            if row_action == "unlink":
                rollback_failed = _rollback_page_items(changed_rows)
                if rollback_failed:
                    return {
                        "status": "partial",
                        "updated_count": len(rollback_failed),
                        "rollback_failed_ids": rollback_failed,
                    }
            raise
        return {
            **(result if isinstance(result, dict) else {}),
            "updated_count": len(changed_rows),
            "row_ids": [str(item["id"]) for item in changed_rows],
            "cleanup_status": (
                (result or {}).get("cleanup_status")
                if isinstance(result, dict)
                else ("queued" if tasks.tasks else "not_required")
            ),
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

            attempted = []
            try:
                for item in prepared:
                    # Register before writing: `_write_page` replaces the file
                    # before refreshing the index, so the same item must be
                    # rolled back when the refresh itself raises.
                    attempted.append(item)
                    _write_page(
                        item["path"],
                        item["metadata"],
                        item["body"],
                    )
            except Exception as error:
                rollback_failed = _rollback_page_items(attempted)
                if rollback_failed:
                    return {
                        "status": "partial",
                        "updated_count": len(rollback_failed),
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
_PAGE_LOCKS_GUARD = threading.Lock()
_PAGE_LOCKS: Dict[str, threading.RLock] = {}


@contextmanager
def _page_lock(path: Path):
    """Serialize one canonical page path across threads and worker processes."""
    key = str(path.resolve())
    lock_stripe = hashlib.sha256(key.encode("utf-8")).hexdigest()[:2]
    with _PAGE_LOCKS_GUARD:
        thread_lock = _PAGE_LOCKS.setdefault(lock_stripe, threading.RLock())
    with thread_lock:
        lock_path = Path(tempfile.gettempdir()) / f"gnosi-page-lock-{lock_stripe}.lock"
        with lock_path.open("a+b") as lock_file:
            try:
                import fcntl
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            except ImportError:
                fcntl = None
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _mutate_page(path: Path, mutator) -> Dict[str, Any]:
    """Read, mutate, version, and write a page as one serialized operation."""
    with _page_lock(path):
        expected_revision = _file_revision(path)
        metadata, body = _parse(path)
        next_metadata, next_body = mutator(metadata, body)
        if _file_revision(path) != expected_revision:
            raise ActionConflictError(
                "The page changed while the agent was preparing the update.",
            )
        _write_page(path, next_metadata, next_body)
        return next_metadata
