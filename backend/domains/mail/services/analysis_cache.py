"""Bounded local persistence for the last valid mail analysis result."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pydantic import JsonValue, TypeAdapter, ValidationError

from backend.config.data_dir import resolve_data_dir

MAX_ANALYSIS_CACHE_BYTES = 4 * 1024 * 1024
MAX_ANALYSIS_CACHE_ENTRIES = 128
MAX_ANALYSIS_ENTRY_BYTES = 128 * 1024
MAX_ANALYSIS_ITEMS = 100

_CACHE_VERSION = 1
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_JSON_LIST = TypeAdapter(list[JsonValue])


@dataclass(frozen=True)
class PreviousMailAnalysis:
    """One validated provider result for an exact input digest."""

    events: list[JsonValue]
    contacts: list[JsonValue]


def _cache_root() -> Path:
    return resolve_data_dir(create=True) / "cache" / "mail" / "analysis-results"


def _update_digest(hasher: hashlib._Hash, value: str) -> None:
    encoded = value.encode("utf-8")
    hasher.update(len(encoded).to_bytes(8, "big"))
    hasher.update(encoded)


def analysis_input_digest(
    context: str,
    *,
    sender: str,
    recipients: tuple[str, ...],
    attachments: tuple[str, ...],
) -> str:
    """Identify exact analysis input without retaining any input field."""
    hasher = hashlib.sha256()
    _update_digest(hasher, context)
    _update_digest(hasher, sender)
    for collection in (recipients, attachments):
        hasher.update(len(collection).to_bytes(4, "big"))
        for value in collection:
            _update_digest(hasher, value)
    return hasher.hexdigest()


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _atomic_write(path: Path, body: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            os.chmod(temporary, 0o600)
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        _safe_unlink(temporary)


def _validated_items(value: object) -> list[JsonValue]:
    items = _JSON_LIST.validate_python(value, strict=True)
    if len(items) > MAX_ANALYSIS_ITEMS:
        raise ValueError("too many cached analysis items")
    return items


def load_previous_mail_analysis(
    context: str,
    *,
    sender: str,
    recipients: tuple[str, ...],
    attachments: tuple[str, ...],
) -> PreviousMailAnalysis | None:
    """Load a bounded exact-match result; corruption is a cache miss."""
    key = analysis_input_digest(
        context,
        sender=sender,
        recipients=recipients,
        attachments=attachments,
    )
    path = _cache_root() / f"{key}.json"
    try:
        if path.stat().st_size > MAX_ANALYSIS_ENTRY_BYTES:
            raise ValueError("cached analysis is oversized")
        raw: object = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("cached analysis root is invalid")
        if raw.get("version") != _CACHE_VERSION or raw.get("input_digest") != key:
            raise ValueError("cached analysis identity is invalid")
        events = _validated_items(raw.get("events"))
        contacts = _validated_items(raw.get("contacts"))
        os.utime(path, None)
    except (OSError, UnicodeError, json.JSONDecodeError, ValidationError, ValueError):
        _safe_unlink(path)
        return None
    return PreviousMailAnalysis(events=events, contacts=contacts)


def _prune_cache(root: Path) -> None:
    entries: list[tuple[float, int, Path]] = []
    try:
        paths = list(root.glob("*.json"))
    except OSError:
        return
    for path in paths:
        if not _DIGEST_RE.fullmatch(path.stem):
            _safe_unlink(path)
            continue
        try:
            info = path.stat()
        except OSError:
            continue
        if info.st_size <= 0 or info.st_size > MAX_ANALYSIS_ENTRY_BYTES:
            _safe_unlink(path)
            continue
        entries.append((info.st_mtime, info.st_size, path))
    total = sum(item[1] for item in entries)
    while len(entries) > MAX_ANALYSIS_CACHE_ENTRIES or total > MAX_ANALYSIS_CACHE_BYTES:
        oldest = min(entries)
        entries.remove(oldest)
        total -= oldest[1]
        _safe_unlink(oldest[2])


def store_previous_mail_analysis(
    context: str,
    *,
    sender: str,
    recipients: tuple[str, ...],
    attachments: tuple[str, ...],
    events: object,
    contacts: object,
) -> None:
    """Persist only validated structured output, never source mail or raw AI text."""
    try:
        validated_events = _validated_items(events)
        validated_contacts = _validated_items(contacts)
        key = analysis_input_digest(
            context,
            sender=sender,
            recipients=recipients,
            attachments=attachments,
        )
        payload = json.dumps(
            {
                "version": _CACHE_VERSION,
                "input_digest": key,
                "events": validated_events,
                "contacts": validated_contacts,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(payload) > MAX_ANALYSIS_ENTRY_BYTES:
            return
        root = _cache_root()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(root, 0o700)
        _atomic_write(root / f"{key}.json", payload)
        _prune_cache(root)
    except (OSError, TypeError, ValidationError, ValueError):
        return
