"""vault_file_index.py — Vault file/folder name index.

Why it exists
----------------
The "Select file or folder" picker searches via `/api/system/search`, which
delegated to Spotlight (`mdfind`) via the `host_open_helper`. But the helper, as
a long-running daemon, does NOT reliably see `~/Library/CloudStorage`
(OneDrive): OneDrive's File Provider goes stale for its context and `mdfind`
returns empty for the whole Vault (symptom: it "can't find" files like "Ética de Kant").
A kickstart of the helper does NOT fix it.

The backend container has all of HOME mounted (`${HOME}:${HOME}:ro`) and reliably
reads `~/Library/CloudStorage` with `os.walk` (including ONLINE-ONLY files,
which also show up there). That's why we keep an in-memory name index here,
built in the background, that covers ALL of CloudStorage (OneDrive,
Google Drive…), not just the Vault — see `_index_roots`.

Why MERGE and not REPLACE (key for online-only files)
---------------------------------------------------
`os.walk` over OneDrive is **intermittent**: it usually returns the whole tree
(~110k entries, ~15s, with all online-only files), but every so often the File
Provider serves empty/non-hydrated folder listings and the walk returns a
fraction (e.g. 37k, 1s). If the index did REPLACE, a partial walk would **shrink**
the index and search would stop finding the online-only files until the next
full walk. That's why each build **merges** (union by path) instead of
replacing: a partial walk never removes anything; when a full walk happens, the index
already has everything. Entries that have truly disappeared are pruned by `last_seen`, but
ONLY after a substantial walk (never after a partial one).

Design (mirroring the `vault_routes` page/link index)
----------------------------------------------------
* Build in a **thread** (not asyncio): I/O-bound over a cloud mount.
* **Load from disk first** (milliseconds) + background rebuild → search
  is available instantly after a restart and coverage accumulates.
* Atomic swap under a lock → queries never see a half-built index.
* Cache in the local volume `/app/data/cache/` (NEVER in OneDrive).
"""

import json
import logging
import os
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List

log = logging.getLogger(__name__)

# ── Configuration ──
_VAULT_INTERNAL = os.environ.get("DIGITAL_BRAIN_VAULT_PATH") or "/vault"
_VAULT_HOST = os.environ.get("VAULT_HOST_PATH") or ""
_LOCAL_DATA = Path(os.environ.get("GNOSI_LOCAL_DATA") or "/app/data")
_CACHE_PATH = _LOCAL_DATA / "cache" / "vault_file_index.json"
# Periodic refresh (seconds). The walk is metadata-only (it doesn't download files).
_REFRESH_SECONDS = int(os.environ.get("GNOSI_FILE_INDEX_REFRESH_SECONDS", "600"))
# An entry not seen in any walk during this time is considered deleted and
# is pruned — but ONLY in a substantial walk (see _PRUNE_MIN_RATIO).
_STALE_SECONDS = int(os.environ.get("GNOSI_FILE_INDEX_STALE_SECONDS", str(7 * 24 * 3600)))
# We only prune if the current walk has seen at least this fraction of the index
# previous (= a "complete" walk); this way an intermittent partial walk doesn't delete anything.
_PRUNE_MIN_RATIO = 0.6

# Folders that are never indexed (noise or hidden). Same criteria as search.
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".cache", ".local", ".npm",
    ".Trash", "Trash", ".obsidian", ".gnosi", ".Dashboards",
}

# ── State (protected by _lock) ──
# Dict path(host) → {"name","name_norm","is_dir","last_seen"}. Dict (not a list)
# to merge walks by path without duplicates.
_lock = threading.Lock()
_by_path: Dict[str, Dict[str, Any]] = {}
_built_at: float = 0.0
_building = False
_thread_started = False


def _norm(s: str) -> str:
    """Normalize for comparison: NFC (macOS stores in NFD) + casefold."""
    return unicodedata.normalize("NFC", s).casefold()


def _to_host(internal_path: str) -> str:
    """Maps an internal container path to the HOST path (the one Finder
    sees and that the frontend can open). Only the Vault is mounted at `/vault`."""
    if _VAULT_HOST and internal_path.startswith(_VAULT_INTERNAL):
        return _VAULT_HOST + internal_path[len(_VAULT_INTERNAL):]
    return internal_path


def _index_roots() -> List[str]:
    """Roots to index (HOST paths, accessible in the container via the HOME
    `ro` mount). We index ALL of `~/Library/CloudStorage` (OneDrive, Google Drive…), not
    just the Vault: the helper (mdfind) does not reliably see ANY CloudStorage
    folder from its context, so everything that lives there (Vault,
    Library, Documents/ESS, etc.) must go into the index. The rest of HOME
    (LOCAL Documents/Downloads, outside CloudStorage) is covered by the helper.

    Why this was needed: the user was searching for `Presentación vivienda cooperativa.pdf`
    (in `OneDrive-UNED/Documents/ESS/`, outside the Vault) and it wasn't showing up because
    the index only covered Vault + Library.
    
    """
    home = os.environ.get("HOME_HOST_PATH") or os.path.expanduser("~")
    cloudstorage = os.path.join(home, "Library", "CloudStorage")
    if Path(cloudstorage).is_dir():
        return [cloudstorage]
    # Fallback (layouts without CloudStorage or outside Docker): the Vault (the
    # Library lives inside since the pure vault-first design).
    roots: List[str] = []
    if Path(_VAULT_INTERNAL).is_dir():
        roots.append(_VAULT_INTERNAL)
    return roots


def _walk() -> List[Dict[str, Any]]:
    """Walks the roots and returns the flat list of entries (may be partial
    if the File Provider serves incomplete listings at this moment). The paths
    are always returned as HOST (via `_to_host`, which only maps the fallback's
    `/vault` prefix; the CloudStorage roots are already host)."""
    out: List[Dict[str, Any]] = []
    for root in _index_roots():
        for dirpath, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [
                d for d in dirs
                if not d.startswith(".")
                and d not in _SKIP_DIRS
                and not d.endswith((".app", ".photoslibrary", ".musiclibrary"))
            ]
            for is_dir, name in (
                [(True, d) for d in dirs] + [(False, f) for f in files]
            ):
                if not is_dir and name.startswith("."):
                    continue
                internal = os.path.join(dirpath, name)
                out.append({
                    "name": name,
                    "name_norm": _norm(name),
                    "path": _to_host(internal),
                    "is_dir": is_dir,
                })
    return out


def _save_to_disk(by_path: Dict[str, Dict[str, Any]]) -> None:
    """Persists the index to the local volume (atomic write). Compact format
    [name, path, is_dir, last_seen]."""
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "v": 2,
            "built_at": time.time(),
            "entries": [
                [e["name"], e["path"], 1 if e["is_dir"] else 0, e.get("last_seen", 0)]
                for e in by_path.values()
            ],
        }
        tmp = _CACHE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(_CACHE_PATH)
    except Exception as e:
        log.warning(f"vault file-index: no s'ha pogut desar el cache: {e}")


def _load_from_disk() -> bool:
    """Loads the index from the disk cache. Returns True if it loaded something.
    Tolerates the old format (v1, without last_seen)."""
    global _by_path, _built_at
    try:
        if not _CACHE_PATH.exists():
            return False
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8") or "{}")
        raw = data.get("entries") or []
        now = time.time()
        loaded: Dict[str, Dict[str, Any]] = {}
        for row in raw:
            name, path, is_dir = row[0], row[1], bool(row[2])
            last_seen = row[3] if len(row) > 3 and row[3] else now
            loaded[path] = {
                "name": name, "name_norm": _norm(name),
                "path": path, "is_dir": is_dir, "last_seen": last_seen,
            }
        with _lock:
            _by_path = loaded
            _built_at = float(data.get("built_at") or 0.0)
        log.info(f"⚡ vault file-index carregat del cache: {len(loaded)} entrades")
        return bool(loaded)
    except Exception as e:
        log.warning(f"vault file-index: cache de disc il·legible: {e}")
        return False


def build_index() -> int:
    """Builds/refreshes the index by walking the roots and MERGING (union) with
    the current index. Never shrinks due to a partial walk. Returns the number
    of entries. Idempotent: if it's already building, it's a no-op."""
    global _by_path, _built_at, _building
    with _lock:
        if _building:
            return len(_by_path)
        _building = True
    try:
        t0 = time.time()
        new_entries = _walk()
        now = time.time()
        with _lock:
            merged = dict(_by_path)  # copy to merge outside the lock
        prev_n = len(merged)
        for e in new_entries:
            e2 = dict(e)
            e2["last_seen"] = now
            merged[e2["path"]] = e2
        # Pruning of disappeared entries ONLY if this walk has been
        # substantial (avoids deleting anything due to an intermittent partial walk).
        substantial = prev_n == 0 or len(new_entries) >= _PRUNE_MIN_RATIO * prev_n
        pruned = 0
        if substantial:
            cutoff = now - _STALE_SECONDS
            before = len(merged)
            merged = {p: e for p, e in merged.items() if e.get("last_seen", now) >= cutoff}
            pruned = before - len(merged)
        with _lock:
            _by_path = merged
            _built_at = now
        _save_to_disk(merged)
        log.info(
            f"🗂️ vault file-index: walk {len(new_entries)} → índex {len(merged)} "
            f"entrades ({'complet' if substantial else 'PARCIAL, només unió'}, "
            f"purgades {pruned}) en {time.time() - t0:.1f}s"
        )
        return len(merged)
    finally:
        with _lock:
            _building = False


def query(q: str, limit: int = 200, include_files: bool = True) -> List[Dict[str, Any]]:
    """Searches the index. Token-AND matching with NFC normalization: an entry
    matches if ALL the tokens of the query are a substring of the normalized name (like
    `mdfind -name`, but independent of the helper). Instant (in memory)."""
    qn = _norm(q.strip())
    if len(qn) < 2:
        return []
    tokens = [t for t in qn.split() if t]
    if not tokens:
        return []
    with _lock:
        snapshot = list(_by_path.values())
    results: List[Dict[str, Any]] = []
    for e in snapshot:
        if not include_files and not e["is_dir"]:
            continue
        nm = e["name_norm"]
        if all(t in nm for t in tokens):
            results.append({"name": e["name"], "path": e["path"], "is_dir": e["is_dir"]})
            if len(results) >= limit:
                break
    return results


def is_ready() -> bool:
    """True if the index has entries (queryable)."""
    with _lock:
        return bool(_by_path)


def status() -> Dict[str, Any]:
    """Status for diagnostics / endpoint."""
    with _lock:
        return {
            "ready": bool(_by_path),
            "entries": len(_by_path),
            "built_at": _built_at,
            "building": _building,
            "refresh_seconds": _REFRESH_SECONDS,
        }


def kickoff_file_index_rebuild() -> None:
    """Starts the index: disk load (fast) + background thread that
    builds it and refreshes it every `_REFRESH_SECONDS`. Idempotent."""
    global _thread_started
    with _lock:
        if _thread_started:
            return
        _thread_started = True

    _load_from_disk()

    def _loop() -> None:
        try:
            build_index()
        except Exception:
            log.exception("vault file-index: build inicial ha fallat")
        while True:
            time.sleep(_REFRESH_SECONDS)
            try:
                build_index()
            except Exception:
                log.exception("vault file-index: refresc periòdic ha fallat")

    threading.Thread(target=_loop, name="vault-file-index", daemon=True).start()
    log.info("🔥 vault file-index: rebuild arrencat en segon pla")
