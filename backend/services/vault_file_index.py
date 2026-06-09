"""vault_file_index.py — Índex de noms de fitxers/carpetes del Vault.

Per què existeix
----------------
El picker "Seleccionar fitxer o carpeta" cerca per `/api/system/search`, que
delegava a Spotlight (`mdfind`) via el `host_open_helper`. Però el helper, com
a dimoni de llarga durada, NO veu de forma fiable `~/Library/CloudStorage`
(OneDrive): el File Provider d'OneDrive es ranceja per al seu context i `mdfind`
torna buit per a tot el Vault (símptoma: la cerca "no troba" fitxers com
"Ética de Kant"). Un kickstart del helper NO ho arregla.

El contenidor del backend, en canvi, té el Vault muntat a `/vault` i el llegeix
de forma fiable — però un `os.walk` en viu sobre OneDrive online-only triga
~14 s per a ~110k entrades, massa lent per a cada tecla.

Solució: mantenim un índex de noms EN MEMÒRIA (amb cache a disc al volum local,
mai a OneDrive), construït en segon pla a l'arrencada i refrescat
periòdicament. Les cerques consulten l'índex (instantani, complet i fiable),
independentment de l'estat del helper o d'OneDrive.

Disseny (emmirallant `vault_routes` page/link index)
----------------------------------------------------
* Build en un **thread** (no asyncio): el walk és I/O-bound sobre un muntatge
  cloud que pot bloquejar desenes de segons; un thread manté l'event loop viu.
* **Càrrega de disc primer** (mil·lisegons) i després rebuild en segon pla, així
  l'índex està disponible a l'instant després d'un reinici.
* Swap atòmic de la llista sota un lock → les consultes mai veuen un índex a mig
  construir.
* Cache al volum local `/app/data/cache/` (MAI a OneDrive: vegeu docker-compose
  `gnosi_local_data` i `cache_outside_onedrive`).
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
_BIBLIOTECA_HOST = os.environ.get("BIBLIOTECA_HOST_PATH") or ""
_LOCAL_DATA = Path(os.environ.get("GNOSI_LOCAL_DATA") or "/app/data")
_CACHE_PATH = _LOCAL_DATA / "cache" / "vault_file_index.json"
# Refresc periòdic (segons). El walk del Vault és metadata-only (no baixa
# fitxers), però sobre OneDrive triga ~14 s → un interval ampli evita martellejar.
_REFRESH_SECONDS = int(os.environ.get("GNOSI_FILE_INDEX_REFRESH_SECONDS", "600"))

# Carpetes que mai s'indexen (soroll o ocultes). Mateix criteri que la cerca.
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".cache", ".local", ".npm",
    ".Trash", "Trash", ".obsidian", ".gnosi", ".Dashboards",
}

# ── Estat (protegit per _lock) ──
_lock = threading.Lock()
_entries: List[Dict[str, Any]] = []   # {"name","name_norm","path"(host),"is_dir"}
_built_at: float = 0.0
_building = False
_thread_started = False


def _norm(s: str) -> str:
    """Normalitza per a comparació: NFC (macOS desa en NFD) + casefold.

    Sense NFC, una query "ética" (1 codepoint) no casa amb el nom de disc
    "ética" (e + accent combinant). casefold és més robust que lower per
    a unicode.
    """
    return unicodedata.normalize("NFC", s).casefold()


def _to_host(internal_path: str) -> str:
    """Mapeja una ruta interna del contenidor a la ruta HOST (la que veu Finder
    i que el frontend pot obrir). Només el Vault es munta a `/vault`; la
    Biblioteca ja es munta a la seva ruta host."""
    if _VAULT_HOST and internal_path.startswith(_VAULT_INTERNAL):
        return _VAULT_HOST + internal_path[len(_VAULT_INTERNAL):]
    return internal_path


def _index_roots() -> List[tuple]:
    """Arrels a indexar: (ruta_a_recórrer, cal_mapejar_a_host).

    Indexem les arrels de CloudStorage que el helper NO veu de forma fiable:
    el Vault i la Biblioteca. La resta de HOME (Documents, Downloads…) la
    cobreix el helper, que sí funciona fora de CloudStorage.
    """
    roots: List[tuple] = []
    if Path(_VAULT_INTERNAL).is_dir():
        roots.append((_VAULT_INTERNAL, True))
    if _BIBLIOTECA_HOST and Path(_BIBLIOTECA_HOST).is_dir():
        roots.append((_BIBLIOTECA_HOST, False))
    return roots


def _walk() -> List[Dict[str, Any]]:
    """Recorre les arrels i retorna la llista plana d'entrades."""
    out: List[Dict[str, Any]] = []
    for root, map_to_host in _index_roots():
        for dirpath, dirs, files in os.walk(root, followlinks=False):
            # Pruna in-place: ocults, soroll, bundles d'app.
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
                host = _to_host(internal) if map_to_host else internal
                out.append({
                    "name": name,
                    "name_norm": _norm(name),
                    "path": host,
                    "is_dir": is_dir,
                })
    return out


def _save_to_disk(entries: List[Dict[str, Any]]) -> None:
    """Persisteix l'índex al volum local (escriptura atòmica). Format compacte
    [name, path, is_dir] per no inflar el JSON (~110k entrades)."""
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "v": 1,
            "built_at": time.time(),
            "entries": [[e["name"], e["path"], 1 if e["is_dir"] else 0] for e in entries],
        }
        tmp = _CACHE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(_CACHE_PATH)
    except Exception as e:
        log.warning(f"vault file-index: no s'ha pogut desar el cache: {e}")


def _load_from_disk() -> bool:
    """Carrega l'índex del cache de disc. Retorna True si ha carregat alguna cosa."""
    global _entries, _built_at
    try:
        if not _CACHE_PATH.exists():
            return False
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8") or "{}")
        raw = data.get("entries") or []
        loaded = [
            {"name": n, "name_norm": _norm(n), "path": p, "is_dir": bool(d)}
            for n, p, d in raw
        ]
        with _lock:
            _entries = loaded
            _built_at = float(data.get("built_at") or 0.0)
        log.info(f"⚡ vault file-index carregat del cache: {len(loaded)} entrades")
        return bool(loaded)
    except Exception as e:
        log.warning(f"vault file-index: cache de disc il·legible: {e}")
        return False


def build_index() -> int:
    """Construeix l'índex recorrent les arrels i fa swap atòmic. Retorna el
    nombre d'entrades. Idempotent: si ja s'està construint, és un no-op."""
    global _entries, _built_at, _building
    with _lock:
        if _building:
            return len(_entries)
        _building = True
    try:
        t0 = time.time()
        new_entries = _walk()
        with _lock:
            _entries = new_entries
            _built_at = time.time()
        _save_to_disk(new_entries)
        log.info(
            f"🗂️ vault file-index construït: {len(new_entries)} entrades "
            f"en {time.time() - t0:.1f}s"
        )
        return len(new_entries)
    finally:
        with _lock:
            _building = False


def query(q: str, limit: int = 200, include_files: bool = True) -> List[Dict[str, Any]]:
    """Cerca a l'índex. Matching token-AND amb normalització NFC: una entrada
    casa si TOTS els tokens de la query són subcadena del nom normalitzat (com
    fa `mdfind -name`, però independent del helper). Instantani (en memòria)."""
    qn = _norm(q.strip())
    if len(qn) < 2:
        return []
    tokens = [t for t in qn.split() if t]
    if not tokens:
        return []
    with _lock:
        snapshot = _entries
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
        return bool(_entries)


def status() -> Dict[str, Any]:
    """Estat per a diagnòstic / endpoint."""
    with _lock:
        return {
            "ready": bool(_entries),
            "entries": len(_entries),
            "built_at": _built_at,
            "building": _building,
            "refresh_seconds": _REFRESH_SECONDS,
        }


def kickoff_file_index_rebuild() -> None:
    """Arrenca l'índex: càrrega de disc (ràpid) + thread de fons que el
    construeix i el refresca cada `_REFRESH_SECONDS`. Idempotent (només arrenca
    un thread). Cridar-ho a l'startup del backend (lifespan)."""
    global _thread_started
    with _lock:
        if _thread_started:
            return
        _thread_started = True

    # Càrrega ràpida del cache perquè les cerques funcionin a l'instant.
    _load_from_disk()

    def _loop() -> None:
        # Primer build "en fred" (o refresc del cache carregat) contra el disc.
        try:
            build_index()
        except Exception:
            log.exception("vault file-index: build inicial ha fallat")
        # Refresc periòdic per recollir canvis externs (fitxers nous al Vault).
        while True:
            time.sleep(_REFRESH_SECONDS)
            try:
                build_index()
            except Exception:
                log.exception("vault file-index: refresc periòdic ha fallat")

    threading.Thread(target=_loop, name="vault-file-index", daemon=True).start()
    log.info("🔥 vault file-index: rebuild arrencat en segon pla")
