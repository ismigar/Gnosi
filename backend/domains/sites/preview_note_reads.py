"""Authenticated Markdown bytes reused only after fresh source version checks.

The caller still opens the original without following aliases, checks its full
POSIX version and placeholder state, and revalidates its path after every hit.
Confirmation never enters this preview-only context.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import io
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import stat
import zlib

from .note_parse_cache import _key, _read
from .preview_render_cache import _root

_FORMAT = b'preview-note-bytes-v1\0'
_RAW_MAXIMUM = 128 * 1024 * 1024
_ENCODED_MAXIMUM = 192 * 1024 * 1024
_COMPRESSED_MAXIMUM = 64 * 1024 * 1024
_COUNT_MAXIMUM = 20000


def _relative(value: str) -> Path:
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or any(p.startswith('.') for p in path.parts)
            or '\\' in value or any(ord(c) < 32 for c in value) or path.suffix != '.md'):
        raise ValueError('Invalid cached Markdown path')
    return Path(value)


def _signature(key: bytes, vault: Path, payload: bytes) -> bytes:
    return hmac.new(key, _FORMAT + str(vault).encode() + b'\0' + payload, hashlib.sha256).digest()


def load(root: Path | None, vault: Path | None) -> dict[Path, tuple[tuple[int, ...], bytes]]:
    if root is None or vault is None or os.name != 'posix':
        return {}
    try:
        _root(root)
        envelope = _read(root / 'notes.gz', _COMPRESSED_MAXIMUM + 32)
        signature, compressed = envelope[:32], envelope[32:]
        if not hmac.compare_digest(signature, _signature(_key(root), vault, compressed)):
            raise ValueError('Changed Markdown cache')
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            encoded = stream.read(_ENCODED_MAXIMUM + 1)
        if len(encoded) > _ENCODED_MAXIMUM:
            raise ValueError('Oversized Markdown cache')
        values = json.loads(encoded)
        if not isinstance(values, dict) or len(values) > _COUNT_MAXIMUM:
            raise ValueError('Invalid Markdown cache inventory')
        result: dict[Path, tuple[tuple[int, ...], bytes]] = {}
        total = 0
        for name, entry in values.items():
            relative = _relative(name)
            if (not isinstance(entry, list) or len(entry) != 2 or not isinstance(entry[0], list)
                    or len(entry[0]) != 6 or any(type(x) is not int for x in entry[0])
                    or not isinstance(entry[1], str)):
                raise ValueError('Invalid Markdown cache version')
            raw = base64.b64decode(entry[1], validate=True)
            total += len(raw)
            if (total > _RAW_MAXIMUM or len(raw) > 4_000_000
                    or len(raw) != entry[0][3] or not stat.S_ISREG(entry[0][2])):
                raise ValueError('Oversized cached Markdown')
            result[vault / relative] = (tuple(entry[0]), raw)
        return result
    except (OSError, ValueError, TypeError, KeyError, EOFError, zlib.error):
        return {}


def save(root: Path | None, vault: Path | None, entries: dict[Path, tuple[tuple[int, ...], bytes]]) -> None:
    if root is None or vault is None or os.name != 'posix':
        return
    temporary: Path | None = None
    try:
        _root(root)
        values: dict[str, object] = {}
        total = 0
        for path, (version, raw) in entries.items():
            relative = path.relative_to(vault).as_posix()
            _relative(relative)
            total += len(raw)
            if total > _RAW_MAXIMUM or len(values) >= _COUNT_MAXIMUM or len(raw) > 4_000_000:
                raise ValueError('Oversized Markdown cache')
            values[relative] = [version, base64.b64encode(raw).decode('ascii')]
        encoded = json.dumps(values, separators=(',', ':')).encode()
        if len(encoded) > _ENCODED_MAXIMUM:
            return
        compressed = gzip.compress(encoded, compresslevel=1, mtime=0)
        if len(compressed) > _COMPRESSED_MAXIMUM:
            return
        envelope = _signature(_key(root), vault, compressed) + compressed
        temporary = root / ('.pending-' + secrets.token_hex(16))
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(envelope)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, root / 'notes.gz')
    except (OSError, ValueError, TypeError):
        pass
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
