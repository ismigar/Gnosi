"""Filtering, sorting, pagination, and file selection for media roots."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Protocol, cast

from backend.domains.media.types import (
    MediaEntry,
    MediaInfo,
    MediaPage,
    UserMetadataItem,
    UserMetadataStore,
)


class DateTimeValue(Protocol):
    """Narrow datetime behavior used by ISO filter parsing."""

    def replace(
        self,
        *,
        hour: int,
        minute: int,
        second: int,
    ) -> DateTimeValue: ...

    def timestamp(self) -> float: ...


class QueryService(Protocol):
    """Late-bound facade operations consumed by media querying."""

    _user_metadata: UserMetadataStore | None

    @classmethod
    def classify_kind(cls, ext: str) -> str: ...

    def _ensure_user_metadata_loaded(self) -> None: ...

    def _root_dir(self, root: str = "images") -> Path | None: ...

    def _user_meta_key(self, root: str, rel_path_in_root: str) -> str: ...

    def _resolve_album_dir(self, album: str | None, root: str = "images") -> Path | None: ...

    def _scan_with_cache(
        self,
        target_dir: Path,
        skip_dirs: set[str] | None = None,
    ) -> list[MediaEntry]: ...

    def _apply_filters_and_sort(
        self,
        entries: list[MediaEntry],
        root: str,
        *,
        kinds: set[str] | None,
        extensions: set[str] | None,
        q: str | None,
        desc_contains: str | None,
        tags_any: set[str] | None,
        tags_all: set[str] | None,
        tags_none: set[str] | None,
        size_min_bytes: int | None,
        size_max_bytes: int | None,
        mtime_from_ts: float | None,
        mtime_to_ts: float | None,
        sort: str,
        dir_: str,
    ) -> list[MediaEntry]: ...

    def _csv_to_set(self, value: str | None, lower: bool = True) -> set[str] | None: ...

    def _parse_iso_to_epoch(
        self,
        iso_str: str | None,
        end_of_day: bool = False,
    ) -> float | None: ...

    def _get_file_info(
        self,
        path: Path,
        fast: bool = False,
        root: str = "images",
    ) -> MediaInfo: ...


def classify_kind(
    extension: str,
    *,
    image_extensions: set[str],
    video_extensions: set[str],
    audio_extensions: set[str],
    document_extensions: set[str],
) -> str:
    """Map an extension to the historical media kind labels."""
    normalized = extension.lower()
    if normalized in image_extensions:
        return "image"
    if normalized in video_extensions:
        return "video"
    if normalized in audio_extensions:
        return "audio"
    if normalized in document_extensions:
        return "pdf"
    return "other"


def parse_iso_to_epoch(
    iso_str: str | None,
    end_of_day: bool,
    parse_iso: Callable[[str], DateTimeValue],
) -> float | None:
    """Parse a date or complete ISO timestamp with the historical fallback."""
    if not iso_str:
        return None
    try:
        value = iso_str.strip()
        if "T" in value:
            parsed = parse_iso(value.replace("Z", "+00:00"))
        else:
            parsed = parse_iso(value)
            if end_of_day:
                parsed = parsed.replace(hour=23, minute=59, second=59)
        return parsed.timestamp()
    except (ValueError, AttributeError):
        return None


def csv_to_set(value: str | None, lower: bool = True) -> set[str] | None:
    """Normalize one comma-separated filter to a non-empty set."""
    if value is None:
        return None
    items = {
        item.strip().lower() if lower else item.strip() for item in value.split(",") if item.strip()
    }
    return items or None


def _matches_basic_filters(
    service: QueryService,
    path: Path,
    mtime: float,
    *,
    kinds: set[str] | None,
    extensions: set[str] | None,
    q: str | None,
    mtime_from_ts: float | None,
    mtime_to_ts: float | None,
) -> bool:
    extension = path.suffix.lstrip(".").lower()
    if extensions is not None and extension not in extensions:
        return False
    if kinds is not None and service.classify_kind("." + extension) not in kinds:
        return False
    if q is not None and q not in path.name.lower():
        return False
    if mtime_from_ts is not None and mtime < mtime_from_ts:
        return False
    return mtime_to_ts is None or mtime <= mtime_to_ts


def _metadata_for_path(
    service: QueryService,
    path: Path,
    root: str,
    root_resolved: Path | None,
) -> UserMetadataItem:
    if root_resolved is not None:
        try:
            relative_path = path.resolve().relative_to(root_resolved).as_posix()
        except ValueError:
            relative_path = path.name
    else:
        relative_path = path.name
    store = cast(UserMetadataStore, service._user_metadata)
    return store["items"].get(service._user_meta_key(root, relative_path), {})


def _matches_metadata_filters(
    item: UserMetadataItem,
    *,
    tags_any: set[str] | None,
    tags_all: set[str] | None,
    tags_none: set[str] | None,
    desc_contains: str | None,
) -> bool:
    tags = set(item.get("tags") or [])
    description = (item.get("description") or "").lower()
    if tags_any and tags.isdisjoint(tags_any):
        return False
    if tags_all and not tags_all.issubset(tags):
        return False
    if tags_none and not tags.isdisjoint(tags_none):
        return False
    return not (desc_contains and desc_contains not in description)


def _measured_size(
    path: Path,
    *,
    needs_size: bool,
    size_min_bytes: int | None,
    size_max_bytes: int | None,
) -> tuple[bool, int | None]:
    if not needs_size:
        return True, None
    try:
        size = path.stat().st_size
    except OSError:
        return False, None
    if size_min_bytes is not None and size < size_min_bytes:
        return False, size
    if size_max_bytes is not None and size > size_max_bytes:
        return False, size
    return True, size


def _sort_entries(
    entries: list[tuple[Path, float, int | None]],
    service: QueryService,
    sort: str,
    dir_: str,
) -> None:
    reverse = dir_ != "asc"
    if sort == "filename":
        entries.sort(key=lambda entry: entry[0].name.lower(), reverse=reverse)
    elif sort == "size":
        entries.sort(key=lambda entry: entry[2] or 0, reverse=reverse)
    elif sort == "kind":
        entries.sort(
            key=lambda entry: service.classify_kind(entry[0].suffix.lower()),
            reverse=reverse,
        )
    else:
        entries.sort(key=lambda entry: entry[1], reverse=reverse)


def apply_filters_and_sort(
    service: QueryService,
    entries: list[MediaEntry],
    root: str,
    *,
    kinds: set[str] | None,
    extensions: set[str] | None,
    q: str | None,
    desc_contains: str | None,
    tags_any: set[str] | None,
    tags_all: set[str] | None,
    tags_none: set[str] | None,
    size_min_bytes: int | None,
    size_max_bytes: int | None,
    mtime_from_ts: float | None,
    mtime_to_ts: float | None,
    sort: str,
    dir_: str,
) -> list[MediaEntry]:
    """Apply historical filters in order, then the requested stable sort."""
    needs_metadata = bool(tags_any or tags_all or tags_none or desc_contains)
    if needs_metadata:
        service._ensure_user_metadata_loaded()
    needs_size = size_min_bytes is not None or size_max_bytes is not None or sort == "size"
    root_directory = service._root_dir(root)
    root_resolved = root_directory.resolve() if root_directory else None

    filtered: list[tuple[Path, float, int | None]] = []
    for path, mtime in entries:
        if not _matches_basic_filters(
            service,
            path,
            mtime,
            kinds=kinds,
            extensions=extensions,
            q=q,
            mtime_from_ts=mtime_from_ts,
            mtime_to_ts=mtime_to_ts,
        ):
            continue
        if needs_metadata and not _matches_metadata_filters(
            _metadata_for_path(service, path, root, root_resolved),
            tags_any=tags_any,
            tags_all=tags_all,
            tags_none=tags_none,
            desc_contains=desc_contains,
        ):
            continue
        accepted, size = _measured_size(
            path,
            needs_size=needs_size,
            size_min_bytes=size_min_bytes,
            size_max_bytes=size_max_bytes,
        )
        if accepted:
            filtered.append((path, mtime, size))

    _sort_entries(filtered, service, sort, dir_)
    return [(path, mtime) for path, mtime, _size in filtered]


def get_all_media(
    service: QueryService,
    album: str | None,
    limit: int,
    offset: int,
    root: str,
    *,
    kinds: str | None,
    extensions: str | None,
    q: str | None,
    desc_contains: str | None,
    tags_any: str | None,
    tags_all: str | None,
    tags_none: str | None,
    size_min: int | None,
    size_max: int | None,
    mtime_from: str | None,
    mtime_to: str | None,
    sort: str,
    dir_: str,
    vault_skip_dirs: set[str],
) -> MediaPage:
    """List one recursive root selection with pagination and filtering."""
    target_dir = service._resolve_album_dir(album, root=root)
    if target_dir is None or not target_dir.exists():
        return {"items": [], "total": 0, "limit": limit, "offset": offset, "root": root}

    skip_dirs = vault_skip_dirs if root == "vault" else None
    all_entries = service._scan_with_cache(target_dir, skip_dirs=skip_dirs)
    kinds_set = service._csv_to_set(kinds)
    extensions_set = service._csv_to_set(extensions)
    if extensions_set is not None:
        extensions_set = {extension.lstrip(".") for extension in extensions_set}
    tags_any_set = service._csv_to_set(tags_any)
    tags_all_set = service._csv_to_set(tags_all)
    tags_none_set = service._csv_to_set(tags_none)
    size_min_bytes = size_min * 1024 if size_min is not None else None
    size_max_bytes = size_max * 1024 if size_max is not None else None

    any_filter_active = any(
        [
            kinds_set,
            extensions_set,
            q,
            desc_contains,
            tags_any_set,
            tags_all_set,
            tags_none_set,
            size_min_bytes is not None,
            size_max_bytes is not None,
            mtime_from,
            mtime_to,
        ]
    )
    custom_sort = sort != "mtime" or dir_ != "desc"
    if any_filter_active or custom_sort:
        entries = service._apply_filters_and_sort(
            all_entries,
            root,
            kinds=kinds_set,
            extensions=extensions_set,
            q=q.lower() if q else None,
            desc_contains=desc_contains.lower() if desc_contains else None,
            tags_any=tags_any_set,
            tags_all=tags_all_set,
            tags_none=tags_none_set,
            size_min_bytes=size_min_bytes,
            size_max_bytes=size_max_bytes,
            mtime_from_ts=service._parse_iso_to_epoch(mtime_from),
            mtime_to_ts=service._parse_iso_to_epoch(mtime_to, end_of_day=True),
            sort=sort,
            dir_=dir_,
        )
    else:
        entries = all_entries

    total = len(entries)
    paged = entries[offset : offset + limit]
    items = [service._get_file_info(path, fast=True, root=root) for path, _mtime in paged]
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "root": root,
    }
