try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    Image = None

import json
import logging
import hashlib
import shutil
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import UploadFile, HTTPException
from backend.services.context_vars import get_active_vault_path

log = logging.getLogger(__name__)

class MediaService:
    def __init__(self):
        # Ja no inicialitzem el path aquí per evitar errors al boot
        self._media_dir_cache = None

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

    def get_all_media(self, album: Optional[str] = None) -> List[Dict[str, Any]]:
        """Llista tots els fitxers de mitjans, opcionalment filtrats per àlbum."""
        media_list = []
        m_dir = self.media_dir
        target_dir = m_dir / album if album else m_dir
        
        if not target_dir.exists():
            return []

        # Recórrer subdirectoris (àlbums)
        for path in target_dir.rglob("*.*"):
            if path.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]:
                media_list.append(self._get_file_info(path))
                    
        # Ordenar per data de modificació (més recents primer)
        media_list.sort(key=lambda x: x.get("date_taken") or x["last_modified"], reverse=True)
        return media_list

    def get_albums(self) -> List[str]:
        """Retorna la llista de carpetes (àlbums) a Images."""
        m_dir = self.media_dir
        if not m_dir.exists(): return []
        return [d.name for d in m_dir.iterdir() if d.is_dir()]

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
                        except: pass
                    elif decoded == "GPSInfo":
                        gps_data = {GPSTAGS.get(t, t): value[t] for t in value}
                        lat = gps_data.get("GPSLatitude")
                        lat_ref = gps_data.get("GPSLatitudeRef")
                        lng = gps_data.get("GPSLongitude")
                        lng_ref = gps_data.get("GPSLongitudeRef")
                        if lat and lat_ref and lng and lng_ref:
                            results["lat"] = self._convert_to_degrees(lat) * (1 if lat_ref == "N" else -1)
                            results["lng"] = self._convert_to_degrees(lng) * (1 if lng_ref == "E" else -1)
        except Exception: pass
        return results

    def _convert_to_degrees(self, value):
        d = float(value[0].numerator) / float(value[0].denominator)
        m = float(value[1].numerator) / float(value[1].denominator)
        s = float(value[2].numerator) / float(value[2].denominator)
        return d + (m / 60.0) + (s / 3600.0)

    def _get_file_info(self, path: Path) -> Dict[str, Any]:
        v_path = get_active_vault_path()
        rel_path = path.relative_to(v_path)
        album = path.parent.name
        m_dir = self.media_dir
        url = f"/api/vault/images/{path.relative_to(m_dir).as_posix()}"
        exif = self._get_exif_data(path)
        
        return {
            "id": path.stem,
            "filename": path.name,
            "url": url,
            "path": str(rel_path),
            "album": album,
            "size": path.stat().st_size,
            "last_modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            "extension": path.suffix.lower(),
            "date_taken": exif.get("date_taken"),
            "lat": exif.get("lat"),
            "lng": exif.get("lng")
        }

# Instància global segueix sent vàlida ja que el constructor és segur ara
media_service = MediaService()
