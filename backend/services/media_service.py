try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    Image = None

import os
import re
import json
import time
import pickle
import logging
import hashlib
import shutil
import threading
from pathlib import Path
from typing import List, Optional, Dict, Any, Iterator, Tuple
from datetime import datetime
from fastapi import UploadFile, HTTPException
from backend.services.context_vars import get_active_vault_path
from backend.utils.safe_io import safe_write_bytes, sanitize_path_segment

log = logging.getLogger(__name__)

# TTL del cache de l'escaneig recursiu. A OneDrive amb desenes de milers
# d'imatges la primera passada pot trigar minuts; aquí mantenim el resultat
# per evitar repetir-la per cada paginació.
_SCAN_CACHE_TTL_S = 24 * 60 * 60  # 24 h: el ritme normal de canvis a Images/
                                   # és diari, no per minuts. La invalidació
                                   # explícita ja ataca els uploads.

# Cache persistent: el contenidor pot reiniciar-se sovint i no volem que cada
# reinici dispari un escaneig de 56k fitxers. /app/data és un volum local
# (gnosi_local_data) — és correcte deixar-hi pickles.
_PERSIST_DIR = Path("/app/data/media_cache")

# Roots multi-arrel suportats per la cerca de mitjans. La clau s'envia des del
# frontend (?root=...). Cada root resol a una carpeta i a un prefix d'URL per
# servir els fitxers. La carpeta es resol dinàmicament a get_active_vault_path()
# perquè el vault pot canviar amb workspace switching.
#
# - "images"     → Images/ (galeria històrica, comportament default per back-compat)
# - "assets"     → Assets/ (mitjans inserits a pàgines via /assets/upload)
# - "biblioteca" → Biblioteca/ (carpeta germana del vault, no dins)
# - "vault"      → tot el vault, exclou carpetes de sistema (.git, .gnosi, BD)
MEDIA_ROOTS: Dict[str, Dict[str, Any]] = {
    "images": {"label": "Imatges (Galeria)", "url_prefix": "/api/vault/images/"},
    "assets": {"label": "Assets de pàgines", "url_prefix": "/api/vault/assets/"},
    "biblioteca": {"label": "Biblioteca", "url_prefix": "/api/vault/biblioteca/"},
    "vault": {"label": "Tot el Vault", "url_prefix": "/api/vault/raw/"},
}

# Carpetes que mai s'escanegen quan root="vault": meta dades de control de
# versions, configuració interna, BD JSON. Sense aquesta llista, escanejar
# tot el vault inclouria milers de fitxers JSON irrellevants i alentiria la
# primera passada considerablement.
_VAULT_SKIP_DIRS = {
    ".git", ".gnosi", ".Dashboards", "BD", "node_modules",
    "__pycache__", ".cache", ".idea", ".vscode",
}


class MediaService:
    # Sidecar de metadades d'usuari (tags + descripció). Viu DINS el vault
    # perquè són dades semàntiques de l'usuari i han de sincronitzar entre
    # dispositius via OneDrive — la regla "caches fora d'OneDrive" no aplica
    # a dades, només a caches/índexs derivables.
    _USER_META_FILENAME = "media_metadata.json"
    # Vistes desades de l'usuari (filtres + sort + scope amb nom). Mateixa
    # raó que _USER_META_FILENAME: dades d'usuari, dins el vault.
    _VIEWS_FILENAME = "media_views.json"

    def __init__(self):
        # Ja no inicialitzem el path aquí per evitar errors al boot
        self._media_dir_cache = None
        self._scan_cache: Dict[str, Tuple[float, List[Tuple[Path, float]]]] = {}
        self._scan_locks: Dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        # Sidecar lazy: es carrega al primer ús (update_metadata o filtre per tags).
        self._user_metadata: Optional[Dict[str, Any]] = None
        self._user_metadata_lock = threading.RLock()
        # Vistes lazy: es carreguen al primer accés.
        self._views: Optional[Dict[str, Any]] = None
        self._views_lock = threading.RLock()
        try:
            _PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.debug(f"No es pot crear {_PERSIST_DIR}: {e}")

    def _root_dir(self, root: str = "images") -> Optional[Path]:
        """Resol la clau de root a un Path absolut. Crea Images/ si cal
        (back-compat) però NO crea les altres carpetes — si Biblioteca o Assets
        no existeixen, retornem None i el caller respondrà amb llista buida.
        """
        base = get_active_vault_path()
        if root == "images":
            d = base / "Images"
            try:
                d.mkdir(parents=True, exist_ok=True)
                (d / "General").mkdir(parents=True, exist_ok=True)
            except Exception as e:
                log.warning(f"No es pot crear el directori de media a {d}: {e}")
            return d
        if root == "assets":
            return base / "Assets"
        if root == "biblioteca":
            # Resolució vault-first amb fallback llegat (mateixa regla que
            # get_p("BIBLIOTECA")): abans es calculava aquí `base.parent/Biblioteca`
            # a pèl, i per als vaults fills (p. ex. Principal) apuntava a una
            # carpeta equivocada → el picker sortia buit.
            from backend.services.biblioteca_paths import resolve_biblioteca
            return resolve_biblioteca(base)
        if root == "vault":
            return base
        log.warning(f"Root desconegut: {root!r}")
        return None

    def get_roots(self) -> List[Dict[str, Any]]:
        """Retorna la llista de roots disponibles amb metadades. Marca
        `available=False` per als que no existeixen al disc, perquè la UI
        pugui amagar-los o desactivar-los."""
        items: List[Dict[str, Any]] = []
        for key, meta in MEDIA_ROOTS.items():
            d = self._root_dir(key)
            available = bool(d and d.exists())
            items.append({
                "key": key,
                "label": meta["label"],
                "url_prefix": meta["url_prefix"],
                "available": available,
            })
        return items

    @property
    def media_dir(self) -> Path:
        """Resol el directori de mitjans dinàmicament segons el vault actiu.
        Mantingut per compatibilitat: equival a `_root_dir("images")`.
        """
        return self._root_dir("images")

    # Ampliem la llista d'extensions vàlides: la galeria històrica només mostrava
    # imatges, però amb multi-root volem trobar també vídeos i PDFs perquè el
    # MediaCenter funcioni com a picker per al BlockEditor.
    _IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp"}
    _VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}
    _AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}
    _DOC_EXTS = {".pdf"}
    _VALID_EXTENSIONS = _IMAGE_EXTS | _VIDEO_EXTS | _AUDIO_EXTS | _DOC_EXTS

    @classmethod
    def classify_kind(cls, ext: str) -> str:
        e = ext.lower()
        if e in cls._IMAGE_EXTS: return "image"
        if e in cls._VIDEO_EXTS: return "video"
        if e in cls._AUDIO_EXTS: return "audio"
        if e in cls._DOC_EXTS: return "pdf"
        return "other"

    def _scan_recursive(self, root: Path, skip_dirs: Optional[set] = None) -> Iterator[Tuple[Path, float]]:
        """
        Recorre `root` recursivament emetent (path, mtime) per cada fitxer
        amb extensió vàlida. Usa os.scandir perquè comparteix el stat() amb
        el llistat (a OneDrive cada stat addicional és car: el rglob+stat
        anterior trigava >60s per ~56k fitxers).

        `skip_dirs` és una llista de noms de carpeta (no paths) a evitar; útil
        per al root="vault" que ha de saltar-se .git, .gnosi, BD/, etc.
        """
        try:
            with os.scandir(root) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if skip_dirs and entry.name in skip_dirs:
                                continue
                            # Saltem també carpetes ocultes per defecte
                            if entry.name.startswith('.') and skip_dirs is not None:
                                continue
                            yield from self._scan_recursive(Path(entry.path), skip_dirs)
                        elif entry.is_file(follow_symlinks=False):
                            ext = os.path.splitext(entry.name)[1].lower()
                            if ext in self._VALID_EXTENSIONS:
                                yield (Path(entry.path), entry.stat().st_mtime)
                    except OSError as e:
                        log.debug(f"Skip entry {entry.path}: {e}")
                        continue
        except OSError as e:
            log.debug(f"Skip dir {root}: {e}")

    def _get_lock(self, key: str) -> threading.Lock:
        with self._locks_guard:
            lk = self._scan_locks.get(key)
            if lk is None:
                lk = threading.Lock()
                self._scan_locks[key] = lk
            return lk

    def _persist_path(self, target_dir: Path) -> Path:
        """Fitxer pickle on persistim el cache d'aquest target_dir."""
        h = hashlib.sha1(str(target_dir).encode("utf-8")).hexdigest()[:16]
        return _PERSIST_DIR / f"scan_{h}.pkl"

    def _load_persisted(self, target_dir: Path) -> Optional[Tuple[float, List[Tuple[Path, float]]]]:
        f = self._persist_path(target_dir)
        if not f.exists():
            return None
        try:
            with open(f, "rb") as fh:
                ts, entries = pickle.load(fh)
            return (ts, entries)
        except Exception as e:
            log.debug(f"No es pot carregar cache persistit {f}: {e}")
            return None

    def _save_persisted(self, target_dir: Path, ts: float, entries: List[Tuple[Path, float]]) -> None:
        try:
            f = self._persist_path(target_dir)
            with open(f, "wb") as fh:
                pickle.dump((ts, entries), fh, protocol=pickle.HIGHEST_PROTOCOL)
        except OSError as e:
            log.debug(f"No es pot persistir cache per {target_dir}: {e}")

    def _scan_with_cache(self, target_dir: Path, skip_dirs: Optional[set] = None) -> List[Tuple[Path, float]]:
        """Retorna l'índex (path, mtime) per `target_dir` amb cache TTL +
        persistència a disc per sobreviure reinicis del contenidor.

        `skip_dirs` es propaga a `_scan_recursive`. Hash key inclou el set
        de carpetes saltades perquè el cache de "vault sense BD" no col·lideixi
        amb un eventual scan futur "vault sencer".
        """
        cache_suffix = "::" + ",".join(sorted(skip_dirs)) if skip_dirs else ""
        key = str(target_dir) + cache_suffix
        now = time.time()
        cached = self._scan_cache.get(key)
        if cached and (now - cached[0]) < _SCAN_CACHE_TTL_S:
            return cached[1]

        # Si en RAM no hi és, intentem el persistit abans de re-escanejar.
        if cached is None:
            persisted = self._load_persisted(Path(key))
            if persisted and (now - persisted[0]) < _SCAN_CACHE_TTL_S:
                self._scan_cache[key] = persisted
                log.info(f"[media] cache persistit reutilitzat per {target_dir} ({len(persisted[1])} fitxers)")
                return persisted[1]

        lock = self._get_lock(key)
        with lock:
            cached = self._scan_cache.get(key)
            if cached and (time.time() - cached[0]) < _SCAN_CACHE_TTL_S:
                return cached[1]
            t0 = time.time()
            entries = list(self._scan_recursive(target_dir, skip_dirs))
            entries.sort(key=lambda x: x[1], reverse=True)
            ts = time.time()
            self._scan_cache[key] = (ts, entries)
            self._save_persisted(Path(key), ts, entries)
            log.info(
                f"[media] scan {target_dir}: {len(entries)} fitxers en {ts-t0:.1f}s"
            )
            return entries

    def invalidate_cache(self, target_dir: Optional[Path] = None) -> None:
        """Buida el cache (un directori concret o tot)."""
        if target_dir is None:
            self._scan_cache.clear()
            try:
                for f in _PERSIST_DIR.glob("scan_*.pkl"):
                    f.unlink(missing_ok=True)
            except OSError:
                pass
        else:
            self._scan_cache.pop(str(target_dir), None)
            try:
                self._persist_path(target_dir).unlink(missing_ok=True)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Sidecar de metadades d'usuari (tags + descripció)
    # ------------------------------------------------------------------

    def _user_meta_path(self) -> Optional[Path]:
        base = get_active_vault_path()
        if base is None:
            return None
        d = base / ".gnosi"
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.debug(f"No es pot crear {d}: {e}")
            return None
        return d / self._USER_META_FILENAME

    def _ensure_user_metadata_loaded(self) -> None:
        if self._user_metadata is not None:
            return
        with self._user_metadata_lock:
            if self._user_metadata is not None:
                return
            path = self._user_meta_path()
            loaded = {"version": 1, "items": {}}
            if path and path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        raw = json.load(f)
                    if isinstance(raw, dict) and isinstance(raw.get("items"), dict):
                        loaded = raw
                except (OSError, json.JSONDecodeError) as e:
                    log.warning(
                        f"media_metadata.json corrupte ({path}): {e} — reinicialitzant"
                    )
            self._user_metadata = loaded

    @staticmethod
    def _user_meta_key(root: str, rel_path_in_root: str) -> str:
        return f"{root}::{rel_path_in_root}"

    def _save_user_metadata(self) -> bool:
        path = self._user_meta_path()
        if path is None:
            return False
        with self._user_metadata_lock:
            try:
                tmp = path.with_suffix(path.suffix + ".tmp")
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(self._user_metadata, f, ensure_ascii=False, indent=2)
                os.replace(tmp, path)
                return True
            except OSError as e:
                log.warning(f"No es pot desar media_metadata.json: {e}")
                return False

    def _get_user_meta_for(self, root: str, rel_path_in_root: str) -> Dict[str, Any]:
        """Retorna {tags, description} del sidecar (defaults si no hi és)."""
        self._ensure_user_metadata_loaded()
        item = self._user_metadata["items"].get(
            self._user_meta_key(root, rel_path_in_root)
        )
        if not item:
            return {"tags": [], "description": ""}
        return {
            "tags": list(item.get("tags") or []),
            "description": str(item.get("description") or ""),
        }

    def update_metadata(
        self,
        path_in_root: str,
        metadata: Dict[str, Any],
        root: str = "images",
    ) -> bool:
        """Actualitza tags/descripció per (root, path_in_root) al sidecar.

        `path_in_root` és relatiu al root (p.e. `Viatges/2026/IMG.jpg`). El
        camp arriba al payload de `_get_file_info` com a `path_in_root`.
        """
        if not path_in_root:
            return False
        # Validem que el path no surti del root (prevenció path traversal).
        r_dir = self._root_dir(root)
        if r_dir is None:
            return False
        try:
            (r_dir / path_in_root).resolve().relative_to(r_dir.resolve())
        except ValueError:
            log.warning(f"update_metadata: path fora del root {root!r}: {path_in_root!r}")
            return False

        self._ensure_user_metadata_loaded()
        key = self._user_meta_key(root, path_in_root)
        with self._user_metadata_lock:
            existing = self._user_metadata["items"].get(key, {})

            # Tags: normalitzem a minúscules sense espais; ordenats i sense
            # duplicats per consistència entre escriptures.
            if "tags" in metadata:
                raw_tags = metadata.get("tags") or []
                norm_tags = sorted({
                    (t or "").strip().lower()
                    for t in raw_tags
                    if (t or "").strip()
                })
            else:
                norm_tags = list(existing.get("tags") or [])

            if "description" in metadata:
                description = str(metadata.get("description") or "")
            else:
                description = str(existing.get("description") or "")

            self._user_metadata["items"][key] = {
                "tags": norm_tags,
                "description": description,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            }
        return self._save_user_metadata()

    # ------------------------------------------------------------------
    # Vistes desades (filtres + sort + scope amb nom)
    # ------------------------------------------------------------------

    def _views_path(self) -> Optional[Path]:
        base = get_active_vault_path()
        if base is None:
            return None
        d = base / ".gnosi"
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.debug(f"No es pot crear {d}: {e}")
            return None
        return d / self._VIEWS_FILENAME

    def _ensure_views_loaded(self) -> None:
        if self._views is not None:
            return
        with self._views_lock:
            if self._views is not None:
                return
            path = self._views_path()
            loaded = {"version": 1, "items": []}
            if path and path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        raw = json.load(f)
                    if isinstance(raw, dict) and isinstance(raw.get("items"), list):
                        loaded = raw
                except (OSError, json.JSONDecodeError) as e:
                    log.warning(
                        f"media_views.json corrupte ({path}): {e} — reinicialitzant"
                    )
            self._views = loaded

    def _save_views(self) -> bool:
        path = self._views_path()
        if path is None:
            return False
        with self._views_lock:
            try:
                tmp = path.with_suffix(path.suffix + ".tmp")
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(self._views, f, ensure_ascii=False, indent=2)
                os.replace(tmp, path)
                return True
            except OSError as e:
                log.warning(f"No es pot desar media_views.json: {e}")
                return False

    @staticmethod
    def _normalize_view_payload(data: Dict[str, Any]) -> Dict[str, Any]:
        """Sanititza el payload d'una vista: només camps coneguts, sense
        deixar passar coses arbitràries que puguin omplir el JSON."""
        scope = data.get("scope") or {}
        filters = data.get("filters") or {}
        sort = data.get("sort") or {}
        return {
            "label": str(data.get("label") or "").strip()[:120],
            "scope": {
                "root": str(scope.get("root") or "images"),
                "album": (str(scope.get("album")) if scope.get("album") is not None else ""),
            },
            "filters": {
                "kinds": list(filters.get("kinds") or []),
                "q": str(filters.get("q") or ""),
                "tagsAny": list(filters.get("tagsAny") or []),
                "datePreset": str(filters.get("datePreset") or "all"),
                "mtimeFrom": str(filters.get("mtimeFrom") or ""),
                "mtimeTo": str(filters.get("mtimeTo") or ""),
                "sizePreset": str(filters.get("sizePreset") or "all"),
            },
            "sort": {
                "field": str(sort.get("field") or "mtime"),
                "dir": str(sort.get("dir") or "desc"),
            },
        }

    def list_views(self) -> List[Dict[str, Any]]:
        self._ensure_views_loaded()
        return list(self._views.get("items") or [])

    def create_view(self, data: Dict[str, Any]) -> Dict[str, Any]:
        self._ensure_views_loaded()
        norm = self._normalize_view_payload(data)
        if not norm["label"]:
            raise ValueError("Cal un nom per a la vista")
        now = datetime.utcnow().isoformat() + "Z"
        view = {
            "id": f"view_{int(time.time() * 1000)}",
            **norm,
            "created_at": now,
            "updated_at": now,
        }
        with self._views_lock:
            self._views["items"].append(view)
        self._save_views()
        return view

    def update_view(self, view_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        self._ensure_views_loaded()
        norm = self._normalize_view_payload(data)
        with self._views_lock:
            for i, v in enumerate(self._views["items"]):
                if v.get("id") == view_id:
                    if not norm["label"]:
                        norm["label"] = v.get("label", "")
                    updated = {
                        **v,
                        **norm,
                        "updated_at": datetime.utcnow().isoformat() + "Z",
                    }
                    self._views["items"][i] = updated
                    self._save_views()
                    return updated
        return None

    def delete_view(self, view_id: str) -> bool:
        self._ensure_views_loaded()
        with self._views_lock:
            before = len(self._views["items"])
            self._views["items"] = [
                v for v in self._views["items"] if v.get("id") != view_id
            ]
            if len(self._views["items"]) == before:
                return False
            self._save_views()
            return True

    # ------------------------------------------------------------------
    # Filtres + sort post-cache (per get_all_media)
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_iso_to_epoch(iso_str: Optional[str], end_of_day: bool = False) -> Optional[float]:
        """`YYYY-MM-DD` o ISO complet → epoch seconds. None si invàlid."""
        if not iso_str:
            return None
        try:
            s = iso_str.strip()
            if "T" in s:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            else:
                dt = datetime.fromisoformat(s)
                if end_of_day:
                    dt = dt.replace(hour=23, minute=59, second=59)
            return dt.timestamp()
        except (ValueError, AttributeError):
            return None

    def _apply_filters_and_sort(
        self,
        entries: List[Tuple[Path, float]],
        root: str,
        *,
        kinds: Optional[set],
        extensions: Optional[set],
        q: Optional[str],
        desc_contains: Optional[str],
        tags_any: Optional[set],
        tags_all: Optional[set],
        tags_none: Optional[set],
        size_min_bytes: Optional[int],
        size_max_bytes: Optional[int],
        mtime_from_ts: Optional[float],
        mtime_to_ts: Optional[float],
        sort: str,
        dir_: str,
    ) -> List[Tuple[Path, float]]:
        """Filtra (path, mtime) pel conjunt de filtres declarat i ordena.

        Els filtres dependents del sidecar (tags/desc) carreguen la cache de
        metadades una sola vegada; els que necessiten `st.st_size` o sort per
        size disparen un `path.stat()` per fitxer (relativament barat un cop
        l'index està en RAM, però no gratis a OneDrive).
        """
        needs_meta = bool(tags_any or tags_all or tags_none or desc_contains)
        if needs_meta:
            self._ensure_user_metadata_loaded()
        needs_size = (
            size_min_bytes is not None
            or size_max_bytes is not None
            or sort == "size"
        )

        r_dir = self._root_dir(root)
        r_resolved = r_dir.resolve() if r_dir else None

        out: List[Tuple[Path, float, Optional[int]]] = []
        for path, mtime in entries:
            ext_no_dot = path.suffix.lstrip(".").lower()
            if extensions is not None and ext_no_dot not in extensions:
                continue
            if kinds is not None and self.classify_kind("." + ext_no_dot) not in kinds:
                continue
            if q is not None and q not in path.name.lower():
                continue
            if mtime_from_ts is not None and mtime < mtime_from_ts:
                continue
            if mtime_to_ts is not None and mtime > mtime_to_ts:
                continue

            if needs_meta:
                if r_resolved is not None:
                    try:
                        rel_path = path.resolve().relative_to(r_resolved).as_posix()
                    except ValueError:
                        rel_path = path.name
                else:
                    rel_path = path.name
                item = self._user_metadata["items"].get(
                    self._user_meta_key(root, rel_path), {}
                )
                tags_set = set(item.get("tags") or [])
                description = (item.get("description") or "").lower()
                if tags_any and tags_set.isdisjoint(tags_any):
                    continue
                if tags_all and not tags_all.issubset(tags_set):
                    continue
                if tags_none and not tags_set.isdisjoint(tags_none):
                    continue
                if desc_contains and desc_contains not in description:
                    continue

            size: Optional[int] = None
            if needs_size:
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                if size_min_bytes is not None and size < size_min_bytes:
                    continue
                if size_max_bytes is not None and size > size_max_bytes:
                    continue

            out.append((path, mtime, size))

        reverse = dir_ != "asc"
        if sort == "filename":
            out.sort(key=lambda t: t[0].name.lower(), reverse=reverse)
        elif sort == "size":
            out.sort(key=lambda t: (t[2] or 0), reverse=reverse)
        elif sort == "kind":
            out.sort(
                key=lambda t: self.classify_kind(t[0].suffix.lower()),
                reverse=reverse,
            )
        else:  # "mtime" o desconegut → comportament històric
            out.sort(key=lambda t: t[1], reverse=reverse)

        return [(p, m) for p, m, _ in out]

    @staticmethod
    def _csv_to_set(value: Optional[str], lower: bool = True) -> Optional[set]:
        if value is None:
            return None
        items = {
            (s.strip().lower() if lower else s.strip())
            for s in value.split(",")
            if s.strip()
        }
        return items or None

    def _resolve_album_dir(self, album: Optional[str], root: str = "images") -> Optional[Path]:
        """Resol l'`album` (relatiu al root indicat) a un Path absolut, validant
        que no surt del root. Retorna None si és invalid."""
        r_dir = self._root_dir(root)
        if r_dir is None or not r_dir.exists():
            return None
        if not album:
            return r_dir
        # Normalitzem separadors i evitem segments .. o absoluts
        candidate = (r_dir / album).resolve()
        try:
            candidate.relative_to(r_dir.resolve())
        except ValueError:
            log.warning(f"Album fora del root {root!r}: {album!r}")
            return None
        return candidate

    def get_all_media(
        self,
        album: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        root: str = "images",
        *,
        kinds: Optional[str] = None,
        extensions: Optional[str] = None,
        q: Optional[str] = None,
        desc_contains: Optional[str] = None,
        tags_any: Optional[str] = None,
        tags_all: Optional[str] = None,
        tags_none: Optional[str] = None,
        size_min: Optional[int] = None,  # KB
        size_max: Optional[int] = None,  # KB
        mtime_from: Optional[str] = None,  # ISO
        mtime_to: Optional[str] = None,    # ISO
        sort: str = "mtime",
        dir_: str = "desc",
    ) -> Dict[str, Any]:
        """Llista fitxers de mitjans amb paginació, filtres i ordenació.

        `album` pot ser un path relatiu amb subdirectoris (`Pueblo/Sierra`).
        Sempre escaneja recursivament el directori indicat.
        `root` selecciona la carpeta arrel: images|assets|biblioteca|vault.

        Filtres acceptats (tots opcionals, csv on aplica):
        - kinds: image,video,audio,pdf,other
        - extensions: jpg,png,...  (sense punt)
        - q: substring sobre filename (case-insensitive)
        - desc_contains: substring sobre descripció (case-insensitive)
        - tags_any / tags_all / tags_none: csv de tags (normalitzats a minúscules)
        - size_min / size_max: en KB
        - mtime_from / mtime_to: dates ISO (`YYYY-MM-DD` o complet)
        - sort: mtime|filename|size|kind  (def: mtime)
        - dir_: asc|desc  (def: desc)
        """
        target_dir = self._resolve_album_dir(album, root=root)
        if target_dir is None or not target_dir.exists():
            return {
                "items": [],
                "total": 0,
                "limit": limit,
                "offset": offset,
                "root": root,
            }

        # Per al root="vault" saltem carpetes de sistema. Per la resta, no.
        skip = _VAULT_SKIP_DIRS if root == "vault" else None
        all_entries = self._scan_with_cache(target_dir, skip_dirs=skip)

        kinds_set = self._csv_to_set(kinds)
        ext_set = self._csv_to_set(extensions)
        if ext_set is not None:
            ext_set = {e.lstrip(".") for e in ext_set}
        tags_any_set = self._csv_to_set(tags_any)
        tags_all_set = self._csv_to_set(tags_all)
        tags_none_set = self._csv_to_set(tags_none)
        size_min_b = size_min * 1024 if size_min is not None else None
        size_max_b = size_max * 1024 if size_max is not None else None

        any_filter_active = any([
            kinds_set, ext_set, q, desc_contains,
            tags_any_set, tags_all_set, tags_none_set,
            size_min_b is not None, size_max_b is not None,
            mtime_from, mtime_to,
        ])
        custom_sort = sort != "mtime" or dir_ != "desc"

        if any_filter_active or custom_sort:
            entries = self._apply_filters_and_sort(
                all_entries,
                root,
                kinds=kinds_set,
                extensions=ext_set,
                q=(q.lower() if q else None),
                desc_contains=(desc_contains.lower() if desc_contains else None),
                tags_any=tags_any_set,
                tags_all=tags_all_set,
                tags_none=tags_none_set,
                size_min_bytes=size_min_b,
                size_max_bytes=size_max_b,
                mtime_from_ts=self._parse_iso_to_epoch(mtime_from),
                mtime_to_ts=self._parse_iso_to_epoch(mtime_to, end_of_day=True),
                sort=sort,
                dir_=dir_,
            )
        else:
            # Path ràpid back-compat: cap filtre, sort per defecte → reutilitzem
            # exactament l'ordre del cache (ja és mtime desc).
            entries = all_entries

        total = len(entries)
        paged = entries[offset : offset + limit]
        items = [self._get_file_info(p, fast=True, root=root) for p, _ in paged]

        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "root": root,
        }

    def get_albums(self) -> List[str]:
        """Retorna la llista de carpetes (àlbums) a Images. Mantingut per
        compatibilitat — l'arbre lazy es serveix via `get_tree_node`.
        """
        m_dir = self.media_dir
        if not m_dir.exists(): return []
        return [d.name for d in m_dir.iterdir() if d.is_dir()]

    def get_tree_node(self, path: Optional[str] = None, root: str = "images") -> List[Dict[str, Any]]:
        """Retorna les subcarpetes immediates de `<root>/path` (o del root
        si `path` és None), cada una amb un flag `has_children` calculat per
        permetre a la UI mostrar el chevron sense carregar tot l'arbre.

        És lazy: només llegeix un nivell. Per als ~33k directoris d'aquest
        vault, escanejar tot l'arbre seria inviable.

        Per al root="vault" exclou carpetes de sistema (`.git`, `BD`, etc.).
        """
        target = self._resolve_album_dir(path, root=root)
        if target is None or not target.exists():
            return []
        skip = _VAULT_SKIP_DIRS if root == "vault" else set()
        nodes: List[Dict[str, Any]] = []
        try:
            with os.scandir(target) as it:
                for entry in it:
                    if entry.name.startswith('.'):
                        continue
                    if entry.name in skip:
                        continue
                    try:
                        if not entry.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    rel = (Path(path) / entry.name).as_posix() if path else entry.name
                    has_children = False
                    try:
                        with os.scandir(entry.path) as it2:
                            for sub in it2:
                                if sub.name.startswith('.'):
                                    continue
                                if sub.name in skip:
                                    continue
                                if sub.is_dir(follow_symlinks=False):
                                    has_children = True
                                    break
                    except OSError:
                        pass
                    nodes.append({
                        "name": entry.name,
                        "path": rel,
                        "has_children": has_children,
                    })
        except OSError as e:
            log.warning(f"scandir tree {target}: {e}")
            return []
        nodes.sort(key=lambda n: n["name"].lower())
        return nodes

    def upload_media(self, file: UploadFile, album: str = "General") -> Dict[str, Any]:
        """Puja un fitxer i el guarda a la carpeta de l'àlbum corresponent.

        `album` pot ser jeràrquic ("Viatges/2024": l'arbre de la UI navega
        subcarpetes), així que es saneja segment a segment i es conté el
        destí dins d'Images/. Veure la directiva media_upload_path_safety.
        """
        m_dir = self.media_dir

        # Segments "." / ".." són sempre traversal (la UI no els genera mai):
        # rebuig sorollós en comptes de sanejar-los en silenci.
        segments: List[str] = []
        for seg in re.split(r"[\\/]+", album or ""):
            seg = seg.strip()
            if not seg:
                continue
            if set(seg) <= {"."}:
                raise HTTPException(status_code=400, detail="Nom d'àlbum invàlid")
            segments.append(sanitize_path_segment(seg, "General"))
        if not segments:
            segments = ["General"]
        target_dir = m_dir.joinpath(*segments)

        # Contenció post-resolució: tanca també symlinks dins Images que
        # apuntin fora. Es comprova ABANS de crear cap directori.
        try:
            target_dir.resolve().relative_to(m_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Nom d'àlbum invàlid")
        target_dir.mkdir(parents=True, exist_ok=True)

        content = file.file.read()
        fallback_name = f"upload-{hashlib.sha256(content).hexdigest()[:8]}"
        filename = sanitize_path_segment(file.filename or "", fallback_name)
        target_path = target_dir / filename

        if target_path.exists():
            file_hash = hashlib.sha256(content).hexdigest()[:8]
            filename = f"{file_hash}_{filename}"
            target_path = target_dir / filename

        # Atòmic (tmp + rename): un upload interromput mai deixa un fitxer
        # truncat que OneDrive pugui replicar a mitges.
        safe_write_bytes(target_path, content)

        # Invalidar caches afectats: el directori de l'àlbum i el del root
        # (que també conté el fitxer recursivament).
        self.invalidate_cache(target_dir)
        self.invalidate_cache(m_dir)

        info = self._get_file_info(target_path)
        return info

    def _get_exif_data(self, path: Path) -> Dict[str, Any]:
        if not Image: return {"date_taken": None, "lat": None, "lng": None}
        results = {"date_taken": None, "lat": None, "lng": None}
        try:
            with Image.open(path) as img:
                exif = img._getexif()
                if not exif: return results
                for tag, value in exif.items():
                    decoded = TAGS.get(tag, tag)
                    if decoded == "DateTimeOriginal":
                        try:
                            results["date_taken"] = datetime.strptime(value, "%Y:%m:%d %H:%M:%S").isoformat()
                        except (ValueError, TypeError) as e:
                            # Format de data EXIF malformat — ho ignorem però
                            # ho loggem perquè algun proveïdor pot estar
                            # produint dades fora d'spec.
                            log.debug(f"EXIF date parse failed for {path}: {e}")
                    elif decoded == "GPSInfo":
                        gps_data = {GPSTAGS.get(t, t): value[t] for t in value}
                        lat = gps_data.get("GPSLatitude")
                        lat_ref = gps_data.get("GPSLatitudeRef")
                        lng = gps_data.get("GPSLongitude")
                        lng_ref = gps_data.get("GPSLongitudeRef")
                        if lat and lat_ref and lng and lng_ref:
                            results["lat"] = self._convert_to_degrees(lat) * (1 if lat_ref == "N" else -1)
                            results["lng"] = self._convert_to_degrees(lng) * (1 if lng_ref == "E" else -1)
        except Exception as e:
            log.debug(f"EXIF read failed for {path}: {e}")
        return results

    def _convert_to_degrees(self, value):
        d = float(value[0].numerator) / float(value[0].denominator)
        m = float(value[1].numerator) / float(value[1].denominator)
        s = float(value[2].numerator) / float(value[2].denominator)
        return d + (m / 60.0) + (s / 3600.0)

    def _get_file_info(self, path: Path, fast: bool = False, root: str = "images") -> Dict[str, Any]:
        v_path = get_active_vault_path()
        try:
            rel_path = path.relative_to(v_path)
        except ValueError:
            # El root pot ser fora de VAULT (Biblioteca és germà). En aquest
            # cas usem la ruta sencera com a referència; la URL la calculem
            # des del root específic.
            rel_path = path
        album = path.parent.name
        r_dir = self._root_dir(root)

        # URL: relatiu al root, amb el prefix corresponent del root.
        prefix = MEDIA_ROOTS.get(root, MEDIA_ROOTS["images"])["url_prefix"]
        try:
            url_rel = path.relative_to(r_dir).as_posix() if r_dir else path.name
            url = f"{prefix}{url_rel}"
        except ValueError:
            url_rel = path.name
            url = f"{prefix}{path.name}"

        # Si estem en mode ràpid, no mirem EXIF (que obre el fitxer)
        exif = {}
        if not fast:
            exif = self._get_exif_data(path)

        st = path.stat()
        ext = path.suffix.lower()

        # Hidratació de tags + descripció des del sidecar (clau `<root>::<rel>`).
        # Lookup O(1) en memòria — no fa I/O addicional per fitxer.
        user_meta = self._get_user_meta_for(root, url_rel)

        return {
            "id": path.stem,
            "filename": path.name,
            "url": url,
            "path": str(rel_path),
            "path_in_root": url_rel,
            "album": album,
            "root": root,
            "kind": self.classify_kind(ext),
            "size": st.st_size,
            "last_modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "extension": ext,
            "date_taken": exif.get("date_taken"),
            "location": {"lat": exif.get("lat"), "lng": exif.get("lng")} if not fast else None,
            "tags": user_meta["tags"],
            "description": user_meta["description"],
        }

# Instància global segueix sent vàlida ja que el constructor és segur ara
media_service = MediaService()
