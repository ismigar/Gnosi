"""Local translation index for translate-row idempotency.

Map `{ canonical_origin_id: { lang: subitem_id } }` persisted OUTSIDE the Vault (in
`local_data/system/`, never synced with OneDrive). This way translate-row idempotency
does not depend on reading the Vault subitems, which can be
online-only (dataless) and cause the lookup to fail → duplicates (bug "re-translating creates
new subitems and moves the old ones to .trash").

It's a primary HINT, NOT the only source: the caller validates each id against disk
(`find_page_path`) before using it, so that a stale index (subitem
deleted manually, or lost index) doesn't cause any error — it just falls back to the
other paths (snapshot / _recover).

No heavy backend imports (only `translation_helpers`, which is pure):
importable in isolation for tests.
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
    """Path to the index JSON, in `local_data/system/` (never in OneDrive)."""
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
        tmp.replace(p)  # atomic rename
    except Exception as exc:
        log.warning(f"translation-index: no s'ha pogut desar {p}: {exc}")


def get_known_translations(origin_id: str) -> Dict[str, str]:
    """`{lang: subitem_id}` registered for an origin (may be stale → the
    caller must validate each id against disk)."""
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
    """Registers (origin, lang) → subitem_id. Idempotent (overwrites the lang)."""
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
    """Remove (origin, lang) from the index (subitem deleted or stale id)."""
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
