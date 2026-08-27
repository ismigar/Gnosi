"""Canonical vault slug helpers shared by routing and management APIs."""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.management import Vault
from backend.services.context_vars import get_active_vault_path


_SLUG_SEPARATOR_RE = re.compile(r"[^a-z0-9]+")


def slugify_vault_name(name: str) -> str:
    """Return a stable URL-safe base slug for a vault display name."""
    normalized = unicodedata.normalize("NFKD", str(name or ""))
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return _SLUG_SEPARATOR_RE.sub("-", ascii_name).strip("-") or "vault"


def assign_vault_slug(db: Session, vault: Vault) -> str:
    """Assign a globally unique slug to ``vault`` without changing existing slugs."""
    existing = str(vault.slug or "").strip()
    if existing:
        return existing

    base = slugify_vault_name(vault.name)
    candidate = base
    suffix = 2
    while db.query(Vault.id).filter(Vault.slug == candidate, Vault.id != vault.id).first():
        candidate = f"{base}-{suffix}"
        suffix += 1
    vault.slug = candidate
    return candidate


def ensure_vault_slugs(db: Session) -> bool:
    """Backfill missing slugs deterministically and return whether rows changed."""
    changed = False
    rows = db.query(Vault).order_by(Vault.created_at.asc(), Vault.id.asc()).all()
    for vault in rows:
        if not str(vault.slug or "").strip():
            assign_vault_slug(db, vault)
            db.flush()
            changed = True
    if changed:
        db.commit()
    return changed


def resolve_vault_slug(db: Session, slug: str) -> Optional[Vault]:
    """Resolve a canonical slug, backfilling legacy rows when necessary."""
    normalized = str(slug or "").strip().lower()
    if not normalized:
        return None
    vault = db.query(Vault).filter(Vault.slug == normalized).first()
    if vault:
        return vault
    ensure_vault_slugs(db)
    return db.query(Vault).filter(Vault.slug == normalized).first()


def get_active_vault_slug() -> str:
    """Return the canonical slug for the request's active vault path."""
    active_path = str(get_active_vault_path() or "")
    if not active_path:
        return ""
    from backend.data.management_db import get_mgmt_session

    db = get_mgmt_session()
    try:
        ensure_vault_slugs(db)
        row = db.query(Vault).filter(Vault.path_override == active_path).first()
        return str(row.slug or "") if row else ""
    finally:
        db.close()


def canonical_vault_browser_path(app: str, resource_path: str = "") -> str:
    """Build a canonical browser path for the request's active vault."""
    slug = get_active_vault_slug()
    clean_app = str(app or "knowledge").strip("/") or "knowledge"
    clean_resource = str(resource_path or "").lstrip("/")
    if not slug:
        legacy = {
            "knowledge": "/vault",
            "reader": "/reader",
        }.get(clean_app, f"/{clean_app}")
        return f"{legacy}/{clean_resource}" if clean_resource else legacy
    base = f"/@{slug}/{clean_app}"
    return f"{base}/{clean_resource}" if clean_resource else base
