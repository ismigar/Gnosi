"""Native-attested folder grants and bounded, non-overwriting transfers."""
from __future__ import annotations

from typing import Any, cast

import base64
from contextlib import contextmanager
from collections.abc import Iterator
import hashlib
import hmac
import json
import os
from pathlib import Path
import stat
import time

from fastapi import HTTPException

from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore

MAX_FILE_BYTES = 15 * 1024 * 1024


def grant_folder(store: WorkbenchStore, scope: WorkbenchScope, path: str, token: str) -> dict[str, Any]:
    secret = os.environ.get('GNOSI_DESKTOP_SELECTION_SECRET', '')
    if not secret:
        raise HTTPException(503, 'Native folder selection is unavailable')
    try:
        payload, signature = token.split('.')
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        now = time.time()
        if not now < float(data['expires_at']) <= now + 120:
            raise ValueError()
        if (data['path'], data['agent_id'], data['session_id']) != (path, scope.agent_id, scope.session_id):
            raise ValueError()
        if data['scope_key'] != scope.key:
            raise ValueError()
        nonce = str(data['nonce'])
        if not 8 <= len(nonce) <= 128:
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise HTTPException(403, 'Invalid or expired native folder selection') from None
    root = Path(path).absolute()
    if root != root.resolve() or not root.is_dir():
        raise HTTPException(422, 'Select a canonical directory without symbolic links')
    protected = [Path('/'), Path.home(), Path('/etc'), Path('/var'), Path('/usr'), Path('/System'), Path('/Applications'), Path('/Library'), Path('/private'), Path(scope.vault_path).resolve()]
    protected_trees = [Path('/etc').resolve(), Path('/usr').resolve(), Path('/System'), Path('/Applications'), Path('/Library'), Path('/private/var/root'), Path('/private/var/db'), Path.home() / 'Library']
    if any(root == p or root in p.parents for p in protected) or any(root == p or p in root.parents for p in protected_trees):
        raise HTTPException(403, 'This directory cannot be shared')
    if any(part.startswith('.') for part in root.parts):
        raise HTTPException(403, 'Hidden directories cannot be shared')
    # Consume globally, preventing a native selection from being replayed by another principal.
    native_scope = WorkbenchScope('native-selection', '', '', '', '')
    won, _ = store.claim(native_scope, 'nonce', nonce, hashlib.sha256(token.encode()).hexdigest())
    if not won:
        raise HTTPException(409, 'Native folder selection was already used')
    info = root.stat()
    return store.create(scope, 'grant', dict(path=str(root), name=root.name, revoked=False, device=info.st_dev, inode=info.st_ino, created_at=time.time()))


@contextmanager
def authorized_file(store: WorkbenchStore, scope: WorkbenchScope, grant_id: str, relative: str, *, directory: bool = False, create: bool = False) -> Iterator[int]:
    grant = store.get(scope, 'grant', grant_id)
    if grant['revoked']:
        raise HTTPException(403, 'Folder access was revoked')
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or any(part.startswith('.') for part in path.parts) or len(relative) > 1024:
        raise HTTPException(422, 'Invalid relative path')
    descriptors = []
    try:
        fd = os.open(grant['path'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(fd)
        info = os.fstat(fd)
        if (info.st_dev, info.st_ino) != (grant['device'], grant['inode']):
            raise HTTPException(409, 'Shared directory identity changed')
        parts = list(path.parts)
        for index, part in enumerate(parts):
            final = index == len(parts) - 1
            flags = os.O_NOFOLLOW | os.O_RDONLY | os.O_NONBLOCK
            if not final or directory:
                flags |= os.O_DIRECTORY
            if final and create:
                flags = os.O_NOFOLLOW | os.O_WRONLY | os.O_CREAT | os.O_EXCL
            fd = os.open(part, flags, 0o600, dir_fd=fd)
            descriptors.append(fd)
        if not directory and (not parts or not stat.S_ISREG(os.fstat(fd).st_mode)):
            raise HTTPException(422, 'A regular file is required')
        yield fd
    except FileExistsError:
        raise HTTPException(409, 'Destination already exists') from None
    except (OSError, ValueError):
        raise HTTPException(422, 'Path is unavailable or contains symbolic links') from None
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def list_files(store: WorkbenchStore, scope: WorkbenchScope, grant_id: str, path: str = '') -> dict[str, Any]:
    with authorized_file(store, scope, grant_id, path, directory=True) as fd:
        entries = []
        with os.scandir(fd) as iterator:
            for item in iterator:
                if item.name.startswith('.') or item.is_symlink():
                    continue
                entries.append(dict(name=item.name, directory=item.is_dir(follow_symlinks=False), size=item.stat(follow_symlinks=False).st_size))
                if len(entries) >= 500:
                    break
    return dict(entries=entries, limit=500)


def read_file(store: WorkbenchStore, scope: WorkbenchScope, grant_id: str, path: str) -> bytes:
    with authorized_file(store, scope, grant_id, path) as fd:
        if os.fstat(fd).st_size > MAX_FILE_BYTES:
            raise HTTPException(413, 'File exceeds 15 MB')
        chunks = []
        remaining = MAX_FILE_BYTES + 1
        while remaining:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b''.join(chunks)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, 'File exceeds 15 MB')
        return data


def transfer(store: WorkbenchStore, scope: WorkbenchScope, grant_id: str, path: str, data: bytes, size: int, sha256: str, request_id: str) -> dict[str, Any]:
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, 'File exceeds 15 MB')
    if len(data) != size or not hmac.compare_digest(digest, sha256):
        raise HTTPException(422, 'File byte count or SHA-256 does not match')
    # Check current grant even for an idempotent retry after revocation.
    grant = store.get(scope, 'grant', grant_id)
    if grant['revoked']:
        raise HTTPException(403, 'Folder access was revoked')
    fingerprint = hashlib.sha256(json.dumps([grant_id, path, size, digest]).encode()).hexdigest()
    won, receipt = store.claim(scope, 'transfer', request_id, fingerprint)
    if not won:
        return receipt
    with authorized_file(store, scope, grant_id, path, create=True) as fd:
        offset = 0
        while offset < len(data):
            offset += os.write(fd, data[offset:])
        os.fsync(fd)
    receipt.update(status='committed', size=size, sha256=digest, grant_id=grant_id, path=path)
    return store.update(scope, 'transfer', request_id, receipt)
