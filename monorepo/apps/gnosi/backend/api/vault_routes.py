import os
import logging
import unicodedata
import shutil
from pathlib import Path
from fastapi import (
    APIRouter,
    HTTPException,
    Body,
    BackgroundTasks,
    File,
    UploadFile,
    Query,
)
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
import urllib.parse
import mimetypes
import base64
import yaml
import re
import json
import requests
import uuid
import shutil
import threading
import time
import sys
import subprocess
from config.app_config import load_params
from backend.services.rule_engine import RuleEngine

log = logging.getLogger(__name__)

router = APIRouter()

from dotenv import load_dotenv

# Carrega activament el dotenv en arrencar el router per assegurar-nos
# que agafa qualsevol canvi a .env_shared ràpidament si correm en local.
try:
    base_dir = Path(__file__).resolve().parents[4]
    shared_env = base_dir / ".env_shared"
    if shared_env.exists():
        load_dotenv(shared_env)
except Exception:
    pass  # Docker envs capture it inherently from compose.yml

# Carregar configuració i agafar la ruta de la Vault
cfg = load_params(strict_env=False)
VAULT_PATH = cfg.paths["VAULT"]
ASSETS_PATH = VAULT_PATH / "Assets"
BD_PATH = VAULT_PATH / "BD"
REGISTRY_PATH = BD_PATH / "vault_db_registry.json"
CALENDAR_PATH = VAULT_PATH / "Calendar"
MAIL_PATH = VAULT_PATH / "Mail"
PLANTILLES_PATH = VAULT_PATH / "Plantilles"
DIBUIXOS_PATH = VAULT_PATH / "Dibuixos"
WIKI_PATH = VAULT_PATH / "Wiki"

# Assegurar-nos que BD existeix (per al registre)
BD_PATH.mkdir(parents=True, exist_ok=True)

# Si WIKI_PATH no existeix, potser l'usuari vol que sigui Mail o una altra
# De moment la mantenim però serem resilients en la lectura.
DEFAULT_DB_PATH = BD_PATH / "Cervell Digital"
DEFAULT_TABLE_PATH = DEFAULT_DB_PATH / "Taula 1"
NEWSLETTERS_PATH = VAULT_PATH / "Newsletters"

# Inicializar RuleEngine
rule_engine = RuleEngine(VAULT_PATH)
_table_recalc_lock = threading.Lock()
_table_recalc_state = {}
_TABLE_RECALC_COOLDOWN_SECONDS = 0.5
_page_index_lock = threading.Lock()
_page_index_entries: Dict[str, Dict[str, Any]] = {}


def sync_to_google_calendar_if_needed(
    metadata: dict, background_tasks: BackgroundTasks
):
    source = metadata.get("source", "")
    if "Google Calendar" in source and metadata.get("uid"):
        match = re.search(r"\((.*?)\)", source)
        if match:
            email = match.group(1)
            event_uid = metadata.get("uid")
            patch_data = {"summary": metadata.get("title")}
            if metadata.get("date"):
                patch_data["start"] = metadata.get("date")
            if metadata.get("end_date"):
                patch_data["end"] = metadata.get("end_date")

            from backend.services.google_calendar_service import update_google_event

            background_tasks.add_task(update_google_event, email, event_uid, patch_data)


# Assegurar que existeixen
ASSETS_PATH.mkdir(parents=True, exist_ok=True)
log.info(f"DEBUG: VAULT_PATH is {VAULT_PATH}")
log.info(f"DEBUG: REGISTRY_PATH is {REGISTRY_PATH}")
if not REGISTRY_PATH.exists():
    REGISTRY_PATH.write_text(
        json.dumps({"databases": [], "tables": [], "views": []}, indent=2),
        encoding="utf-8",
    )


class PageSaveRequest(BaseModel):
    title: str
    content: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict = {}


class DrawingSaveRequest(BaseModel):
    title: str
    data: dict
    metadata: dict = {}


class PageInfo(BaseModel):
    id: str
    title: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict = {}
    last_modified: str
    size: int
    folder: str = (
        ""  # relative folder path inside the vault (e.g. "BD/Cervell Digital/Recursos")
    )
    path: Optional[str] = None  # Absolute file path
    resolved_table_id: Optional[str] = None


class PagePatchRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[dict] = None
    parent_id: Optional[str] = None
    is_database: Optional[bool] = None


class OpenResourceRequest(BaseModel):
    zotero_uri: Optional[str] = None
    file_path: Optional[str] = None
    attachments: Optional[object] = None


class SidebarPageInfo(BaseModel):
    id: str
    title: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict = {}
    last_modified: str
    folder: str = ""
    resolved_table_id: Optional[str] = None


class TablePagesSnapshot(BaseModel):
    table_id: str
    raw_count: int
    visible_count: int
    pages: List[PageInfo]


def _normalize_resource_title(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = normalized.lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized).strip()
    return normalized


def _resource_visible_record(page: PageInfo) -> bool:
    metadata = page.metadata or {}
    if metadata.get("is_template"):
        return False

    tipus = str(metadata.get("Tipus") or "").strip().lower()
    title = str(page.title or "").strip().lower()
    gnosi_id = str(metadata.get("id") or page.id or "").strip()

    if tipus == "annotation":
        return False

    if title in {"nou", "sense títol", "sense titol"}:
        return False

    if not gnosi_id:
        return False

    return True


def _canonical_visible_table_pages(
    table_id: str, pages: List[PageInfo]
) -> List[PageInfo]:
    # Base rule shared by all tables: templates are not records in table counts.
    filtered = [p for p in pages if not (p.metadata or {}).get("is_template")]

    if table_id != "resources":
        return filtered

    filtered = [p for p in filtered if _resource_visible_record(p)]

    # Recursos may include semantic duplicates (accent/punctuation variants).
    deduped: Dict[str, PageInfo] = {}
    for page in filtered:
        key = _normalize_resource_title(page.title)
        if not key:
            key = f"__{page.id}"

        existing = deduped.get(key)
        if existing is None:
            deduped[key] = page
            continue

        try:
            existing_ts = datetime.fromisoformat(existing.last_modified).timestamp()
        except Exception:
            existing_ts = 0

        try:
            next_ts = datetime.fromisoformat(page.last_modified).timestamp()
        except Exception:
            next_ts = 0

        if next_ts > existing_ts:
            deduped[key] = page

    return list(deduped.values())


def is_calendar_entry(metadata: Optional[dict]) -> bool:
    """Decideix si una pàgina s'ha de guardar com a cita del calendari."""
    if not metadata:
        return False

    source = (metadata.get("source") or "").strip().lower()
    has_date = bool(metadata.get("date"))
    has_table = bool(metadata.get("database_table_id") or metadata.get("table_id"))

    # Una cita sempre ha de tenir data. Amb data: és cita si prové de Gnosi
    # (calendari intern) o si no pertany a cap taula de BD.
    return has_date and (source in {"gnosi", "gnosi vault"} or not has_table)


def init_vault():
    """Inicialitza l'entorn bàsic."""
    VAULT_PATH.mkdir(parents=True, exist_ok=True)
    ASSETS_PATH.mkdir(parents=True, exist_ok=True)
    CALENDAR_PATH.mkdir(parents=True, exist_ok=True)
    DIBUIXOS_PATH.mkdir(parents=True, exist_ok=True)
    BD_PATH.mkdir(parents=True, exist_ok=True)
    DEFAULT_DB_PATH.mkdir(parents=True, exist_ok=True)
    DEFAULT_TABLE_PATH.mkdir(parents=True, exist_ok=True)
    NEWSLETTERS_PATH.mkdir(parents=True, exist_ok=True)


def ensure_default_registry_structure():
    """Assegura l'existència de la BD per defecte i una taula inicial."""
    registry = load_registry()
    if "databases" not in registry or not isinstance(registry["databases"], list):
        registry["databases"] = []
    if "tables" not in registry or not isinstance(registry["tables"], list):
        registry["tables"] = []
    if "views" not in registry or not isinstance(registry["views"], list):
        registry["views"] = []

    changed = False

    db = next(
        (d for d in registry["databases"] if d.get("id") == "digital_brain_db"), None
    )
    if db is None:
        db = {
            "id": "digital_brain_db",
            "name": "Cervell Digital",
            "folder": "BD/Cervell Digital",
        }
        registry["databases"].append(db)
        changed = True
    else:
        if db.get("name") != "Cervell Digital":
            db["name"] = "Cervell Digital"
            changed = True
        if db.get("folder") != "BD/Cervell Digital":
            db["folder"] = "BD/Cervell Digital"
            changed = True

    default_table = next(
        (t for t in registry["tables"] if t.get("id") == "taula_1"), None
    )
    if default_table is None:
        has_any_table_for_default_db = any(
            t.get("database_id") == "digital_brain_db" for t in registry["tables"]
        )
        # Desactivat per evitar soroll innecessari a la Vault segons feedback de l'usuari
        pass

    if changed:
        save_registry(registry)


init_vault()


def parse_frontmatter(content: str, file_path: Optional[Path] = None):
    """Parses d'un arxiu markdown per extreure el YAML frontmatter i el body.

    If the YAML is malformed we log an error and return empty metadata.
    ``file_path`` is used only for logging context.
    """
    # Regex per capturar el frontmatter entre --- i --- al principi de l'arxiu
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if match:
        yaml_content = match.group(1)
        body = content[match.end() :]
        try:
            metadata = yaml.safe_load(yaml_content) or {}
            return metadata, body
        except yaml.YAMLError as e:
            fallback_metadata = _parse_frontmatter_fallback(yaml_content)
            if fallback_metadata:
                location = f" in {file_path}" if file_path else ""
                log.warning(
                    f"YAML frontmatter malformat{location}; aplicant parseig de rescat"
                )
                return fallback_metadata, body
            location = f" in {file_path}" if file_path else ""
            # malformed YAML is annoying but not fatal; debug instead of error
            log.debug(f"Error parsejant YAML frontmatter{location}: {e}")
            return {}, content
    return {}, content


def _parse_frontmatter_fallback(yaml_content: str) -> dict:
    """Fallback tolerant parser for simple top-level `key: value` frontmatter.

    It intentionally ignores nested/object/list blocks and only salvages scalar
    values from top-level keys so listings can still resolve id/title/table_id.
    """
    metadata = {}
    for raw_line in yaml_content.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue

        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue

        # Ignore nested YAML blocks and list members to avoid corrupt parsing.
        if line.startswith((" ", "\t", "- ")):
            continue

        if ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        if not key:
            continue

        parsed_value = value.strip()

        if len(parsed_value) >= 2 and (
            (parsed_value[0] == '"' and parsed_value[-1] == '"')
            or (parsed_value[0] == "'" and parsed_value[-1] == "'")
        ):
            parsed_value = parsed_value[1:-1]

        lowered = parsed_value.lower()
        if lowered == "true":
            metadata[key] = True
        elif lowered == "false":
            metadata[key] = False
        elif re.fullmatch(r"-?\d+", parsed_value):
            metadata[key] = int(parsed_value)
        else:
            metadata[key] = parsed_value

    return metadata


def generate_frontmatter(metadata: dict) -> str:
    """Generates YAML frontmatter string from a dictionary."""
    if not metadata:
        return "---\n---\n"
    yaml_str = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    return f"---\n{yaml_str}---\n"


def normalize_metadata_ids(metadata: dict) -> dict:
    """
    Normalitza els camps d'identificació al frontmatter.
    Política: el camp canònic és 'id'. Si existeixen claus legacy d'identificador,
    es renomenen a 'id' i s'eliminen. Si ja existeix 'id', es preserva.
    """
    legacy_fields = ["source_id", "gnosi_id"]
    for key in list(metadata.keys()):
        normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
        if normalized in {"sourceid", "gnosiid"}:
            legacy_fields.append(key)

    for field in set(legacy_fields):
        if field in metadata:
            if "id" not in metadata:
                metadata["id"] = metadata[field]
            del metadata[field]
    return metadata


def normalize_table_context(metadata: dict) -> dict:
    """Manté sincronitzats els camps de context de taula (canònic + legacy)."""
    table_id = metadata.get("table_id")
    database_table_id = metadata.get("database_table_id")

    if table_id and not database_table_id:
        metadata["database_table_id"] = table_id
    elif database_table_id and not table_id:
        metadata["table_id"] = database_table_id

    return metadata


def ensure_correct_page_location(file_path: Path, metadata: dict) -> Path:
    """Mou notes entre Wiki/Plantilles/Calendar/BD segons metadata."""
    is_template = metadata.get("is_template") is True
    is_calendar = is_calendar_entry(metadata)

    if is_template:
        target_dir = PLANTILLES_PATH
    elif is_calendar:
        target_dir = CALENDAR_PATH
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        if table_folder:
            target_dir = table_folder
        else:
            target_dir = WIKI_PATH

    target_dir.mkdir(parents=True, exist_ok=True)

    # No movem notes que ja estan en subcarpetes d'usuari, excepte Plantilles/Calendar.
    can_relocate = (
        file_path.parent == VAULT_PATH
        or file_path.parent == PLANTILLES_PATH
        or file_path.parent == CALENDAR_PATH
        or file_path.parent == WIKI_PATH
    )

    if can_relocate and file_path.parent != target_dir:
        new_path = target_dir / file_path.name
        if file_path.exists() and file_path.is_file():
            file_path.rename(new_path)
        return new_path

    return file_path


def _process_metadata_paths(metadata: dict):
    """
    Transforma rutes relatives rutes que comencen per Assets/
    en rutes accessibles via API /api/vault/assets/.
    """
    if not metadata:
        return metadata

    for key in ["cover", "icon"]:
        val = metadata.get(key)
        if isinstance(val, str) and val.startswith("Assets/"):
            # Substituïm Assets/ per la ruta de l'API
            metadata[key] = val.replace("Assets/", "/api/vault/assets/", 1)

    return metadata


def _normalize_schema_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _sanitize_asset_segment(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[\\/]+", " ", str(value or "")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^\w\-. ]", "", cleaned, flags=re.UNICODE).strip()
    if not cleaned:
        return fallback
    return cleaned[:120]


def _safe_filename(title: str, target_dir: Path) -> str:
    """Generate a safe filename from a title, handling collisions.

    Returns the filename WITHOUT extension.
    """
    # Sanitize: remove invalid filesystem characters
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(title or "")).strip()
    safe = re.sub(r"\s+", " ", safe)
    if not safe:
        safe = "Untitled"

    # Truncate to avoid filesystem limits
    if len(safe) > 200:
        safe = safe[:200].strip()

    # Handle collisions: if file exists, append counter
    candidate = safe
    counter = 2
    while (target_dir / f"{candidate}.md").exists():
        candidate = f"{safe} ({counter})"
        counter += 1

    return candidate


def _is_asset_property(prop: Dict[str, Any]) -> bool:
    p_type = str((prop or {}).get("type") or "").strip().lower()
    if p_type in {
        "files",
        "file",
        "image",
        "images",
        "attachment",
        "attachments",
        "media",
    }:
        return True

    p_name = str((prop or {}).get("name") or "").strip().lower()
    return p_type == "url" and any(
        token in p_name
        for token in [
            "image",
            "imatge",
            "imagen",
            "foto",
            "cover",
            "thumbnail",
            "thumb",
        ]
    )


def _resolve_table_and_database_for_assets(
    table_id: str, registry: dict
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    table = next(
        (t for t in registry.get("tables", []) if str(t.get("id")) == str(table_id)),
        None,
    )
    if not table:
        return None, None
    database_id = table.get("database_id")
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(database_id)
        ),
        None,
    )
    return table, database


def _property_assets_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]], property_name: str
) -> Path:
    db_segment = _sanitize_asset_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _sanitize_asset_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table", "Table"
    )
    prop_segment = _sanitize_asset_segment(property_name, "Property")
    return ASSETS_PATH / db_segment / table_segment / prop_segment


def _ensure_asset_dirs_for_table_entry(table: Dict[str, Any], registry: dict):
    if not table:
        return
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(table.get("database_id"))
        ),
        None,
    )
    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue
        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue
        _property_assets_dir(table, database, prop_name).mkdir(
            parents=True, exist_ok=True
        )


def _ensure_table_vault_folder(table: Dict[str, Any], registry_data: Dict[str, Any]):
    """Crea la carpeta física de la taula dins de BD/NomBD/ (ex: Gnosi/BD/Cervell Digital/Articles/).
    Inclou lògica de migració: si la carpeta és a l'arrel o a BD/, la mou a la carpeta de la BD.
    """
    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        log.warning(f"Taula {table.get('id')} ({table.get('name')}) no té la propietat 'folder' definida.")
        return

    # Cerquem la carpeta de la base de dades a la que pertany la taula
    db_id = table.get("database_id")
    db_folder = "BD" # Default si no es troba
    
    if registry_data and "databases" in registry_data:
        for db in registry_data["databases"]:
            if db.get("id") == db_id:
                db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
                break

    # Ruta final correcta: Gnosi / BD / Nom BD / folder_rel
    target_path = VAULT_PATH / db_folder / folder_rel
    
    # Rutes de migració (on podria estar la carpeta ara mateix)
    legacy_root_path = VAULT_PATH / folder_rel
    legacy_bd_path = BD_PATH / folder_rel

    try:
        # 1. MIGRACIÓ des de l'arrel (Gnosi/Articles)
        if legacy_root_path.exists() and legacy_root_path.is_dir() and legacy_root_path != (VAULT_PATH / db_folder):
            if not target_path.exists():
                log.info(f"📦 Migrant carpeta de taula de ROOT a {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_root_path), str(target_path))
        
        # 2. MIGRACIÓ des de BD/ (Gnosi/BD/Articles)
        if legacy_bd_path.exists() and legacy_bd_path.is_dir() and legacy_bd_path != target_path:
            if not target_path.exists():
                log.info(f"📦 Migrant carpeta de taula de BD a {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_bd_path), str(target_path))
            else:
                # Si ja existeix a destí, però també a BD/, intentem fusionar o eliminar la vella si és buida
                log.warning(f"⚠️ La carpeta legacy a BD/ encara existeix per {folder_rel}. Considerant neteja.")
                if not any(legacy_bd_path.iterdir()):
                    legacy_bd_path.rmdir()

        # 3. CREACIÓ (si no s'ha migrat o no existia)
        if not target_path.exists():
            target_path.mkdir(parents=True, exist_ok=True)
            log.info(f"✅ Carpeta de taula creada a {db_folder}/: {target_path}")
        # else:
            # log.info(f"ℹ️ La carpeta de taula ja existeix correctament a {db_folder}/: {target_path}")
            
    except Exception as e:
        log.error(f"❌ Error gestionant carpeta de la taula {folder_rel} a {db_folder}: {e}")


def _table_assets_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]]
) -> Path:
    """Retorna el directori Assets/[BD]/[Taula] per a una taula."""
    db_segment = _sanitize_asset_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _sanitize_asset_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table", "Table"
    )
    return ASSETS_PATH / db_segment / table_segment


def _delete_asset_files_for_page(
    page_metadata: dict, table: Dict[str, Any], registry: dict
):
    """Esborra els fitxers d'assets referenciats en el metadata d'un registre."""
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(table.get("database_id"))
        ),
        None,
    )
    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue
        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue
        value = page_metadata.get(prop_name)
        if not value:
            continue
        # Normalitzar a llista per tractar valors únics i múltiples de la mateixa manera
        paths = value if isinstance(value, list) else [value]
        for raw_path in paths:
            if not isinstance(raw_path, str):
                continue
            rel = raw_path.strip()
            if not rel.startswith("Assets/"):
                continue
            abs_path = VAULT_PATH / rel
            if abs_path.is_file():
                try:
                    abs_path.unlink()
                    log.info(f"Asset esborrat: {abs_path}")
                except Exception as exc:
                    log.warning(f"No s'ha pogut esborrar {abs_path}: {exc}")


def _delete_asset_property_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]], prop_name: str
):
    """Esborra recursivament la carpeta Assets/[BD]/[Taula]/[Propietat] si existeix."""
    prop_dir = _property_assets_dir(table, database, prop_name)
    if prop_dir.is_dir():
        try:
            shutil.rmtree(prop_dir)
            log.info(f"Carpeta de propietat esborrada: {prop_dir}")
        except Exception as exc:
            log.warning(f"No s'ha pogut esborrar la carpeta {prop_dir}: {exc}")


def _delete_asset_table_dir(table: Dict[str, Any], database: Optional[Dict[str, Any]]):
    """Esborra recursivament la carpeta Assets/[BD]/[Taula] si existeix."""
    table_dir = _table_assets_dir(table, database)
    if table_dir.is_dir():
        try:
            shutil.rmtree(table_dir)
            log.info(f"Carpeta de taula esborrada: {table_dir}")
        except Exception as exc:
            log.warning(f"No s'ha pogut esborrar la carpeta {table_dir}: {exc}")


def _copy_local_file_to_assets(local_path: Path, target_dir: Path) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = _sanitize_asset_segment(local_path.name, f"file-{uuid.uuid4().hex[:8]}")
    destination = target_dir / filename
    if destination.exists():
        stem = _sanitize_asset_segment(local_path.stem, "file")
        ext = local_path.suffix
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"
    shutil.copy2(local_path, destination)
    return str(destination.relative_to(VAULT_PATH)).replace("\\", "/")


def _save_uploaded_file_to_assets(upload: UploadFile, target_dir: Path) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload.bin"
    ext = Path(original_name).suffix
    stem = _sanitize_asset_segment(Path(original_name).stem, "upload")
    destination = target_dir / f"{stem}{ext}"
    if destination.exists():
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"

    with open(destination, "wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)

    return str(destination.relative_to(VAULT_PATH)).replace("\\", "/")


def _save_data_url_image_to_assets(value: str, target_dir: Path) -> Optional[str]:
    match = re.match(
        r"^data:(image/[^;]+);base64,(.+)$", value.strip(), re.IGNORECASE | re.DOTALL
    )
    if not match:
        return None

    mime_type = match.group(1).lower()
    payload = match.group(2)
    try:
        decoded = base64.b64decode(payload, validate=True)
    except Exception:
        return None

    ext = mimetypes.guess_extension(mime_type) or ".bin"
    if ext == ".jpe":
        ext = ".jpg"

    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"image-{uuid.uuid4().hex[:12]}{ext}"
    destination = target_dir / filename
    destination.write_bytes(decoded)
    return str(destination.relative_to(VAULT_PATH)).replace("\\", "/")


def _persist_asset_value(value: Any, target_dir: Path) -> Any:
    if value is None:
        return value

    if isinstance(value, list):
        return [_persist_asset_value(item, target_dir) for item in value]

    if isinstance(value, dict):
        updated = dict(value)
        for key in ["path", "file_path", "url", "src"]:
            if key in updated:
                updated[key] = _persist_asset_value(updated[key], target_dir)
        return updated

    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return value

    if text.startswith("/api/vault/assets/"):
        return "Assets/" + text[len("/api/vault/assets/") :]
    if text.startswith("Assets/"):
        return text
    if text.startswith("http://") or text.startswith("https://"):
        return text

    data_url_result = _save_data_url_image_to_assets(text, target_dir)
    if data_url_result:
        return data_url_result

    candidate = text
    if text.startswith("file://"):
        candidate = urllib.parse.unquote(text[7:])

    local_path = Path(candidate).expanduser()
    try:
        if local_path.exists() and local_path.is_file():
            return _copy_local_file_to_assets(local_path, target_dir)
    except Exception:
        return value

    return value


def _persist_metadata_assets(metadata: dict) -> dict:
    if not metadata:
        return metadata

    table_id = metadata.get("database_table_id") or metadata.get("table_id")
    if not table_id:
        return metadata

    registry = load_registry()
    table, database = _resolve_table_and_database_for_assets(str(table_id), registry)
    if not table:
        return metadata

    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue

        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue

        prop_key_norm = _normalize_schema_key(prop_name)
        metadata_key = next(
            (k for k in metadata.keys() if _normalize_schema_key(k) == prop_key_norm),
            None,
        )
        if not metadata_key:
            continue

        target_dir = _property_assets_dir(table, database, prop_name)
        target_dir.mkdir(parents=True, exist_ok=True)
        metadata[metadata_key] = _persist_asset_value(
            metadata.get(metadata_key), target_dir
        )

    return metadata


def _normalize_rel_folder(folder: Optional[str]) -> str:
    """Normalitza la ruta de la carpeta per fer-la relativa al VAULT_PATH.
    AQUESTA VERSIÓ detecta si ens arriba una ruta absoluta del host Mac i la neteja.
    """
    if not folder:
        return ""
    
    f = str(folder).replace("\\", "/")
    
    # Si és una ruta absoluta del host (comú amb el FolderPicker real del Mac)
    # Busquem el segment 'Gnosi' que és el root de la nostra Vault
    if "Gnosi/" in f:
        f = f.split("Gnosi/", 1)[1]
    elif f.startswith("/vault/"):
        f = f[7:]
    elif f.startswith("/vault"):
        f = f[6:]
        
    # Neteja de prefixos redundants de BD/ (per compatibilitat amb el nou directori base)
    if f.startswith("BD/"):
        f = f[3:]
    elif "/BD/" in f:
        f = f.split("/BD/", 1)[1]

    return f.strip().strip("/")


def _build_table_folder_index(registry: dict) -> dict:
    folder_to_table = {}
    
    # Mapeig de carpetes de bases de dades per a prefixar rutes
    db_folders = {db["id"]: _normalize_rel_folder(db.get("folder", "")) 
                  for db in registry.get("databases", [])}

    for table in registry.get("tables", []):
        raw_folder = table.get("folder")
        table_id = table.get("id")
        if not raw_folder or not table_id:
            continue
            
        db_id = table.get("database_id")
        db_prefix = db_folders.get(db_id, "") if db_id else ""
        
        # 1. Carpeta plana (ex: "Arees")
        plain_folder = _normalize_rel_folder(raw_folder)
        if plain_folder:
            folder_to_table[plain_folder.lower()] = table_id
            
        # 2. Ruta completa amb prefix de BD (ex: "Cervell Digital/Arees")
        if db_prefix:
            full_path = _normalize_rel_folder(f"{db_prefix}/{raw_folder}")
            if full_path and full_path.lower() != plain_folder.lower():
                folder_to_table[full_path.lower()] = table_id
                
    return folder_to_table


def _resolve_table_id_from_context(
    metadata: dict, rel_folder: str, folder_to_table: dict
) -> Optional[str]:
    # Canonical source: table folder from registry.
    folder_key = _normalize_rel_folder(rel_folder).lower()
    if folder_key:
        # Sort folders by length descending to match the most specific one first
        sorted_folders = sorted(folder_to_table.keys(), key=len, reverse=True)
        for f in sorted_folders:
            if folder_key == f or folder_key.startswith(f + "/"):
                return folder_to_table[f]


    # Fallback for legacy/template notes outside table folders.
    return metadata.get("table_id") or metadata.get("database_table_id")


def _resolve_table_folder_from_metadata(metadata: dict) -> Optional[Path]:
    table_id = metadata.get("table_id") or metadata.get("database_table_id")
    if not table_id:
        return None

    registry = load_registry()
    table = next(
        (t for t in registry.get("tables", []) if t.get("id") == table_id), None
    )
    if not table:
        return None

    folder = _normalize_rel_folder(table.get("folder"))
    if not folder:
        return None

    return VAULT_PATH / folder


def _resolve_page_context_from_path(
    metadata: dict, file_path: Path
) -> tuple[str, Optional[str]]:
    rel_folder = str(file_path.parent.relative_to(VAULT_PATH)).replace("\\", "/")
    if rel_folder == ".":
        rel_folder = ""

    registry = load_registry()
    folder_to_table = _build_table_folder_index(registry)
    resolved_table_id = _resolve_table_id_from_context(
        metadata, rel_folder, folder_to_table
    )
    return rel_folder, resolved_table_id


def _recompute_cross_record_formulas_for_table(
    table_id: str, exclude_page_id: Optional[str] = None
):
    """Recalcula fórmules inter-registre d'una taula després de canvis en una fila."""
    if not table_id:
        return

    with _table_recalc_lock:
        state = _table_recalc_state.setdefault(
            table_id, {"running": False, "pending": False, "last_run": 0.0}
        )
        now = time.monotonic()
        if state["running"]:
            state["pending"] = True
            return
        if now - state["last_run"] < _TABLE_RECALC_COOLDOWN_SECONDS:
            state["pending"] = True
            return
        state["running"] = True

    try:
        while True:
            with _table_recalc_lock:
                state = _table_recalc_state.setdefault(
                    table_id, {"running": True, "pending": False, "last_run": 0.0}
                )
                state["pending"] = False

            try:
                if not rule_engine.table_has_cross_record_formulas(table_id):
                    break
            except Exception as e:
                log.warning(
                    f"No s'ha pogut validar fórmules cross-record per taula {table_id}: {e}"
                )
                break

            for file_path in VAULT_PATH.rglob("*.md"):
                if any(part.startswith('.') for part in file_path.relative_to(VAULT_PATH).parts):
                    continue

                try:
                    raw = file_path.read_text(encoding="utf-8")
                    metadata, body = parse_frontmatter(raw, file_path)
                except Exception:
                    continue

                page_id = str(metadata.get("id") or file_path.stem)
                if exclude_page_id and page_id == exclude_page_id:
                    continue
                if metadata.get("is_template") is True:
                    continue

                row_table_id = metadata.get("database_table_id") or metadata.get(
                    "table_id"
                )
                if row_table_id != table_id:
                    continue

                original = metadata.copy()
                try:
                    updated = rule_engine.process_updates(
                        page_id, original, original.copy()
                    )
                except Exception as e:
                    log.warning(
                        f"Error recalculant fila {page_id} de la taula {table_id}: {e}"
                    )
                    continue

                if updated == original:
                    continue

                try:
                    frontmatter = generate_frontmatter(updated)
                    file_path.write_text(
                        f"{frontmatter}\n{body.lstrip()}", encoding="utf-8"
                    )
                except Exception as e:
                    log.warning(f"Error desant recàlcul de {page_id}: {e}")

            with _table_recalc_lock:
                state = _table_recalc_state.setdefault(
                    table_id, {"running": True, "pending": False, "last_run": 0.0}
                )
                state["last_run"] = time.monotonic()
                rerun = state["pending"]

            if not rerun:
                break
    finally:
        with _table_recalc_lock:
            state = _table_recalc_state.setdefault(
                table_id, {"running": False, "pending": False, "last_run": 0.0}
            )
            state["running"] = False


def _build_page_cache_entry(file_path: Path, stat_result) -> Dict[str, Any]:
    try:
        raw_content = file_path.read_text(encoding="utf-8")
        metadata, _ = parse_frontmatter(raw_content, file_path)
        metadata = _process_metadata_paths(metadata)
    except Exception as e:
        log.warning(f"Error parsejant el frontmatter de {file_path.name}: {e}")
        metadata = {}

    file_id = str(metadata.get("id") or file_path.stem)
    rel_folder = str(file_path.parent.relative_to(VAULT_PATH)).replace("\\", "/")
    if rel_folder == ".":
        rel_folder = ""

    return {
        "path": str(file_path),
        "mtime_ns": stat_result.st_mtime_ns,
        "mtime": stat_result.st_mtime,
        "size": stat_result.st_size,
        "id": file_id,
        "title": metadata.get("title", "Sense Títol"),
        "parent_id": metadata.get("parent_id"),
        "is_database": metadata.get("is_database", False),
        "metadata": metadata,
        "folder": rel_folder,
    }


def _get_cached_page_entries() -> List[Dict[str, Any]]:
    if not VAULT_PATH.exists():
        return []

    with _page_index_lock:
        current_paths = set()

        for file_path in VAULT_PATH.rglob("*.md"):
            if any(part.startswith('.') for part in file_path.relative_to(VAULT_PATH).parts):
                continue

            path_str = str(file_path)
            current_paths.add(path_str)

            try:
                stat_result = file_path.stat()
            except FileNotFoundError:
                continue

            cached = _page_index_entries.get(path_str)
            if (
                cached
                and cached.get("mtime_ns") == stat_result.st_mtime_ns
                and cached.get("size") == stat_result.st_size
            ):
                continue

            _page_index_entries[path_str] = _build_page_cache_entry(
                file_path, stat_result
            )

        stale_paths = [
            path for path in _page_index_entries.keys() if path not in current_paths
        ]
        for stale in stale_paths:
            _page_index_entries.pop(stale, None)

        return list(_page_index_entries.values())


def _get_pages_snapshot() -> List[PageInfo]:
    entries = _get_cached_page_entries()
    if not entries:
        return []

    registry = load_registry()
    folder_to_table = _build_table_folder_index(registry)

    pages_by_id: Dict[str, PageInfo] = {}
    duplicate_ids = set()

    for entry in entries:
        resolved_table_id = _resolve_table_id_from_context(
            entry["metadata"], entry["folder"], folder_to_table
        )
        page_info = PageInfo(
            id=entry["id"],
            title=entry["title"],
            parent_id=entry["parent_id"],
            is_database=entry["is_database"],
            metadata=entry["metadata"],
            last_modified=datetime.fromtimestamp(entry["mtime"]).isoformat(),
            size=entry["size"],
            folder=entry["folder"],
            path=entry.get("path"),
            resolved_table_id=resolved_table_id,
        )

        existing = pages_by_id.get(entry["id"])
        if existing is None:
            pages_by_id[entry["id"]] = page_info
        else:
            duplicate_ids.add(entry["id"])
            if page_info.last_modified > existing.last_modified:
                pages_by_id[entry["id"]] = page_info

    if duplicate_ids:
        log.warning(
            f"S'han deduplicat {len(duplicate_ids)} pàgines amb id repetit al Vault"
        )

    pages = list(pages_by_id.values())
    pages.sort(key=lambda x: x.last_modified, reverse=True)
    return pages


@router.get("/pages", response_model=List[PageInfo])
async def list_pages():
    """Llista totes les pàgines de l'arrel de forma plana iterant pels arxius UUID.md."""
    return _get_pages_snapshot()


@router.get("/pages/by-table/{table_id}", response_model=List[PageInfo])
async def list_pages_by_table(table_id: str, include_templates: bool = Query(True)):
    """Retorna només les pàgines d'una taula concreta per evitar carregar tot el Vault."""
    pages = _get_pages_snapshot()
    filtered = [p for p in pages if p.resolved_table_id == table_id]
    if not include_templates:
        filtered = [p for p in filtered if not p.metadata.get("is_template")]
    return filtered


@router.get("/pages/by-table/{table_id}/snapshot", response_model=TablePagesSnapshot)
async def list_pages_by_table_snapshot(table_id: str):
    """Retorna snapshot canònic per taula: brut + visible real.

    Aquesta ruta evita divergències entre sessions frontend i estableix
    una font única de veritat per al recompte de registres visibles.
    """
    pages = _get_pages_snapshot()
    raw_pages = [p for p in pages if p.resolved_table_id == table_id]
    visible_pages = _canonical_visible_table_pages(table_id, raw_pages)

    return TablePagesSnapshot(
        table_id=table_id,
        raw_count=len(raw_pages),
        visible_count=len(visible_pages),
        pages=visible_pages,
    )


@router.get("/sidebar/summary", response_model=List[SidebarPageInfo])
async def list_sidebar_summary():
    """Retorna un resum lleuger de pàgines per la sidebar."""
    pages = _get_pages_snapshot()
    return [
        SidebarPageInfo(
            id=p.id,
            title=p.title,
            parent_id=p.parent_id,
            is_database=p.is_database,
            metadata=p.metadata,
            last_modified=p.last_modified,
            folder=p.folder,
            resolved_table_id=p.resolved_table_id,
        )
        for p in pages
    ]


@router.post("/pages")
async def create_page(request: PageSaveRequest, background_tasks: BackgroundTasks):
    """Crea una pàgina nova amb un ID UUID."""
    page_id = str(uuid.uuid4())

    # Construir metadata inicial
    metadata = request.metadata.copy()
    metadata = normalize_metadata_ids(metadata)
    metadata = normalize_table_context(metadata)
    metadata["id"] = page_id
    metadata["title"] = request.title
    if request.parent_id:
        metadata["parent_id"] = request.parent_id
    if request.is_database:
        metadata["is_database"] = True

    # Aplicar automatitzacions i fòrmules també en creació (old_metadata buit)
    try:
        metadata = rule_engine.process_updates(page_id, {}, metadata)
    except Exception as e:
        log.error(f"Error processant automatitzacions en create per {page_id}: {e}")

    metadata = _persist_metadata_assets(metadata)

    is_template = metadata.get("is_template") is True

    # Determinar directori destí
    if is_template:
        target_dir = PLANTILLES_PATH
    elif is_calendar_entry(metadata):
        target_dir = CALENDAR_PATH
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        target_dir = table_folder if table_folder else WIKI_PATH

    target_dir.mkdir(parents=True, exist_ok=True)

    # Generar nom de fitxer des del títol (no UUID)
    safe_name = _safe_filename(request.title, target_dir)
    file_path = target_dir / f"{safe_name}.md"

    frontmatter = generate_frontmatter(metadata)
    full_content = f"{frontmatter}\n{request.content}"

    try:
        file_path.write_text(full_content, encoding="utf-8")
        background_tasks.add_task(
            trigger_n8n_webhook, file_path.name, "Universal", request.content
        )
        table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if table_id:
            background_tasks.add_task(
                _recompute_cross_record_formulas_for_table, table_id, page_id
            )
        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        return {
            "status": "created",
            "id": page_id,
            "title": request.title,
            "metadata": metadata,
            "content": request.content,
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
            "message": "Pàgina creada",
        }
    except Exception as e:
        log.error(f"Error creant la pàgina: {e}")
        raise HTTPException(
            status_code=500, detail="Error escrivint l'arxiu de la pàgina"
        )


def find_page_path(page_id: str) -> Optional[Path]:
    """Busca la ruta d'un fitxer .md per ID de forma recursiva."""
    # 1. Intent directe format UUID/ID (com abans)
    direct_path = VAULT_PATH / f"{page_id}.md"
    if direct_path.exists():
        return direct_path

    # 2. Cercar a l'arrel si el fitxer es diu directament id.md (ja cobert per rglob però útil)

    # 3. Cerca recursiva ràpida pel nom del fitxer (UUID.md)
    for p in VAULT_PATH.rglob(f"{page_id}.md"):
        return p

    # 4. Fallback: Cercar dins dels fitxers .md si el 'id' al frontmatter coincideix
    # Com que això és lent, només es fa si l'ID no coincideix amb cap nom de fitxer.
    # Podríem mantenir un índex en memòria si la performance és un problema.
    for p in VAULT_PATH.rglob("*.md"):
        try:
            # Només llegim els primers bytes per speed si és possible, però parse_frontmatter necessita context
            content = p.read_text(encoding="utf-8")
            metadata, _ = parse_frontmatter(content, p)
            if metadata.get("id") == page_id:
                return p
        except Exception:
            continue

    return None


@router.get("/pages/{page_id}")
async def get_page(page_id: str):
    """Retorna el contingut sencer d'una pàgina per ID."""
    file_path = find_page_path(page_id)

    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Pàgina no trobada (ID: {page_id})"
        )

    try:
        raw_content = file_path.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(raw_content, file_path)
        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        return {
            "id": str(metadata.get("id") or page_id),
            "title": metadata.get("title", ""),
            "metadata": metadata,
            "content": body.strip(),
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
        }
    except Exception as e:
        log.error(f"Error llegint la pàgina {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error llegint l'arxiu")


@router.put("/pages/{page_id}")
async def save_page(
    page_id: str, request: PageSaveRequest, background_tasks: BackgroundTasks
):
    """Guarda o actualitza una pàgina existint o readaptant el seu UUID."""
    file_path = find_page_path(page_id)

    metadata = request.metadata.copy()
    metadata = normalize_metadata_ids(metadata)
    metadata = normalize_table_context(metadata)
    metadata["id"] = page_id
    metadata["title"] = request.title
    if request.parent_id is not None:
        metadata["parent_id"] = request.parent_id

    if request.is_database:
        metadata["is_database"] = True

    is_template = metadata.get("is_template") is True
    if not file_path:
        # Si no existeix, la creem a la carpeta correcta segons metadata.
        if is_template:
            target_dir = PLANTILLES_PATH
        elif is_calendar_entry(metadata):
            target_dir = CALENDAR_PATH
        else:
            table_folder = _resolve_table_folder_from_metadata(metadata)
            target_dir = table_folder if table_folder else WIKI_PATH

        target_dir.mkdir(parents=True, exist_ok=True)
        safe_name = _safe_filename(request.title, target_dir)
        file_path = target_dir / f"{safe_name}.md"
    else:
        # Assegurar-nos que està a la carpeta correcta
        file_path = ensure_correct_page_location(file_path, metadata)

    # Llegir metadata anterior per detectar overrides manuals
    old_metadata = {}
    if file_path and file_path.exists():
        try:
            raw_content = file_path.read_text(encoding="utf-8")
            old_metadata, _ = parse_frontmatter(raw_content, file_path)
        except Exception:
            pass

    # Aplicar automatitzacions i fòrmules
    try:
        metadata = rule_engine.process_updates(page_id, old_metadata, metadata)
    except Exception as e:
        log.error(f"Error processant automatitzacions per {page_id}: {e}")

    metadata = _persist_metadata_assets(metadata)

    frontmatter = generate_frontmatter(metadata)
    # Evitar dobletes de salts inútils respectant body
    full_content = f"{frontmatter}\n{request.content.lstrip()}"

    try:
        if file_path and file_path.exists():
            _create_page_version(page_id, file_path)
            
        file_path.write_text(full_content, encoding="utf-8")
        background_tasks.add_task(
            trigger_n8n_webhook, file_path.name, "Universal", request.content
        )
        table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if table_id:
            background_tasks.add_task(
                _recompute_cross_record_formulas_for_table, table_id, page_id
            )
        sync_to_google_calendar_if_needed(metadata, background_tasks)
        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        return {
            "status": "success",
            "id": page_id,
            "title": metadata.get("title", request.title),
            "metadata": metadata,
            "content": request.content,
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
            "message": "Pàgina guardada correctament",
        }
    except Exception as e:
        log.error(f"Error guardant la pàgina {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error escrivint l'arxiu al disc")


@router.patch("/pages/{page_id}")
async def patch_page(
    page_id: str, request: PagePatchRequest, background_tasks: BackgroundTasks
):
    """Actualització parcial d'una pàgina (per exemple, només metadata)."""
    file_path = find_page_path(page_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Page not found")

    try:
        raw_content = file_path.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(raw_content, file_path)

        if request.title is not None:
            metadata["title"] = request.title
        if request.parent_id is not None:
            metadata["parent_id"] = request.parent_id
        if request.is_database is not None:
            metadata["is_database"] = request.is_database
        if request.metadata is not None:
            # Merge metadata
            metadata.update(request.metadata)

        content = request.content if request.content is not None else body

        # Normalitzar IDs legacy
        metadata = normalize_metadata_ids(metadata)
        metadata = normalize_table_context(metadata)

        # Moure si canvia de tipus (plantilla/no plantilla)
        file_path = ensure_correct_page_location(file_path, metadata)

        # Aplicar automatitzacions i fòrmules
        try:
            # Aquí 'metadata' ja té els canvis del request, el 'RuleEngine' compararà amb 'old_metadata' (del fitxer)
            raw_content = file_path.read_text(encoding="utf-8")
            original_metadata, _ = parse_frontmatter(raw_content, file_path)
            metadata = rule_engine.process_updates(page_id, original_metadata, metadata)
        except Exception as e:
            log.error(f"Error processant automatitzacions per {page_id}: {e}")

        metadata = _persist_metadata_assets(metadata)

        frontmatter = generate_frontmatter(metadata)
        full_content = f"{frontmatter}\n{content.lstrip()}"

        _create_page_version(page_id, file_path)
        file_path.write_text(full_content, encoding="utf-8")
        background_tasks.add_task(
            trigger_n8n_webhook, file_path.name, "Universal", content
        )
        table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if table_id:
            background_tasks.add_task(
                _recompute_cross_record_formulas_for_table, table_id, page_id
            )
        sync_to_google_calendar_if_needed(metadata, background_tasks)

        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        return {
            "status": "success",
            "id": page_id,
            "title": metadata.get("title", ""),
            "metadata": metadata,
            "content": content,
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
            "message": "Pàgina actualitzada parcialment",
        }
    except Exception as e:
        log.error(f"Error patxejant la pàgina {page_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/pages/{page_id}")
async def delete_page(page_id: str):
    """Elimina permanentment la pàgina .md (usar amb cura)."""
    file_path = find_page_path(page_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Page not found")

    try:
        registry = load_registry()

        # Esborrar fitxers d'assets associats al registre
        try:
            raw_content = file_path.read_text(encoding="utf-8")
            page_metadata, _ = parse_frontmatter(raw_content, file_path)
            table_id = page_metadata.get("table_id") or page_metadata.get(
                "database_table_id"
            )
            if table_id:
                table = next(
                    (
                        t
                        for t in registry.get("tables", [])
                        if str(t.get("id")) == str(table_id)
                    ),
                    None,
                )
                if table:
                    _delete_asset_files_for_page(page_metadata, table, registry)
        except Exception as asset_exc:
            log.warning(
                f"No s'han pogut esborrar els assets del registre {page_id}: {asset_exc}"
            )

        # IMPORTANT: No eliminar mai la taula del registry en esborrar una pàgina!
        # El registry conté l'esquema de la taula, no les seves files.
        # Les línies següents van ser eliminades perquè causaven errors en
        # esborrar l'últim registre d'una taula.
        # Original buggy code (removed):
        # registry["databases"] = [db for db in registry["databases"] if db.get("id") != page_id]
        # tables_to_remove = [t["id"] for t in registry["tables"] if t.get("database_id") == page_id]
        # registry["tables"] = [t for t in registry["tables"] if t.get("database_id") != page_id]
        # registry["views"] = [v for v in registry["views"] if v.get("table_id") not in tables_to_remove]

        file_path.unlink()
        return {"status": "success", "message": "Page deleted and registry cleaned"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-cover")
async def upload_cover(file: UploadFile = File(...)):
    """Puja una imatge a la carpeta Assets/Covers i retorna la URL."""
    covers_path = ASSETS_PATH / "Covers"
    covers_path.mkdir(parents=True, exist_ok=True)

    try:
        relative_path = _save_uploaded_file_to_assets(file, covers_path)
    except Exception as e:
        log.error(f"Error pujant imatge: {e}")
        raise HTTPException(status_code=500, detail="No s'ha pogut guardar la imatge")

    url = f"http://localhost:5002/api/vault/assets/{relative_path[len('Assets/') :]}"
    return {"url": url, "path": relative_path}


@router.post("/upload-property-file")
async def upload_property_file(
    table_id: str = Query(...),
    property_name: str = Query(...),
    file: UploadFile = File(...),
):
    """Puja un fitxer a Assets/[BD]/[Taula]/[Propietat] i retorna ruta relativa."""
    registry = load_registry()
    table, database = _resolve_table_and_database_for_assets(table_id, registry)
    if not table:
        raise HTTPException(status_code=404, detail="Taula no trobada")

    property_clean = str(property_name or "").strip()
    if not property_clean:
        raise HTTPException(status_code=400, detail="property_name és obligatori")

    target_dir = _property_assets_dir(table, database, property_clean)
    try:
        relative_path = _save_uploaded_file_to_assets(file, target_dir)
    except Exception as e:
        log.error(f"Error pujant fitxer de propietat: {e}")
        raise HTTPException(status_code=500, detail="No s'ha pogut guardar el fitxer")

    api_url = f"/api/vault/assets/{relative_path[len('Assets/') :]}"
    return {"path": relative_path, "url": api_url}


@router.get("/unsplash/search")
async def unsplash_search(query: str = Query(...), page: int = Query(1)):
    """Cerca imatges a Unsplash actuant com a proxy."""
    unsplash_key = os.getenv("UNSPLASH_ACCESS_KEY")
    if not unsplash_key:
        raise HTTPException(
            status_code=500,
            detail="L'API Key d'Unsplash no està configurada a .env (UNSPLASH_ACCESS_KEY)",
        )

    url = "https://api.unsplash.com/search/photos"
    headers = {"Authorization": f"Client-ID {unsplash_key}"}
    params = {"query": query, "page": page, "per_page": 21, "orientation": "landscape"}

    try:
        resp = requests.get(url, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()

        results = []
        for img in data.get("results", []):
            results.append(
                {
                    "id": img["id"],
                    "url": img["urls"]["regular"],
                    "thumb": img["urls"]["small"],
                    "author": img["user"]["name"],
                    "author_url": img["user"]["links"]["html"],
                }
            )

        return {"results": results, "total_pages": data.get("total_pages", 1)}
    except Exception as e:
        log.error(f"Error fetching from Unsplash: {e}")
        raise HTTPException(status_code=502, detail="Error fetching from Unsplash API")


@router.post("/pages/{page_id}/duplicate")
async def duplicate_page(page_id: str, background_tasks: BackgroundTasks):
    """Duplica una pàgina existent i retorna el nou ID."""
    source_path = find_page_path(page_id)

    if not source_path or not source_path.exists():
        raise HTTPException(
            status_code=404, detail="Pàgina font no trobada (ID inexistent)"
        )

    try:
        raw_content = source_path.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(raw_content, source_path)

        # Nou UUID i ajustos de metadata
        new_page_id = str(uuid.uuid4())
        new_metadata = metadata.copy()
        new_metadata["id"] = new_page_id

        # Afegim prefix "(Còpia)" al títol
        old_title = metadata.get("title", "Sense Títol")
        new_title = f"{old_title} (Còpia)"
        new_metadata["title"] = new_title

        frontmatter = generate_frontmatter(new_metadata)
        full_content = f"{frontmatter}\n{body.lstrip()}"

        # Les còpies es creen al mateix directori que l'original
        new_file_path = source_path.parent / f"{new_page_id}.md"
        new_file_path.write_text(full_content, encoding="utf-8")

        background_tasks.add_task(
            trigger_n8n_webhook, new_file_path.name, "Universal", body
        )

        return {
            "status": "created",
            "id": new_page_id,
            "message": "Pàgina duplicada",
            "title": new_title,
        }

    except Exception as e:
        log.error(f"Error duplicant la pàgina {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error duplicant l'arxiu")


def trigger_n8n_webhook(filename: str, folder: str, content: str):
    """Envia un POST a n8n de forma invisible quan una nota es desa o crea."""
    try:
        url = "http://n8n:5678/webhook/vault-update"
        payload = {
            "event": "note_saved",
            "folder": folder,
            "filename": filename,
            "content": content[:2000],  # Limitem el text per lleugeresa
        }
        requests.post(url, json=payload, timeout=2)
    except Exception as e:
        log.warning(f"No s'ha pogut notificar l'esdeveniment a n8n: {e}")


@router.get("/global-index")
async def get_global_index():
    """Retorna un mapeig global de id -> title per a tot el Vault."""
    index = {}

    if not VAULT_PATH.exists():
        return index

    for file_path in VAULT_PATH.rglob("*.md"):
        try:
            raw_content = file_path.read_text(encoding="utf-8")
            metadata, _ = parse_frontmatter(raw_content, file_path)
            page_id = metadata.get("id") or metadata.get("notion_id") or file_path.stem

            # Prioritzem title del frontmatter, després el nom del fitxer
            title = metadata.get("title") or file_path.stem
            index[page_id] = title
        except Exception as e:
            log.warning(f"Error indexant {file_path.name}: {e}")

    return index


@router.get("/backlinks")
async def get_backlinks(id: str):
    """Troba totes les notes que enllacen a un id específic (tant en metadata com en el body)."""
    backlinks = []

    if not VAULT_PATH.exists():
        return backlinks

    # Busquem per tot el Vault notes que referenciïn aquest ID
    for file_path in VAULT_PATH.rglob("*.md"):
        try:
            raw_content = file_path.read_text(encoding="utf-8")
            metadata, body = parse_frontmatter(raw_content, file_path)

            # No ens comptem a nosaltres mateixos com a backlink
            current_id = metadata.get("id", file_path.stem)
            if current_id == id:
                continue

            found = False
            # 1. Check Metadata
            for val in metadata.values():
                if val == id:
                    found = True
                    break
                if isinstance(val, list) and id in val:
                    found = True
                    break

            # 2. Check Body (WikiLinks and MD Links)
            if not found:
                # Obsidian style [[ID]] or [[ID|Alias]]
                # We relax the regex to match either ID or Title if it matches our id
                if re.search(r"\[\[([^\]|]*?)(?:\|.*?)?\]\]", body):
                    wiki_links = re.findall(r"\[\[([^\]|]*?)(?:\|.*?)?\]\]", body)
                    if id in wiki_links:
                        found = True

                # Standard MD links [text](ID)
                if not found and re.search(r"\[.*?\]\((.*?)\)", body):
                    md_links = re.findall(r"\[.*?\]\((.*?)\)", body)
                    if id in md_links:
                        found = True

            if found:
                backlinks.append(
                    {"id": current_id, "title": metadata.get("title") or file_path.stem}
                )
        except Exception as e:
            log.warning(f"Error processant backlinks per {file_path.name}: {e}")
            continue

    return backlinks


# --------------------------------------------------------------------------
# DATABASE REGISTRY ROUTES (4-Layer Architecture)
# --------------------------------------------------------------------------


def load_registry():
    """Llegeix el registre central i l'assegura. 
    Sanejament: Elimina taula_1 per defecte i normalitza les rutes a relatives.
    """
    if not REGISTRY_PATH.exists():
        return {"databases": [], "tables": [], "views": []}
    try:
        data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        
        changed = False
        tables = data.get("tables", [])
        
        # 1. Filtrar taula_1 si existia (feedback usuari)
        initial_count = len(tables)
        tables = [t for t in tables if t.get("id") != "taula_1"]
        if len(tables) < initial_count:
            data["tables"] = tables
            changed = True
            log.info("🗑️ Eliminada taula_1 per defecte del registre.")

        # 2. Sanejament i creació de carpetes
        for table in tables:
            # Assegurar propietat 'folder' i que sigui RELATIVA (neteja host paths)
            folder_raw = table.get("folder") or table.get("name", "untitled_table")
            folder_normalized = _normalize_rel_folder(folder_raw)
            
            if table.get("folder") != folder_normalized:
                table["folder"] = folder_normalized
                changed = True
                log.info(f"🧹 Normalitzada ruta de taula '{table.get('name')}': {folder_normalized}")
            
            # Assegurar carpeta física
            try:
                _ensure_table_vault_folder(table, data)
            except Exception as e:
                log.error(f"❌ Error assegurant carpeta per taula {table.get('name')}: {e}")
        
        if changed:
            save_registry(data)
            
        return data
    except Exception as e:
        log.error(f"❌ Error carregant registre: {e}")
        return {"databases": [], "tables": [], "views": []}


def save_registry(data):
    REGISTRY_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


ensure_default_registry_structure()


def _sort_key_name(item):
    """Clau d'ordenació que prioritza 'order' i després el nom (ignorant accents)."""
    order = item.get("order")
    # Si té order, el retornem com a primer element de la tupla per a l'ordenació
    if order is not None:
        try:
            order_val = int(order)
        except (ValueError, TypeError):
            order_val = 999999
    else:
        order_val = 999999

    name = (item.get("name") or "").lower()
    normalized_name = "".join(
        c for c in unicodedata.normalize("NFD", name) if unicodedata.category(c) != "Mn"
    )
    return (order_val, normalized_name)


def _safe_open_target(target: str) -> None:
    """Open URI/path with the system default app without shell interpolation."""
    if sys.platform == "darwin":
        subprocess.Popen(["open", target])
        return
    if os.name == "nt":
        os.startfile(target)  # type: ignore[attr-defined]
        return
    subprocess.Popen(["xdg-open", target])


def _extract_attachment_paths(attachments: object) -> List[str]:
    """Extract candidate file paths from heterogeneous attachment values."""
    if attachments is None:
        return []

    raw_values: List[str] = []
    if isinstance(attachments, list):
        raw_values = [str(v).strip() for v in attachments if str(v).strip()]
    elif isinstance(attachments, str):
        text = attachments.strip()
        if not text:
            return []
        parts = re.split(r"[\n;,]", text)
        raw_values = [p.strip() for p in parts if p.strip()]

    candidates: List[str] = []
    for item in raw_values:
        match = re.search(r"\(([^)]+)\)", item)
        if match:
            item = match.group(1).strip()

        if item.startswith("file://"):
            item = urllib.parse.unquote(item[7:])

        expanded = str(Path(item).expanduser())
        candidates.append(expanded)

    return candidates


def _pick_existing_path(
    file_path: Optional[str], attachments: Optional[object]
) -> Optional[str]:
    candidates: List[str] = []

    if isinstance(file_path, str) and file_path.strip():
        candidates.append(str(Path(file_path.strip()).expanduser()))

    candidates.extend(_extract_attachment_paths(attachments))

    for candidate in candidates:
        try:
            path = Path(candidate)
            if path.exists() and path.is_file():
                return str(path)
        except Exception:
            continue

    return None


@router.get("/registry")
async def get_registry():
    """Retorna el registre complet de bases de dades, taules i vistes (ordenat alfabèticament)."""
    try:
        registry = load_registry()
        registry["databases"] = sorted(
            registry.get("databases", []), key=_sort_key_name
        )
        registry["tables"] = sorted(registry.get("tables", []), key=_sort_key_name)
        registry["views"] = sorted(registry.get("views", []), key=_sort_key_name)
        return registry
    except Exception as e:
        logging.exception(f"ERROR a get_registry: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/registry")
async def update_registry(data: dict = Body(...)):
    """Actualitza el registre complet (usar amb cura)."""
    save_registry(data)
    return {"status": "success"}


@router.post("/open-resource")
async def open_resource(payload: OpenResourceRequest):
    """Open a Zotero URI or local attachment path with the OS default handler."""
    zotero_uri = (payload.zotero_uri or "").strip()

    if zotero_uri:
        if not zotero_uri.startswith("zotero://"):
            raise HTTPException(status_code=400, detail="Invalid Zotero URI")
        try:
            _safe_open_target(zotero_uri)
            return {"status": "ok", "opened_with": "zotero_uri", "target": zotero_uri}
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"No s'ha pogut obrir l'URI de Zotero: {e}"
            )

    existing_path = _pick_existing_path(payload.file_path, payload.attachments)
    if not existing_path:
        raise HTTPException(
            status_code=404, detail="No s'ha trobat cap adjunt local vàlid"
        )

    try:
        _safe_open_target(existing_path)
        return {"status": "ok", "opened_with": "file_path", "target": existing_path}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"No s'ha pogut obrir el fitxer local: {e}"
        )


@router.get("/databases")
async def list_databases():
    registry = load_registry()
    databases = registry.get("databases", [])
    return sorted(databases, key=_sort_key_name)


@router.post("/databases")
async def create_database(db: dict = Body(...)):
    registry = load_registry()
    if "id" not in db:
        db["id"] = str(uuid.uuid4())

    # Upsert
    existing_idx = next(
        (i for i, d in enumerate(registry["databases"]) if d["id"] == db["id"]), None
    )
    if existing_idx is not None:
        registry["databases"][existing_idx] = db
    else:
        registry["databases"].append(db)

    save_registry(registry)
    return db


@router.delete("/databases/{database_id}")
async def delete_database(database_id: str):
    registry = load_registry()
    registry["databases"] = [
        db for db in registry["databases"] if db.get("id") != database_id
    ]
    # Netejar tables i views associades
    tables_to_remove = [
        t["id"] for t in registry["tables"] if t.get("database_id") == database_id
    ]
    registry["tables"] = [
        t for t in registry["tables"] if t.get("database_id") != database_id
    ]
    registry["views"] = [
        v for v in registry["views"] if v.get("table_id") not in tables_to_remove
    ]
    save_registry(registry)
    return {"status": "success"}


@router.get("/tables")
async def list_tables(database_id: Optional[str] = None):
    registry = load_registry()
    tables = registry.get("tables", [])
    if database_id:
        tables = [t for t in tables if t.get("database_id") == database_id]
    return sorted(tables, key=_sort_key_name)


@router.post("/tables")
async def create_table(table: dict = Body(...)):
    registry = load_registry()
    if "id" not in table:
        table["id"] = str(uuid.uuid4())
    
    # Assegurar i normalitzar la propietat folder
    folder_raw = table.get("folder") or table.get("name", "untitled_table")
    table["folder"] = _normalize_rel_folder(folder_raw)

    # Si ja existeix, l'actualitzem (upsert)
    existing_idx = next(
        (i for i, t in enumerate(registry["tables"]) if t["id"] == table["id"]), None
    )
    if existing_idx is not None:
        old_table = registry["tables"][existing_idx]
        # Detectar propietats eliminades per esborrar les seves carpetes d'assets
        old_asset_props = {
            str(p.get("name") or "").strip()
            for p in (old_table.get("properties") or [])
            if _is_asset_property(p) and str(p.get("name") or "").strip()
        }
        new_asset_props = {
            str(p.get("name") or "").strip()
            for p in (table.get("properties") or [])
            if _is_asset_property(p) and str(p.get("name") or "").strip()
        }
        removed_props = old_asset_props - new_asset_props
        if removed_props:
            db_entry = next(
                (
                    d
                    for d in registry.get("databases", [])
                    if str(d.get("id")) == str(old_table.get("database_id"))
                ),
                None,
            )
            for prop_name in removed_props:
                _delete_asset_property_dir(old_table, db_entry, prop_name)
        registry["tables"][existing_idx] = table
    else:
        registry["tables"].append(table)

    _ensure_asset_dirs_for_table_entry(table, registry)
    _ensure_table_vault_folder(table)

    save_registry(registry)
    return table


@router.delete("/tables/{table_id}")
async def delete_table(table_id: str):
    registry = load_registry()
    # Obtenir informació de la taula ABANS d'esborrar-la del registre
    table_entry = next((t for t in registry["tables"] if t.get("id") == table_id), None)
    if table_entry:
        db_entry = next(
            (
                d
                for d in registry.get("databases", [])
                if str(d.get("id")) == str(table_entry.get("database_id"))
            ),
            None,
        )
        _delete_asset_table_dir(table_entry, db_entry)
    registry["tables"] = [t for t in registry["tables"] if t.get("id") != table_id]
    # Netejar views associades
    registry["views"] = [v for v in registry["views"] if v.get("table_id") != table_id]
    save_registry(registry)
    return {"status": "success"}


@router.put("/tables/{table_id}")
async def rename_table(table_id: str, data: dict = Body(...)):
    registry = load_registry()
    for t in registry["tables"]:
        if t["id"] == table_id:
            if "name" in data:
                t["name"] = data["name"]
                if not t.get("folder"):
                    t["folder"] = data["name"]
            if "folder" in data:
                t["folder"] = data["folder"]
            _ensure_asset_dirs_for_table_entry(t, registry)
            _ensure_table_vault_folder(t)
            break
    save_registry(registry)
    return {"status": "success"}


@router.get("/views")
async def list_views(table_id: Optional[str] = None):
    registry = load_registry()
    views = registry.get("views", [])
    if table_id:
        views = [v for v in views if v.get("table_id") == table_id]

    # ensure new configuration fields have sensible defaults so frontend
    # can render older views without modifications
    for v in views:
        # cardSize is only meaningful for gallery views; default to 'medium'
        if v.get("cardSize") is None:
            v["cardSize"] = "medium"
        # galleryPreview can be 'cover','properties' or 'content'
        if v.get("galleryPreview") is None:
            v["galleryPreview"] = "cover"
        # visibleProperties may be missing; frontend treats undefined as show-all
    return sorted(views, key=_sort_key_name)


@router.post("/views")
async def create_view(view: dict = Body(...)):
    registry = load_registry()
    if "id" not in view:
        view["id"] = str(uuid.uuid4())

    existing_idx = next(
        (i for i, v in enumerate(registry["views"]) if v["id"] == view["id"]), None
    )
    if existing_idx is not None:
        registry["views"][existing_idx] = view
    else:
        registry["views"].append(view)

    save_registry(registry)
    return view


@router.delete("/views/{view_id}")
async def delete_view(view_id: str):
    registry = load_registry()
    registry["views"] = [v for v in registry["views"] if v.get("id") != view_id]
    save_registry(registry)
    return {"status": "success"}


@router.put("/views/{view_id}")
async def update_view(view_id: str, data: dict = Body(...)):
    registry = load_registry()
    found = False
    for v in registry["views"]:
        if v["id"] == view_id:
            # Actualitzar tots els camps enviats
            for key, value in data.items():
                v[key] = value
            found = True
            break

    if not found:
        # Si no existeix i tenim prou dades, podríem crear-la,
        # però el comportament esperat de PUT és actualitzar.
        # Tot i això, per robustesa amb el frontend, si ens passen l'objecte sencer:
        if "id" in data and data["id"] == view_id:
            registry["views"].append(data)
        else:
            raise HTTPException(status_code=404, detail="Vista no trobada")

    save_registry(registry)
    return {"status": "success"}


# Ruta per retrocompatibilitat amb el frontend existent (SchemaConfigModal)
@router.post("/schema")
async def save_schema(folder: str, schema: dict = Body(...)):
    """
    Ruta legacy per guardar esquemes per carpeta.
    Ara ho redirigim a la creació d'una taula si cal, o ho guardem com a fitxer local.
    """
    schema_path = VAULT_PATH / folder / "schema.json"
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    schema_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    return {"status": "success"}


@router.get("/schema")
async def get_schema(folder: str):
    schema_path = VAULT_PATH / folder / "schema.json"
    if not schema_path.exists():
        return {}
    return json.loads(schema_path.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# EXCALIDRAW DRAWINGS ROUTES
# --------------------------------------------------------------------------


@router.get("/drawings")
async def list_drawings():
    """Llista tots els dibuixos al vault (tldraw i excalidraw)."""
    DIBUIXOS_PATH.mkdir(parents=True, exist_ok=True)
    drawings = []
    seen_ids = set()

    # Primer buscar fitxers .tldraw.json (format nou)
    for file_path in DIBUIXOS_PATH.glob("*.tldraw.json"):
        drawing_id = file_path.stem.replace(".tldraw", "")
        seen_ids.add(drawing_id)
        stat = file_path.stat()
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            # El format nou té { title, data, metadata }
            title = data.get("title", drawing_id)
            drawings.append(
                {
                    "id": drawing_id,
                    "title": title,
                    "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "size": stat.st_size,
                }
            )
        except Exception as e:
            log.warning(f"Error llegint dibuix {file_path.name}: {e}")

    # Després buscar fitxers .excalidraw.json (format antic)
    for file_path in DIBUIXOS_PATH.glob("*.excalidraw.json"):
        drawing_id = file_path.stem.replace(".excalidraw", "")
        if drawing_id in seen_ids:
            continue  # Ja tenim el format nou
        stat = file_path.stat()
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            drawings.append(
                {
                    "id": drawing_id,
                    "title": data.get("metadata", {}).get("title", drawing_id),
                    "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "size": stat.st_size,
                }
            )
        except Exception as e:
            log.warning(f"Error llegint dibuix {file_path.name}: {e}")

    return drawings


@router.get("/drawings/{drawing_id}")
async def get_drawing(drawing_id: str):
    """Retorna les dades d'un dibuix de Tldraw."""
    # Buscar primer en format nou (.tldraw.json)
    file_path = DIBUIXOS_PATH / f"{drawing_id}.tldraw.json"
    if not file_path.exists():
        # Fallback al format antic (.excalidraw.json)
        file_path = DIBUIXOS_PATH / f"{drawing_id}.excalidraw.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Dibuix no trobat")

    try:
        file_data = json.loads(file_path.read_text(encoding="utf-8"))
        # El format nou té { title, data, metadata } - retornem el data
        if "data" in file_data:
            return file_data["data"]
        # Format antic - retornem tal qual
        return file_data
    except Exception as e:
        log.error(f"Error llegint dibuix {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error llegint l'arxiu")


@router.put("/drawings/{drawing_id}")
async def save_drawing(drawing_id: str, request: DrawingSaveRequest):
    """Guarda o actualitza un dibuix de Tldraw."""
    DIBUIXOS_PATH.mkdir(parents=True, exist_ok=True)
    file_path = DIBUIXOS_PATH / f"{drawing_id}.tldraw.json"

    # Guardem el títol i les dades junts
    payload = {
        "title": request.title,
        "data": request.data,
        "metadata": request.metadata or {},
    }

    try:
        file_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return {"status": "success", "id": drawing_id}
    except Exception as e:
        log.error(f"Error guardant dibuix {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error escrivint l'arxiu")


@router.delete("/drawings/{drawing_id}")
async def delete_drawing(drawing_id: str):
    """Elimina un dibuix."""
    file_path = DIBUIXOS_PATH / f"{drawing_id}.tldraw.json"
    if not file_path.exists():
        file_path = DIBUIXOS_PATH / f"{drawing_id}.excalidraw.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Dibuix no trobat")

    file_path.unlink()
    return {"status": "success"}


def _create_page_version(page_id: str, file_path: Path):
    """Guarda una versió del fitxer actual a .history/{page_id}/{timestamp}.md si ha passat el cooldown."""
    if not file_path or not file_path.exists():
        return

    history_base = VAULT_PATH / ".history" / page_id
    history_base.mkdir(parents=True, exist_ok=True)

    # Cooldown de 10 minuts (600 segons) per evitar saturar amb auto-saves
    COOLDOWN = 600
    
    # Comprovar l'última versió guardada per respectar el cooldown
    versions = sorted(history_base.glob("*.md"))
    if versions:
        last_version = versions[-1]
        try:
            if time.time() - last_version.stat().st_mtime < COOLDOWN:
                return
        except Exception:
            pass

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    version_path = history_base / f"{timestamp}.md"
    try:
        shutil.copy2(file_path, version_path)
        log.info(f"Versió de pàgina creada: {version_path}")
    except Exception as e:
        log.warning(f"No s'ha pogut crear la versió de {page_id}: {e}")


@router.get("/pages/{page_id}/history")
async def get_page_history(page_id: str):
    """Retorna la llista de versions disponibles per a una pàgina."""
    history_base = VAULT_PATH / ".history" / page_id
    if not history_base.exists():
        return []
    
    versions = []
    # Glob retorna fitxers, els ordenem descendentment pel nom (que és el timestamp)
    for f in sorted(history_base.glob("*.md"), key=lambda x: x.name, reverse=True):
        ts_str = f.stem
        try:
            # Intentar formatar el timestamp per fer-lo llegible
            dt = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
            readable_ts = dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            readable_ts = ts_str
            
        versions.append({
            "id": ts_str,
            "timestamp": readable_ts,
            "size": f.stat().st_size
        })
    return versions


@router.get("/pages/{page_id}/history/{timestamp}")
async def get_page_version_content(page_id: str, timestamp: str):
    """Retorna el contingut d'una versió específica."""
    version_path = VAULT_PATH / ".history" / page_id / f"{timestamp}.md"
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Versió no trobada")
    
    try:
        raw_content = version_path.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(raw_content, version_path)
        return {
            "id": page_id,
            "version_id": timestamp,
            "metadata": metadata,
            "content": body.strip()
        }
    except Exception as e:
        log.error(f"Error llegint versió {timestamp} de {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error llegint la versió")


@router.post("/pages/{page_id}/history/restore/{timestamp}")
async def restore_page_version(page_id: str, timestamp: str, background_tasks: BackgroundTasks):
    """Restaura una pàgina a una versió anterior."""
    version_path = VAULT_PATH / ".history" / page_id / f"{timestamp}.md"
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Versió no trobada")
    
    file_path = find_page_path(page_id)
    if not file_path:
         raise HTTPException(status_code=404, detail="Pàgina actual no trobada")

    # Guardar la versió actual (estat just abans de la restauració) per si de cas
    _create_page_version(page_id, file_path)
    
    try:
        shutil.copy2(version_path, file_path)
        log.info(f"Pàgina {page_id} restaurada a la versió {timestamp}")
        
        # Opcionalment recalcular fòrmules si la pàgina pertany a una taula
        raw_content = file_path.read_text(encoding="utf-8")
        metadata, _ = parse_frontmatter(raw_content, file_path)
        table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if table_id:
            background_tasks.add_task(_recompute_cross_record_formulas_for_table, table_id, page_id)
            
        return {"status": "success", "message": "Pàgina restaurada correctament"}
    except Exception as e:
        log.error(f"Error restaurant versió {timestamp} de {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error restaurant la versió")


@router.delete("/pages/{page_id}/history")
async def purge_page_history(page_id: str):
    """Elimina tot l'històric de versions d'una pàgina."""
    history_base = VAULT_PATH / ".history" / page_id
    if not history_base.exists():
        return {"status": "success", "message": "No hi ha historial per eliminar"}
    
    try:
        shutil.rmtree(history_base)
        log.info(f"Historial de la pàgina {page_id} purgat")
        return {"status": "success", "message": "Historial eliminat correctament"}
    except Exception as e:
        log.error(f"Error purgant historial de {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error eliminant l'historial")
