"""Vault-backed mail persistence helpers."""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Optional, cast

import yaml  # type: ignore[import-untyped]
from fastapi import HTTPException

from backend.services.context_vars import get_active_vault_path, get_primary_vault_path
from backend.utils.safe_io import safe_write_text

log = logging.getLogger(__name__)


def get_mail_vault_path() -> Path:
    base = get_primary_vault_path()
    return (base / "Mail") if base else (get_active_vault_path() / "Mail")


def get_vault_path() -> Optional[Path]:
    # Returns `Optional[Path]` because `get_primary_vault_path()` and
    # `get_active_vault_path()` both return `Optional[Path]`: if no config
    # or context defines "VAULT", both yield `None`. Callers must
    # save the return value or use `get_mail_vault_path()` (it has a built-in fallback).
    return cast(Optional[Path], get_primary_vault_path() or get_active_vault_path())


_MESSAGE_ID_RE = re.compile(r"^[A-Za-z0-9_\-@.+]+$")


def _validate_message_id(message_id: str) -> str:
    """Validates and returns the message_id, or raises HTTPException(400)."""
    mid = str(message_id or "").strip()
    if not mid or not _MESSAGE_ID_RE.match(mid) or len(mid) > 256:
        raise HTTPException(status_code=400, detail="Invalid message id")
    return mid


def _find_message_files(mail_path: Path, message_id: str) -> list[Path]:
    """Returns mail .md files matching `<message_id>_*.md` or that contain
    the (validated) id in the stem. Validates the id before any glob to
    avoid arbitrary glob patterns landing in user input.
    """
    mid = _validate_message_id(message_id)
    files = list(mail_path.glob(f"{mid}_*.md"))
    if not files:
        files = [f for f in mail_path.glob("*.md") if mid in f.stem]
    return files


def _sanitize_yaml_string(val: str) -> str:
    """Escape problematic characters to make a string safe for YAML.

    The sync service sometimes generates metadata values that already
    contain double quotes (for example the sender field often looks like
    ``"Name" <email@example.com>``).  ``yaml.dump`` wraps the entire value
    in quotes but does not escape inner quotes, leading to invalid YAML like
    ``sender: ""Name" <...>"`` which crashes the parser.  We keep a very
    simple heuristic here: escape every double quote with a backslash so the
    dumper produces a valid quoted string.
    """
    return val.replace('"', '\\"')


def _naive_metadata_from_text(yaml_text: str) -> dict[str, Any]:
    """Parse a YAML-like block using a very forgiving line-by-line strategy.

    This is only used when ``yaml.safe_load`` fails; we don't need to handle
    recursion or complex structures since the mail frontmatter is flat.
    """
    out = {}
    for line in yaml_text.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        cleaned = val.strip().strip('"').strip("'")
        out[key.strip()] = cleaned
    return out


def _repair_file(file_path: Path, yaml_text: str, body: str) -> Any:
    """Attempt to rewrite a mailbox file with safe frontmatter.

    ``yaml_text`` is the raw text of the frontmatter (between the ``---``
    markers) and ``body`` is the remainder.  We build a metadata dict using
    ``_naive_metadata_from_text`` so we don't depend on the broken YAML, then
    sanitize and dump it back to disk.  This makes the file parseable on
    subsequent reads and prevents the same error from being logged repeatedly.
    """
    metadata = _naive_metadata_from_text(yaml_text)
    # escape every string value so the dumper won't blow up again
    for k, v in list(metadata.items()):
        if isinstance(v, str):
            metadata[k] = _sanitize_yaml_string(v)
    new_front = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
    safe_write_text(file_path, f"---\n{new_front}---\n\n{body}\n")
    log.info(f"Rewrote malformed mail frontmatter in {file_path}")


def parse_frontmatter(content: str, file_path: Optional[Path] | None = None) -> Any:
    """Parses a markdown file to extract YAML frontmatter and body.

    ``file_path`` is optional and only used to provide context in logs.
    In the mail subsystem we log at DEBUG level because malformed frontmatter
    is expected occasionally when emails contain stray YAML-like content.
    """
    match = re.search(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)", content, re.DOTALL)
    if not match:
        match = re.search(r"^---\s*\n(.*?)\n---\s*\n(.*)", content, re.DOTALL)

    if match:
        try:
            metadata = yaml.safe_load(match.group(1)) or {}
            body = match.group(2)
            return metadata, body
        except Exception as e:
            location = f" in {file_path}" if file_path else ""
            log.debug(f"Error parsing mail frontmatter{location}: {e}")
            # try to repair the file contents so future reads succeed
            if file_path:
                try:
                    _repair_file(file_path, match.group(1), match.group(2))
                    # after rewriting the file we can safely parse again and return
                    fixed = file_path.read_text(encoding="utf-8")
                    return parse_frontmatter(fixed, file_path)
                except Exception as rerr:
                    log.debug(f"Failed to repair {file_path}: {rerr}")

    return {}, content


def get_unix_timestamp(date_str: Any) -> Any:
    """Converts a date string to a Unix timestamp (seconds)."""
    if not date_str:
        return int(time.time())
    try:
        # Try email format (RFC 2822)
        dt = parsedate_to_datetime(str(date_str))
        return int(dt.timestamp())
    except Exception:
        try:
            # If it's a YAML datetime object
            if isinstance(date_str, datetime):
                return int(date_str.timestamp())
        except Exception:
            pass
    return int(time.time())


def _load_vault_drafts(account_email: str) -> list[Any]:
    """Returns the drafts saved locally in the vault for an IMAP account."""
    mail_path = get_mail_vault_path()
    if not mail_path.exists():
        return []
    drafts = []
    for f in mail_path.glob("draft_*.md"):
        try:
            content = f.read_text(encoding="utf-8")
            metadata, body = parse_frontmatter(content, f)
            if metadata.get("type") != "Draft":
                continue
            if account_email and metadata.get("account", "") != account_email:
                continue
            date_val = metadata.get("date")
            drafts.append(
                {
                    "id": metadata.get("id") or f.stem,
                    "thread_id": metadata.get("thread_id") or f.stem,
                    "subject": metadata.get("title") or "(Esborrany)",
                    "sender": metadata.get("sender") or account_email,
                    "recipient": metadata.get("recipients") or "",
                    "cc": metadata.get("cc") or "",
                    "date": str(date_val) if date_val else "",
                    "timestamp": get_unix_timestamp(date_val) if date_val else 0,
                    "body_text": body or "",
                    "is_read": True,
                    "is_starred": False,
                    "has_attachments": False,
                    "archived": False,
                    "type": "Draft",
                    "account": account_email,
                    "source": "vault",
                }
            )
        except Exception:
            continue
    drafts.sort(key=lambda d: d.get("timestamp", 0), reverse=True)
    return drafts
