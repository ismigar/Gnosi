"""Storage de la designació de "Taula de Referències" del Vault.

Aquesta configuració era originalment compartida amb el sync Zotero ↔ Vault
(eliminat al cleanup de codi sync deprecated). El que sobreviu: la
**designació de quina taula del Vault és la de Recursos** (per al gating
del modal Citations, l'export amb cites resoltes via pandoc, etc.).

El JSON segueix vivint a `pipeline/skills/zotero_sync/zotero_db_config.json`
per compatibilitat amb instàncies que ja el tenien (no migrem dades en
runtime). El nom del directori és històric — no implica que el sync existeixi.

Camps mantinguts:
  - `target_table`: UUID de la taula del Vault designada com a Recursos.
  - `references_configured`: bool, indica si l'usuari ha tocat Settings
    (encara que sigui per desactivar). Si True, NO s'auto-migra a una
    nova taula trobada per heurística.
  - `linked_attachments_base`: opcional, ruta a la carpeta de PDFs
    enllaçats (heretat de Phase 6 attachments).

Camps heretats del sync deprecated (poden existir al JSON però el codi
viu els ignora): `enabled`, `mapping`, `last_sync_*`, `existing_pages_strategy`,
`zotero_db`. No els reproduïm a `DEFAULT_CONFIG` perquè el merge dels
defaults seria semànticament fals.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_BASE_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = _BASE_DIR / "pipeline/skills/zotero_sync/zotero_db_config.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "target_table": "",
    "references_configured": False,
    "linked_attachments_base": "",
}


def load_json(path: Path, default: Any = None) -> Any:
    """Llegeix un JSON file. Retorna `default` si no existeix o és malformat."""
    if path is None or not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    """Escriu un JSON atòmicament (evita corrupció a meitat de write)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    from backend.utils.safe_io import safe_write_json
    safe_write_json(path, data, indent=2, ensure_ascii=False)
