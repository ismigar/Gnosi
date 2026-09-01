"""Typed page-index entry construction."""

from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO


Metadata = dict[str, Any]
PageCacheEntry = dict[str, Any]
ParseFrontmatter = Callable[[str, Path], tuple[Metadata, str]]


@dataclass
class PartialReadState:
    """Mutable bounded-reader state preserved across cloud I/O retries."""

    lines: list[str]
    frontmatter_started: bool = False
    frontmatter_count: int = 0


@dataclass(frozen=True)
class PageIndexEntryDependencies:
    """Ports required to parse and normalize one vault page."""

    parse_frontmatter: ParseFrontmatter
    is_dashboard_file: Callable[[Path], bool]
    read_dashboard_file: Callable[[Path], tuple[Metadata, str]]
    process_metadata_paths: Callable[[Metadata], Metadata]
    vault_root: Callable[[], Path]
    logger: logging.Logger


_dependencies: PageIndexEntryDependencies | None = None


def configure(dependencies: PageIndexEntryDependencies) -> None:
    """Bind the page composition ports from the legacy router."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Page index entries are already configured")
    _dependencies = dependencies


def _deps() -> PageIndexEntryDependencies:
    if _dependencies is None:
        raise RuntimeError("Page index entries have not been configured")
    return _dependencies


def _collect_partial_lines(file_handle: TextIO, state: PartialReadState) -> list[str]:
    """Collect bounded frontmatter plus a short body preview."""
    for line in file_handle:
        content_line = line.strip()
        if content_line == "---":
            state.frontmatter_count += 1
            if state.frontmatter_count == 2:
                state.lines.append(line)
                for _ in range(60):
                    body_line = next(file_handle, None)
                    if body_line is None:
                        break
                    state.lines.append(body_line)
                break
            state.frontmatter_started = True
        if state.frontmatter_started:
            state.lines.append(line)
        elif content_line:
            break
        # A genuinely large frontmatter can contain hundreds of YAML lines.
        # The bound only protects corrupt documents with no closing marker.
        if len(state.lines) > 2000:
            break
    return state.lines


def _read_partial_once(
    file_path: Path,
    state: PartialReadState,
) -> tuple[Metadata, str]:
    dependencies = _deps()
    with file_path.open("r", encoding="utf-8", errors="ignore") as file_handle:
        content = "".join(_collect_partial_lines(file_handle, state))
    return dependencies.parse_frontmatter(content, file_path)


def read_frontmatter_partial(file_path: Path) -> tuple[Metadata, str]:
    """Read bounded page metadata with cloud-provider deadlock retries."""
    dependencies = _deps()

    # A macOS File Provider (OneDrive, Google Drive, Dropbox, etc.) can lock
    # the file for a few seconds. Back off
    # exponential up to 4s — more than the partial read with 60 lines should
    # of ever needing under normal conditions.
    retries = 7
    delays = [0.05, 0.1, 0.2, 0.4, 0.8, 1.0, 1.5]
    last_error: OSError | None = None
    state = PartialReadState(lines=[])
    for attempt in range(retries + 1):
        try:
            return _read_partial_once(file_path, state)
        except OSError as error:
            if error.errno == 35:  # Resource deadlock
                last_error = error
                if attempt < retries:
                    time.sleep(delays[attempt])
                    continue
            dependencies.logger.warning("Error in partial read of %s: %s", file_path, error)
            return {}, ""
        except Exception as error:
            dependencies.logger.warning("Error in partial read of %s: %s", file_path, error)
            return {}, ""

    if last_error:
        dependencies.logger.warning(
            "Final error reading %s after retries: %s", file_path, last_error
        )
    return {}, ""


def _recover_full_metadata(
    file_path: Path,
    metadata: Metadata,
    body: str,
) -> tuple[Metadata, str, bool]:
    """Recover a missing page ID with the complete tolerant parser."""
    if str(metadata.get("id") or "").strip():
        return metadata, body, False
    dependencies = _deps()
    try:
        full_metadata, full_body = dependencies.parse_frontmatter(
            file_path.read_text(encoding="utf-8", errors="ignore"),
            file_path,
        )
    except OSError:
        return metadata, body, not metadata and not body
    except Exception as error:
        dependencies.logger.warning(
            "Full-read fallback failed for %s: %s",
            file_path.name,
            error,
        )
        return metadata, body, not metadata and not body
    if full_metadata and str(full_metadata.get("id") or "").strip():
        return full_metadata, full_body, False
    return metadata, body, not metadata and not body


def _load_page_metadata(file_path: Path) -> tuple[Metadata, str, bool]:
    dependencies = _deps()
    if dependencies.is_dashboard_file(file_path):
        metadata, body = dependencies.read_dashboard_file(file_path)
        return metadata, body, False
    metadata, body = read_frontmatter_partial(file_path)
    metadata, body, parse_failed = _recover_full_metadata(file_path, metadata, body)
    metadata = dependencies.process_metadata_paths(metadata)
    if "data" in metadata and "date" not in metadata:
        metadata["date"] = metadata["data"]
    return metadata, body, parse_failed


def _relative_folder(file_path: Path, vault_root: Path) -> str:
    try:
        folder = file_path.parent.relative_to(vault_root)
    except ValueError:
        folder = file_path.parent.resolve().relative_to(vault_root.resolve())
    normalized = str(folder).replace("\\", "/")
    return "" if normalized == "." else normalized


def is_metadata_stub(metadata: Metadata) -> bool:
    """Heuristic: the cache was initialized from a partial index
    (only id/title/description) and the frontmatter hasn't been reread yet.
    If the metadata has only basic keys, we consider that it needs to be refreshed
    from the file before returning it to the frontend.

    """
    if not metadata:
        return True
    keys = set(metadata.keys())
    bare = {"id", "title", "parent_id", "description", "is_database"}
    return keys.issubset(bare)


def humanize_relation_index_title(title: object, metadata: Metadata) -> str:
    """Replace a relation-index UUID suffix with its wikilink display name."""
    display_title = str(title or "").strip()
    match = re.match(
        r"^(?:Index|Índex)\s*[·:]\s*(?:Projecte|Project|Àrea|Area)\s*:\s*"
        r"([0-9a-f]{8}-[0-9a-f-]{27,})$",
        display_title,
        re.IGNORECASE,
    )
    if not match:
        return display_title

    target_id = match.group(1)
    for raw_value in (metadata or {}).values():
        values = raw_value if isinstance(raw_value, list) else [raw_value]
        for value in values:
            relation_match = re.search(
                r"\[\[([^]|]+)\|\s*" + re.escape(target_id) + r"\s*\]\]",
                str(value or ""),
                re.IGNORECASE,
            )
            if relation_match:
                return f"{display_title.split(':', 1)[0]}: {relation_match.group(1).strip()}"
    return display_title


def build_page_cache_entry(
    file_path: Path,
    stat_result: os.stat_result,
) -> PageCacheEntry:
    dependencies = _deps()
    try:
        metadata, body, parse_failed = _load_page_metadata(file_path)
    except Exception as error:
        dependencies.logger.warning("Error parsing frontmatter for %s: %s", file_path.name, error)
        metadata = {}
        body = ""
        parse_failed = True

    file_id = str(metadata.get("id") or file_path.stem)
    rel_folder = _relative_folder(file_path, dependencies.vault_root())

    # Better title handling: metadata > filename stem > "Untitled". Generated
    # relation-index pages can have a filename such as ``Index · Projecte:
    # <uuid>`` while their relation metadata still contains ``[[Name|uuid]]``;
    # prefer that human title for table rows and page lists.
    title = metadata.get("title")
    if not title:
        title = file_path.stem
    title = humanize_relation_index_title(title, metadata)

    entry: PageCacheEntry = {
        "path": str(file_path),
        "mtime_ns": stat_result.st_mtime_ns,
        "mtime": stat_result.st_mtime,
        # File creation date (macOS: st_birthtime; fallback st_ctime).
        "created_mtime": getattr(stat_result, "st_birthtime", None) or stat_result.st_ctime,
        "size": stat_result.st_size,
        "id": file_id,
        "title": title,
        "parent_id": metadata.get("parent_id"),
        "is_database": metadata.get("is_database", False),
        "metadata": {
            **metadata,
            "description": metadata.get("description") or (body.strip()[:500] if body else None),
        },
        "folder": rel_folder,
    }
    # Flag for the caller: if the frontmatter parse failed, avoid
    # overwriting an old entry with good data (Errno 35 on File Provider mounts).
    if parse_failed:
        entry["_parse_failed"] = True
    return entry


def build_cache_entry_from_memory(
    file_path: Path,
    stat_result: os.stat_result,
    metadata: Metadata,
    body: str,
) -> PageCacheEntry:
    """Fast variant of `_build_page_cache_entry` for when the caller already
    has the final `metadata` and `body` in memory (typically after a
    PATCH/PUT). Avoids rereading the file just written to cloud-backed storage,
    costs 100-300 ms and is the dominant bottleneck of the idempotent PATCH.

    Entry shape identical to that of `_build_page_cache_entry`.

    """
    # Applies the same post-processing that the disk version does via
    # `_read_frontmatter_partial` + `_process_metadata_paths`. Here it
    # we have the metadata after `_persist_metadata_assets`; the `_process_*`
    # only affects cover/icon which are already handled in the PATCH pipeline.
    dependencies = _deps()
    md = dependencies.process_metadata_paths(dict(metadata or {}))
    if "data" in md and "date" not in md:
        md["date"] = md["data"]

    file_id = str(md.get("id") or file_path.stem)
    rel_folder = str(file_path.parent.relative_to(dependencies.vault_root())).replace("\\", "/")
    if rel_folder == ".":
        rel_folder = ""

    title = md.get("title") or file_path.stem

    return {
        "path": str(file_path),
        "mtime_ns": stat_result.st_mtime_ns,
        "mtime": stat_result.st_mtime,
        "created_mtime": getattr(stat_result, "st_birthtime", None) or stat_result.st_ctime,
        "size": stat_result.st_size,
        "id": file_id,
        "title": title,
        "parent_id": md.get("parent_id"),
        "is_database": md.get("is_database", False),
        "metadata": {
            **md,
            "description": md.get("description") or (body.strip()[:500] if body else None),
        },
        "folder": rel_folder,
    }


# Mechanical-extraction names retained for idempotent recovery and old imports.
_read_frontmatter_partial = read_frontmatter_partial
_is_metadata_stub = is_metadata_stub
_humanize_relation_index_title = humanize_relation_index_title
_build_page_cache_entry = build_page_cache_entry
_build_cache_entry_from_memory = build_cache_entry_from_memory


__all__ = [
    "Metadata",
    "PageCacheEntry",
    "PartialReadState",
    "PageIndexEntryDependencies",
    "build_cache_entry_from_memory",
    "build_page_cache_entry",
    "configure",
    "humanize_relation_index_title",
    "is_metadata_stub",
    "read_frontmatter_partial",
]
