"""Complete, date-ordered header listing across selected IMAP mailboxes."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Any

from backend.domains.mail.cache import _MAIL_CACHE
from backend.domains.mail.sync.imap_protocol import _imap_name
from backend.services.context_vars import active_vault_path

HEADER_FIELDS = "BODY.PEEK[HEADER.FIELDS (DATE SUBJECT FROM TO CC MESSAGE-ID)]"
_HEADER_BATCH_SIZE = 200
# Serialized snapshots keep the shared 128-entry cache bounded to at most 32 MiB
# of header payloads. Oversized batches remain readable without being cached.
_MAX_HEADER_BATCH_CACHE_BYTES = 256 * 1024


def search_uids(imap: Any, criteria: str) -> tuple[Any, Any]:
    if criteria.isascii():
        status, data = imap.uid("search", None, criteria)
    else:
        status, data = imap.uid("search", "CHARSET", "UTF-8", criteria.encode("utf-8"))
    return status, data


def _uidvalidity(imap: Any) -> str | None:
    """Return SELECT's UID generation, disabling reuse when it is unavailable."""
    response = getattr(imap, "response", None)
    if not callable(response):
        return None
    try:
        status, data = response("UIDVALIDITY")
    except (AttributeError, TypeError, ValueError):
        return None
    if status != "UIDVALIDITY" or not isinstance(data, (list, tuple)) or len(data) != 1:
        return None
    value = data[0]
    if not isinstance(value, (str, bytes)):
        return None
    if isinstance(value, bytes):
        value = value.decode("ascii", errors="replace")
    if not value.isascii() or not value.isdigit() or not 0 < int(value) <= 0xFFFFFFFF:
        return None
    return str(int(value))


def _matches_uids(headers: list[dict[str, Any]], batch: list[bytes]) -> bool:
    received = [str(item.get("imap_uid", "")) for item in headers]
    return len(received) == len(batch) and set(received) == {uid.decode("ascii") for uid in batch}


def _cached_headers(key: str | None, batch: list[bytes]) -> list[dict[str, Any]] | None:
    if key is None:
        return None
    snapshot = _MAIL_CACHE.get(key)
    if not isinstance(snapshot, bytes) or len(snapshot) > _MAX_HEADER_BATCH_CACHE_BYTES:
        return None
    try:
        headers = json.loads(snapshot)
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(headers, list) or not all(isinstance(item, dict) for item in headers):
        return None
    return headers if _matches_uids(headers, batch) else None


def _cache_headers(key: str | None, headers: list[dict[str, Any]]) -> None:
    if key is None:
        return
    chunks: list[bytes] = []
    size = 0
    try:
        for chunk in json.JSONEncoder(ensure_ascii=False, separators=(",", ":")).iterencode(headers):
            encoded = chunk.encode("utf-8")
            size += len(encoded)
            if size > _MAX_HEADER_BATCH_CACHE_BYTES:
                return
            chunks.append(encoded)
    except (TypeError, UnicodeEncodeError, ValueError):
        # Optional caching must not prevent a complete direct listing.
        return
    _MAIL_CACHE.set(key, b"".join(chunks))


def _search_all_uids(imap: Any, criteria: str) -> list[bytes]:
    status, data = search_uids(imap, criteria)
    if (
        status != "OK" or not isinstance(data, (list, tuple)) or not data
        or not all(isinstance(part, bytes) for part in data)
    ):
        raise RuntimeError("Unable to search a mailbox while reading all mail")
    uids = b" ".join(data).split()
    if any(not uid.isdigit() or not 0 < int(uid) <= 0xFFFFFFFF for uid in uids):
        raise RuntimeError("Invalid message identifiers while reading all mail")
    uids = sorted((str(int(uid)).encode("ascii") for uid in uids), key=int)
    if len(set(uids)) != len(uids):
        raise RuntimeError("Duplicate message identifiers while reading all mail")
    return uids


def _read_header_batch(
    imap: Any, batch: list[bytes], fetch_args: str,
    parse_item: Callable[..., dict[str, Any] | None], email: str,
    name: str, parse_folder: str,
) -> list[dict[str, Any]]:
    status, fetched = imap.uid("fetch", b",".join(batch).decode("ascii"), fetch_args)
    if status != "OK" or not isinstance(fetched, (list, tuple)) or not fetched:
        raise RuntimeError("Unable to read message headers while reading all mail")
    headers = []
    for index, part in enumerate(fetched):
        item = parse_item(fetched, index, parse_folder, email, name)
        if item is None:
            if isinstance(part, tuple):
                raise RuntimeError("Invalid message headers while reading all mail")
            continue
        headers.append(item)
    if not _matches_uids(headers, batch):
        raise RuntimeError("Incomplete message headers while reading all mail")
    return headers


def _apply_folder_metadata(
    headers: list[dict[str, Any]], name: str, kind: str,
    logical_folder: str, gmail: bool,
) -> None:
    for item in headers:
        item["imap_folder"] = name
        if logical_folder.upper() == "ARCHIVE":
            item["archived"] = True
        elif not (gmail and kind == "All"):
            item["archived"] = kind in ("Archived", "Custom")
        if kind in ("Sent", "Draft"):
            item["type"] = kind


def _mailbox_headers(
    imap: Any, email: str, name: str, kind: str, criteria: str,
    parse_item: Callable[..., dict[str, Any] | None], *,
    gmail: bool, logical_folder: str,
) -> list[dict[str, Any]]:
    status, _ = imap.select(_imap_name(name, always_quote=True), readonly=True)
    if status != "OK":
        raise RuntimeError("Unable to open a mailbox while reading all mail")
    uidvalidity = _uidvalidity(imap)
    uids = _search_all_uids(imap, criteria)
    membership = hashlib.sha256(b" ".join(uids)).hexdigest()
    vault = active_vault_path.get()
    scope = json.dumps([
        str(vault) if vault is not None else None, email.casefold(), name, kind,
        logical_folder.upper(), gmail, criteria, uidvalidity, membership,
    ], ensure_ascii=False, separators=(",", ":"))
    prefix = f"mail-header-batch|{hashlib.sha256(scope.encode('utf-8')).hexdigest()}"

    # Snapshot existing hits before misses are inserted, so a listing larger
    # than the cache can still reuse its retained batches without LRU churn.
    batches: list[tuple[list[bytes], str | None, list[dict[str, Any]] | None]] = []
    for start in range(0, len(uids), _HEADER_BATCH_SIZE):
        batch = uids[start:start + _HEADER_BATCH_SIZE]
        key = f"{prefix}|{start}" if uidvalidity is not None else None
        batches.append((batch, key, _cached_headers(key, batch)))
    fetch_args = (
        f"(UID FLAGS X-GM-THRID X-GM-LABELS {HEADER_FIELDS})" if gmail
        else f"(UID FLAGS {HEADER_FIELDS})"
    )
    parse_folder = logical_folder if gmail and kind == "All" else name
    messages = []
    for batch, key, headers in batches:
        if headers is None:
            headers = _read_header_batch(imap, batch, fetch_args, parse_item, email, name, parse_folder)
            _apply_folder_metadata(headers, name, kind, logical_folder, gmail)
            _cache_headers(key, headers)
        messages.extend(headers)
    return messages


def list_all_mailboxes(
    imap: Any,
    email: str,
    folders: list[tuple[str, str]],
    criteria: str,
    limit: int,
    offset: int,
    parse_item: Callable[..., dict[str, Any] | None],
    *,
    gmail: bool = False,
    logical_folder: str = "all",
) -> dict[str, Any]:
    """Merge every caller-selected mailbox before applying date pagination.

    UID numbers are local to a mailbox and cannot order messages across folders.
    A cold listing must read every matching message's small headers in bounded
    round trips to establish the actual date order. Warm pages can reuse modest
    batch snapshots while UIDVALIDITY and the complete UID membership agree.
    Without UIDVALIDITY, an identical UID set could belong to a reset mailbox,
    so caching is skipped. Never publish a partial provider read as complete.
    """
    messages: list[dict[str, Any]] = []
    for name, kind in folders:
        messages.extend(_mailbox_headers(
            imap, email, name, kind, criteria, parse_item,
            gmail=gmail, logical_folder=logical_folder,
        ))

    messages.sort(key=lambda item: (
        item.get("timestamp", 0), item["imap_folder"], int(item["imap_uid"]),
    ), reverse=True)
    return {"messages": messages[offset:offset + limit], "total": len(messages)}
