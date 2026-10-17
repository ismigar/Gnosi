"""IMAP protocol normalization and folder discovery."""

from __future__ import annotations

import logging
import re
from email.header import decode_header
from typing import Any, NamedTuple

log = logging.getLogger(__name__)


class _FolderInfo(NamedTuple):
    name: str
    kind: str
    delimiter: str | None
    selectable: bool = True

_FLAG_TYPE_MAP = {
    "\\sent": "Sent",
    "\\trash": "Deleted",
    "\\junk": "Spam",
    "\\drafts": "Draft",
    "\\spam": "Spam",
    "\\archive": "Archived",
    "\\all": "All",
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


def _imap_name(folder_name: str, *, always_quote: bool = False) -> str:
    """Quote mailbox names and escape quoted-string specials for IMAP."""
    if any(ord(character) < 32 or ord(character) == 127 for character in folder_name):
        raise ValueError("Invalid control character in mailbox name")
    if always_quote or any(character.isspace() or character in '(){%*"\\]}' for character in folder_name):
        escaped = folder_name.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return folder_name


def _list_delimiter(token: str) -> str | None:
    if token == "NIL":
        return None
    delimiter = re.sub(r'\\(["\\])', r'\1', token[1:-1])
    if len(delimiter) != 1 or ord(delimiter) < 32 or ord(delimiter) == 127:
        raise ValueError("Invalid mailbox hierarchy delimiter")
    return delimiter


def _parse_list_entry(entry: Any) -> tuple[list[str], str, str | None] | None:
    """Decode quoted, atom and literal mailbox names returned by imaplib."""
    literal = None
    if isinstance(entry, tuple) and len(entry) == 2:
        entry, literal = entry
    line = entry.decode("utf-8") if isinstance(entry, bytes) else entry
    if not line:
        return None
    if not isinstance(line, str):
        raise ValueError("Unsupported mailbox discovery response")
    match = re.fullmatch(r'\(([^)]*)\)\s+("(?:\\.|[^"\\])*"|NIL)\s+(.+)', line)
    if not match:
        raise ValueError("Invalid mailbox discovery response")
    token = match.group(3).strip()
    if literal is not None:
        length = re.fullmatch(r"\{(\d+)\}", token)
        if not isinstance(literal, bytes) or not length or len(literal) != int(length.group(1)):
            raise ValueError("Invalid literal mailbox name")
        name = literal.decode("utf-8")
    elif token.startswith('"'):
        if not re.fullmatch(r'"(?:\\.|[^"\\])*"', token):
            raise ValueError("Invalid quoted mailbox name")
        name = re.sub(r'\\(["\\])', r'\1', token[1:-1])
    elif re.fullmatch(r'[^\s{}"]+', token):
        name = token
    else:
        raise ValueError("Invalid mailbox name")
    return match.group(1).lower().split(), name, _list_delimiter(match.group(2))


def _find_all_mail_folder(imap: Any) -> str | None:
    r"""Find Gmail's localized \All mailbox, independently of archive folders."""
    status, entries = imap.list()
    if status != "OK":
        return None
    for entry in entries or []:
        try:
            parsed = _parse_list_entry(entry)
        except (UnicodeError, ValueError):
            continue
        if parsed and "\\all" in parsed[0]:
            return parsed[1]
    return None


def _folder_type(name: str, flags: list[str], delimiter: str | None) -> str:
    if name.upper() == "INBOX":
        return "Received"
    for flag, kind in _FLAG_TYPE_MAP.items():
        if flag in flags:
            return kind
    name_lower = name.lower()
    basename = name_lower.rsplit(delimiter, 1)[-1] if delimiter else name_lower
    return _NAME_TYPE_MAP.get(name_lower) or _NAME_TYPE_MAP.get(basename) or "Custom"


def _archive_descendants(folders: list[_FolderInfo], special_use: set[str]) -> list[_FolderInfo]:
    prefixes = [info.name + info.delimiter for info in folders
                if info.kind == "Archived" and info.delimiter is not None]
    return [
        info._replace(kind="Archived")
        if info.name not in special_use and any(info.name.startswith(prefix) for prefix in prefixes)
        else info
        for info in folders
    ]


def _discover_folder_details(imap: Any, *, strict: bool = False) -> list[_FolderInfo]:
    """Retain hierarchy containers without treating them as selectable mailboxes."""
    status, folder_list = imap.list()
    if status != "OK":
        if strict:
            raise RuntimeError("Mail folder discovery is temporarily unavailable")
        return [_FolderInfo("INBOX", "Received", None)]

    folders: list[_FolderInfo] = []
    seen_names: set[str] = set()
    special_use: set[str] = set()

    for raw in folder_list or []:
        try:
            parsed = _parse_list_entry(raw)
        except (UnicodeError, ValueError) as error:
            if strict:
                raise RuntimeError("Mail folder discovery is incomplete") from error
            continue
        if parsed is None:
            continue
        flags, name, delimiter = parsed
        if not name or name in seen_names:
            continue
        selectable = "\\noselect" not in flags and "\\nonexistent" not in flags
        if any(flag in _FLAG_TYPE_MAP for flag in flags):
            special_use.add(name)

        seen_names.add(name)
        folders.append(_FolderInfo(name, _folder_type(name, flags, delimiter), delimiter, selectable))

    if not any(info.name.upper() == "INBOX" for info in folders):
        folders.insert(0, _FolderInfo("INBOX", "Received", None))

    return _archive_descendants(folders, special_use)


def _discover_folders(imap: Any, *, strict: bool = False) -> list[tuple[str, str]]:
    """Return every selectable mailbox, preserving custom and archive folders."""
    return [(info.name, info.kind) for info in _discover_folder_details(imap, strict=strict) if info.selectable]


_FOLDER_TYPE_MAP_REVERSE = {
    "INBOX": "Received",
    "SENT": "Sent",
    "DRAFTS": "Draft",
    "TRASH": "Deleted",
    "SPAM": "Spam",
    "ARCHIVE": "Archived",
    "ALL": "All",
    "NOT_ARCHIVED": "Received",
    "STARRED": None,
}
