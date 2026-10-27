"""Reauthorize and resume approved website jobs after a backend restart."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from pathlib import Path

from backend.config.app_config import load_params
from backend.config.data_dir import resolve_data_dir
from backend.data.management_db import get_mgmt_session
from backend.models.management import Membership, User, UserRole, Vault, VaultAccess
from backend.services.plugin_access import plugins_enabled_now
from backend.services.workspace_service import ROLE_WEIGHTS, WorkspaceContext

from .models import SiteJob
from .storage import SiteStore, fingerprint


log = logging.getLogger(__name__)
_recovery_lock = threading.Lock()


def authorized_context(workspace_id: str, vault_path: Path, user_id: str) -> WorkspaceContext | None:
    """Use current membership and registered storage, never stale serialized roles."""
    params = load_params(strict_env=False)
    project = params.paths.get("PROJECT_DIR")
    default_vault = params.paths.get("VAULT")
    if not project or not default_vault or not vault_path.is_dir():
        return None
    with get_mgmt_session() as db:
        if db.query(User).filter(User.id == user_id).first() is None:
            return None
        membership = db.query(Membership).filter(Membership.workspace_id == workspace_id, Membership.user_id == user_id).first()
        if membership is None:
            return None
        role = membership.role.value if isinstance(membership.role, UserRole) else str(membership.role)
        if ROLE_WEIGHTS.get(role, 0) < ROLE_WEIGHTS["editor"]:
            return None
        access = db.query(VaultAccess).filter(VaultAccess.workspace_id == workspace_id, VaultAccess.user_id == user_id).all()
        allowed_ids = {str(item.vault_id) for item in access}
        registered = db.query(Vault).filter(Vault.workspace_id == workspace_id).all()
        for vault in registered:
            if params.gnosi_mode != "personal" and allowed_ids and vault.id not in allowed_ids:
                continue
            if vault.path_override:
                candidate = Path(vault.path_override)
                if not candidate.is_absolute():
                    candidate = project / candidate
            elif params.gnosi_mode == "personal":
                candidate = default_vault
            else:
                candidate = project / "workspaces" / workspace_id / "vault"
            if candidate.is_dir() and candidate.resolve() == vault_path.resolve():
                return WorkspaceContext(workspace_id, user_id, role, vault_path)
    return None


def recover_queued_jobs() -> dict[str, int]:
    """Discover only device-private receipts, without inventing missing cloud mounts."""
    from .publication import dispatch, jobs
    counts = {"resumed": 0, "skipped": 0, "failed": 0}
    if not _recovery_lock.acquire(blocking=False):
        return counts
    try:
        root = resolve_data_dir() / "sites"
        if not root.is_dir():
            return counts
        for scope in root.iterdir():
            descriptor = scope / "scope.json"
            database = scope / "operations.sqlite"
            if scope.is_symlink() or not scope.is_dir() or not descriptor.is_file() or not database.is_file() or database.is_symlink():
                continue
            try:
                if descriptor.stat().st_size > 16000:
                    raise ValueError("Oversized scope receipt")
                identity = json.loads(descriptor.read_text())
                workspace_id = str(identity["workspace_id"])
                vault = Path(identity["vault_path"])
                if not vault.is_absolute() or not vault.is_dir() or fingerprint([workspace_id, str(vault.resolve())]) != scope.name:
                    counts["skipped"] += 1
                    continue
                with sqlite3.connect("file:" + str(database) + "?mode=ro", uri=True) as db:
                    rows = db.execute("SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 1000").fetchall()
                for row in rows:
                    job = SiteJob.model_validate_json(row[0])
                    if job.status not in {"queued", "running", "failed", "interrupted"}:
                        continue
                    request_path = scope / job.site_id / "jobs" / (job.id + ".json")
                    if request_path.is_symlink() or not request_path.resolve().is_relative_to(scope) or not request_path.is_file():
                        counts["skipped"] += 1
                        continue
                    request = json.loads(request_path.read_text())
                    context = authorized_context(workspace_id, vault, str(request["user_id"]))
                    if context is None or not plugins_enabled_now("web-publishing", vault_path=vault):
                        counts["skipped"] += 1
                        continue
                    store = SiteStore(context)
                    if job.status == "queued":
                        dispatch(store, job)
                        counts["resumed"] += 1
                    elif job.release_id:
                        jobs(store, job.site_id)
            except Exception:
                counts["failed"] += 1
                log.warning("Website task recovery could not read one private operation scope")
    finally:
        _recovery_lock.release()
    return counts


def kickoff_recovery() -> threading.Thread | None:
    """Start bounded discovery without blocking the application startup thread."""
    if str(os.environ.get("GNOSI_DISABLE_SCHEDULER", "")).lower() in {"1", "true", "yes", "on"}:
        return None
    thread = threading.Thread(target=recover_queued_jobs, daemon=True, name="website-task-recovery")
    thread.start()
    return thread
