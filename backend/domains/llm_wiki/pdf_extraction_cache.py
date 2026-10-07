"""Reuse complete PDF extraction by exact file bytes, including its OCR result."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

from filelock import FileLock

from backend.utils.safe_io import safe_write_json

EXTRACTION_VERSION = 1


def file_digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def cache_path(root: Path, path: Path, digest: str) -> Path:
    scope = hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:24]
    return root / scope / f"v{EXTRACTION_VERSION}-{digest}.json"


def payload(digest: str, segments: list[dict[str, object]]) -> dict[str, object]:
    encoded = json.dumps(segments, ensure_ascii=False, sort_keys=True).encode()
    return {"version": EXTRACTION_VERSION, "source_sha256": digest, "complete": True,
            "segments": segments, "segments_sha256": hashlib.sha256(encoded).hexdigest()}


def _read(path: Path, digest: str) -> list[dict[str, object]] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        segments = data["segments"]
        if (not isinstance(segments, list) or not segments or not all(
                isinstance(s, dict) and isinstance(s.get("text"), str) and isinstance(s.get("locator"), dict)
                for s in segments)):
            return None
        expected = payload(digest, segments)
        return segments if all(data.get(key) == value for key, value in expected.items()) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def extract_cached_pdf(path: Path, root: Path,
                       extract: Callable[[], list[dict[str, object]]]) -> list[dict[str, object]]:
    """Serialize concurrent misses; changed files or corrupt caches cannot reuse text."""
    digest = file_digest(path)
    target = cache_path(root, path, digest)
    target.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(str(target) + ".lock", timeout=240):
        segments = _read(target, digest)
        if segments is None:
            segments = extract()
            if not segments:
                return segments
            if file_digest(path) != digest:
                raise RuntimeError("The PDF changed during extraction; retry after the file finishes saving")
            safe_write_json(target, payload(digest, segments), ensure_ascii=False)
        elif file_digest(path) != digest:
            raise RuntimeError("The PDF changed while loading its extracted text")
        return segments
