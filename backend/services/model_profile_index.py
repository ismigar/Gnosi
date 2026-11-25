"""A compact, versioned lookup of model profiles from the local comparison report."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from backend.utils.safe_io import safe_write_json


_profiles_lock = threading.Lock()
_profiles_source: tuple[Path, tuple[int, ...]] | None = None
_profiles_index: dict[str, dict[str, str]] = {}


def _index_model_profiles(payload: dict[str, Any]) -> dict[str, dict[str, str]]:
    index: dict[str, dict[str, str]] = {}
    for model in payload.get("models") or []:
        if not isinstance(model, dict):
            continue
        for route in model.get("routes") or []:
            if isinstance(route, dict) and isinstance(route.get("provider"), str) and isinstance(route.get("model_id"), str):
                index.setdefault(route["provider"], {}).setdefault(route["model_id"], str(model.get("profile") or "unrated"))
    return index


def _saved_profiles(path: Path, revision: tuple[int, ...]) -> dict[str, dict[str, str]] | None:
    try:
        data = json.loads(path.read_bytes())
        if data["revision"] != list(revision):
            return None
        profiles = data["profiles"]
        if isinstance(profiles, dict) and all(isinstance(row, dict) and all(isinstance(label, str) for label in row.values())
                                              for row in profiles.values()):
            return profiles
    except (OSError, ValueError, KeyError, TypeError, RecursionError):
        pass
    return None


def published_profiles(path: Path) -> dict[str, dict[str, str]]:
    """The open report binds the small index to one published revision even during an atomic refresh."""
    global _profiles_source, _profiles_index
    with _profiles_lock, path.open("rb") as report:
        stat = os.fstat(report.fileno())
        revision = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        if _profiles_source == (path, revision):
            return _profiles_index
        index_path = path.with_name(path.name + ".profiles-v1.json")
        index = _saved_profiles(index_path, revision)
        if index is None:
            index = _index_model_profiles(json.load(report))
            try:
                safe_write_json(index_path, {"revision": revision, "profiles": index}, indent=None)
            except OSError:
                pass  # A read-only cache can still supply the correct in-memory classification.
        _profiles_index, _profiles_source = index, (path, revision)
        return index
