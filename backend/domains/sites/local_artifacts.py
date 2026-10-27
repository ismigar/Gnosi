"""Canonical local release namespaces, exact inventories and atomic pointers."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import cast

from fastapi import HTTPException

from .storage import SiteStore, private_json


def _reject(detail: str = "The local website artifact is outside its reviewed namespace") -> HTTPException:
    return HTTPException(409, detail)


def _identity(value: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value):
        raise _reject()
    return value


def owned_directory(path: Path, *, create: bool = False) -> Path:
    if path.is_symlink() or path.exists() and not path.is_dir():
        raise _reject()
    if not path.exists():
        if not create:
            raise _reject("A retained local website directory is missing")
        path.mkdir(mode=0o700)
    if path.resolve(strict=True) != path:
        raise _reject()
    return path


def _site_root(store: SiteStore, site_id: str) -> Path:
    owned_directory(store.private_root)
    return owned_directory(store.site_dir(site_id))


def _namespace(store: SiteStore, site_id: str, *, create: bool = False) -> Path:
    root = _site_root(store, site_id)
    return owned_directory(root / "releases", create=create)


def output_path(store: SiteStore, site_id: str, release_id: str) -> Path:
    releases = _namespace(store, site_id)
    release = owned_directory(releases / _identity(release_id))
    return owned_directory(release / "public")


def prepare(store: SiteStore, site_id: str, release_id: str) -> Path:
    releases = _namespace(store, site_id, create=True)
    release = releases / _identity(release_id)
    if release.exists() or release.is_symlink():
        raise _reject("An immutable local website version already exists")
    owned_directory(release, create=True)
    return owned_directory(release / "public", create=True)


def _regular_file(path: Path) -> os.stat_result:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or path.resolve(strict=True) != path:
        raise _reject("The local website contains an aliased or unsupported file")
    return info


def _digest(path: Path) -> str:
    before = _regular_file(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise _reject("A local website file changed during verification")
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    after = _regular_file(path)
    if (before.st_mtime_ns, before.st_size, before.st_ino) != (after.st_mtime_ns, after.st_size, after.st_ino):
        raise _reject("A local website file changed during verification")
    return digest


def inventory(output: Path) -> dict[str, str]:
    owned_directory(output)
    result: dict[str, str] = {}
    for directory, names, files in os.walk(output, followlinks=False):
        parent = owned_directory(Path(directory))
        for name in names:
            owned_directory(parent / name)
        for name in files:
            path = parent / name
            result[path.relative_to(output).as_posix()] = _digest(path)
    return result


def seal(store: SiteStore, site_id: str, release_id: str) -> Path:
    output = output_path(store, site_id, release_id)
    manifest = inventory(output)
    if not any(path.endswith(".html") for path in manifest):
        raise HTTPException(503, "The website renderer produced no pages")
    target = output.parent / "manifest.json"
    if target.exists() or target.is_symlink():
        raise _reject("An immutable local website manifest already exists")
    private_json(target, manifest)
    return output


def _manifest(path: Path) -> dict[str, str]:
    info = _regular_file(path)
    if info.st_size > 8_000_000:
        raise _reject("The retained website manifest is too large")
    data: object = json.loads(path.read_text())
    if not isinstance(data, dict) or not data:
        raise _reject("The retained website manifest is invalid")
    for relative, digest in data.items():
        if not isinstance(relative, str) or not isinstance(digest, str):
            raise _reject()
        parts = PurePosixPath(relative)
        if parts.is_absolute() or str(parts) != relative or ".." in parts.parts or "\\" in relative or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise _reject("The retained website manifest contains an invalid entry")
    return cast(dict[str, str], data)


def verify(store: SiteStore, site_id: str, release_id: str) -> Path:
    try:
        output = output_path(store, site_id, release_id)
        if inventory(output) != _manifest(output.parent / "manifest.json"):
            raise _reject("The retained local website inventory or content changed")
        return output
    except (OSError, ValueError):
        raise _reject("The retained local website cannot be verified") from None


def _active_path(store: SiteStore, site_id: str, target_id: str, *, create: bool = False) -> Path:
    root = _site_root(store, site_id)
    parent = owned_directory(root / "active", create=create)
    return parent / _identity(target_id)


def _pointer_identity(store: SiteStore, site_id: str, active: Path) -> str | None:
    if not active.exists() and not active.is_symlink():
        return None
    if not active.is_symlink():
        raise _reject("The active local website is not an owned pointer")
    target = active.readlink()
    release_id = _identity(target.parent.name)
    expected = output_path(store, site_id, release_id)
    if target != expected or active.resolve(strict=True) != expected:
        raise _reject("The active local website points to an unknown version")
    return release_id


def current(store: SiteStore, site_id: str, target_id: str) -> str | None:
    try:
        parent = _site_root(store, site_id) / "active"
        if not parent.exists() and not parent.is_symlink():
            return None
        identity = _pointer_identity(store, site_id, _active_path(store, site_id, target_id))
        if identity is not None:
            verify(store, site_id, identity)
        return identity
    except (OSError, ValueError):
        raise _reject("The active local website cannot be verified") from None


def activate(store: SiteStore, site_id: str, target_id: str, release_id: str, parent_id: str | None, guard: Callable[[], None]) -> Path:
    output = verify(store, site_id, release_id)
    active = _active_path(store, site_id, target_id, create=True)
    if _pointer_identity(store, site_id, active) != parent_id:
        raise _reject("The active local version changed before activation")
    pending = active.with_name(active.name + "." + release_id)
    if pending.exists() or pending.is_symlink():
        if not pending.is_symlink() or pending.readlink() != output:
            raise _reject("An unrelated local activation pointer is pending")
    else:
        pending.symlink_to(output, target_is_directory=True)
    verify(store, site_id, release_id)
    guard()
    _active_path(store, site_id, target_id)
    if _pointer_identity(store, site_id, active) != parent_id:
        raise _reject("The active local version changed during activation")
    if pending.readlink() != output or output_path(store, site_id, release_id) != output:
        raise _reject("The local activation pointer changed")
    os.replace(pending, active)
    if _pointer_identity(store, site_id, active) != release_id:
        raise _reject("The activated local version could not be verified")
    return output
