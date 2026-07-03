"""vault_file_index.py — Índex de noms de fitxers/carpetes del Vault.

Per què existeix
----------------
El picker "Seleccionar fitxer o carpeta" cerca per `/api/system/search`, que
delegava a Spotlight (`mdfind`) via el `host_open_helper`. Però el helper, com
a dimoni de llarga durada, NO veu de forma fiable `~/Library/CloudStorage`
(OneDrive): el File Provider d'OneDrive es ranceja per al seu context i `mdfind`
torna buit per a tot el Vault (símptoma: "no troba" fitxers com "Ética de Kant").
Un kickstart del helper NO ho arregla.

El contenidor del backend té tot HOME muntat (`${HOME}:${HOME}:ro`) i llegeix
`~/Library/CloudStorage` de forma fiable amb `os.walk` (inclosos els fitxers
ONLINE-ONLY, que també hi surten). Per això mantenim aquí un índex de noms en
memòria, construït en segon pla, que cobreix TOTA la CloudStorage (OneDrive,
Google Drive…), no només el Vault — vegeu `_index_roots`.

Per què UNIÓ i no REPLACE (clau per als online-only)
---------------------------------------------------
`os.walk` sobre OneDrive és **intermitent**: normalment retorna l'arbre sencer
(~110k entrades, ~15s, amb tots els online-only), però de tant en tant el File
Provider serveix llistats de carpeta buits/no hidratats i el walk torna una
fracció (p.ex. 37k, 1s). Si l'índex fes REPLACE, un walk parcial **encongiria**
l'índex i la cerca deixaria de trobar els online-only fins al proper walk
complet. Per això cada build **fusiona** (unió per ruta) en comptes de
substituir: un walk parcial mai treu res; quan passa un walk complet, l'índex
ja té tot. Les entrades realment desaparegudes es purguen per `last_seen`, però
NOMÉS després d'un walk substancial (mai per un de parcial).

Disseny (emmirallant `vault_routes` page/link index)
----------------------------------------------------
* Build en un **thread** (no asyncio): I/O-bound sobre un muntatge cloud.
* **Càrrega de disc primer** (mil·lisegons) + rebuild en segon pla → la cerca
  està disponible a l'instant després d'un reinici i la coberta s'acumula.
* Swap atòmic sota un lock → les consultes mai veuen un índex a mig construir.
* Cache al volum local `/app/data/cache/` (MAI a OneDrive).
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

# ── Configuració ──
_VAULT_INTERNAL = os.environ.get("DIGITAL_BRAIN_VAULT_PATH") or "/vault"
_VAULT_HOST = os.environ.get("VAULT_HOST_PATH") or ""
_LOCAL_DATA = Path(os.environ.get("GNOSI_LOCAL_DATA") or "/app/data")
_CACHE_PATH = _LOCAL_DATA / "cache" / "vault_file_index.json"
# Refresc periòdic (segons). El walk és metadata-only (no baixa fitxers).
_REFRESH_SECONDS = int(os.environ.get("GNOSI_FILE_INDEX_REFRESH_SECONDS", "600"))
# Una entrada no vista en cap walk durant aquest temps es considera esborrada i
# es purga — però NOMÉS en un walk substancial (vegeu _PRUNE_MIN_RATIO).
_STALE_SECONDS = int(os.environ.get("GNOSI_FILE_INDEX_STALE_SECONDS", str(7 * 24 * 3600)))
# Només purguem si el walk actual ha vist com a mínim aquesta fracció de l'índex
# previ (= walk "complet"); així un walk parcial intermitent no esborra res.
_PRUNE_MIN_RATIO = 0.6

# Carpetes que mai s'indexen (soroll o ocultes). Mateix criteri que la cerca.
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".cache", ".local", ".npm",
    ".Trash", "Trash", ".obsidian", ".gnosi", ".Dashboards",
}

# ── Estat (protegit per _lock) ──
# Dict ruta(host) → {"name","name_norm","is_dir","last_seen"}. Dict (no llista)
# per fusionar walks per ruta sense duplicats.
_lock = threading.Lock()
_by_path: Dict[str, Dict[str, Any]] = {}
_built_at: float = 0.0
_building = False
_thread_started = False


def _norm(s: str) -> str:
    """Normalitza per a comparació: NFC (macOS desa en NFD) + casefold."""
    return unicodedata.normalize("NFC", s).casefold()


def _to_host(internal_path: str) -> str:
    """Mapeja una ruta interna del contenidor a la ruta HOST (la que veu Finder
    i que el frontend pot obrir). Només el Vault es munta a `/vault`."""
    if _VAULT_HOST and internal_path.startswith(_VAULT_INTERNAL):
        return _VAULT_HOST + internal_path[len(_VAULT_INTERNAL):]
    return internal_path


def _index_roots() -> List[str]:
    """Arrels a indexar (rutes HOST, accessibles al contenidor via el mount HOME
    `ro`). Indexem TOT `~/Library/CloudStorage` (OneDrive, Google Drive…), no
    només el Vault: el helper (mdfind) no veu de forma fiable CAP carpeta de
    CloudStorage des del seu context, així que tot el que hi viu (Vault,
    Biblioteca, Documents/ESS, etc.) ha d'anar a l'índex. La resta de HOME
    (Documents/Downloads LOCALS, fora de CloudStorage) la cobreix el helper.

    Per què va caldre: l'usuari cercava `Presentación vivienda cooperativa.pdf`
    (a `OneDrive-UNED/Documents/ESS/`, fora del Vault) i no sortia perquè
    l'índex només cobria Vault + Biblioteca.
    """
    home = os.environ.get("HOME_HOST_PATH") or os.path.expanduser("~")
    cloudstorage = os.path.join(home, "Library", "CloudStorage")
    if Path(cloudstorage).is_dir():
        return [cloudstorage]
    # Fallback (layouts sense CloudStorage o fora de Docker): el Vault (la
    # Biblioteca viu a dins des del disseny vault-first pur).
    roots: List[str] = []
    if Path(_VAULT_INTERNAL).is_dir():
        roots.append(_VAULT_INTERNAL)
    return roots


def _walk() -> List[Dict[str, Any]]:
    """Recorre les arrels i retorna la llista plana d'entrades (pot ser parcial
    si el File Provider serveix llistats incomplets en aquest moment). Les rutes
    es retornen sempre com a HOST (via `_to_host`, que només mapeja el prefix
    `/vault` del fallback; les arrels de CloudStorage ja són host)."""
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
    """Persisteix l'índex al volum local (escriptura atòmica). Format compacte
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
    """Carrega l'índex del cache de disc. Retorna True si ha carregat alguna cosa.
    Tolera el format antic (v1, sense last_seen)."""
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
    """Construeix/refresca l'índex recorrent les arrels i FUSIONANT (unió) amb
    l'índex actual. Mai encongeix per un walk parcial. Retorna el nombre
    d'entrades. Idempotent: si ja s'està construint, és un no-op."""
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
            merged = dict(_by_path)  # còpia per fusionar fora del lock
        prev_n = len(merged)
        for e in new_entries:
            e2 = dict(e)
            e2["last_seen"] = now
            merged[e2["path"]] = e2
        # Purga d'entrades desaparegudes NOMÉS si aquest walk ha estat
        # substancial (evita esborrar res per un walk parcial intermitent).
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
    """Cerca a l'índex. Matching token-AND amb normalització NFC: una entrada
    casa si TOTS els tokens de la query són subcadena del nom normalitzat (com
    `mdfind -name`, però independent del helper). Instantani (en memòria)."""
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
    """True si l'índex té entrades (consultable)."""
    with _lock:
        return bool(_by_path)


def status() -> Dict[str, Any]:
    """Estat per a diagnòstic / endpoint."""
    with _lock:
        return {
            "ready": bool(_by_path),
            "entries": len(_by_path),
            "built_at": _built_at,
            "building": _building,
            "refresh_seconds": _REFRESH_SECONDS,
        }


def kickoff_file_index_rebuild() -> None:
    """Arrenca l'índex: càrrega de disc (ràpid) + thread de fons que el
    construeix i el refresca cada `_REFRESH_SECONDS`. Idempotent."""
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
