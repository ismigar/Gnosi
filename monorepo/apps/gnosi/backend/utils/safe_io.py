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


# Caràcters/forms prohibits a OneDrive/Windows. Veure
# docs/dev_memory/directives/onedrive_filename_safety.md.
_FILENAME_FORBIDDEN_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename_component(value: str) -> str:
    """Return `value` cleaned for use inside a single path component.

    Removes: reserved chars (`<>:"/\\|?*`), control chars, and any whitespace
    (incloent `\\r\\n` que apareix als headers Message-ID folded). Strip
    extern de `.` i espais. Adequat per Message-IDs, slugs, títols.
    """
    if value is None:
        return ""
    # Treu reserved + control
    cleaned = _FILENAME_FORBIDDEN_RE.sub("", str(value))
    # Treu qualsevol whitespace (Message-IDs no en duen mai legítim)
    cleaned = re.sub(r"\s+", "", cleaned)
    # Strip extern de chars que Windows no accepta a final/inici de nom
    cleaned = cleaned.strip(" .")
    return cleaned


def sanitize_path_segment(value: str, fallback: str) -> str:
    """Return `value` cleaned for use as ONE path segment (àlbum, fitxer).

    A diferència de `sanitize_filename_component`, conserva els espais
    interiors (noms humans d'àlbum/fitxer), col·lapsats a un de sol. Els
    separadors de ruta es converteixen en espai i només sobreviuen lletres,
    dígits, `_`, `-`, `.` i espai. Si el resultat queda buit O compost només
    de punts (`.`/`..`, traversal), retorna `fallback`.

    Veure docs/dev_memory/directives/media_upload_path_safety.md: aquest
    sanejador NO és l'única defensa contra traversal — el caller ha de
    contenir igualment el destí final dins la seva arrel.
    """
    cleaned = re.sub(r"[\\/]+", " ", str(value or "")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^\w\-. ]", "", cleaned, flags=re.UNICODE).strip()
    if not cleaned or set(cleaned) <= {"."}:
        return fallback
    return cleaned[:120]


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
