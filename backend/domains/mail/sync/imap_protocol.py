"""IMAP protocol normalization and folder discovery."""

from __future__ import annotations

import logging
from email.header import decode_header
from typing import Any

log = logging.getLogger(__name__)

_FLAG_TYPE_MAP = {
    "\\sent": "Sent",
    "\\trash": "Deleted",
    "\\junk": "Spam",
    "\\drafts": "Draft",
    "\\spam": "Spam",
    "\\archive": "Archived",
}


_NAME_TYPE_MAP = {
    "sent": "Sent",
    "sent messages": "Sent",
    "sent items": "Sent",
    "enviats": "Sent",
    "trash": "Deleted",
    "deleted": "Deleted",
    "deleted messages": "Deleted",
    "deleted items": "Deleted",
    "papelera": "Deleted",
    "paperera": "Deleted",
    "correu eliminat": "Deleted",
    "bin": "Deleted",
    "wastebasket": "Deleted",
    "junk": "Spam",
    "junk e-mail": "Spam",
    "spam": "Spam",
    "bulk mail": "Spam",
    "bulk": "Spam",
    "drafts": "Draft",
    "draft": "Draft",
    "esborranys": "Draft",
    "archive": "Archived",
    "archives": "Archived",
    "all mail": "Archived",
}


_TYPE_FOLDER_PREFERENCE = {
    "Deleted": ["Deleted", "Trash"],
    "Archived": ["Archive", "Archived", "All Mail"],
}


def _decode_str(val: Any) -> Any:
    import html

    if not val:
        return val
    try:
        parts = decode_header(val)
    except Exception:
        return str(val)
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            codec = enc
            if codec:
                codec = codec.strip().strip('"').strip("'").lower()
                if codec in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                    codec = "utf-8"
            else:
                codec = "utf-8"
            try:
                result.append(part.decode(codec, errors="replace"))
            except LookupError:
                result.append(part.decode("latin1", errors="replace"))
            except Exception:
                result.append(part.decode("utf-8", errors="replace"))
        else:
            result.append(part)
    return html.unescape("".join(result))


def _detect_category(msg: Any) -> str:
    list_id = msg.get("List-ID", "") or msg.get("List-Id", "")
    list_unsub = msg.get("List-Unsubscribe", "")
    precedence = (msg.get("Precedence", "") or "").lower()
    x_ml = msg.get("X-Mailing-List", "") or msg.get("X-ML-Name", "")
    x_google_group = msg.get("X-Google-Group-ID", "")

    if x_google_group or (list_id and "googlegroups" in list_id.lower()):
        return "Forums"
    if list_id or x_ml:
        return "Forums"
    if precedence in ("bulk", "list"):
        return "Promotions"
    if list_unsub:
        return "Promotions"
    return "Main"


def _imap_name(folder_name: str) -> str:
    """Quote folder names that contain spaces for IMAP protocol."""
    return f'"{folder_name}"' if " " in folder_name else folder_name


def _discover_folders(imap: Any) -> list[tuple[str, str]]:
    """Return list of (folder_name, internal_type). INBOX always first."""
    status, folder_list = imap.list()
    if status != "OK":
        return [("INBOX", "Received")]

    folders = []
    seen_types: set[str] = set()

    for raw in folder_list:
        line = raw.decode() if isinstance(raw, bytes) else raw
        parts = line.split('"')
        if len(parts) < 3:
            continue
        flags_part = parts[0].strip().lower()
        name = parts[-2] if parts[-1].strip() == "" else parts[-1]
        name = name.strip().strip('"')
        if not name:
            continue

        folder_type = None
        for flag, ftype in _FLAG_TYPE_MAP.items():
            if flag in flags_part:
                folder_type = ftype
                break

        if folder_type is None:
            name_lower = name.lower()
            folder_type = _NAME_TYPE_MAP.get(name_lower)
            if folder_type is None:
                # Try the base name of hierarchical folders (e.g. "INBOX.Trash" → "trash")
                basename = name_lower.rsplit(".", 1)[-1].rsplit("/", 1)[-1]
                if basename != name_lower:
                    folder_type = _NAME_TYPE_MAP.get(basename)

        if name.upper() == "INBOX":
            folder_type = "Received"

        if folder_type is None:
            continue

        if folder_type in seen_types and folder_type != "Received":
            log.debug(f"[IMAP] Skipping duplicate type {folder_type}: {name}")
            continue

        seen_types.add(folder_type)
        folders.append((name, folder_type))

    if not any(n.upper() == "INBOX" for n, _ in folders):
        folders.insert(0, ("INBOX", "Received"))

    return folders


_FOLDER_TYPE_MAP_REVERSE = {
    "INBOX": "Received",
    "SENT": "Sent",
    "DRAFTS": "Draft",
    "TRASH": "Deleted",
    "SPAM": "Spam",
    "STARRED": None,
}
