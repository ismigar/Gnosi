"""Durable, URL-free cache storage for verified remote mail images."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from backend.config.data_dir import resolve_data_dir

MAX_CACHE_BYTES = 128 * 1024 * 1024
MAX_CACHE_ENTRIES = 512
MAX_IMAGE_BYTES = 8 * 1024 * 1024
CACHE_TTL_SECONDS = 300.0
CACHE_LEASE_STALE_SECONDS = 30.0

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


@dataclass(frozen=True)
class CacheEntryLease:
    """Ownership of one digest-named cross-process cache lease."""

    path: Path
    token: str

    def release(self) -> None:
        owner_path = self.path / "owner"
        try:
            if owner_path.read_text(encoding="ascii") != self.token:
                return
        except (OSError, UnicodeError):
            return
        _safe_unlink(owner_path)
        try:
            self.path.rmdir()
        except OSError:
            pass


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


def _remove_stale_lease(path: Path, *, now: float) -> bool:
    try:
        info = path.lstat()
    except OSError:
        return True
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        _safe_unlink(path)
        return not path.exists()
    if now - info.st_mtime <= CACHE_LEASE_STALE_SECONDS:
        return False
    _safe_unlink(path / "owner")
    for temporary in path.glob(".owner.*.tmp"):
        _safe_unlink(temporary)
    try:
        path.rmdir()
    except OSError:
        return False
    return True


def try_acquire_cache_lease(raw_url: str, *, now: float) -> CacheEntryLease | None:
    """Acquire one portable atomic-directory lease without retaining its URL."""
    root = _cache_root()
    key = cache_key(raw_url)
    _, lock_path = _entry_paths(key, root)
    token = uuid4().hex
    try:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(root, 0o700)
        lock_path.mkdir(mode=0o700)
    except FileExistsError:
        if not _remove_stale_lease(lock_path, now=now):
            return None
        try:
            lock_path.mkdir(mode=0o700)
        except OSError:
            return None
    except OSError:
        return None
    try:
        _atomic_write(lock_path / "owner", token.encode("ascii"))
        os.utime(lock_path, (now, now))
    except OSError:
        _safe_unlink(lock_path / "owner")
        try:
            lock_path.rmdir()
        except OSError:
            pass
        return None
    return CacheEntryLease(path=lock_path, token=token)


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
        _safe_unlink(metadata_path)
        return _recover_cached_body(
            raw_url,
            root=root,
            now=now,
            accepted_types=accepted_types,
            validate_raster=validate_raster,
        )
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
        _safe_unlink(metadata_path)
        return _recover_cached_body(
            raw_url,
            root=root,
            now=now,
            accepted_types=accepted_types,
            validate_raster=validate_raster,
        )
    try:
        body = (root / body_file).read_bytes()
    except OSError:
        _safe_unlink(metadata_path)
        return _recover_cached_body(
            raw_url,
            root=root,
            now=now,
            accepted_types=accepted_types,
            validate_raster=validate_raster,
        )
    if len(body) != size or hashlib.sha256(body).hexdigest() != body_digest:
        _discard_entry(root, key, body_file)
        return _recover_cached_body(
            raw_url,
            root=root,
            now=now,
            accepted_types=accepted_types,
            validate_raster=validate_raster,
        )
    try:
        if validate_raster(body) != content_type:
            raise ValueError("cached MIME mismatch")
    except Exception:
        _safe_unlink(metadata_path)
        return _recover_cached_body(
            raw_url,
            root=root,
            now=now,
            accepted_types=accepted_types,
            validate_raster=validate_raster,
        )
    try:
        os.utime(metadata_path, (now, now))
    except OSError:
        pass
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


def _metadata_payload(
    *,
    key: str,
    body_digest: str,
    body_file: str,
    entry: CachedRemoteMailImage,
    now: float,
) -> dict[str, object]:
    return {
        "version": _CACHE_VERSION,
        "source_digest": key,
        "body_digest": body_digest,
        "body_file": body_file,
        "content_type": entry.content_type,
        "etag": entry.etag,
        "last_modified": entry.last_modified,
        "validator_digest": entry.validator_digest,
        "size": len(entry.body),
        "expires_at": entry.expires_at,
        "accessed_at": now,
    }


def _write_metadata(
    path: Path,
    *,
    key: str,
    body_digest: str,
    body_file: str,
    entry: CachedRemoteMailImage,
    now: float,
) -> None:
    metadata = _metadata_payload(
        key=key,
        body_digest=body_digest,
        body_file=body_file,
        entry=entry,
        now=now,
    )
    _atomic_write(
        path,
        json.dumps(metadata, ensure_ascii=True, separators=(",", ":")).encode(),
    )


def _recover_cached_body(
    raw_url: str,
    *,
    root: Path,
    now: float,
    accepted_types: frozenset[str],
    validate_raster: Callable[[bytes], str],
) -> tuple[CachedRemoteMailImage, bool] | None:
    """Rebuild minimal metadata for a still-valid content-addressed body."""
    key = cache_key(raw_url)
    metadata_path, _ = _entry_paths(key, root)
    for body_path in sorted(root.glob(f"{key}.*.bin")):
        body_file = body_path.name
        if not _BODY_FILE_RE.fullmatch(body_file):
            continue
        body_digest = body_file.split(".", 2)[1]
        try:
            size = body_path.stat().st_size
            if size <= 0 or size > MAX_IMAGE_BYTES:
                raise ValueError("invalid cached image size")
            body = body_path.read_bytes()
            if len(body) != size or hashlib.sha256(body).hexdigest() != body_digest:
                raise ValueError("invalid cached image digest")
            content_type = validate_raster(body)
            if content_type not in accepted_types:
                raise ValueError("invalid cached image type")
        except Exception:
            _safe_unlink(body_path)
            continue
        entry = CachedRemoteMailImage(
            body=body,
            content_type=content_type,
            etag="",
            last_modified="",
            validator_digest=validator_digest(raw_url),
            expires_at=0,
        )
        try:
            _write_metadata(
                metadata_path,
                key=key,
                body_digest=body_digest,
                body_file=body_file,
                entry=entry,
                now=now,
            )
        except OSError:
            pass
        return entry, False
    return None


def _prune_cache(root: Path) -> None:
    entries: list[tuple[float, int, str, str, bool]] = []
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
        try:
            accessed_at = metadata_path.stat().st_mtime
        except OSError:
            accessed_at = _metadata_float((metadata or {}).get("accessed_at"), 0)
        if (
            not _DIGEST_RE.fullmatch(key)
            or not _BODY_FILE_RE.fullmatch(body_file)
            or size <= 0
            or size > MAX_IMAGE_BYTES
        ):
            # Keep a content-addressed body until it has been independently
            # validated or evicted by the bounded orphan-body LRU below.
            _safe_unlink(metadata_path)
            continue
        entries.append((accessed_at, size, key, body_file, True))
        referenced_bodies.add(body_file)
    total = sum(item[1] for item in entries)
    for body_path in root.glob("*.bin"):
        if body_path.name in referenced_bodies:
            continue
        body_file = body_path.name
        if not _BODY_FILE_RE.fullmatch(body_file):
            _safe_unlink(body_path)
            continue
        try:
            size = body_path.stat().st_size
            accessed_at = body_path.stat().st_mtime
        except OSError:
            continue
        if size <= 0 or size > MAX_IMAGE_BYTES:
            _safe_unlink(body_path)
            continue
        key = body_file.split(".", 1)[0]
        entries.append((accessed_at, size, key, body_file, False))
        referenced_bodies.add(body_file)
        total += size
    while len(entries) > MAX_CACHE_ENTRIES or total > MAX_CACHE_BYTES:
        oldest = min(entries)
        _, size, key, body_file, has_metadata = oldest
        entries.remove(oldest)
        if has_metadata:
            _discard_entry(root, key, body_file)
        else:
            _safe_unlink(root / body_file)
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
        _write_metadata(
            metadata_path,
            key=key,
            body_digest=body_digest,
            body_file=body_file,
            entry=entry,
            now=now,
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
