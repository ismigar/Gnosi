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
* A managed worker loads the disk snapshot and rebuilds in the background →
  startup remains responsive and coverage accumulates without competing with
  the first UI hydration burst.
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
from typing import Any, Dict, List, Literal

from backend.config.data_dir import resolve_data_dir

log = logging.getLogger(__name__)

# ── Configuration ──
_VAULT_INTERNAL = os.environ.get("DIGITAL_BRAIN_VAULT_PATH") or "/vault"
_VAULT_HOST = os.environ.get("VAULT_HOST_PATH") or ""
_LOCAL_DATA = resolve_data_dir()
_CACHE_PATH = _LOCAL_DATA / "cache" / "vault_file_index.json"
# Provider-wide walks are unrelated to Knowledge and can contend with its first
# hydration on File Provider mounts.  The index is therefore started lazily by
# the filesystem-search endpoint.  A zero interval means one cache load/build;
# deployments that need periodic provider discovery can opt in explicitly.
_DEFAULT_REFRESH_SECONDS = 0
_REFRESH_SECONDS = max(
    0,
    int(
        os.environ.get(
            "GNOSI_FILE_INDEX_REFRESH_SECONDS",
            str(_DEFAULT_REFRESH_SECONDS),
        )
    ),
)
_SHUTDOWN_TIMEOUT_SECONDS = float(os.environ.get("GNOSI_FILE_INDEX_SHUTDOWN_TIMEOUT_SECONDS", "5"))
_WORKER_BATCH_ENTRIES = max(
    1,
    min(
        1024,
        int(os.environ.get("GNOSI_FILE_INDEX_WORKER_BATCH_ENTRIES", "128")),
    ),
)
_WORKER_PAUSE_SECONDS = max(
    0.0001,
    min(
        0.05,
        float(os.environ.get("GNOSI_FILE_INDEX_WORKER_PAUSE_MS", "1")) / 1000.0,
    ),
)
_JSON_WRITE_BATCH_CHARS = 256 * 1024
# An entry not seen in any walk during this time is considered deleted and
# is pruned — but ONLY in a substantial walk (see _PRUNE_MIN_RATIO).
_STALE_SECONDS = int(os.environ.get("GNOSI_FILE_INDEX_STALE_SECONDS", str(7 * 24 * 3600)))
# We only prune if the current walk has seen at least this fraction of the index
# previous (= a "complete" walk); this way an intermittent partial walk doesn't delete anything.
_PRUNE_MIN_RATIO = 0.6

# Folders that are never indexed (noise or hidden). Same criteria as search.
_SKIP_DIRS = {
    "node_modules",
    ".git",
    "__pycache__",
    ".cache",
    ".local",
    ".npm",
    ".Trash",
    "Trash",
    ".obsidian",
    ".gnosi",
    ".Dashboards",
}

# ── State (protected by _lock) ──
# Dict path(host) → {"name","name_norm","is_dir","last_seen"}. Dict (not a list)
# to merge walks by path without duplicates.
_lock = threading.Lock()
_by_path: Dict[str, Dict[str, Any]] = {}
_built_at: float = 0.0
_building = False
_thread_started = False
_worker_thread: threading.Thread | None = None
_stop_event: threading.Event | None = None
_state: Literal["preparing", "ready", "error"] = "preparing"
_last_error: str | None = None
# Roots removed via remove_subtree, mapped to the time of removal. A build that
# started before a removal must not resurrect the deleted subtree when it swaps
# in its (pre-removal) walk snapshot. Pruned once older than the window below.
_tombstones: Dict[str, float] = {}
_TOMBSTONE_TTL_SECONDS = 600.0


class _BuildCancelled(Exception):
    """Internal signal used to abandon a walk without publishing partial data."""


def _cooperate_with_event_loop(
    processed_entries: int,
    cancel_event: threading.Event | None,
) -> None:
    """Give request threads a real, cancellation-aware scheduling window."""
    if cancel_event is not None and cancel_event.is_set():
        raise _BuildCancelled
    if processed_entries % _WORKER_BATCH_ENTRIES != 0:
        return
    if cancel_event is not None:
        if cancel_event.wait(_WORKER_PAUSE_SECONDS):
            raise _BuildCancelled
    else:
        time.sleep(_WORKER_PAUSE_SECONDS)


def _norm(s: str) -> str:
    """Normalize for comparison: NFC (macOS stores in NFD) + casefold."""
    return unicodedata.normalize("NFC", s).casefold()


def _to_host(internal_path: str) -> str:
    """Maps an internal container path to the HOST path (the one Finder
    sees and that the frontend can open). Only the Vault is mounted at `/vault`."""
    if _VAULT_HOST and internal_path.startswith(_VAULT_INTERNAL):
        return _VAULT_HOST + internal_path[len(_VAULT_INTERNAL) :]
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


def _walk(cancel_event: threading.Event | None = None) -> List[Dict[str, Any]]:
    """Walks the roots and returns the flat list of entries (may be partial
    if the File Provider serves incomplete listings at this moment). The paths
    are always returned as HOST (via `_to_host`, which only maps the fallback's
    `/vault` prefix; the CloudStorage roots are already host)."""
    out: List[Dict[str, Any]] = []
    processed_entries = 0
    for root in _index_roots():
        if cancel_event is not None and cancel_event.is_set():
            raise _BuildCancelled
        for dirpath, dirs, files in os.walk(root, followlinks=False):
            if cancel_event is not None and cancel_event.is_set():
                raise _BuildCancelled
            dirs[:] = [
                d
                for d in dirs
                if not d.startswith(".")
                and d not in _SKIP_DIRS
                and not d.endswith((".app", ".photoslibrary", ".musiclibrary"))
            ]
            for is_dir, names in ((True, dirs), (False, files)):
                for name in names:
                    processed_entries += 1
                    _cooperate_with_event_loop(processed_entries, cancel_event)
                    if not is_dir and name.startswith("."):
                        continue
                    internal = os.path.join(dirpath, name)
                    out.append(
                        {
                            "name": name,
                            "name_norm": _norm(name),
                            "path": _to_host(internal),
                            "is_dir": is_dir,
                        }
                    )
    return out


def _save_to_disk(
    by_path: Dict[str, Dict[str, Any]],
    cancel_event: threading.Event | None = None,
) -> None:
    """Persists the index to the local volume (atomic write). Compact format
    [name, path, is_dir, last_seen]."""
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        entries: list[list[object]] = []
        for processed_entries, entry in enumerate(by_path.values(), start=1):
            _cooperate_with_event_loop(processed_entries, cancel_event)
            entries.append(
                [
                    entry["name"],
                    entry["path"],
                    1 if entry["is_dir"] else 0,
                    entry.get("last_seen", 0),
                ]
            )
        payload = {"v": 2, "built_at": time.time(), "entries": entries}
        # Unique temp file (not a fixed `.json.tmp` sibling) so a concurrent
        # build and remove_subtree can't interleave writes to the same path.
        import tempfile

        fd, tmp_name = tempfile.mkstemp(dir=str(_CACHE_PATH.parent), suffix=".json.tmp")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                chunks: list[str] = []
                chunk_chars = 0
                for chunk in json.JSONEncoder().iterencode(payload):
                    chunks.append(chunk)
                    chunk_chars += len(chunk)
                    if chunk_chars < _JSON_WRITE_BATCH_CHARS:
                        continue
                    fh.write("".join(chunks))
                    chunks.clear()
                    chunk_chars = 0
                    _cooperate_with_event_loop(_WORKER_BATCH_ENTRIES, cancel_event)
                if chunks:
                    fh.write("".join(chunks))
            tmp.replace(_CACHE_PATH)
        finally:
            tmp.unlink(missing_ok=True)
    except _BuildCancelled:
        raise
    except Exception as e:
        log.warning(f"vault file-index: could not save the cache: {e}")


def _load_from_disk(cancel_event: threading.Event | None = None) -> bool:
    """Loads the index from the disk cache. Returns True if it loaded something.
    Tolerates the old format (v1, without last_seen)."""
    global _by_path, _built_at, _last_error, _state
    try:
        if not _CACHE_PATH.exists():
            return False
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8") or "{}")
        raw = data.get("entries") or []
        now = time.time()
        loaded: Dict[str, Dict[str, Any]] = {}
        for processed_entries, row in enumerate(raw, start=1):
            _cooperate_with_event_loop(processed_entries, cancel_event)
            name, path, is_dir = row[0], row[1], bool(row[2])
            last_seen = row[3] if len(row) > 3 and row[3] else now
            loaded[path] = {
                "name": name,
                "name_norm": _norm(name),
                "path": path,
                "is_dir": is_dir,
                "last_seen": last_seen,
            }
        with _lock:
            _by_path = loaded
            _built_at = float(data.get("built_at") or 0.0)
            if loaded:
                _state = "ready"
                _last_error = None
        log.info(f"⚡ vault file-index loaded from cache: {len(loaded)} entries")
        return bool(loaded)
    except _BuildCancelled:
        raise
    except Exception as e:
        log.warning(f"vault file-index: disk cache unreadable: {e}")
        return False


def build_index(cancel_event: threading.Event | None = None) -> int:
    """Builds/refreshes the index by walking the roots and MERGING (union) with
    the current index. Never shrinks due to a partial walk. Returns the number
    of entries. Idempotent: if it's already building, it's a no-op."""
    global _by_path, _built_at, _building, _last_error, _state
    with _lock:
        if _building:
            return len(_by_path)
        _building = True
        if not _by_path:
            _state = "preparing"
        _last_error = None
    try:
        t0 = time.time()
        new_entries = _walk(cancel_event)
        if cancel_event is not None and cancel_event.is_set():
            raise _BuildCancelled
        now = time.time()
        with _lock:
            merged = dict(_by_path)  # copy to merge outside the lock
            # Roots removed while this walk was in flight: the walk enumerated
            # them before deletion, so drop them here rather than resurrecting.
            active_tombstones = [r for r, ts in _tombstones.items() if ts >= t0]
        prev_n = len(merged)
        for processed_entries, e in enumerate(new_entries, start=1):
            _cooperate_with_event_loop(processed_entries, cancel_event)
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
            retained: Dict[str, Dict[str, Any]] = {}
            for processed_entries, (path, entry) in enumerate(merged.items(), start=1):
                _cooperate_with_event_loop(processed_entries, cancel_event)
                if entry.get("last_seen", now) >= cutoff:
                    retained[path] = entry
            merged = retained
            pruned = before - len(merged)
        # Honor subtrees removed during the walk (see active_tombstones).
        for r in active_tombstones:
            r = r.rstrip("/")
            prefix = r + "/"
            retained = {}
            for processed_entries, (path, entry) in enumerate(merged.items(), start=1):
                _cooperate_with_event_loop(processed_entries, cancel_event)
                if path != r and not path.startswith(prefix):
                    retained[path] = entry
            merged = retained
        with _lock:
            _by_path = merged
            _built_at = now
            _state = "ready"
            _last_error = None
        _save_to_disk(merged, cancel_event)
        log.info(
            f"🗂️ vault file-index: walk {len(new_entries)} → índex {len(merged)} "
            f"entries ({'complete' if substantial else 'PARTIAL, union only'}, "
            f"pruned {pruned}) in {time.time() - t0:.1f}s"
        )
        return len(merged)
    except _BuildCancelled:
        with _lock:
            _state = "ready" if _by_path else "preparing"
        raise
    except Exception as error:
        with _lock:
            _state = "error"
            _last_error = type(error).__name__
        raise
    finally:
        with _lock:
            _building = False


def remove_subtree(root: str) -> int:
    """Drops every entry under `root` (inclusive) from the index and persists.

    Needed when a vault is DELETED: the merge-only build keeps stale entries
    until the 7-day `last_seen` prune, so a removed vault kept polluting the
    picker/search for a week. Returns the number of entries removed.
    """
    root = str(root).rstrip("/")
    if not root:
        return 0
    prefix = root + "/"
    global _by_path
    with _lock:
        before = len(_by_path)
        _by_path = {p: e for p, e in _by_path.items() if p != root and not p.startswith(prefix)}
        removed = before - len(_by_path)
        # Tombstone so an in-flight build (walked before this deletion) can't
        # resurrect the subtree on its swap. Prune expired tombstones.
        now = time.time()
        _tombstones[root] = now
        for r in [r for r, ts in _tombstones.items() if now - ts > _TOMBSTONE_TTL_SECONDS]:
            _tombstones.pop(r, None)
        snapshot = dict(_by_path)
    if removed:
        _save_to_disk(snapshot)
        log.info(f"🗂️ vault file-index: removed {removed} entries under {root}")
    return removed


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
            "state": _state,
            "error": _last_error,
            "refresh_seconds": _REFRESH_SECONDS,
        }


def _initial_rebuild_delay(cache_loaded: bool) -> int:
    """Delay the first cloud walk when a queryable cache already exists."""
    return max(0, _REFRESH_SECONDS) if cache_loaded else 0


def _run_refresh_loop(stop_event: threading.Event) -> None:
    """Load/build lazily and optionally refresh without blocking HTTP."""
    global _stop_event, _thread_started, _worker_thread
    current_thread = threading.current_thread()
    try:
        cache_loaded = _load_from_disk(stop_event)
        if cache_loaded and _REFRESH_SECONDS <= 0:
            return
        initial_delay = _initial_rebuild_delay(cache_loaded)
        if initial_delay:
            log.info(
                "⏳ vault file-index: cache ready; refresh deferred for %ss",
                initial_delay,
            )
            if stop_event.wait(initial_delay):
                return
        while not stop_event.is_set():
            try:
                build_index(stop_event)
            except _BuildCancelled:
                return
            except Exception:
                log.exception("vault file-index: background build failed")
            if _REFRESH_SECONDS <= 0:
                return
            if stop_event.wait(max(0, _REFRESH_SECONDS)):
                return
    finally:
        with _lock:
            if _worker_thread is current_thread:
                _worker_thread = None
                _stop_event = None
                _thread_started = False


def kickoff_file_index_rebuild() -> None:
    """Start one on-demand worker and return before cache parsing/traversal."""
    global _stop_event, _thread_started, _worker_thread, _state
    with _lock:
        if _thread_started:
            return
        _thread_started = True
        if not _by_path:
            _state = "preparing"
        stop_event = threading.Event()
        worker = threading.Thread(
            target=_run_refresh_loop,
            args=(stop_event,),
            name="vault-file-index",
            daemon=True,
        )
        _stop_event = stop_event
        _worker_thread = worker
        worker.start()
    log.info("🔥 vault file-index: background refresh loop started")


def shutdown_file_index(
    timeout_seconds: float = _SHUTDOWN_TIMEOUT_SECONDS,
) -> bool:
    """Request cancellation and wait a bounded time for the worker to stop."""
    global _last_error, _state
    with _lock:
        stop_event = _stop_event
        worker = _worker_thread
    if stop_event is None or worker is None:
        return True
    stop_event.set()
    if worker is threading.current_thread():
        return False
    worker.join(timeout=max(0.0, timeout_seconds))
    if not worker.is_alive():
        return True
    with _lock:
        if _worker_thread is worker:
            _state = "error"
            _last_error = "shutdown_timeout"
    log.warning(
        "vault file-index: worker did not stop within %.1fs; "
        "leaving the daemon worker cancellation requested",
        timeout_seconds,
    )
    return False
