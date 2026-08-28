"""Shared deterministic helpers for first-party Gnosi tools."""

from __future__ import annotations

import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, cast

import yaml

from backend.services.content_revision import tree_revision
from backend.utils.safe_io import safe_write_bytes, safe_write_text

MAX_LIST_ITEMS = 100


MAX_BODY_CHARS = 12_000


MAX_DETERMINISTIC_BULK_ITEMS = 5_000


MAX_REFERENCE_TABLES = 10


MAX_CONFIRMATION_SAMPLE_ITEMS = 8


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
            "Installation-global integrations are unavailable outside the personal workspace."
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
                if str(item.get("email") or item.get("username") or "").strip().lower()
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
        raise ActionConflictError(f"{target} changed after the confirmation preview.")


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
                "subject": str(metadata.get("subject") or metadata.get("title") or "")[:500],
                "sender": str(metadata.get("sender") or metadata.get("from") or "")[:500],
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

    canonical: Dict[str, Any] = {
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
        "imap_folder": str(message.get("imap_folder") or folder or ""),
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
        raise ActionConflictError("The mail message changed after the confirmation preview.")
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
                    json.loads(sidecar.read_text(encoding="utf-8")).get("title") or entry.name
                )
            except Exception:
                pass
        snapshot.append(
            {
                "id": entry.name,
                "revision": revision,
                "title": title[:500],
            }
        )
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

    typed_parse = cast(
        Callable[[str, Path], tuple[Dict[str, Any], str]],
        parse_frontmatter,
    )
    return typed_parse(path.read_text(encoding="utf-8"), path)


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
        return [_bounded_json_value(item, depth=depth + 1) for item in list(value)[:100]]
    return value


def _serialize_page(path: Path, *, include_body: bool = False) -> Dict[str, Any]:
    metadata, body = _parse(path)
    bounded_metadata = _bounded_json_value(metadata)
    result = {
        "id": str(metadata.get("id") or ""),
        "title": str(metadata.get("title") or path.stem),
        "table_id": str(metadata.get("table_id") or metadata.get("database_table_id") or ""),
        "metadata": bounded_metadata,
    }
    if include_body:
        result["content"] = body[:MAX_BODY_CHARS]
        result["truncated"] = len(body) > MAX_BODY_CHARS
    return result


def _write_page(path: Path, metadata: Dict[str, Any], body: str) -> None:
    from backend.api.vault_routes import _create_page_version, register_page_in_index

    create_page_version = cast(Callable[[str, Path, bool], object], _create_page_version)
    index_page = cast(Callable[[Path], None], register_page_in_index)
    if path.exists():
        create_page_version(str(metadata.get("id") or ""), path, True)
    frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).strip()
    safe_write_text(path, f"---\n{frontmatter}\n---\n\n{body.rstrip()}\n")
    index_page(path)


def _rollback_page_items(items: Iterable[Dict[str, Any]]) -> List[str]:
    """Restore attempted page writes and return IDs that could not be restored."""
    from backend.api.vault_routes import register_page_in_index

    index_page = cast(Callable[[Path], None], register_page_in_index)
    failed: List[str] = []
    for item in reversed(list(items)):
        try:
            safe_write_bytes(item["path"], item["original"])
            index_page(item["path"])
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
        current_table_id = str(metadata.get("table_id") or metadata.get("database_table_id") or "")
        if current_table_id != str(table_id):
            continue
        rows.append(
            {
                "id": str(metadata.get("id") or ""),
                "title": str(metadata.get("title") or path.stem)[:500],
                "relative_path": path.relative_to(vault).as_posix(),
                "revision": _file_revision(path),
            }
        )
    return sorted(rows, key=lambda row: row["relative_path"])


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _reference_title_replacement_plan(
    source_rows: List[Dict[str, str]],
    references: List[Dict[str, Any]],
) -> tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """Build an exact index-title replacement plan from complete snapshots."""
    matchers = []
    for reference in references:
        label = str(reference.get("label") or "").strip()
        rows = list(reference.get("rows") or [])
        title_by_id = {
            str(row.get("id") or "").casefold(): str(row.get("title") or "")
            for row in rows
            if row.get("id") and row.get("title")
        }
        pattern = re.compile(
            rf"^(?P<head>\s*(?:Índex|Index)\s*[-·–—]\s*"
            rf"{re.escape(label)}\s*:\s*)(?P<reference_id>.+?)\s*$",
            re.IGNORECASE,
        )
        matchers.append((label, title_by_id, pattern))

    updates: List[Dict[str, str]] = []
    unresolved: List[Dict[str, str]] = []
    for row in source_rows:
        old_title = str(row.get("title") or "")
        for label, title_by_id, pattern in matchers:
            match = pattern.fullmatch(old_title)
            if not match:
                continue
            reference_id = match.group("reference_id").strip()
            replacement = title_by_id.get(reference_id.casefold())
            if replacement:
                row_id = str(row.get("id") or "")
                if not row_id:
                    break
                new_title = f"{match.group('head')}{replacement}"
                if new_title != old_title:
                    updates.append(
                        {
                            "id": row_id,
                            "old_title": old_title,
                            "new_title": new_title,
                            "relative_path": str(row.get("relative_path") or ""),
                            "revision": str(row.get("revision") or ""),
                        }
                    )
            elif _UUID_RE.fullmatch(reference_id):
                unresolved.append(
                    {
                        "id": str(row.get("id") or ""),
                        "title": old_title,
                        "label": label,
                        "reference_id": reference_id,
                    }
                )
            break
    return updates, unresolved


def _table_delete_snapshot(table: Dict[str, Any]) -> Dict[str, Any]:
    """Bind table, views, rows, and active assets to one confirmation."""
    from backend.api.vault_routes import (
        _table_asset_revision,
        _table_views_revision,
        load_registry,
    )

    typed_load_registry = cast(Callable[[], Dict[str, Any]], load_registry)
    typed_views_revision = cast(
        Callable[[Dict[str, Any], str], str],
        _table_views_revision,
    )
    registry = typed_load_registry()
    table_id = str(table.get("id") or "")
    current_table = next(
        (item for item in registry.get("tables", []) if str(item.get("id") or "") == table_id),
        None,
    )
    if not current_table:
        raise LookupError("Table not found.")
    database = next(
        (
            item
            for item in registry.get("databases", [])
            if str(item.get("id") or "") == str(current_table.get("database_id") or "")
        ),
        None,
    )
    rows = _table_rows_snapshot(table_id)
    views = [
        item for item in registry.get("views", []) if str(item.get("table_id") or "") == table_id
    ]
    return {
        "table_revision": _value_revision(current_table),
        "views_revision": typed_views_revision(registry, table_id),
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
    return str(table.get("folder") or table.get("path") or table.get("name") or "Databases")
