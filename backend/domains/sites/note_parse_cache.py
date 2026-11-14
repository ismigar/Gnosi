"""Authenticated private YAML parse reuse; original bytes are always read afresh."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import stat
from collections.abc import Iterator
from typing import cast
from pydantic import JsonValue

import yaml

from .storage import private_json

_MAXIMUM = 32 * 1024 * 1024
_FORMAT = 'safe-note-metadata-v1:' + yaml.__version__


parsed_note_cache: ContextVar[dict[str, str] | None] = ContextVar("preview_parsed_notes", default=None)


def parse_metadata(frontmatter: str, digest: str) -> dict[str, JsonValue] | None:
    """Reuse only the parse of freshly read and hashed original bytes."""
    cache = parsed_note_cache.get()
    cached = cache.get(digest) if cache is not None else None
    if cached is not None:
        value = json.loads(cached)
        if isinstance(value, dict) and value.get("id"):
            return cast(dict[str, JsonValue], value)
    # Both loaders accept only SafeLoader constructors.
    meta: object = yaml.load(frontmatter, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))
    if not isinstance(meta, dict) or not meta.get("id"):
        return None
    serialized = json.dumps(meta, default=str)
    if cache is not None:
        cache[digest] = serialized
    return cast(dict[str, JsonValue], json.loads(serialized))


def _read(path: Path, maximum: int) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > maximum:
            raise ValueError('Invalid private metadata cache')
        raw = stream.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError('Oversized metadata cache')
        return raw


def _key(root: Path) -> bytes:
    path = root / '.note-parse-cache-key'
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(secrets.token_bytes(32))
    key = _read(path, 32)
    if len(key) != 32:
        raise ValueError('Invalid metadata cache key')
    return key


def _tag(key: bytes, payload: str) -> str:
    return hmac.new(key, (_FORMAT + '\0' + payload).encode(), hashlib.sha256).hexdigest()


@contextmanager
def parsed_metadata(root: Path) -> Iterator[dict[str, str]]:
    """A corrupt/unavailable cache falls back to full source parsing."""
    cache: dict[str, str] = {}
    key: bytes | None = None
    path = root / 'note-parse-cache.json'
    try:
        key = _key(root)
        value = json.loads(_read(path, _MAXIMUM))
        payload, signature = value['payload'], value['signature']
        if not isinstance(payload, str) or not isinstance(signature, str) or not hmac.compare_digest(_tag(key, payload), signature):
            raise ValueError('Changed metadata cache')
        data = json.loads(payload)
        if not isinstance(data, dict) or len(data) > 100_000 or any(not isinstance(k, str) or not re.fullmatch(r'[a-f0-9]{64}', k) or not isinstance(v, str) for k, v in data.items()):
            raise ValueError('Invalid metadata cache entries')
        cache = data
    except (OSError, ValueError, TypeError, KeyError):
        pass
    try:
        yield cache
    finally:
        if key is not None:
            payload = json.dumps(cache, ensure_ascii=False, separators=(',', ':'))
            value = {'payload': payload, 'signature': _tag(key, payload)}
            if len(json.dumps(value).encode()) <= _MAXIMUM:
                try:
                    if not path.is_symlink():
                        private_json(path, value)
                except (OSError, ValueError):
                    pass
