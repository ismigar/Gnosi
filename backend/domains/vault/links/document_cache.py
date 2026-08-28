"""Persistent mtime-keyed body and parsed-document caches for Vault links."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast


Metadata = dict[str, object]
BodyCache = dict[str, tuple[int, str]]
ParsedDocument = tuple[int, Metadata, str]
ParsedDocumentCache = dict[str, ParsedDocument]


@dataclass
class _PersistState:
    lock: threading.Lock = field(default_factory=threading.Lock)
    pending: bool = False


@dataclass(frozen=True)
class DocumentCacheDependencies:
    """Cache storage, parser, and filesystem ports."""

    body_cache: BodyCache
    body_lock: AbstractContextManager[object]
    parsed_cache: ParsedDocumentCache
    parsed_lock: AbstractContextManager[object]
    page_index_cache_path: Callable[[], Path | None]
    data_dir: Callable[[], Path]
    write_json: Callable[[Path, object], None]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    body_persist_debounce: float
    parsed_persist_debounce: float
    logger: logging.Logger


_body_persist_state = _PersistState()
_parsed_persist_state = _PersistState()


def cache_path(kind: str, dependencies: DocumentCacheDependencies) -> Path:
    """Resolve a local cache path beside the page index or below the data directory."""
    base = dependencies.page_index_cache_path()
    filename = f"vault_{kind}_cache.json"
    return base.parent / filename if base else dependencies.data_dir() / "cache" / filename


def save_body_cache(dependencies: DocumentCacheDependencies) -> None:
    """Persist one consistent snapshot of the Markdown body cache."""
    try:
        path = cache_path("body", dependencies)
        path.parent.mkdir(parents=True, exist_ok=True)
        with dependencies.body_lock:
            payload = {
                cache_key: {"mtime_ns": mtime, "body": body}
                for cache_key, (mtime, body) in dependencies.body_cache.items()
            }
        dependencies.write_json(path, payload)
        dependencies.logger.info("💾 Body cache saved (%d files)", len(payload))
    except Exception as error:
        dependencies.logger.warning("body-cache persist failed: %s", error)


def _schedule(
    state: _PersistState,
    delay: float,
    save: Callable[[], None],
    name: str,
) -> None:
    with state.lock:
        if state.pending:
            return
        state.pending = True

    def run() -> None:
        time.sleep(delay)
        try:
            save()
        except Exception:
            pass
        finally:
            with state.lock:
                state.pending = False

    threading.Thread(target=run, daemon=True, name=name).start()


def schedule_body_cache_persist(dependencies: DocumentCacheDependencies) -> None:
    """Debounce body-cache persistence across individual reads and invalidations."""
    _schedule(
        _body_persist_state,
        dependencies.body_persist_debounce,
        lambda: save_body_cache(dependencies),
        "body-cache-persist",
    )


def load_body_cache(dependencies: DocumentCacheDependencies) -> bool:
    """Load a persisted body cache without eagerly validating every mtime."""
    try:
        path = cache_path("body", dependencies)
        if not path.exists():
            return False
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            return False
        with dependencies.body_lock:
            dependencies.body_cache.clear()
            for raw_path, raw_value in loaded.items():
                if not isinstance(raw_value, dict):
                    continue
                mtime = raw_value.get("mtime_ns") or 0
                body = raw_value.get("body") or ""
                if isinstance(mtime, int) and mtime and isinstance(body, str) and body:
                    dependencies.body_cache[str(raw_path)] = (mtime, body)
        dependencies.logger.info(
            "📂 Body cache loaded from disk (%d files)",
            len(dependencies.body_cache),
        )
        return True
    except Exception as error:
        dependencies.logger.warning("body-cache load failed: %s", error)
        return False


def body_for_path(file_path: Path, dependencies: DocumentCacheDependencies) -> str:
    """Return one Markdown body, reusing it while the file mtime is unchanged."""
    path_key = str(file_path)
    try:
        mtime = file_path.stat().st_mtime_ns
    except OSError:
        return ""
    with dependencies.body_lock:
        cached = dependencies.body_cache.get(path_key)
        if cached and cached[0] == mtime:
            return cached[1]
    try:
        content = file_path.read_text(encoding="utf-8")
    except OSError as error:
        if error.errno == 35:
            dependencies.logger.debug("Body skip (Errno 35): %s", file_path.name)
        else:
            dependencies.logger.warning(
                "Error reading body of %s: %s",
                file_path.name,
                error,
            )
        return ""
    except Exception as error:
        dependencies.logger.warning(
            "Error reading body of %s: %s",
            file_path.name,
            error,
        )
        return ""
    with dependencies.body_lock:
        dependencies.body_cache[path_key] = (mtime, content)
    schedule_body_cache_persist(dependencies)
    return content


def save_parsed_cache(dependencies: DocumentCacheDependencies) -> None:
    """Persist JSON-compatible parsed documents and skip unsupported metadata."""
    try:
        path = cache_path("parsed_doc", dependencies)
        path.parent.mkdir(parents=True, exist_ok=True)
        with dependencies.parsed_lock:
            snapshot = list(dependencies.parsed_cache.items())
        payload: dict[str, object] = {}
        skipped = 0
        for cache_key, (mtime, metadata, body) in snapshot:
            try:
                json.dumps(metadata, allow_nan=False)
            except (TypeError, ValueError):
                skipped += 1
                continue
            payload[cache_key] = {"mtime_ns": mtime, "metadata": metadata, "body": body}
        dependencies.write_json(path, payload)
        suffix = f", {skipped} skipped" if skipped else ""
        dependencies.logger.info(
            "💾 Parsed-document cache saved (%d files%s)",
            len(payload),
            suffix,
        )
    except Exception as error:
        dependencies.logger.warning("parsed-doc-cache save failed: %s", error)


def schedule_parsed_cache_persist(dependencies: DocumentCacheDependencies) -> None:
    """Debounce parsed-document cache persistence."""
    _schedule(
        _parsed_persist_state,
        dependencies.parsed_persist_debounce,
        lambda: save_parsed_cache(dependencies),
        "parsed-doc-cache-persist",
    )


def load_parsed_cache(dependencies: DocumentCacheDependencies) -> bool:
    """Load parsed documents; individual mtimes remain lazily validated."""
    try:
        path = cache_path("parsed_doc", dependencies)
        if not path.exists():
            return False
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            return False
        with dependencies.parsed_lock:
            dependencies.parsed_cache.clear()
            for raw_path, raw_value in loaded.items():
                if not isinstance(raw_value, dict):
                    continue
                mtime = raw_value.get("mtime_ns") or 0
                metadata = raw_value.get("metadata")
                body = raw_value.get("body") or ""
                if isinstance(mtime, int) and mtime and isinstance(metadata, dict):
                    dependencies.parsed_cache[str(raw_path)] = (
                        mtime,
                        cast(Metadata, metadata),
                        str(body),
                    )
        dependencies.logger.info(
            "📂 Parsed-document cache loaded from disk (%d files)",
            len(dependencies.parsed_cache),
        )
        return True
    except Exception as error:
        dependencies.logger.warning("parsed-doc-cache load failed: %s", error)
        return False


def parsed_document(
    file_path: Path,
    dependencies: DocumentCacheDependencies,
) -> tuple[Metadata, str] | None:
    """Return parsed frontmatter and body, memoized by file mtime."""
    path_key = str(file_path)
    try:
        mtime = file_path.stat().st_mtime_ns
    except OSError:
        return None
    with dependencies.parsed_lock:
        cached = dependencies.parsed_cache.get(path_key)
        if cached and cached[0] == mtime:
            return cached[1], cached[2]
    content = body_for_path(file_path, dependencies)
    if not content:
        return None
    metadata, body = dependencies.parse_frontmatter(content, file_path)
    with dependencies.parsed_lock:
        dependencies.parsed_cache[path_key] = (mtime, metadata, body)
    schedule_parsed_cache_persist(dependencies)
    return metadata, body


__all__ = [
    "BodyCache",
    "DocumentCacheDependencies",
    "Metadata",
    "ParsedDocumentCache",
    "body_for_path",
    "cache_path",
    "load_body_cache",
    "load_parsed_cache",
    "parsed_document",
    "save_body_cache",
    "save_parsed_cache",
    "schedule_body_cache_persist",
    "schedule_parsed_cache_persist",
]
