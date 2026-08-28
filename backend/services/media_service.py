try:
    from PIL import Image
    from PIL.ExifTags import GPSTAGS, TAGS
except ImportError:
    Image = None

import logging
import os
import re
import threading
import time
import typing as _typing
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from fastapi import HTTPException, UploadFile

from backend.config.data_dir import resolve_data_dir
from backend.domains.media import metadata as _metadata
from backend.domains.media import query as _query
from backend.domains.media import roots as _roots
from backend.domains.media import scan_cache as _scan_cache_domain
from backend.domains.media import uploads as _uploads
from backend.domains.media import views as _views_domain
from backend.domains.media.types import (
    MediaRoots as _MediaRoots,
)
from backend.domains.media.types import (
    ScanCache as _ScanCache,
)
from backend.domains.media.types import (
    ScanLocks as _ScanLocks,
)
from backend.domains.media.types import (
    UserMetadataStore as _UserMetadataStore,
)
from backend.domains.media.types import (
    ViewStore as _ViewStore,
)
from backend.services.context_vars import get_active_vault_path
from backend.utils.safe_io import safe_write_bytes, sanitize_path_segment

log = logging.getLogger(__name__)

# TTL for the recursive scan cache. On OneDrive with tens of thousands
# of images the first pass can take minutes; here we keep the result
# to avoid repeating it on every pagination.
_SCAN_CACHE_TTL_S = 24 * 60 * 60  # 24 h: the normal rate of changes in Images/
# is daily, not by minutes. The invalidation
# explicit one already handles the uploads.

# Persistent cache: the container can restart often and we don't want every
# restart to trigger a scan of 56k files. /app/data is a local volume
# (gnosi_local_data) — it's fine to leave pickles there.
_PERSIST_DIR = resolve_data_dir() / "media_cache"

# Multi-root roots supported for the media search. The key is sent from the
# frontend (?root=...). Each root resolves to a folder and a URL prefix to
# serve the files. The folder is resolved dynamically in get_active_vault_path()
# because the vault can change with workspace switching.
#
# - "images"     → Images/ (historical gallery, default behavior for back-compat)
# - "assets"     → Assets/ (media inserted into pages via /assets/upload)
# - "library" → Library/ (sibling folder of the vault, not inside)
# - "vault"      → the whole vault, excludes system folders (.git, .gnosi, DB)
MEDIA_ROOTS: Dict[str, Dict[str, Any]] = {
    "images": {"label": "Images (Gallery)", "url_prefix": "/api/vault/images/"},
    "assets": {"label": "Page assets", "url_prefix": "/api/vault/assets/"},
    "library": {"label": "Library", "url_prefix": "/api/vault/library/"},
    "vault": {"label": "Entire Vault", "url_prefix": "/api/vault/raw/"},
}

# Folders that are never scanned when root="vault": control metadata for
# versions, internal configuration, JSON DB. Without this list, scanning
# the whole vault would include thousands of irrelevant JSON files and would slow down the
# primera passada considerablement.
_VAULT_SKIP_DIRS = {
    ".git",
    ".gnosi",
    ".Dashboards",
    "BD",
    "node_modules",
    "__pycache__",
    ".cache",
    ".idea",
    ".vscode",
}


class MediaService:
    # User metadata sidecar (tags + description). Lives INSIDE the vault
    # because they are semantic user data and need to sync across
    # devices via OneDrive — the "caches outside OneDrive" rule does not apply
    # to data, only to derivable caches/indexes.
    _USER_META_FILENAME = "media_metadata.json"
    # User's saved views (filters + sort + named scope). Same
    # reason as _USER_META_FILENAME: user data, inside the vault.
    _VIEWS_FILENAME = "media_views.json"

    def __init__(self):
        # We no longer initialize the path here to avoid errors at boot
        self._media_dir_cache = None
        self._scan_cache: _ScanCache = {}
        self._scan_locks: _ScanLocks = {}
        self._locks_guard = threading.Lock()
        # Lazy sidecar: loads on first use (update_metadata or filter by tags).
        self._user_metadata: Optional[_UserMetadataStore] = None
        self._user_metadata_lock = threading.RLock()
        # Lazy views: loaded on first access.
        self._views: Optional[_ViewStore] = None
        self._views_lock = threading.RLock()
        try:
            _PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.debug(f"Could not create {_PERSIST_DIR}: {e}")

    def _root_dir(self, root: str = "images") -> Optional[Path]:
        """Resolves the root key to an absolute Path. Creates Images/ if needed
        (back-compat) but does NOT create the other folders — if Library or Assets
        don't exist, we return None and the caller will respond with an empty list.

        """

        def resolve_library_late(base: Path) -> Path:
            from backend.services.library_paths import resolve_library

            return resolve_library(base)

        return _roots.root_dir(
            root,
            active_vault_path=lambda: get_active_vault_path(),
            resolve_library=resolve_library_late,
            logger=log,
        )

    def get_roots(self) -> List[Dict[str, Any]]:
        """Returns the list of available roots with metadata. Marks
        `available=False` for those that don't exist on disk, so the UI
        can hide or disable them."""
        roots = _typing.cast(_MediaRoots, MEDIA_ROOTS)
        return _typing.cast(List[Dict[str, Any]], _roots.get_roots(self, roots))

    @property
    def media_dir(self) -> Path:
        """Resolves the media directory dynamically based on the active vault.
        Kept for compatibility: equivalent to `_root_dir("images")`.

        """
        return _typing.cast(Path, self._root_dir("images"))

    # We're expanding the list of valid extensions: the historical gallery only showed
    # images, but with multi-root we also want to find videos and PDFs because the
    # MediaCenter works as a picker for the BlockEditor.
    _IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp"}
    _VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}
    _AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}
    _DOC_EXTS = {".pdf"}
    _VALID_EXTENSIONS = _IMAGE_EXTS | _VIDEO_EXTS | _AUDIO_EXTS | _DOC_EXTS

    @classmethod
    def classify_kind(cls, ext: str) -> str:
        return _query.classify_kind(
            ext,
            image_extensions=cls._IMAGE_EXTS,
            video_extensions=cls._VIDEO_EXTS,
            audio_extensions=cls._AUDIO_EXTS,
            document_extensions=cls._DOC_EXTS,
        )

    def _scan_recursive(
        self,
        root: Path,
        skip_dirs: Optional[set] = None,
    ) -> Iterator[Tuple[Path, float]]:
        """
                Recursively walks `root`, emitting (path, mtime) for each file
        with a valid extension. Uses os.scandir because it shares the stat() with
        the listing (on OneDrive every additional stat is expensive: the previous
        rglob+stat took >60s for ~56k files).

        `skip_dirs` is a list of folder names (not paths) to avoid; useful
        for root="vault", which must skip .git, .gnosi, BD/, etc.

        """
        typed_skip = _typing.cast(Optional[set[str]], skip_dirs)
        yield from _scan_cache_domain.scan_recursive(
            root,
            typed_skip,
            valid_extensions=self._VALID_EXTENSIONS,
            recurse=lambda path, skipped: self._scan_recursive(path, skipped),
            logger=log,
        )

    def _get_lock(self, key: str) -> threading.Lock:
        return _scan_cache_domain.get_lock(key, self._scan_locks, self._locks_guard)

    def _persist_path(self, target_dir: Path) -> Path:
        """JSON file where we persist the cache for this target_dir.

        JSON (not pickle): the payload is a list of [path, mtime] pairs, so there
        is no reason to deserialize an arbitrary object graph from disk.
        """
        return _scan_cache_domain.persist_path(target_dir, _PERSIST_DIR)

    def _load_persisted(
        self,
        target_dir: Path,
    ) -> Optional[Tuple[float, List[Tuple[Path, float]]]]:
        return _scan_cache_domain.load_persisted(target_dir, self._persist_path, log)

    def _save_persisted(
        self,
        target_dir: Path,
        ts: float,
        entries: List[Tuple[Path, float]],
    ) -> None:
        _scan_cache_domain.save_persisted(target_dir, ts, entries, self._persist_path, log)

    def _scan_with_cache(
        self,
        target_dir: Path,
        skip_dirs: Optional[set] = None,
    ) -> List[Tuple[Path, float]]:
        """Returns the index (path, mtime) for `target_dir` with a TTL cache +
        disk persistence to survive container restarts.

        `skip_dirs` propagates to `_scan_recursive`. The hash key includes the set
        of skipped folders so that the "vault without BD" cache doesn't collide
        with a possible future "whole vault" scan.

        """
        return _scan_cache_domain.scan_with_cache(
            self,
            target_dir,
            _typing.cast(Optional[set[str]], skip_dirs),
            _SCAN_CACHE_TTL_S,
            lambda: time.time(),
            log,
        )

    def invalidate_cache(self, target_dir: Optional[Path] = None) -> None:
        """Clears the cache (a specific directory or all of it)."""
        _scan_cache_domain.invalidate_cache(self, target_dir, _PERSIST_DIR)

    # ------------------------------------------------------------------
    # User metadata sidecar (tags + description)
    # ------------------------------------------------------------------

    def _user_meta_path(self) -> Optional[Path]:
        return _metadata.user_meta_path(
            lambda: get_active_vault_path(),
            self._USER_META_FILENAME,
            log,
        )

    def _ensure_user_metadata_loaded(self) -> None:
        _metadata.ensure_user_metadata_loaded(self, self._user_meta_path, log)

    @staticmethod
    def _user_meta_key(root: str, rel_path_in_root: str) -> str:
        return _metadata.user_meta_key(root, rel_path_in_root)

    def _save_user_metadata(self) -> bool:
        return _metadata.save_user_metadata(self, self._user_meta_path(), os.replace, log)

    def _get_user_meta_for(self, root: str, rel_path_in_root: str) -> Dict[str, Any]:
        """Returns {tags, description} from the sidecar (defaults if not present)."""
        result = _metadata.get_user_meta_for(self, root, rel_path_in_root)
        return _typing.cast(Dict[str, Any], result)

    def update_metadata(
        self,
        path_in_root: str,
        metadata: Dict[str, Any],
        root: str = "images",
    ) -> bool:
        """Updates tags/description for (root, path_in_root) in the sidecar.

        `path_in_root` is relative to the root (e.g. `Viatges/2026/IMG.jpg`). The
        field arrives in the `_get_file_info` payload as `path_in_root`.

        """
        return _metadata.update_metadata(
            self,
            path_in_root,
            metadata,
            root,
            now_iso=lambda: datetime.utcnow().isoformat() + "Z",
            logger=log,
        )

    # ------------------------------------------------------------------
    # Saved views (filters + sort + named scope)
    # ------------------------------------------------------------------

    def _views_path(self) -> Optional[Path]:
        return _views_domain.views_path(
            lambda: get_active_vault_path(),
            self._VIEWS_FILENAME,
            log,
        )

    def _ensure_views_loaded(self) -> None:
        _views_domain.ensure_views_loaded(self, self._views_path, log)

    def _save_views(self) -> bool:
        return _views_domain.save_views(self, self._views_path(), os.replace, log)

    @staticmethod
    def _normalize_view_payload(data: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitizes a view's payload: only known fields, without
        letting arbitrary things through that could bloat the JSON."""
        result = _views_domain.normalize_view_payload(data)
        return _typing.cast(Dict[str, Any], result)

    def list_views(self) -> List[Dict[str, Any]]:
        return _typing.cast(List[Dict[str, Any]], _views_domain.list_views(self))

    def create_view(self, data: Dict[str, Any]) -> Dict[str, Any]:
        result = _views_domain.create_view(
            self,
            data,
            now_iso=lambda: datetime.utcnow().isoformat() + "Z",
            now_milliseconds=lambda: int(time.time() * 1000),
        )
        return _typing.cast(Dict[str, Any], result)

    def update_view(
        self,
        view_id: str,
        data: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        result = _views_domain.update_view(
            self,
            view_id,
            data,
            now_iso=lambda: datetime.utcnow().isoformat() + "Z",
        )
        return _typing.cast(Optional[Dict[str, Any]], result)

    def delete_view(self, view_id: str) -> bool:
        return _views_domain.delete_view(self, view_id)

    # ------------------------------------------------------------------
    # Filters + sort post-cache (for get_all_media)
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_iso_to_epoch(
        iso_str: Optional[str],
        end_of_day: bool = False,
    ) -> Optional[float]:
        """`YYYY-MM-DD` or full ISO → epoch seconds. None if invalid."""
        return _query.parse_iso_to_epoch(iso_str, end_of_day, datetime.fromisoformat)

    def _apply_filters_and_sort(
        self,
        entries: List[Tuple[Path, float]],
        root: str,
        *,
        kinds: Optional[set],
        extensions: Optional[set],
        q: Optional[str],
        desc_contains: Optional[str],
        tags_any: Optional[set],
        tags_all: Optional[set],
        tags_none: Optional[set],
        size_min_bytes: Optional[int],
        size_max_bytes: Optional[int],
        mtime_from_ts: Optional[float],
        mtime_to_ts: Optional[float],
        sort: str,
        dir_: str,
    ) -> List[Tuple[Path, float]]:
        """Filters (path, mtime) by the declared set of filters and sorts.

        Filters that depend on the sidecar (tags/desc) load the metadata
        cache only once; those that need `st.st_size` or sort by
        size trigger a `path.stat()` per file (relatively cheap once
        the index is in RAM, but not free on OneDrive).

        """
        return _query.apply_filters_and_sort(
            self,
            entries,
            root,
            kinds=_typing.cast(Optional[set[str]], kinds),
            extensions=_typing.cast(Optional[set[str]], extensions),
            q=q,
            desc_contains=desc_contains,
            tags_any=_typing.cast(Optional[set[str]], tags_any),
            tags_all=_typing.cast(Optional[set[str]], tags_all),
            tags_none=_typing.cast(Optional[set[str]], tags_none),
            size_min_bytes=size_min_bytes,
            size_max_bytes=size_max_bytes,
            mtime_from_ts=mtime_from_ts,
            mtime_to_ts=mtime_to_ts,
            sort=sort,
            dir_=dir_,
        )

    @staticmethod
    def _csv_to_set(value: Optional[str], lower: bool = True) -> Optional[set]:
        return _query.csv_to_set(value, lower)

    def _resolve_album_dir(
        self,
        album: Optional[str],
        root: str = "images",
    ) -> Optional[Path]:
        """Resolves the `album` (relative to the given root) to an absolute Path, validating
        that it doesn't escape the root. Returns None if invalid."""
        return _roots.resolve_album_dir(self, album, root, log)

    def get_all_media(
        self,
        album: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        root: str = "images",
        *,
        kinds: Optional[str] = None,
        extensions: Optional[str] = None,
        q: Optional[str] = None,
        desc_contains: Optional[str] = None,
        tags_any: Optional[str] = None,
        tags_all: Optional[str] = None,
        tags_none: Optional[str] = None,
        size_min: Optional[int] = None,  # KB
        size_max: Optional[int] = None,  # KB
        mtime_from: Optional[str] = None,  # ISO
        mtime_to: Optional[str] = None,  # ISO
        sort: str = "mtime",
        dir_: str = "desc",
    ) -> Dict[str, Any]:
        """Lists media files with pagination, filters, and sorting.

        `album` can be a relative path with subdirectories (`Pueblo/Sierra`).
        Always scans the given directory recursively.
        `root` selects the root folder: images|assets|library|vault.

        Accepted filters (all optional, csv where applicable):
        - kinds: image,video,audio,pdf,other
        - extensions: jpg,png,...  (no dot)
        - q: substring on filename (case-insensitive)
        - desc_contains: substring on description (case-insensitive)
        - tags_any / tags_all / tags_none: csv of tags (normalized to lowercase)
        - size_min / size_max: in KB
        - mtime_from / mtime_to: ISO dates (`YYYY-MM-DD` or full)
        - sort: mtime|filename|size|kind  (default: mtime)
        - dir_: asc|desc  (default: desc)

        """
        result = _query.get_all_media(
            self,
            album,
            limit,
            offset,
            root,
            kinds=kinds,
            extensions=extensions,
            q=q,
            desc_contains=desc_contains,
            tags_any=tags_any,
            tags_all=tags_all,
            tags_none=tags_none,
            size_min=size_min,
            size_max=size_max,
            mtime_from=mtime_from,
            mtime_to=mtime_to,
            sort=sort,
            dir_=dir_,
            vault_skip_dirs=_VAULT_SKIP_DIRS,
        )
        return _typing.cast(Dict[str, Any], result)

    def get_albums(self) -> List[str]:
        """Returns the list of folders (albums) in Images. Kept for
        compatibility — the lazy tree is served via `get_tree_node`.

        """
        return _roots.get_albums(self)

    def get_tree_node(
        self,
        path: Optional[str] = None,
        root: str = "images",
    ) -> List[Dict[str, Any]]:
        """Returns the immediate subfolders of `<root>/path` (or of the root
        if `path` is None), each with a `has_children` flag computed to
        let the UI show the chevron without loading the whole tree.

        It's lazy: it only reads one level. For the ~33k directories in this
        vault, scanning the whole tree would be infeasible.

        For root="vault" it excludes system folders (`.git`, `BD`, etc.).

        """
        result = _roots.get_tree_node(self, path, root, _VAULT_SKIP_DIRS, log)
        return _typing.cast(List[Dict[str, Any]], result)

    def upload_media(self, file: UploadFile, album: str = "General") -> Dict[str, Any]:
        """Uploads a file and saves it to the corresponding album folder.

        `album` can be hierarchical ("Viatges/2024": the UI tree navigates
        subfolders), so it's sanitized segment by segment and the
        destination is contained within Images/. See the media_upload_path_safety directive.

        """
        result = _uploads.upload_media(
            self,
            file,
            album,
            split_album=lambda value: re.split(r"[\\/]+", value),
            sanitize_segment=lambda value, fallback: sanitize_path_segment(value, fallback),
            safe_write=lambda path, content: safe_write_bytes(path, content),
            http_exception=HTTPException,
        )
        return _typing.cast(Dict[str, Any], result)

    def _get_exif_data(self, path: Path) -> Dict[str, Any]:
        if not Image:
            return {"date_taken": None, "lat": None, "lng": None}
        result = _uploads.get_exif_data(
            path,
            image=_typing.cast(_uploads.ImageModule, Image),
            tags=_typing.cast(_typing.Mapping[int, str | int], TAGS),
            gps_tags=_typing.cast(_typing.Mapping[int, str | int], GPSTAGS),
            parse_exif_date=lambda value: datetime.strptime(
                value,
                "%Y:%m:%d %H:%M:%S",
            ).isoformat(),
            convert_degrees=lambda value: self._convert_to_degrees(value),
            logger=log,
        )
        return _typing.cast(Dict[str, Any], result)

    def _convert_to_degrees(self, value):
        return _uploads.convert_to_degrees(value)

    def _get_file_info(
        self,
        path: Path,
        fast: bool = False,
        root: str = "images",
    ) -> Dict[str, Any]:
        result = _uploads.get_file_info(
            _typing.cast(_uploads.FileInfoService, self),
            path,
            fast,
            root,
            active_vault_path=lambda: get_active_vault_path(),
            media_roots=_typing.cast(_MediaRoots, MEDIA_ROOTS),
            from_timestamp=lambda timestamp: datetime.fromtimestamp(timestamp).isoformat(),
        )
        return _typing.cast(Dict[str, Any], result)


# The global instance remains valid since the constructor is now safe
media_service = MediaService()
