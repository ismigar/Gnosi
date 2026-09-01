"""
safe_io.py — Atomic and cloud-safe filesystem helpers.

Why this module exists:
    Cloud-synced storage (OneDrive, Dropbox, iCloud, Google Drive) sees files
    as the unit of replication. If a process writes a file in-place and the
    cloud client starts uploading mid-write, the remote copy ends up truncated
    or corrupt. SQLite/WAL/journal files multiply the risk because they expect
    POSIX-style page-level fsync semantics that FUSE-based cloud mounts don't
    honor.

Provided primitives:
    safe_write_text(path, text, encoding="utf-8")
    safe_write_bytes(path, data)
    safe_write_json(path, obj, **dumps_kwargs)
        → tmp + fsync + os.replace() — guarantees the file at `path` is either
          the previous version or the new one, never anything in between.

    file_etag(path) -> str | None
        → Cheap fingerprint based on st_mtime_ns + st_size. Used for optimistic
          conflict detection ("did the file change while you were editing?").

    file_mtime_ns(path) -> int | None

Notes:
    - We always write the temp file in the same directory as the target so that
      os.replace() is a true atomic rename (cross-fs renames silently fall back
      to copy+delete on some platforms).
    - We attempt fsync on both file and directory; failures are logged but not
      fatal — atomic rename + a partially-fsynced file is still better than a
      direct write.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Optional, Union

from backend.config.logger_config import get_logger

log = get_logger(__name__)

PathLike = Union[str, "os.PathLike[str]", Path]


def _fsync_dir(directory: Path) -> None:
    """fsync the parent directory so the rename is durable. Best-effort."""
    try:
        fd = os.open(str(directory), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except (OSError, AttributeError):
        # Windows lacks fsync on directories; cloud mounts may reject it.
        pass


def safe_write_bytes(path: PathLike, data: bytes) -> None:
    """Atomically write `data` to `path`.

    Implementation: write to a sibling tmp file → fsync → os.replace().
    Cloud sync clients see the rename as a single replace operation and never
    upload a half-written file.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    # NamedTemporaryFile in same dir → guarantees atomic rename
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent)
    )
    try:
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except OSError:
                    pass
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            raise
        os.replace(tmp_name, target)
        _fsync_dir(target.parent)
    except Exception:
        # Cleanup orphan tmp on failure
        try:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
        except OSError:
            pass
        raise


def safe_write_text(path: PathLike, text: str, encoding: str = "utf-8") -> None:
    """Atomically write `text` to `path` with the given encoding."""
    safe_write_bytes(path, text.encode(encoding))


def safe_write_json(path: PathLike, obj: Any, **dumps_kwargs: Any) -> None:
    """Atomically dump `obj` as JSON to `path`. Defaults: ensure_ascii=False, indent=2."""
    dumps_kwargs.setdefault("ensure_ascii", False)
    dumps_kwargs.setdefault("indent", 2)
    safe_write_text(path, json.dumps(obj, **dumps_kwargs))


# Characters/forms forbidden on OneDrive/Windows. See
# docs/dev_memory/directives/onedrive_filename_safety.md.
_FILENAME_FORBIDDEN_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

# Windows reserved device names: invalid as a file OR folder name even with an
# extension (`CON.md` is also blocked). Comparison is against the part up to
# the FIRST dot, case-insensitive.
_WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(0, 10)}
    | {f"LPT{i}" for i in range(0, 10)}
)


def guard_windows_reserved(name: str) -> str:
    """Prefix `_` if the name clashes with a Windows reserved device (CON, NUL…).

    Windows/OneDrive blocks the name when the part BEFORE the first dot is a
    reserved device name, with any extension (`nul`, `CON.md`, `com1.contact.md`).
    """
    if not name:
        return name
    stem = str(name).split(".", 1)[0].rstrip(" ")
    if stem.upper() in _WINDOWS_RESERVED_NAMES:
        return "_" + name
    return name


def sanitize_filename_component(value: str) -> str:
    """Return `value` cleaned for use inside a single path component.

    Removes: reserved chars (`<>:"/\\|?*`), control chars, and any whitespace
    (including `\\r\\n` which appears in folded Message-ID headers). Strip
    external `.` and spaces. Suitable for Message-IDs, slugs, titles.

    """
    if value is None:
        return ""
    # Remove reserved + control
    cleaned = _FILENAME_FORBIDDEN_RE.sub("", str(value))
    # Strips any whitespace (Message-IDs never legitimately carry any)
    cleaned = re.sub(r"\s+", "", cleaned)
    # External strip of chars that Windows doesn't accept at the start/end of a name
    cleaned = cleaned.strip(" .")
    return guard_windows_reserved(cleaned)


def sanitize_path_segment(value: object, fallback: str) -> str:
    """Return `value` cleaned for use as ONE path segment (album, file).

    Unlike `sanitize_filename_component`, it keeps the interior
    spaces (human album/file names), collapsed into a single one. Path
    separators are converted to a space and only letters,
    digits, `_`, `-`, `.` and space survive. If the result ends up empty OR made up only
    of dots (`.`/`..`, traversal), it returns `fallback`.

    See docs/dev_memory/directives/media_upload_path_safety.md: this
    sanitizer is NOT the only defense against traversal — the caller must
    still contain the final destination within its own root.

    """
    cleaned = re.sub(r"[\\/]+", " ", str(value or "")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^\w\-. ]", "", cleaned, flags=re.UNICODE)
    # Truncate BEFORE the final strip: if the cut lands on a space, or exposes a
    # dot as the last character, OneDrive would reject the name.
    cleaned = cleaned[:120].strip().rstrip(" .")
    if not cleaned:
        return fallback
    return guard_windows_reserved(cleaned)


def sanitize_vault_title(title: object, fallback: str = "Sense títol", max_len: int = 120) -> str:
    """Human title → OneDrive/Windows-safe filename base, WITHOUT slugifying.

    Preserves accents, case and interior spaces (cf. test_pipeline_naming:
    never slugify names). Only removes what OneDrive/Windows forbids:
    `<>:"/\\|?*`, control chars (`\\n`/`\\t` collapsed to a space), trailing
    spaces/dots (also AFTER truncating) and reserved device names.
    """
    # Collapse whitespace FIRST (so `\n`/`\t` become a word separator instead of
    # being silently deleted as control chars), then drop the forbidden chars.
    safe = re.sub(r"\s+", " ", str(title or ""))
    safe = _FILENAME_FORBIDDEN_RE.sub("", safe)
    safe = re.sub(r" {2,}", " ", safe).strip()
    safe = safe[:max_len].rstrip(" .")
    if not safe:
        return fallback
    return guard_windows_reserved(safe)


def sanitize_rel_folder(path: object, fallback: str = "") -> str:
    """Relative multi-segment path (`A/B/C`) → every segment OneDrive-safe.

    Each segment goes through the same rules as `sanitize_vault_title` (an
    intermediate segment is also a real folder: it cannot end in a space or a
    dot nor be a reserved name). Empty segments and dots-only segments
    (`.`/`..`, traversal) are dropped. Returns `fallback` if none survive.
    """
    segments = []
    for seg in re.split(r"[\\/]+", str(path or "")):
        s = re.sub(r"\s+", " ", seg)
        s = _FILENAME_FORBIDDEN_RE.sub("", s)
        s = re.sub(r" {2,}", " ", s).strip().rstrip(" .")
        if not s:
            continue
        segments.append(guard_windows_reserved(s))
    return "/".join(segments) or fallback


def file_mtime_ns(path: PathLike) -> Optional[int]:
    """Return the file's mtime in nanoseconds, or None if it doesn't exist."""
    try:
        return os.stat(str(path)).st_mtime_ns
    except (FileNotFoundError, PermissionError, OSError):
        return None


def file_etag(path: PathLike) -> Optional[str]:
    """Cheap fingerprint of a file: '<mtime_ns>-<size>'. None if missing.

    Used for optimistic concurrency: include in GET responses, validate on PUT.
    Not cryptographically strong but sufficient for "did this change since I
    last read it?" checks.
    """
    try:
        st = os.stat(str(path))
        return f"{st.st_mtime_ns}-{st.st_size}"
    except (FileNotFoundError, PermissionError, OSError):
        return None
