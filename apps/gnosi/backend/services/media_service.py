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
from backend.config.app_config import load_params

log = logging.getLogger(__name__)

class MediaService:
    def __init__(self):
        cfg = load_params(strict_env=False)
        self.vault_path = cfg.paths.get("VAULT")
        
        if not self.vault_path:
            self.vault_path = Path("/tmp/gnosi_vault")
            
        self.media_dir = self.vault_path / "Images"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        
        # Album per defecte
        (self.media_dir / "General").mkdir(parents=True, exist_ok=True)

    def get_all_media(self, album: Optional[str] = None) -> List[Dict[str, Any]]:
        """Llista tots els fitxers de mitjans, opcionalment filtrats per àlbum."""
        media_list = []
        
        target_dir = self.media_dir / album if album else self.media_dir
        
        if not target_dir.exists():
            return []

        # Recórrer subdirectoris (àlbums)
        for path in target_dir.rglob("*.*"):
            if path.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]:
                if path.parent == self.media_dir: 
                    # Fitxers a l'arrel de Images van a 'General' oficialment si es vol
                    pass
                media_list.append(self._get_file_info(path))
                    
        # Ordenar per data de modificació (més recents primer)
        media_list.sort(key=lambda x: x.get("date_taken") or x["last_modified"], reverse=True)
        return media_list

    def get_albums(self) -> List[str]:
        """Retorna la llista de carpetes (àlbums) a Images."""
        return [d.name for d in self.media_dir.iterdir() if d.is_dir()]

    def upload_media(self, file: UploadFile, album: str = "General") -> Dict[str, Any]:
        """Puja un fitxer i el guarda a la carpeta de l'àlbum corresponent."""
        target_dir = self.media_dir / album
        target_dir.mkdir(parents=True, exist_ok=True)
        
        content = file.file.read()
        filename = file.filename
        target_path = target_dir / filename
        
        # Evitar duplicats pel mateix nom (o fer servir hash si es vol)
        if target_path.exists():
            file_hash = hashlib.sha256(content).hexdigest()[:8]
            filename = f"{file_hash}_{filename}"
            target_path = target_dir / filename
            
        with open(target_path, "wb") as f:
            f.write(content)
            
        info = self._get_file_info(target_path)
        log.info(f"📸 Media uploaded: {filename} in {album}")
        return info

    def update_metadata(self, filename: str, album: str, metadata: Dict[str, Any]) -> bool:
        """Actualitza les metadades (tags, descripció, etc.) d'un fitxer."""
        album_meta_path = self.media_dir / album / "metadata.json"
        
        all_meta = {}
        if album_meta_path.exists():
            try:
                with open(album_meta_path, "r", encoding="utf-8") as f:
                    all_meta = json.load(f)
            except Exception:
                pass
        
        if filename not in all_meta:
            all_meta[filename] = {}
            
        # Fusionar les noves metadades
        all_meta[filename].update(metadata)
        
        with open(album_meta_path, "w", encoding="utf-8") as f:
            json.dump(all_meta, f, indent=2, ensure_ascii=False)
            
        return True

    def _get_exif_data(self, path: Path) -> Dict[str, Any]:
        """Extrau data i GPS de la imatge."""
        if not Image: return {}
        
        results = {"date_taken": None, "lat": None, "lng": None}
        try:
            with Image.open(path) as img:
                exif = img._getexif()
                if not exif: return results
                
                for tag, value in exif.items():
                    decoded = TAGS.get(tag, tag)
                    if decoded == "DateTimeOriginal":
                        try:
                            # Format: 2023:10:24 15:30:00
                            results["date_taken"] = datetime.strptime(value, "%Y:%m:%d %H:%M:%S").isoformat()
                        except: pass
                    elif decoded == "GPSInfo":
                        gps_data = {}
                        for t in value:
                            sub_tag = GPSTAGS.get(t, t)
                            gps_data[sub_tag] = value[t]
                        
                        # Convertir a decimal
                        lat = gps_data.get("GPSLatitude")
                        lat_ref = gps_data.get("GPSLatitudeRef")
                        lng = gps_data.get("GPSLongitude")
                        lng_ref = gps_data.get("GPSLongitudeRef")
                        
                        if lat and lat_ref and lng and lng_ref:
                            results["lat"] = self._convert_to_degrees(lat) * (1 if lat_ref == "N" else -1)
                            results["lng"] = self._convert_to_degrees(lng) * (1 if lng_ref == "E" else -1)
        except Exception:
            pass
        return results

    def _convert_to_degrees(self, value):
        """Helper per convertir format GPS EXIF a decimal."""
        d = float(value[0].numerator) / float(value[0].denominator)
        m = float(value[1].numerator) / float(value[1].denominator)
        s = float(value[2].numerator) / float(value[2].denominator)
        return d + (m / 60.0) + (s / 3600.0)

    def _get_file_info(self, path: Path) -> Dict[str, Any]:
        """Retorna informació normalitzada del fitxer, incloent EXIF i metadades JSON."""
        rel_path = path.relative_to(self.vault_path)
        album = path.parent.name
        
        # URL per al frontend
        # El server.py munta /api/vault/images per servir fitxers de VAULT_PATH/Images
        url = f"/api/vault/images/{path.relative_to(self.media_dir).as_posix()}"
        
        exif = self._get_exif_data(path)
        
        # Carregar metadades sidecar (JSON per àlbum)
        sidecar_path = path.parent / "metadata.json"
        metadata = {}
        if sidecar_path.exists():
            try:
                with open(sidecar_path, "r", encoding="utf-8") as f:
                    all_meta = json.load(f)
                    metadata = all_meta.get(path.name, {})
            except Exception: pass
            
        return {
            "id": path.stem,
            "filename": path.name,
            "url": url,
            "path": str(rel_path),
            "album": album,
            "size": path.stat().st_size,
            "last_modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            "extension": path.suffix.lower(),
            "date_taken": metadata.get("date_taken") or exif.get("date_taken"),
            "lat": metadata.get("lat") or exif.get("lat"),
            "lng": metadata.get("lng") or exif.get("lng"),
            "tags": metadata.get("tags", []),
            "description": metadata.get("description", "")
        }

# Instància global (opcional)
media_service = MediaService()
