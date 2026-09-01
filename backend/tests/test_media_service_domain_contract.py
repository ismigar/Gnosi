"""Behavior and architecture contracts for the modular media service."""

from __future__ import annotations

import inspect
import io
import json
import os
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest
from fastapi import UploadFile

import backend.services.media_service as media_module
from backend.services.context_vars import active_vault_path
from backend.services.media_service import MEDIA_ROOTS, MediaService, media_service

PUBLIC_SIGNATURES = {
    "get_roots": "(self) -> List[Dict[str, Any]]",
    "media_dir": "(self) -> pathlib.Path",
    "classify_kind": "(ext: str) -> str",
    "invalidate_cache": "(self, target_dir: Optional[pathlib.Path] = None) -> None",
    "update_metadata": (
        "(self, path_in_root: str, metadata: Dict[str, Any], root: str = 'images') -> bool"
    ),
    "list_views": "(self) -> List[Dict[str, Any]]",
    "create_view": "(self, data: Dict[str, Any]) -> Dict[str, Any]",
    "update_view": ("(self, view_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]"),
    "delete_view": "(self, view_id: str) -> bool",
    "get_all_media": (
        "(self, album: Optional[str] = None, limit: int = 50, offset: int = 0, "
        "root: str = 'images', *, kinds: Optional[str] = None, extensions: Optional[str] "
        "= None, q: Optional[str] = None, desc_contains: Optional[str] = None, tags_any: "
        "Optional[str] = None, tags_all: Optional[str] = None, tags_none: Optional[str] = "
        "None, size_min: Optional[int] = None, size_max: Optional[int] = None, mtime_from: "
        "Optional[str] = None, mtime_to: Optional[str] = None, sort: str = 'mtime', dir_: "
        "str = 'desc') -> Dict[str, Any]"
    ),
    "get_albums": "(self) -> List[str]",
    "get_tree_node": (
        "(self, path: Optional[str] = None, root: str = 'images') -> List[Dict[str, Any]]"
    ),
    "upload_media": (
        "(self, file: fastapi.datastructures.UploadFile, album: str = 'General') -> Dict[str, Any]"
    ),
}

EXPECTED_DESCRIPTORS = {
    "__init__": "function",
    "_apply_filters_and_sort": "function",
    "_convert_to_degrees": "function",
    "_csv_to_set": "staticmethod",
    "_ensure_user_metadata_loaded": "function",
    "_ensure_views_loaded": "function",
    "_get_exif_data": "function",
    "_get_file_info": "function",
    "_get_lock": "function",
    "_get_user_meta_for": "function",
    "_load_persisted": "function",
    "_normalize_view_payload": "staticmethod",
    "_parse_iso_to_epoch": "staticmethod",
    "_persist_path": "function",
    "_resolve_album_dir": "function",
    "_root_dir": "function",
    "_save_persisted": "function",
    "_save_user_metadata": "function",
    "_save_views": "function",
    "_scan_recursive": "function",
    "_scan_with_cache": "function",
    "_user_meta_key": "staticmethod",
    "_user_meta_path": "function",
    "_views_path": "function",
    "classify_kind": "classmethod",
    "create_view": "function",
    "delete_view": "function",
    "get_albums": "function",
    "get_all_media": "function",
    "get_roots": "function",
    "get_tree_node": "function",
    "invalidate_cache": "function",
    "list_views": "function",
    "media_dir": "property",
    "update_metadata": "function",
    "update_view": "function",
    "upload_media": "function",
}


@pytest.fixture()
def vault(tmp_path: Path) -> Iterator[Path]:
    """Activate one isolated vault for every media behavior scenario."""
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir()
    token = active_vault_path.set(vault_dir)
    try:
        yield vault_dir
    finally:
        active_vault_path.reset(token)


def _descriptor_target(name: str) -> Callable[..., object]:
    descriptor = MediaService.__dict__[name]
    if isinstance(descriptor, property):
        assert descriptor.fget is not None
        return cast(Callable[..., object], descriptor.fget)
    return cast(Callable[..., object], getattr(MediaService, name))


def test_legacy_python_surface_is_exact() -> None:
    """Freeze public signatures and every historical monkeypatch descriptor."""
    assert str(inspect.signature(MediaService)) == "() -> None"
    assert inspect.isgeneratorfunction(MediaService._scan_recursive)
    assert media_service.__class__ is MediaService
    assert MEDIA_ROOTS == {
        "images": {"label": "Images (Gallery)", "url_prefix": "/api/vault/images/"},
        "assets": {"label": "Page assets", "url_prefix": "/api/vault/assets/"},
        "library": {"label": "Library", "url_prefix": "/api/vault/library/"},
        "vault": {"label": "Entire Vault", "url_prefix": "/api/vault/raw/"},
    }
    assert {
        name: type(MediaService.__dict__[name]).__name__ for name in EXPECTED_DESCRIPTORS
    } == EXPECTED_DESCRIPTORS
    assert {
        name: str(inspect.signature(_descriptor_target(name))) for name in PUBLIC_SIGNATURES
    } == PUBLIC_SIGNATURES
    assert sorted(vars(MediaService())) == [
        "_locks_guard",
        "_media_dir_cache",
        "_scan_cache",
        "_scan_locks",
        "_user_metadata",
        "_user_metadata_lock",
        "_views",
        "_views_lock",
    ]


def test_metadata_query_tree_and_view_formats(vault: Path) -> None:
    """Exercise the sidecars and paginated wire formats through the facade."""
    album = vault / "Images" / "Trips"
    nested = album / "Nested"
    hidden = album / ".hidden"
    nested.mkdir(parents=True)
    hidden.mkdir()
    photo = album / "A Photo.JPG"
    video = album / "clip.mp4"
    photo.write_bytes(b"photo")
    video.write_bytes(b"video-data")
    os.utime(photo, (1_700_000_000, 1_700_000_000))
    os.utime(video, (1_700_000_100, 1_700_000_100))

    service = MediaService()
    assert service.classify_kind(".JPG") == "image"
    assert service.classify_kind(".mp4") == "video"
    assert service.classify_kind(".unknown") == "other"
    assert [root["key"] for root in service.get_roots()] == [
        "images",
        "assets",
        "library",
        "vault",
    ]
    assert service.update_metadata(
        "Trips/A Photo.JPG",
        {"tags": [" Travel ", "TRAVEL", "Blue"], "description": "Summer Notes"},
    )

    sidecar = json.loads((vault / ".gnosi" / "media_metadata.json").read_text())
    item = sidecar["items"]["images::Trips/A Photo.JPG"]
    assert list(item) == ["tags", "description", "updated_at"]
    assert item["tags"] == ["blue", "travel"]
    assert item["description"] == "Summer Notes"

    page = service.get_all_media(
        album="Trips",
        tags_any="travel",
        q="photo",
        sort="filename",
        dir_="asc",
    )
    assert page["total"] == 1
    assert page["limit"] == 50
    assert page["offset"] == 0
    assert page["root"] == "images"
    assert page["items"] == [
        {
            "id": "A Photo",
            "filename": "A Photo.JPG",
            "url": "/api/vault/images/Trips/A Photo.JPG",
            "path": "Images/Trips/A Photo.JPG",
            "path_in_root": "Trips/A Photo.JPG",
            "album": "Trips",
            "root": "images",
            "kind": "image",
            "size": 5,
            "last_modified": page["items"][0]["last_modified"],
            "extension": ".jpg",
            "date_taken": None,
            "location": None,
            "tags": ["blue", "travel"],
            "description": "Summer Notes",
        }
    ]
    assert service.get_tree_node("Trips") == [
        {"name": "Nested", "path": "Trips/Nested", "has_children": False}
    ]

    created = service.create_view(
        {
            "label": "  Trips  ",
            "scope": {"root": "images", "album": "Trips"},
            "filters": {"kinds": ["image"], "q": "photo", "unknown": "discarded"},
            "sort": {"field": "filename", "dir": "asc"},
            "unknown": "discarded",
        }
    )
    assert created["label"] == "Trips"
    assert created["filters"]["kinds"] == ["image"]
    assert "unknown" not in created
    assert service.list_views() == [created]
    updated = service.update_view(created["id"], {"label": "", "sort": {"field": "size"}})
    assert updated is not None
    assert updated["label"] == "Trips"
    assert updated["sort"] == {"field": "size", "dir": "desc"}
    assert service.update_view("missing", {"label": "x"}) is None
    assert service.delete_view("missing") is False
    assert service.delete_view(created["id"]) is True
    assert service.list_views() == []


def test_late_bound_clock_scan_and_upload_seams(
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Prove that historical facade monkeypatches remain effective."""
    service = MediaService()
    service._user_metadata = {"version": 1, "items": {}}
    service._views = {"version": 1, "items": []}
    resolved_sidecars: list[str] = []

    def record_metadata_path() -> Path | None:
        resolved_sidecars.append("metadata")
        return None

    def record_views_path() -> Path | None:
        resolved_sidecars.append("views")
        return None

    monkeypatch.setattr(service, "_user_meta_path", record_metadata_path)
    monkeypatch.setattr(service, "_views_path", record_views_path)
    service._ensure_user_metadata_loaded()
    service._ensure_views_loaded()
    assert resolved_sidecars == []

    target = vault / "Images" / "General"
    target.mkdir(parents=True, exist_ok=True)
    older = target / "older.jpg"
    newer = target / "newer.jpg"
    scanned = [(older, 10.0), (newer, 20.0)]
    saved: list[tuple[Path, float, list[tuple[Path, float]]]] = []
    ticks = iter([100.0, 101.0, 102.0])

    def fake_scan(_target: Path, _skip: set[str] | None = None) -> Iterator[tuple[Path, float]]:
        yield from scanned

    def fake_save(
        path: Path,
        timestamp: float,
        entries: list[tuple[Path, float]],
    ) -> None:
        saved.append((path, timestamp, entries))

    monkeypatch.setattr(media_module.time, "time", lambda: next(ticks))
    monkeypatch.setattr(service, "_scan_recursive", fake_scan)
    monkeypatch.setattr(service, "_load_persisted", lambda _path: None)
    monkeypatch.setattr(service, "_save_persisted", fake_save)
    assert service._scan_with_cache(target) == [(newer, 20.0), (older, 10.0)]
    assert saved == [(target, 102.0, [(newer, 20.0), (older, 10.0)])]
    assert service._scan_cache[str(target)][0] == 102.0

    writes: list[tuple[Path, bytes]] = []

    def write_bytes(path: Path, content: bytes) -> None:
        writes.append((path, content))
        path.write_bytes(content)

    monkeypatch.setattr(media_module, "safe_write_bytes", write_bytes)
    upload = UploadFile(filename="late.jpg", file=io.BytesIO(b"x"))
    result = service.upload_media(upload)
    assert writes == [(target / "late.jpg", b"x")]
    assert result["filename"] == "late.jpg"


def test_persistent_cache_wire_format_uses_current_facade_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Keep JSON persistence and the replaceable facade cache path exact."""
    persist_dir = tmp_path / "cache"
    persist_dir.mkdir()
    monkeypatch.setattr(media_module, "_PERSIST_DIR", persist_dir)
    service = MediaService()
    target = tmp_path / "root::BD,.git"
    entries = [(tmp_path / "a.jpg", 42.5)]
    assert service._persist_path(target).parent == persist_dir
    custom_cache_path = persist_dir / "custom.json"
    monkeypatch.setattr(service, "_persist_path", lambda _target: custom_cache_path)
    service._save_persisted(target, 99.0, entries)
    cache_path = custom_cache_path
    assert json.loads(cache_path.read_text()) == {
        "ts": 99.0,
        "entries": [[str(tmp_path / "a.jpg"), 42.5]],
    }
    assert service._load_persisted(target) == (99.0, entries)
    service.invalidate_cache(target)
    assert not cache_path.exists()


def test_media_domain_has_no_facade_or_http_imports() -> None:
    """Keep dependency direction from the compatibility facade to the domain."""
    domain_dir = Path(media_module.__file__ or "").parents[1] / "domains" / "media"
    modules = sorted(domain_dir.glob("*.py"))
    assert modules
    for module_path in modules:
        source = module_path.read_text(encoding="utf-8")
        assert "backend.services.media_service" not in source
        assert "backend.api.vault_routes" not in source
        assert "from typing import Any" not in source

    facade_path = Path(media_module.__file__ or "")
    assert len(facade_path.read_text(encoding="utf-8").splitlines()) < 800
    assert isinstance(media_module, ModuleType)
