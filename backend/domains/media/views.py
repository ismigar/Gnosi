"""Vault-synchronized saved filters and sort views for media browsing."""

from __future__ import annotations

import json
import logging
from _thread import RLock
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from backend.domains.media.types import SavedView, ViewPayload, ViewStore


class ViewService(Protocol):
    """Facade state and late-bound methods required by saved views."""

    _views: ViewStore | None
    _views_lock: RLock

    def _ensure_views_loaded(self) -> None: ...

    def _save_views(self) -> bool: ...


def views_path(
    active_vault_path: Callable[[], Path | None],
    filename: str,
    logger: logging.Logger,
) -> Path | None:
    """Return the saved-view sidecar path, creating its private folder."""
    base = active_vault_path()
    if base is None:
        return None
    directory = base / ".gnosi"
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        logger.debug(f"Could not create {directory}: {error}")
        return None
    return directory / filename


def ensure_views_loaded(
    service: ViewService,
    saved_views_path: Callable[[], Path | None],
    logger: logging.Logger,
) -> None:
    """Load the saved-view sidecar once under the historical lock."""
    if service._views is not None:
        return
    with service._views_lock:
        if service._views is not None:
            return
        path = saved_views_path()
        loaded: ViewStore = {"version": 1, "items": []}
        if path and path.exists():
            try:
                with path.open("r", encoding="utf-8") as handle:
                    raw = cast(object, json.load(handle))
                if isinstance(raw, dict) and isinstance(raw.get("items"), list):
                    loaded = cast(ViewStore, raw)
            except (OSError, json.JSONDecodeError) as error:
                logger.warning(f"media_views.json corrupte ({path}): {error} — reinicialitzant")
        service._views = loaded


def save_views(
    service: ViewService,
    path: Path | None,
    replace_file: Callable[[Path, Path], None],
    logger: logging.Logger,
) -> bool:
    """Atomically persist the current saved-view payload."""
    if path is None:
        return False
    with service._views_lock:
        try:
            temporary = path.with_suffix(path.suffix + ".tmp")
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(service._views, handle, ensure_ascii=False, indent=2)
            replace_file(temporary, path)
            return True
        except OSError as error:
            logger.warning(f"Could not save media_views.json: {error}")
            return False


def _mapping_value(data: Mapping[str, object], key: str) -> Mapping[str, object]:
    return cast(Mapping[str, object], data.get(key) or {})


def normalize_view_payload(data: Mapping[str, object]) -> ViewPayload:
    """Keep only the historical saved-view fields and defaults."""
    scope = _mapping_value(data, "scope")
    filters = _mapping_value(data, "filters")
    sort = _mapping_value(data, "sort")
    album = scope.get("album")
    return {
        "label": str(data.get("label") or "").strip()[:120],
        "scope": {
            "root": str(scope.get("root") or "images"),
            "album": str(album) if album is not None else "",
        },
        "filters": {
            "kinds": list(cast(list[object], filters.get("kinds") or [])),
            "q": str(filters.get("q") or ""),
            "tagsAny": list(cast(list[object], filters.get("tagsAny") or [])),
            "datePreset": str(filters.get("datePreset") or "all"),
            "mtimeFrom": str(filters.get("mtimeFrom") or ""),
            "mtimeTo": str(filters.get("mtimeTo") or ""),
            "sizePreset": str(filters.get("sizePreset") or "all"),
        },
        "sort": {
            "field": str(sort.get("field") or "mtime"),
            "dir": str(sort.get("dir") or "desc"),
        },
    }


def list_views(service: ViewService) -> list[SavedView]:
    """Return a shallow copy of the current saved-view sequence."""
    service._ensure_views_loaded()
    store = cast(ViewStore, service._views)
    return list(store.get("items") or [])


def create_view(
    service: ViewService,
    data: Mapping[str, object],
    *,
    now_iso: Callable[[], str],
    now_milliseconds: Callable[[], int],
) -> SavedView:
    """Create and persist one normalized saved view."""
    service._ensure_views_loaded()
    normalized = normalize_view_payload(data)
    if not normalized["label"]:
        raise ValueError("A name is required for the view")
    now = now_iso()
    view = SavedView(
        id=f"view_{now_milliseconds()}",
        **normalized,
        created_at=now,
        updated_at=now,
    )
    store = cast(ViewStore, service._views)
    with service._views_lock:
        store["items"].append(view)
    service._save_views()
    return view


def update_view(
    service: ViewService,
    view_id: str,
    data: Mapping[str, object],
    *,
    now_iso: Callable[[], str],
) -> SavedView | None:
    """Replace mutable fields of one saved view while retaining identity."""
    service._ensure_views_loaded()
    normalized = normalize_view_payload(data)
    store = cast(ViewStore, service._views)
    with service._views_lock:
        for index, view in enumerate(store["items"]):
            if view.get("id") != view_id:
                continue
            if not normalized["label"]:
                normalized["label"] = view.get("label", "")
            updated = cast(
                SavedView,
                {
                    **view,
                    **normalized,
                    "updated_at": now_iso(),
                },
            )
            store["items"][index] = updated
            service._save_views()
            return updated
    return None


def delete_view(service: ViewService, view_id: str) -> bool:
    """Delete one saved view and persist only when a match existed."""
    service._ensure_views_loaded()
    store = cast(ViewStore, service._views)
    with service._views_lock:
        before = len(store["items"])
        store["items"] = [view for view in store["items"] if view.get("id") != view_id]
        if len(store["items"]) == before:
            return False
        service._save_views()
        return True
