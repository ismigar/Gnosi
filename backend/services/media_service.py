try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    Image = None

import os
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


class MediaService:
    def __init__(self):
        # Ja no inicialitzem el path aquí per evitar errors al boot
        self._media_dir_cache = None
        self._scan_cache: Dict[str, Tuple[float, List[Tuple[Path, float]]]] = {}
        self._scan_locks: Dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        try:
            _PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.debug(f"No es pot crear {_PERSIST_DIR}: {e}")

    @property
    def media_dir(self) -> Path:
        """Resol el directori de mitjans dinàmicament segons el vault actiu."""
        base = get_active_vault_path()
        m_dir = base / "Images"
        # Ens assegurem que existeixi quan es demani
        try:
            m_dir.mkdir(parents=True, exist_ok=True)
            (m_dir / "General").mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning(f"No es pot crear el directori de media a {m_dir}: {e}")
        return m_dir

    _VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}

    def _scan_recursive(self, root: Path) -> Iterator[Tuple[Path, float]]:
        """
        Recorre `root` recursivament emetent (path, mtime) per cada imatge vàlida.
        Usa os.scandir perquè comparteix el stat() amb el llistat (a OneDrive cada
        stat addicional és car: el rglob+stat anterior trigava >60s per ~56k fitxers).
        """
        try:
            with os.scandir(root) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            yield from self._scan_recursive(Path(entry.path))
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

    def _scan_with_cache(self, target_dir: Path) -> List[Tuple[Path, float]]:
        """Retorna l'índex (path, mtime) per `target_dir` amb cache TTL +
        persistència a disc per sobreviure reinicis del contenidor.
        """
        key = str(target_dir)
        now = time.time()
        cached = self._scan_cache.get(key)
        if cached and (now - cached[0]) < _SCAN_CACHE_TTL_S:
            return cached[1]

        # Si en RAM no hi és, intentem el persistit abans de re-escanejar.
        if cached is None:
            persisted = self._load_persisted(target_dir)
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
            entries = list(self._scan_recursive(target_dir))
            entries.sort(key=lambda x: x[1], reverse=True)
            ts = time.time()
            self._scan_cache[key] = (ts, entries)
            self._save_persisted(target_dir, ts, entries)
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

    def _resolve_album_dir(self, album: Optional[str]) -> Optional[Path]:
        """Resol l'`album` (relatiu a `Images/`) a un Path absolut, validant
        que no surt del root. Retorna None si és invalid."""
        m_dir = self.media_dir
        if not album:
            return m_dir
        # Normalitzem separadors i evitem segments .. o absoluts
        candidate = (m_dir / album).resolve()
        try:
            candidate.relative_to(m_dir.resolve())
        except ValueError:
            log.warning(f"Album fora del root: {album!r}")
            return None
        return candidate

    def get_all_media(self, album: Optional[str] = None, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """Llista fitxers de mitjans amb paginació i optimització.

        `album` pot ser un path relatiu amb subdirectoris (`Pueblo/Sierra`).
        Sempre escaneja recursivament el directori indicat.
        """
        target_dir = self._resolve_album_dir(album)
        if target_dir is None or not target_dir.exists():
            return {"items": [], "total": 0, "limit": limit, "offset": offset}

        all_entries = self._scan_with_cache(target_dir)
        total = len(all_entries)

        # Paginació
        paged = all_entries[offset : offset + limit]
        items = [self._get_file_info(p, fast=True) for p, _ in paged]

        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def get_albums(self) -> List[str]:
        """Retorna la llista de carpetes (àlbums) a Images. Mantingut per
        compatibilitat — l'arbre lazy es serveix via `get_tree_node`.
        """
        m_dir = self.media_dir
        if not m_dir.exists(): return []
        return [d.name for d in m_dir.iterdir() if d.is_dir()]

    def get_tree_node(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retorna les subcarpetes immediates de `Images/path` (o de `Images/`
        si `path` és None), cada una amb un flag `has_children` calculat per
        permetre a la UI mostrar el chevron sense carregar tot l'arbre.

        És lazy: només llegeix un nivell. Per als ~33k directoris d'aquest
        vault, escanejar tot l'arbre seria inviable.
        """
        target = self._resolve_album_dir(path)
        if target is None or not target.exists():
            return []
        nodes: List[Dict[str, Any]] = []
        try:
            with os.scandir(target) as it:
                for entry in it:
                    if entry.name.startswith('.'):
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
        """Puja un fitxer i el guarda a la carpeta de l'àlbum corresponent."""
        m_dir = self.media_dir
        target_dir = m_dir / album
        target_dir.mkdir(parents=True, exist_ok=True)
        
        content = file.file.read()
        filename = file.filename
        target_path = target_dir / filename
        
        if target_path.exists():
            file_hash = hashlib.sha256(content).hexdigest()[:8]
            filename = f"{file_hash}_{filename}"
            target_path = target_dir / filename
            
        with open(target_path, "wb") as f:
            f.write(content)

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

    def _get_file_info(self, path: Path, fast: bool = False) -> Dict[str, Any]:
        v_path = get_active_vault_path()
        rel_path = path.relative_to(v_path)
        album = path.parent.name
        m_dir = self.media_dir
        
        # Rumb relatiu des de /vault/Images
        try:
            url_rel = path.relative_to(m_dir).as_posix()
            url = f"/api/vault/images/{url_rel}"
        except ValueError:
            url = f"/api/vault/images/{path.name}"

        # Si estem en mode ràpid, no mirem EXIF (que obre el fitxer)
        exif = {}
        if not fast:
            exif = self._get_exif_data(path)
        
        st = path.stat()
        return {
            "id": path.stem,
            "filename": path.name,
            "url": url,
            "path": str(rel_path),
            "album": album,
            "size": st.st_size,
            "last_modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "extension": path.suffix.lower(),
            "date_taken": exif.get("date_taken"),
            "location": {"lat": exif.get("lat"), "lng": exif.get("lng")} if not fast else None
        }

# Instància global segueix sent vàlida ja que el constructor és segur ara
media_service = MediaService()
