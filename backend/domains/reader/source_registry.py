"""Vault-owned subscriptions with a disposable local SQL projection."""
from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Iterator
from typing import Any, cast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

from filelock import FileLock, Timeout
from sqlalchemy.orm import Session

from backend.config.data_dir import default_data_dir
from backend.models.reader import FeedSource
from backend.utils.metadata_io import MetadataUnavailable, read_metadata_text
from backend.utils.safe_io import safe_write_json


class SourceRegistryError(RuntimeError):
    """The canonical subscriptions could not be read or saved safely."""


def _lock_directory() -> Path:
    # Data-directory transitions must not split the lock for the same Vault.
    # Use the per-user platform directory, independently of instance overrides.
    return default_data_dir(environ={}, docker=False) / 'system' / 'reader-source-locks'


def _path(vault: Path) -> Path:
    root = vault.resolve()
    path = root / '.gnosi' / 'reader_sources.json'
    if path.parent.is_symlink() or path.is_symlink():
        raise SourceRegistryError('Reader metadata must not use symlinks')
    if not path.resolve().is_relative_to(root):
        raise SourceRegistryError('Reader metadata escapes the vault')
    return path


def _date(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (ValueError, TypeError, AttributeError) as exc:
        raise SourceRegistryError('Invalid subscription creation date') from exc


def _validate(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or set(payload) != {'version', 'sources'}:
        raise SourceRegistryError('Invalid reader source registry')
    if type(payload['version']) is not int or payload['version'] != 1:
        raise SourceRegistryError('Unsupported reader source registry version')
    if not isinstance(payload['sources'], list):
        raise SourceRegistryError('Invalid reader source list')
    seen = set()
    for item in payload['sources']:
        if not isinstance(item, dict) or set(item) != {'name', 'url', 'category', 'type', 'created_at'}:
            raise SourceRegistryError('Invalid reader source fields')
        if not all(isinstance(item[key], str) or (key == 'category' and item[key] is None)
                   for key in item):
            raise SourceRegistryError('Invalid reader source values')
        if not item['url'].strip():
            raise SourceRegistryError('Invalid reader source')
        try:
            url = urlsplit(item['url'])
            if url.username is not None or url.password is not None:
                raise SourceRegistryError('Subscription URLs must not contain credentials')
        except ValueError as exc:
            raise SourceRegistryError('Invalid subscription URL') from exc
        _date(item['created_at'])
        if item['url'] in seen:
            raise SourceRegistryError('Duplicate subscription URL')
        seen.add(item['url'])
    return cast(list[dict[str, Any]], payload['sources'])


def _snapshot(db: Session) -> dict[str, Any]:
    sources = []
    for row in db.query(FeedSource).order_by(FeedSource.url).all():
        date = row.created_at or datetime.now(timezone.utc)
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        sources.append(dict(name=row.name, url=row.url, category=row.category,
                            type=row.type or 'rss', created_at=date.isoformat()))
    payload = {'version': 1, 'sources': sources}
    _validate(payload)
    return payload


def _reconcile(db: Session, sources: list[dict[str, Any]]) -> bool:
    existing = {row.url: row for row in db.query(FeedSource).all()}
    changed = False
    for item in sources:
        row = existing.pop(item['url'], None)
        if row is None:
            row = FeedSource(url=item['url'], created_at=_date(item['created_at']))
            db.add(row)
            changed = True
        for key in ('name', 'category', 'type'):
            if getattr(row, key) != item[key]:
                setattr(row, key, item[key])
                changed = True
        canonical_date = _date(item['created_at']).astimezone(timezone.utc)
        local_date = row.created_at
        if local_date is not None and local_date.tzinfo is None:
            local_date = local_date.replace(tzinfo=timezone.utc)
        if local_date != canonical_date:
            setattr(row, "created_at", canonical_date)
            changed = True
    for row in existing.values():
        db.delete(row)
        changed = True
    return changed


@contextmanager
def source_transaction(
    db: Session, vault_path: Path, *, write: bool = False
) -> Iterator[Session]:
    """Refresh SQL under a process lock, then optionally publish caller mutations.

    Enter with a clean session, before changing source or article rows. Entry
    rolls back any stale read transaction. The yielded value is the supplied session.
    Source writers must leave commit to this context: canonical file replacement
    precedes the SQL commit, so a failed commit is repaired on the next entry.
    """
    try:
        # Filesystem identity also unifies case aliases on case-insensitive
        # volumes. Different path spellings must not create different locks.
        identity = Path(vault_path).resolve().stat()
        digest = hashlib.sha256(f'{identity.st_dev}:{identity.st_ino}'.encode()).hexdigest()
        locks = _lock_directory()
        locks.mkdir(parents=True, exist_ok=True)
        with FileLock(str(locks / f'{digest}.lock'), timeout=10):
            path = _path(Path(vault_path))
            try:
                payload = json.loads(read_metadata_text(path))
            except FileNotFoundError:
                # Missing is the only migration signal; an empty file is invalid.
                db.rollback()
                db.expire_all()
                payload = _snapshot(db)
                safe_write_json(_path(Path(vault_path)), payload)
            sources = _validate(payload)
            # Do not trust previously loaded identities or a stale read transaction.
            db.rollback()
            db.expire_all()
            if _reconcile(db, sources):
                db.commit()
            yield db
            if write:
                db.flush()
                updated = _snapshot(db)
                if updated != payload:
                    safe_write_json(_path(Path(vault_path)), updated)
                db.commit()
    except Exception as exc:
        db.rollback()
        if isinstance(exc, (OSError, ValueError, MetadataUnavailable, Timeout)):
            raise SourceRegistryError('Reader source registry is unavailable or invalid') from exc
        raise
