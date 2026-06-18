"""Índex local de traduccions per a la idempotència de translate-row.

Mapa `{ origin_id_canònic: { lang: subitem_id } }` persistit FORA del Vault (a
`local_data/system/`, mai sincronitzat amb OneDrive). Així la idempotència de
translate-row no depèn de llegir els subitems del Vault, que poden ser
online-only (dataless) i fer fallar el lookup → duplicats (bug "re-traduir crea
subitems nous i mou els vells a .trash").

És una PISTA primària, NO l'única font: el caller valida cada id contra el disc
(`find_page_path`) abans de fer-lo servir, de manera que un índex ranci (subitem
esborrat manualment, o índex perdut) no provoca cap error — només cau a les
altres vies (snapshot / _recover).

Sense imports pesats del backend (només `translation_helpers`, que és pur):
importable en aïllament per als tests.
"""
import json
import logging
import os
import threading
from pathlib import Path
from typing import Dict

from backend.services.translation_helpers import canonicalize_id

log = logging.getLogger(__name__)

_lock = threading.Lock()


def _index_path() -> Path:
    """Ruta del JSON de l'índex, a `local_data/system/` (mai a OneDrive)."""
    local_env = os.environ.get("GNOSI_LOCAL_DATA")
    base = Path(local_env) if local_env else Path("/app/data")
    return base / "system" / "translation_index.json"


def _load() -> Dict[str, Dict[str, str]]:
    p = _index_path()
    try:
        if not p.exists():
            return {}
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        log.warning(f"translation-index: no s'ha pogut llegir {p}: {exc}")
        return {}


def _save(data: Dict[str, Dict[str, str]]) -> None:
    p = _index_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        tmp.replace(p)  # rename atòmic
    except Exception as exc:
        log.warning(f"translation-index: no s'ha pogut desar {p}: {exc}")


def get_known_translations(origin_id: str) -> Dict[str, str]:
    """`{lang: subitem_id}` registrats per a un origin (pot estar ranci → el
    caller ha de validar cada id contra el disc)."""
    key = canonicalize_id(origin_id)
    if not key:
        return {}
    with _lock:
        entry = _load().get(key) or {}
    if not isinstance(entry, dict):
        return {}
    return {
        str(k).strip().lower(): str(v)
        for k, v in entry.items()
        if isinstance(k, str) and v
    }


def record_translation(origin_id: str, lang: str, subitem_id: str) -> None:
    """Registra (origin, lang) → subitem_id. Idempotent (sobreescriu el lang)."""
    key = canonicalize_id(origin_id)
    lng = str(lang or "").strip().lower()
    sid = str(subitem_id or "").strip()
    if not key or not lng or not sid:
        return
    with _lock:
        data = _load()
        data.setdefault(key, {})[lng] = sid
        _save(data)


def forget_translation(origin_id: str, lang: str) -> None:
    """Treu (origin, lang) de l'índex (subitem esborrat o id ranci)."""
    key = canonicalize_id(origin_id)
    lng = str(lang or "").strip().lower()
    if not key or not lng:
        return
    with _lock:
        data = _load()
        entry = data.get(key)
        if isinstance(entry, dict) and lng in entry:
            del entry[lng]
            if not entry:
                data.pop(key, None)
            _save(data)
