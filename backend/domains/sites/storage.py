"""Atomic synchronized editorial files and device-private website operation state."""
from __future__ import annotations

import hashlib
import builtins
import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import cast

from fastapi import HTTPException
from pydantic import JsonValue

from backend.config.data_dir import resolve_data_dir
from backend.services.workspace_service import WorkspaceContext
from backend.utils.safe_io import safe_write_json

from .models import SiteConfig, SiteJob, SiteTheme, identifier, timestamp


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint(value: object) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def private_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    safe_write_json(path, value, ensure_ascii=False, indent=2)
    path.chmod(0o600)


class SiteStore:
    """Scope all state by authenticated workspace and resolved vault identity."""

    def __init__(self, context: WorkspaceContext) -> None:
        self.context = context
        self.vault = context.vault_path.resolve(strict=True)
        scope = fingerprint([context.workspace_id, str(self.vault)])
        self.private_root = (resolve_data_dir() / "sites" / scope).resolve()
        if self.private_root.is_relative_to(self.vault):
            raise HTTPException(503, "Website private storage must be outside the vault")
        self.private_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.private_root.chmod(0o700)
        self.config_root = self.vault / ".gnosi" / "sites"
        if self.config_root.is_symlink() or not self.config_root.resolve().is_relative_to(self.vault):
            raise HTTPException(409, "Invalid website configuration storage")
        self.db_path = self.private_root / "operations.sqlite"
        with self.database() as db:
            db.executescript("""
CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, user_id TEXT NOT NULL, target_id TEXT NOT NULL, fingerprint TEXT NOT NULL, expires REAL NOT NULL, payload TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, target_id TEXT NOT NULL, payload TEXT NOT NULL, bundle TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS active (site_id TEXT NOT NULL, target_id TEXT NOT NULL, release_id TEXT NOT NULL, PRIMARY KEY(site_id,target_id));
CREATE TABLE IF NOT EXISTS target_environments (site_id TEXT NOT NULL, target_id TEXT NOT NULL, environment TEXT NOT NULL, PRIMARY KEY(site_id,target_id));
CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS locks (site_id TEXT PRIMARY KEY, job_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS newsletter_drafts (site_id TEXT NOT NULL, target_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(site_id,target_id));
CREATE TABLE IF NOT EXISTS newsletter_reviews (site_id TEXT NOT NULL, target_id TEXT NOT NULL, preview_id TEXT NOT NULL, fingerprint TEXT NOT NULL, mode TEXT NOT NULL, PRIMARY KEY(site_id,target_id,preview_id));
""")
        self.db_path.chmod(0o600)

    @contextmanager
    def database(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.db_path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def site_dir(self, site_id: str) -> Path:
        if not site_id or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in site_id) or len(site_id) > 100:
            raise HTTPException(404, "Website not found")
        path = self.private_root / site_id
        if path.is_symlink():
            raise HTTPException(409, "Invalid private website directory")
        path.mkdir(mode=0o700, exist_ok=True)
        return path

    def config_path(self, site_id: str) -> Path:
        self.site_dir(site_id)
        return self.config_root / (site_id + ".json")

    def list(self) -> list[SiteConfig]:
        if not self.config_root.exists():
            return []
        result: list[SiteConfig] = []
        for path in sorted(self.config_root.glob("*.json")):
            if path.is_symlink() or "conflict" in path.name.lower():
                raise HTTPException(409, "Resolve the synchronized website configuration conflict")
            try:
                site = SiteConfig.model_validate_json(path.read_text())
            except (ValueError, OSError):
                raise HTTPException(409, "Website configuration cannot be read") from None
            if path.stem != site.id:
                raise HTTPException(409, "Website configuration identity changed")
            result.append(site)
        return result

    def load(self, site_id: str) -> SiteConfig:
        path = self.config_path(site_id)
        if path.is_symlink():
            raise HTTPException(409, "Invalid website configuration")
        try:
            result = SiteConfig.model_validate_json(path.read_text())
        except FileNotFoundError:
            raise HTTPException(404, "Website not found") from None
        except (OSError, ValueError):
            raise HTTPException(409, "Website configuration cannot be read") from None
        if result.id != site_id:
            raise HTTPException(409, "Website configuration identity changed")
        return result

    def save(self, site: SiteConfig, *, create: bool = False) -> SiteConfig:
        from .validation import validate_site
        validate_site(site)
        with self.database() as db:
            path = self.config_path(site.id)
            if create:
                if path.exists():
                    raise HTTPException(409, "Website already exists")
                revision = 1
            else:
                current = self.load(site.id)
                if current.revision != site.revision:
                    raise HTTPException(409, "The website changed; reload before saving")
                if site.legacy_pilot != current.legacy_pilot:
                    raise HTTPException(422, "Pilot ownership cannot be changed")
                self._bind_target_environments(db, current)
                removed = {target.id for target in current.targets} - {target.id for target in site.targets}
                if removed:
                    self._prepare_removal(db, current, removed)
                revision = current.revision + 1
            result = site.model_copy(update={"revision": revision}, deep=True)
            self._bind_target_environments(db, site)
            db.execute("INSERT INTO versions VALUES (?,?,?,?)", (identifier(), site.id, timestamp(), result.model_dump_json()))
            safe_write_json(path, result.model_dump(mode="json"), ensure_ascii=False, indent=2)
            return result

    def _bind_target_environments(self, db: sqlite3.Connection, site: SiteConfig) -> None:
        """Retained service state keeps its authority after a target is removed."""
        history: list[SiteConfig] | None = None
        for target in site.targets:
            row = db.execute("SELECT environment FROM target_environments WHERE site_id=? AND target_id=?", (site.id, target.id)).fetchone()
            environment = row["environment"] if row else None
            if environment is None:
                root = self.site_dir(site.id) / "services" / target.id
                retained = root.is_dir() and any(root.iterdir())
                retained = retained or bool(db.execute("SELECT 1 FROM releases WHERE site_id=? AND target_id=? UNION ALL SELECT 1 FROM previews WHERE site_id=? AND target_id=? LIMIT 1", (site.id, target.id, site.id, target.id)).fetchone())
                if not retained:
                    continue
                if history is None:
                    history = [SiteConfig.model_validate_json(row["payload"]) for row in db.execute("SELECT payload FROM versions WHERE site_id=? ORDER BY created_at DESC,rowid DESC", (site.id,))]
                environment = next((prior.environment for version in history for prior in version.targets if prior.id == target.id), None)
            # Local previews and remote staging both capture mail. Retained state
            # must never cross the real-delivery boundary in either direction.
            if environment is not None and (environment == "production") != (target.environment == "production"):
                raise HTTPException(409, "Create a separate destination for a different environment")
            db.execute("INSERT OR IGNORE INTO target_environments VALUES (?,?,?)", (site.id, target.id, target.environment))

    def _prepare_removal(self, db: sqlite3.Connection, site: SiteConfig, target_ids: set[str]) -> None:
        """Keep publication and process ownership valid while removing registrations."""
        if db.execute("SELECT 1 FROM locks WHERE site_id=?", (site.id,)).fetchone():
            raise HTTPException(409, "Wait for the website publication to finish before removing it")
        rows = db.execute("SELECT payload FROM jobs WHERE site_id=?", (site.id,)).fetchall()
        for row in rows:
            job = SiteJob.model_validate_json(row["payload"])
            if job.target_id in target_ids and job.status in {"queued", "running"}:
                raise HTTPException(409, "Cancel pending publications before removing the website or hosting")
        from .runtime import retire_target, stop_preview
        for target in site.targets:
            if target.id in target_ids:
                retire_target(self, site.id, target.id)
                previews = db.execute("SELECT id FROM previews WHERE site_id=? AND target_id=?", (site.id, target.id)).fetchall()
                for preview in previews:
                    stop_preview(self, site.id, preview["id"])
                db.execute("DELETE FROM previews WHERE site_id=? AND target_id=?", (site.id, target.id))

    def remove(self, site_id: str, revision: int) -> None:
        """Remove the editorial registration, retaining content and publication history."""
        with self.database() as db:
            site = self.load(site_id)
            if site.revision != revision:
                raise HTTPException(409, "The website changed; reload before removing it")
            self._prepare_removal(db, site, {target.id for target in site.targets})
            db.execute("DELETE FROM previews WHERE site_id=?", (site_id,))
            self.config_path(site_id).unlink()

    def themes(self, site_id: str) -> builtins.list[SiteTheme]:
        self.load(site_id)
        with self.database() as db:
            rows = db.execute("SELECT payload FROM versions WHERE site_id=? ORDER BY created_at DESC LIMIT 50", (site_id,)).fetchall()
        return [SiteConfig.model_validate_json(row["payload"]).theme for row in rows]

    def json_rows(self, table: str, site_id: str) -> builtins.list[dict[str, JsonValue]]:
        if table not in {"jobs", "releases"}:
            raise ValueError("Unknown state collection")
        with self.database() as db:
            rows = db.execute("SELECT payload FROM " + table + " WHERE site_id=? ORDER BY rowid DESC LIMIT 100", (site_id,)).fetchall()
        return [cast(dict[str, JsonValue], json.loads(row["payload"])) for row in rows]

    def active_bundle(self, site_id: str, target_id: str) -> dict[str, JsonValue] | None:
        with self.database() as db:
            row = db.execute("SELECT r.bundle FROM active a JOIN releases r ON r.id=a.release_id WHERE a.site_id=? AND a.target_id=?", (site_id, target_id)).fetchone()
        return cast(dict[str, JsonValue], json.loads(row["bundle"])) if row else None
