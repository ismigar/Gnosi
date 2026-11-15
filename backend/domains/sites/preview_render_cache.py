"""Authenticated, disposable renderer reuse for local previews only.

Fresh source discovery and review/activation checks stay outside this cache.
Only verified generated HTML, Astro assets and Pagefind files are reused;
attachments and service state are never trusted through the render cache.
"""
from __future__ import annotations

from contextvars import ContextVar
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import stat

from .note_parse_cache import _key, _read
from .storage import private_json

preview_cache_root: ContextVar[Path | None] = ContextVar('website_preview_render_cache', default=None)
release_cache_root: ContextVar[Path | None] = ContextVar('website_release_render_cache', default=None)
_MAXIMUM = 64 * 1024 * 1024
_FILE_MAXIMUM = 8 * 1024 * 1024
_FORMAT = b'preview-render-cache-v1\0'


def renderer_identity(renderer: Path) -> str:
    """Bind reuse to every renderer/service input and the pinned toolchain lock."""
    digest = hashlib.sha256(_FORMAT)
    for item in ('src', 'scripts', 'astro.config.mjs', 'package.json', 'package-lock.json', '../public'):
        source = renderer / item
        paths = sorted(source.rglob('*')) if source.is_dir() else [source]
        for path in paths:
            if path.is_file():
                digest.update(str(path.relative_to(renderer.parent)).encode() + b'\0')
                digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _signature(key: bytes, payload: str) -> str:
    return hmac.new(key, _FORMAT + payload.encode(), hashlib.sha256).hexdigest()


def _root(path: Path) -> None:
    if any(item.is_symlink() for item in (path, *path.parents)):
        raise ValueError('Invalid private render cache directory')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Invalid private render cache permissions')


def _relative(value: str) -> Path:
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or '..' in path.parts or '\\' in value
            or any(ord(char) < 32 for char in value)
            or not (value.endswith('/index.html') or value == 'index.html'
                    or path.parts[0] in {'_astro', 'pagefind'})):
        raise ValueError('Invalid generated cache path')
    return Path(value)


def restore(root: Path | None, work: Path, identity: str) -> None:
    """Copy verified bytes into a disposable build; any cache fault is a miss."""
    if root is None or os.name != "posix":
        return
    seed = work / 'prior'
    try:
        _root(root)
        envelope = json.loads(_read(root / 'manifest.json', _MAXIMUM))
        payload = envelope['payload']
        if not isinstance(payload, str) or not isinstance(envelope['signature'], str):
            raise ValueError('Invalid private render cache envelope')
        if not hmac.compare_digest(_signature(_key(root), payload), envelope['signature']):
            raise ValueError('Changed private render cache')
        manifest = json.loads(payload)
        if manifest['renderer'] != identity:
            return
        generation = manifest['generation']
        if not isinstance(generation, str) or len(generation) != 32 or any(c not in '0123456789abcdef' for c in generation):
            raise ValueError('Invalid cache generation')
        directory = root / generation
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('Invalid cache generation directory')
        total = 0
        files = manifest['files']
        if not isinstance(files, dict) or len(files) > 10000:
            raise ValueError('Invalid generated cache inventory')
        for name, expected in files.items():
            relative = _relative(name)
            source = directory / relative
            if any(p.is_symlink() for p in (source, *source.parents)):
                raise ValueError('Invalid cached file ancestry')
            raw = _read(source, _FILE_MAXIMUM)
            total += len(raw)
            if total > _MAXIMUM or hashlib.sha256(raw).hexdigest() != expected:
                raise ValueError('Changed cached file')
            destination = seed / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
        (work / 'prior-index.json').write_text(json.dumps(manifest['index']), encoding='utf-8')
    except (OSError, ValueError, TypeError, KeyError):
        shutil.rmtree(seed, ignore_errors=True)
        (work / 'prior-index.json').unlink(missing_ok=True)


def save(root: Path | None, work: Path, identity: str) -> None:
    """Publish one complete cache generation atomically; failure never breaks preview."""
    if root is None or os.name != "posix":
        return
    generation = secrets.token_hex(16)
    directory = root / generation
    try:
        _root(root)
        key = _key(root)
        index = json.loads((work / 'render-index.json').read_text())
        paths = [*index['routes'].keys()]
        output = work / 'dist'
        names = [route.lstrip('/') + '/index.html' if route != '/' else 'index.html' for route in paths]
        for name in ('_astro', 'pagefind'):
            names.extend(p.relative_to(output).as_posix() for p in (output / name).rglob('*') if p.is_file())
        files: dict[str, str] = {}
        total = 0
        directory.mkdir(mode=0o700)
        for name in names:
            relative = _relative(name)
            source = output / relative
            if any(p.is_symlink() for p in (source, *source.parents)):
                raise ValueError('Invalid generated file ancestry')
            raw = source.read_bytes()
            total += len(raw)
            if len(raw) > _FILE_MAXIMUM or total > _MAXIMUM:
                raise ValueError('Generated cache allowance exceeded')
            target = directory / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(raw)
            target.chmod(0o600)
            files[name] = hashlib.sha256(raw).hexdigest()
        payload = json.dumps(dict(renderer=identity, generation=generation, index=index, files=files), separators=(',', ':'))
        private_json(root / 'manifest.json', dict(payload=payload, signature=_signature(key, payload)))
        # No generations accumulate across previews. Concurrent readers either
        # finish copying verified bytes or get a cache miss and build afresh.
        for previous in root.iterdir():
            if (previous != directory and len(previous.name) == 32
                    and all(c in '0123456789abcdef' for c in previous.name)
                    and previous.is_dir() and not previous.is_symlink()
                    and previous.stat().st_uid == os.getuid()):
                shutil.rmtree(previous)
    except (OSError, ValueError, TypeError, KeyError):
        shutil.rmtree(directory, ignore_errors=True)
