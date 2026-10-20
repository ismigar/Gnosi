"""Preview-first snapshots and atomic, scope-checked publication changes."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from backend.domains.vault.registry.state import RegistryData
from backend.services.workspace_service import WorkspaceContext
from backend.utils.safe_io import file_etag

from .markdown import SelectedNote, SnapshotMarkdown
from .models import PublicationPreview, PublicationRevision, PublicationSite
from .schemas import (PublicationBundle, PublicationCandidate, PublicationPreviewResponse,
                      PublicationSelection, PublicationSummary)

MAX_BUNDLE_BYTES = 2_000_000
PREVIEW_LIFETIME = 15 * 60


@dataclass(frozen=True)
class PublicationDependencies:
    parse: Callable[[str, Path], tuple[RegistryData, str]]
    validate_access: Callable[[], None] = lambda: None
    local_prefixes: tuple[str, ...] = ()


@dataclass(frozen=True)
class PublicationScope:
    owner_id: str
    workspace_id: str
    vault_key: str

    @classmethod
    def from_context(cls, context: WorkspaceContext) -> "PublicationScope":
        return cls(context.user_id, context.workspace_id,
                   hashlib.sha256(str(context.vault_path.resolve()).encode()).hexdigest())


def _owned(site: PublicationSite | PublicationPreview, scope: PublicationScope) -> bool:
    return (site.owner_id, site.workspace_id, site.vault_key) == (scope.owner_id, scope.workspace_id, scope.vault_key)


def inventory(root: Path, dependencies: PublicationDependencies) -> dict[str, SelectedNote]:
    root = root.resolve()
    notes: dict[str, SelectedNote] = {}
    total = 0

    def unreadable(error: OSError) -> None:
        raise HTTPException(409, "A note folder could not be read") from error

    for folder, dirs, filenames in os.walk(root, followlinks=False, onerror=unreadable):
        dirs[:] = sorted(name for name in dirs if not name.startswith(".") and not (Path(folder) / name).is_symlink())
        for name in sorted(filenames):
            path = Path(folder) / name
            if name.startswith(".") or path.suffix.lower() != ".md" or path.is_symlink():
                continue
            if not path.resolve().is_relative_to(root):
                raise HTTPException(409, "A note is outside the selected vault")
            try:
                if path.stat().st_size > 4_000_000:
                    continue
                etag = file_etag(path)
                raw = path.read_bytes()
                total += len(raw)
                if total > 64_000_000 or len(notes) >= 20000:
                    raise HTTPException(409, "This vault exceeds the publication preview limit")
                metadata, body = dependencies.parse(raw.decode("utf-8"), path)
                if file_etag(path) != etag or not path.resolve().is_relative_to(root):
                    raise HTTPException(409, "A note changed while preparing publication")
                identity = str(metadata.get("id") or metadata.get("migration_id") or path.stem)
                if identity in notes:
                    raise HTTPException(409, "Resolve duplicate note identities before publishing")
                aliases = metadata.get("aliases", [])
                alias_values = tuple(str(item) for item in aliases) if isinstance(aliases, list) else (str(aliases),)
                notes[identity] = SelectedNote(identity, str(metadata.get("title") or path.stem)[:500],
                                               path.relative_to(root).as_posix(), alias_values, body)
            except (OSError, UnicodeError, ValueError) as error:
                raise HTTPException(409, "A note could not be read for publication") from error
    dependencies.validate_access()
    return notes


def candidates(root: Path, dependencies: PublicationDependencies) -> list[PublicationCandidate]:
    return [PublicationCandidate(id=note.id, title=note.title)
            for note in sorted(inventory(root, dependencies).values(), key=lambda item: (item.title.casefold(), item.id))]


def _site(db: Session, site_id: str, scope: PublicationScope) -> PublicationSite:
    site = db.get(PublicationSite, site_id)
    if site is None or not _owned(site, scope):
        raise HTTPException(404, "Publication not found")
    return site


def summary(site: PublicationSite) -> PublicationSummary:
    raw_ids: object = json.loads(site.source_ids)
    if not isinstance(raw_ids, list) or any(not isinstance(item, str) for item in raw_ids):
        raise HTTPException(503, "The publication record is unavailable")
    return PublicationSummary(id=site.id, token=site.token, title=site.title, page_ids=raw_ids,
                              revision=site.revision, created_at=site.created_at, updated_at=site.updated_at,
                              expires_at=site.expires_at, revoked=site.revoked)


def list_sites(db: Session, scope: PublicationScope) -> list[PublicationSummary]:
    sites = db.scalars(select(PublicationSite).where(PublicationSite.owner_id == scope.owner_id,
                     PublicationSite.workspace_id == scope.workspace_id,
                     PublicationSite.vault_key == scope.vault_key).order_by(PublicationSite.updated_at.desc()).limit(200))
    return [summary(site) for site in sites]


def preview(db: Session, scope: PublicationScope, root: Path, request: PublicationSelection,
            dependencies: PublicationDependencies, *, now: int | None = None) -> PublicationPreviewResponse:
    now = int(time.time()) if now is None else now
    if request.site_id is not None:
        site = _site(db, request.site_id, scope)
        if site.revoked or site.revision != request.expected_revision or site.revision >= 100:
            raise HTTPException(409, "The publication changed or reached its revision limit; reload the list")
    notes = inventory(root, dependencies)
    if any(page_id not in notes for page_id in request.page_ids):
        raise HTTPException(404, "A selected note is unavailable in this vault")
    selected = [notes[page_id] for page_id in request.page_ids]
    if any(len(note.body.encode()) > 256_000 for note in selected) or sum(len(note.body.encode()) for note in selected) > MAX_BUNDLE_BYTES:
        raise HTTPException(413, "Select fewer or smaller notes (256 KB per note, 2 MB per site)")
    bundle = PublicationBundle(title=request.title, pages=SnapshotMarkdown(selected, dependencies.local_prefixes).render(),
                               published_at=now, expires_at=now + request.expires_in_days * 86400 if request.expires_in_days else None,
                               revision=(request.expected_revision or 0) + 1)
    payload = bundle.model_dump_json()
    if len(payload.encode()) > MAX_BUNDLE_BYTES:
        raise HTTPException(413, "The publication exceeds its 2 MB size limit")
    dependencies.validate_access()
    db.execute(delete(PublicationPreview).where(PublicationPreview.expires_at <= now))
    count = db.scalar(select(func.count()).select_from(PublicationPreview).where(PublicationPreview.owner_id == scope.owner_id)) or 0
    if count >= 10:
        raise HTTPException(429, "Too many pending previews; wait fifteen minutes and retry")
    token = secrets.token_urlsafe(32)
    db.add(PublicationPreview(id=token, owner_id=scope.owner_id, workspace_id=scope.workspace_id,
                            vault_key=scope.vault_key, expires_at=now + PREVIEW_LIFETIME, payload=payload,
                            source_ids=json.dumps(request.page_ids), site_id=request.site_id, expected_revision=request.expected_revision))
    db.commit()
    return PublicationPreviewResponse(preview_id=token, preview_expires_at=now + PREVIEW_LIFETIME, bundle=bundle)


def commit(db: Session, scope: PublicationScope, preview_id: str, *, now: int | None = None) -> PublicationSummary:
    now = int(time.time()) if now is None else now
    draft = db.get(PublicationPreview, preview_id)
    if draft is None or not _owned(draft, scope) or draft.expires_at <= now:
        raise HTTPException(404, "The publication preview expired or is unavailable")
    bundle = PublicationBundle.model_validate_json(draft.payload)
    if bundle.expires_at is not None and bundle.expires_at <= now:
        raise HTTPException(409, "The publication expiry has passed; prepare a new preview")
    # Consume the exact reviewed snapshot in the same transaction as the site
    # pointer. A second tab cannot replay a consumed preview or overwrite a newer revision.
    consumed = db.execute(delete(PublicationPreview).where(PublicationPreview.id == preview_id,
                                                          PublicationPreview.expires_at > now))
    if consumed.rowcount != 1:  # type: ignore[attr-defined]
        db.rollback()
        raise HTTPException(409, "This preview has already been published")
    if draft.site_id is not None:
        site = _site(db, draft.site_id, scope)
        changed = db.execute(update(PublicationSite).where(PublicationSite.id == site.id,
            PublicationSite.revision == draft.expected_revision, PublicationSite.revoked.is_(False)).values(
                revision=bundle.revision, title=bundle.title, source_ids=draft.source_ids,
                updated_at=now, expires_at=bundle.expires_at))
        if changed.rowcount != 1:  # type: ignore[attr-defined]
            db.rollback()
            raise HTTPException(409, "The publication changed; prepare a new preview")
    else:
        count = db.scalar(select(func.count()).select_from(PublicationSite).where(PublicationSite.owner_id == scope.owner_id)) or 0
        if count >= 200:
            db.rollback()
            raise HTTPException(409, "This account reached its 200-site publication limit")
        site = PublicationSite(id=uuid.uuid4().hex, token=secrets.token_urlsafe(32), owner_id=scope.owner_id,
            workspace_id=scope.workspace_id, vault_key=scope.vault_key, title=bundle.title, source_ids=draft.source_ids,
            revision=1, revoked=False, created_at=now, updated_at=now, expires_at=bundle.expires_at)
        db.add(site)
    # Payloads are append-only, including on refresh. Publication time is the
    # reviewed snapshot time so the preview and published bundle are identical.
    db.add(PublicationRevision(site_id=site.id, revision=bundle.revision, payload=draft.payload))
    db.commit()
    db.refresh(site)
    return summary(site)


def revoke(db: Session, scope: PublicationScope, site_id: str, expected_revision: int) -> PublicationSummary:
    site = _site(db, site_id, scope)
    changed = db.execute(update(PublicationSite).where(PublicationSite.id == site.id,
        PublicationSite.revision == expected_revision, PublicationSite.revoked.is_(False)).values(revoked=True, updated_at=int(time.time())))
    if changed.rowcount != 1:  # type: ignore[attr-defined]
        db.rollback()
        raise HTTPException(409, "The publication changed; reload the list")
    db.commit()
    db.refresh(site)
    return summary(site)


def published(db: Session, token: str, *, now: int | None = None) -> PublicationBundle:
    now = int(time.time()) if now is None else now
    site = db.scalar(select(PublicationSite).where(PublicationSite.token == token,
                                                PublicationSite.revoked.is_(False)))
    if site is None or (site.expires_at is not None and site.expires_at <= now):
        raise HTTPException(404, "Publication unavailable")
    revision = db.get(PublicationRevision, (site.id, site.revision))
    if revision is None:
        raise HTTPException(404, "Publication unavailable")
    return PublicationBundle.model_validate_json(revision.payload)
