"""Register existing libraries in the explicitly selected desktop container."""

import os
import hashlib
import json
import uuid
from pathlib import Path
from threading import RLock

from sqlalchemy.orm import Session

from backend.models.management import Vault

_LOCK = RLock()


def register_desktop_vaults(db: Session, workspace_id: str, primary: Path) -> None:
    """Only inspect immediate directories; never scaffold or read user documents."""
    if os.environ.get("GNOSI_DESKTOP_VAULT_DISCOVERY") != "1":
        return
    raw_root = os.environ.get("GNOSI_VAULTS_ROOT")
    if not raw_root:
        return
    root = Path(raw_root)
    if primary.parent != root:
        return
    with _LOCK:
        # Remember discovered folders outside the user's vaults, so removing a
        # registration while retaining its files remains effective after restart.
        data_dir = os.environ.get("GNOSI_DATA_DIR")
        history_file = None
        seen = set()
        if data_dir:
            key = hashlib.sha256(f"{workspace_id}:{root}".encode()).hexdigest()
            history_file = Path(data_dir) / "vault-discovery" / f"{key}.json"
            try:
                seen = set(json.loads(history_file.read_text()))
            except FileNotFoundError:
                pass
        candidates = sorted(
            child for child in root.iterdir()
            if not child.name.startswith(".") and not child.is_symlink() and child.is_dir()
            and ((child / ".gnosi").is_dir()
                 or (child / "BD" / "vault_db_registry.json").is_file())
        )
        rows = db.query(Vault).filter(Vault.workspace_id == workspace_id).all()
        by_path = {row.path_override: row for row in rows}
        changed = False
        for folder in candidates:
            existing = by_path.get(str(folder))
            if existing:
                if folder == primary and existing.name in {"Main Vault", "Vault principal"}:
                    existing.name = folder.name
                    changed = True
                continue
            if str(folder) in seen:
                continue
            vault_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"gnosi:{workspace_id}:{folder}"))
            db.add(Vault(id=vault_id, workspace_id=workspace_id,
                         name=folder.name, path_override=str(folder)))
            changed = True
        if changed:
            from sqlalchemy.exc import IntegrityError

            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                registered = {row.path_override for row in
                              db.query(Vault).filter(Vault.workspace_id == workspace_id).all()}
                if not all(str(folder) in registered or str(folder) in seen for folder in candidates):
                    raise
        discovered = seen | {str(folder) for folder in candidates}
        if history_file and discovered != seen:
            history_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = history_file.with_suffix(f".{uuid.uuid4()}.tmp")
            temporary.write_text(json.dumps(sorted(discovered)), encoding="utf-8")
            temporary.replace(history_file)
