"""Durable, URL-free cache storage for verified remote mail images."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from backend.config.data_dir import resolve_data_dir

MAX_CACHE_BYTES = 32 * 1024 * 1024
MAX_CACHE_ENTRIES = 128
MAX_IMAGE_BYTES = 8 * 1024 * 1024
CACHE_TTL_SECONDS = 300.0

_CACHE_VERSION = 1
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_BODY_FILE_RE = re.compile(r"^[0-9a-f]{64}\.[0-9a-f]{64}\.bin$")


@dataclass(frozen=True)
class CachedRemoteMailImage:
    """One verified cache entry with no retained source URL."""

    body: bytes
    content_type: str
    etag: str
    last_modified: str
    validator_digest: str
    expires_at: float


def cache_key(raw_url: str) -> str:
    """Return the non-reversible cache identity for a complete source URL."""
    return hashlib.sha256(raw_url.encode("utf-8")).hexdigest()


def validator_digest(url: str) -> str:
    """Identify a validated redirect hop without retaining its URL."""
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def _cache_root() -> Path:
    return resolve_data_dir(create=True) / "cache" / "mail" / "remote-images"


def _entry_paths(key: str, root: Path) -> tuple[Path, Path]:
    return root / f"{key}.json", root / f"{key}.lock"


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _discard_entry(root: Path, key: str, body_file: str = "") -> None:
    metadata_path, _ = _entry_paths(key, root)
    _safe_unlink(metadata_path)
    if _BODY_FILE_RE.fullmatch(body_file):
        _safe_unlink(root / body_file)


def _read_metadata(path: Path) -> dict[str, object] | None:
    try:
        if path.stat().st_size > 32_768:
            return None
        value: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    return {str(key): item for key, item in value.items()}


def _metadata_text(value: object, max_chars: int) -> str:
    return value if isinstance(value, str) and len(value) <= max_chars else ""


def _metadata_int(value: object, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _metadata_float(value: object, default: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return default
    try:
        return float(value)
    except ValueError:
        return default


def load_cached_image(
    raw_url: str,
    *,
    now: float,
    accepted_types: frozenset[str],
    validate_raster: Callable[[bytes], str],
) -> tuple[CachedRemoteMailImage, bool] | None:
    """Load and revalidate one exact cache entry, treating corruption as a miss."""
    key = cache_key(raw_url)
    root = _cache_root()
    metadata_path, _ = _entry_paths(key, root)
    metadata = _read_metadata(metadata_path)
    if metadata is None:
        _discard_entry(root, key)
        return None
    body_file = _metadata_text(metadata.get("body_file"), 140)
    version = _metadata_int(metadata.get("version"), 0)
    source_digest = _metadata_text(metadata.get("source_digest"), 64)
    body_digest = _metadata_text(metadata.get("body_digest"), 64)
    content_type = _metadata_text(metadata.get("content_type"), 64)
    etag = _metadata_text(metadata.get("etag"), 1024)
    last_modified = _metadata_text(metadata.get("last_modified"), 1024)
    final_digest = _metadata_text(metadata.get("validator_digest"), 64)
    size = _metadata_int(metadata.get("size"), -1)
    expires_at = _metadata_float(metadata.get("expires_at"), 0)
    if (
        version != _CACHE_VERSION
        or source_digest != key
        or not _DIGEST_RE.fullmatch(body_digest)
        or not _DIGEST_RE.fullmatch(final_digest)
        or not _BODY_FILE_RE.fullmatch(body_file)
        or content_type not in accepted_types
        or size <= 0
        or size > MAX_IMAGE_BYTES
    ):
        _discard_entry(root, key, body_file)
        return None
    try:
        body = (root / body_file).read_bytes()
    except OSError:
        _discard_entry(root, key, body_file)
        return None
    if len(body) != size or hashlib.sha256(body).hexdigest() != body_digest:
        _discard_entry(root, key, body_file)
        return None
    try:
        if validate_raster(body) != content_type:
            raise ValueError("cached MIME mismatch")
    except Exception:
        _discard_entry(root, key, body_file)
        return None
    return (
        CachedRemoteMailImage(
            body=body,
            content_type=content_type,
            etag=etag,
            last_modified=last_modified,
            validator_digest=final_digest,
            expires_at=expires_at,
        ),
        now <= expires_at,
    )


def _atomic_write(path: Path, body: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            os.chmod(temporary, 0o600)
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        _safe_unlink(temporary)


def _prune_cache(root: Path) -> None:
    entries: list[tuple[float, int, str, str]] = []
    referenced_bodies: set[str] = set()
    try:
        metadata_paths = list(root.glob("*.json"))
    except OSError:
        return
    for metadata_path in metadata_paths:
        key = metadata_path.stem
        metadata = _read_metadata(metadata_path)
        body_file = _metadata_text((metadata or {}).get("body_file"), 140)
        size = _metadata_int((metadata or {}).get("size"), -1)
        accessed_at = _metadata_float((metadata or {}).get("accessed_at"), 0)
        if (
            not _DIGEST_RE.fullmatch(key)
            or not _BODY_FILE_RE.fullmatch(body_file)
            or size <= 0
            or size > MAX_IMAGE_BYTES
        ):
            _discard_entry(root, key, body_file)
            continue
        entries.append((accessed_at, size, key, body_file))
        referenced_bodies.add(body_file)
    total = sum(item[1] for item in entries)
    while len(entries) > MAX_CACHE_ENTRIES or total > MAX_CACHE_BYTES:
        _, size, key, body_file = min(entries)
        entries.remove((_, size, key, body_file))
        _discard_entry(root, key, body_file)
        referenced_bodies.discard(body_file)
        total -= size
    for body_path in root.glob("*.bin"):
        if body_path.name not in referenced_bodies:
            _safe_unlink(body_path)


def store_cached_image(
    raw_url: str,
    *,
    body: bytes,
    content_type: str,
    etag: str,
    last_modified: str,
    now: float,
    final_url: str = "",
    final_url_digest: str = "",
) -> CachedRemoteMailImage:
    """Atomically persist one already verified image, best effort."""
    key = cache_key(raw_url)
    body_digest = hashlib.sha256(body).hexdigest()
    body_file = f"{key}.{body_digest}.bin"
    resolved_validator_digest = (
        final_url_digest
        if _DIGEST_RE.fullmatch(final_url_digest)
        else validator_digest(final_url)
    )
    entry = CachedRemoteMailImage(
        body=body,
        content_type=content_type,
        etag=etag,
        last_modified=last_modified,
        validator_digest=resolved_validator_digest,
        expires_at=now + CACHE_TTL_SECONDS,
    )
    try:
        root = _cache_root()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(root, 0o700)
        metadata_path, _ = _entry_paths(key, root)
        previous = _read_metadata(metadata_path)
        previous_body = _metadata_text((previous or {}).get("body_file"), 140)
        body_path = root / body_file
        if not body_path.exists():
            _atomic_write(body_path, body)
        metadata = {
            "version": _CACHE_VERSION,
            "source_digest": key,
            "body_digest": body_digest,
            "body_file": body_file,
            "content_type": content_type,
            "etag": etag,
            "last_modified": last_modified,
            "validator_digest": entry.validator_digest,
            "size": len(body),
            "expires_at": entry.expires_at,
            "accessed_at": now,
        }
        _atomic_write(
            metadata_path,
            json.dumps(metadata, ensure_ascii=True, separators=(",", ":")).encode(),
        )
        if previous_body != body_file and _BODY_FILE_RE.fullmatch(previous_body):
            _safe_unlink(root / previous_body)
        _prune_cache(root)
    except OSError:
        pass
    return entry


def refresh_cached_image(
    raw_url: str,
    entry: CachedRemoteMailImage,
    *,
    now: float,
) -> CachedRemoteMailImage:
    """Refresh durable deadlines after a verified 304 response."""
    return store_cached_image(
        raw_url,
        body=entry.body,
        content_type=entry.content_type,
        etag=entry.etag,
        last_modified=entry.last_modified,
        final_url_digest=entry.validator_digest,
        now=now,
    )
