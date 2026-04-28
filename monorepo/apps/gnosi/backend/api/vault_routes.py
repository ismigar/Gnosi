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
    Depends,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
import urllib.parse
import mimetypes
import base64
import hashlib
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
try:
    from PIL import Image
except Exception:
    Image = None
from backend.config.app_config import load_params
from backend.services.rule_engine import RuleEngine
log = logging.getLogger(__name__)

from backend.services.path_resolver import path_resolver

from backend.services.workspace_service import get_workspace_context, require_role
router = APIRouter(dependencies=[Depends(get_workspace_context)])

from backend.services.context_vars import get_active_vault_path
from backend.services.workspace_service import get_workspace_context, WorkspaceContext
from backend.services.media_service import media_service

# Helper function to get active paths
def get_p(key: str) -> Path:
    from backend.services.context_vars import get_active_vault_path
    base = get_active_vault_path()

    # Mapping of standard sub-folders
    mapping = {
        "VAULT": base,
        "ASSETS": base / "Assets",
        "BIBLIOTECA": base.parent / "Biblioteca",
        "DATABASES": base / "BD",
        # The REGISTRY is now a file inside BD
        "REGISTRY": base / "BD" / "vault_db_registry.json",
        "CALENDAR": base / "Calendar",
        "MAIL": base / "Mail",
        "PLANTILLES": base / "Templates",
        "DIBUIXOS": base / "Drawings",
        "WIKI": base / "Wiki",
        "DASHWORKS": base / ".Dashworks",
        "NEWSLETTERS": base / "Newsletters",
        "DATA": base / "data",
        "CUSTOM_ICONS": base / "data" / "vault_custom_icons.json"
    }
    return mapping.get(key, base / key.lower())

def __getattr__(name: str):
    path_keys = {
        "VAULT_PATH": "VAULT",
        "ASSETS_PATH": "ASSETS",
        "BD_PATH": "DATABASES",
        "REGISTRY_PATH": "REGISTRY",
        "CALENDAR_PATH": "CALENDAR",
        "MAIL_PATH": "MAIL",
        "PLANTILLES_PATH": "PLANTILLES",
        "DIBUIXOS_PATH": "DIBUIXOS",
        "WIKI_PATH": "WIKI",
        "DASHWORKS_PATH": "DASHWORKS",
        "NEWSLETTERS_PATH": "NEWSLETTERS",
        "DATA_PATH": "DATA"
    }
    if name in path_keys:
        return get_p(path_keys[name])
    raise AttributeError(f"module {__name__} has no attribute {name}")


def _clear_page_index_cache():
    """Clears the internal page index cache to force a re-scan."""
    with _page_index_lock:
        _page_index_entries.clear()
        log.info("♻️ Page index cache cleared.")


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


# Base folders and files are now created during workspace activation (WorkspaceService)
# or initialized on demand in each route via get_p().


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
        ""  # relative folder path inside the vault (e.g. "Databases/Gnosi/Resources")
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


class CustomIconsRequest(BaseModel):
    icons: List[str] = []


class IconUrlImportRequest(BaseModel):
    url: str


class LinkMentionsRequest(BaseModel):
    target_id: str
    source_id: Optional[str] = None


def _normalize_custom_icons(values: Any, limit: int = 100) -> List[str]:
    if not isinstance(values, list):
        return []

    seen = set()
    normalized: List[str] = []

    for raw in values:
        if not isinstance(raw, str):
            continue
        icon = raw.strip()
        if not icon or len(icon) > 2048:
            continue
        if icon in seen:
            continue

        seen.add(icon)
        normalized.append(icon)

        if len(normalized) >= limit:
            break

    return normalized


# RuleEngine becomes a dictionary to store an instance for each vault_path (cache)
_rule_engines = {}
_rule_engine_lock = threading.Lock()

def get_rule_engine():
    from backend.services.context_vars import get_active_vault_path
    from backend.services.rule_engine import RuleEngine
    v_path = get_active_vault_path()
    v_str = str(v_path)
    
    with _rule_engine_lock:
        if v_str not in _rule_engines:
            log.info(f"Initializing RuleEngine for vault: {v_str}")
            _rule_engines[v_str] = RuleEngine(v_path)
        return _rule_engines[v_str]

# Instead of a global constant, we use a function
def get_custom_icons_path():
    return get_p("DATA") / "vault_custom_icons.json"

_table_recalc_lock = threading.Lock()
_table_recalc_state = {}
_TABLE_RECALC_COOLDOWN_SECONDS = 0.5
_page_index_lock = threading.Lock()
# Page index also partitioned per vault
_page_index_entries: Dict[str, Dict[str, Dict[str, Any]]] = {}
_page_index_initialized: Dict[str, bool] = {}
_page_id_to_path: Dict[str, Dict[str, str]] = {} # Cache for fast ID -> Path lookups per vault
_VAULT_SYNC_COOLDOWN_SECONDS = 60
_last_vault_sync_time = 0.0

# Google Calendar sync cooldown (5 minutes)
_GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS = 300
_last_google_calendar_sync_time = 0.0

def get_page_index_cache_path():
    return get_p("DATA") / "vault_page_index.json"

def _save_page_index_to_disk(v_str: str):
    """Persists the in-memory cache for a specific vault to disk."""
    try:
        cache_path = get_page_index_cache_path()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        data = _page_index_entries.get(v_str, {})
        if data:
            cache_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            log.info(f"💾 Page index cache saved to disk for {v_str}")
    except Exception as e:
        log.error(f"❌ Error saving page index cache for {v_str}: {e}")

def _load_page_index_from_disk(v_str: str):
    """Loads the persistent cache for a specific vault into memory."""
    try:
        cache_path = get_page_index_cache_path()
        if cache_path.exists():
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            with _page_index_lock:
                _page_index_entries[v_str] = data
                _page_index_initialized[v_str] = True
            log.info(f"📂 Page index cache loaded from disk for {v_str} ({len(data)} entries)")
            return True
    except Exception as e:
        log.error(f"❌ Error loading page index cache for {v_str}: {e}")
    return False

_custom_icons_lock = threading.Lock()

def _load_custom_icons() -> List[str]:
    with _custom_icons_lock:
        try:
            path = get_custom_icons_path()
            if not path.exists():
                return []

            raw = json.loads(path.read_text(encoding="utf-8"))
            return _normalize_custom_icons(raw, limit=100)
        except Exception:
            return []


def _save_custom_icons(values: List[str]) -> List[str]:
    normalized = _normalize_custom_icons(values, limit=100)

    with _custom_icons_lock:
        try:
            path = get_custom_icons_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(normalized, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Could not save custom icons: {exc}",
            )

    return normalized


def _is_image_upload(file: UploadFile) -> bool:
    content_type = str(file.content_type or "").strip().lower()
    if content_type.startswith("image/"):
        return True

    guessed_type, _ = mimetypes.guess_type(file.filename or "")
    return bool(guessed_type and guessed_type.startswith("image/"))


def _upload_image_to_assets_subdir(file: UploadFile, subdir: str) -> Dict[str, str]:
    if not _is_image_upload(file):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    target_path = get_p("ASSETS") / subdir
    target_path.mkdir(parents=True, exist_ok=True)

    try:
        relative_path = _save_uploaded_file_to_assets(file, target_path)
    except Exception as e:
        log.error(f"Error uploading image to {subdir}: {e}")
        raise HTTPException(status_code=500, detail="Could not save image")

    url = f"/api/vault/assets/{relative_path[len('Assets/') :]}"
    return {"url": url, "path": relative_path}


def _normalize_icon_extension(filename: str, content_type: str) -> str:
    ext = (Path(filename or "").suffix or "").strip().lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"}:
        return ".jpg" if ext == ".jpeg" else ext

    ctype = str(content_type or "").split(";")[0].strip().lower()
    mapped = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
    }.get(ctype)
    return mapped or ".png"


def _store_icon_bytes(
    payload: bytes, source_name: str, content_type: str
) -> Dict[str, Optional[str]]:
    if not payload:
        raise HTTPException(status_code=400, detail="Empty icon payload")

    icons_dir = get_p("ASSETS") / "Icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(payload).hexdigest()[:12]
    ext = _normalize_icon_extension(source_name, content_type)
    filename = f"icon-{digest}{ext}"
    icon_path = icons_dir / filename

    if not icon_path.exists():
        icon_path.write_bytes(payload)

    # Thumbnail generation moved to background task in the route
    
    icon_rel = str(icon_path.relative_to(get_p("VAULT"))).replace("\\", "/")

    response = {
        "url": f"/api/vault/assets/{icon_rel[len('Assets/') :]}",
        "path": icon_rel,
        "thumbnail_url": None,
        "thumbnail_path": None,
    }

    if thumbnail_rel:
        response["thumbnail_path"] = thumbnail_rel
        response["thumbnail_url"] = (
            f"/api/vault/assets/{thumbnail_rel[len('Assets/') :]}"
        )

    return response


def _maybe_create_icon_thumbnail(icon_path: Path, digest: str) -> Optional[str]:
    if Image is None:
        return None

    # Raster-only thumbnails; skip vectors such as SVG.
    if icon_path.suffix.lower() == ".svg":
        return None

    try:
        with Image.open(icon_path) as img:
            width, height = img.size
            if max(width, height) <= 256:
                return None

            side = min(width, height)
            left = (width - side) // 2
            top = (height - side) // 2
            cropped = img.crop((left, top, left + side, top + side))
            thumb = cropped.resize((128, 128), Image.LANCZOS)

            thumbs_dir = get_p("ASSETS") / "Icons" / "Thumbnails"
            thumbs_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumbs_dir / f"icon-{digest}-thumb.png"

            thumb.save(thumb_path, format="PNG")
            return str(thumb_path.relative_to(get_p("VAULT"))).replace("\\", "/")
    except Exception:
        return None


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

    tipus = str(metadata.get("Type") or metadata.get("Tipus") or "").strip().lower()
    title = str(page.title or "").strip().lower()
    gnosi_id = str(metadata.get("id") or page.id or "").strip()

    if tipus == "annotation":
        return False

    if title in {"new", "untitled", "sense títol", "sense titol"}:
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
    """Decides if a page should be saved as a calendar appointment."""
    if not metadata:
        return False

    source = (metadata.get("source") or "").strip().lower()
    has_date = bool(metadata.get("date"))
    has_table = bool(metadata.get("database_table_id") or metadata.get("table_id"))

    # An appointment must always have a date. With date: it's an appointment if it comes from Gnosi
    # (internal calendar) or if it doesn't belong to any DB table.
    return has_date and (source in {"gnosi", "gnosi vault"} or not has_table)


def init_vault():
    """Initializes the basic environment."""
    if not get_p("VAULT"):
        log.info("⚠️ Bunker in 'pending' mode: Starting without structural Vault path.")
        return
        
    paths_to_create = [
        get_p("VAULT"), get_p("ASSETS"), get_p("CALENDAR"), get_p("DIBUIXOS"), get_p("DATABASES"), 
        get_p("DEFAULT_DB"), get_p("DEFAULT_TABLE"), get_p("NEWSLETTERS"), get_p("WIKI"), get_p("DASHWORKS")
    ]
    
    for p in paths_to_create:
        if p:
            try:
                p.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                log.error(f"Error initializing structural directory {p}: {e}")


def ensure_default_registry_structure():
    """Ensures the existence of the default DB and an initial table."""
    registry = load_registry()
    if "databases" not in registry or not isinstance(registry["databases"], list):
        registry["databases"] = []
    if "tables" not in registry or not isinstance(registry["tables"], list):
        registry["tables"] = []
    if "views" not in registry or not isinstance(registry["views"], list):
        registry["views"] = []

    changed = False

    db = next(
        (d for d in registry["databases"] if d.get("id") == "gnosi_vault_db"), None
    )
    if db is None:
        db = {
            "id": "gnosi_vault_db",
            "name": "Gnosi Vault",
            "folder": "Databases/Gnosi",
        }
        registry["databases"].append(db)
        changed = True
    else:
        if db.get("name") != "Gnosi Vault":
            db["name"] = "Gnosi Vault"
            changed = True
        if db.get("folder") != "Databases/Gnosi":
            db["folder"] = "Databases/Gnosi"
            changed = True

    default_table = next(
        (t for t in registry["tables"] if t.get("id") == "table_1"), None
    )
    if default_table is None:
        has_any_table_for_default_db = any(
            t.get("database_id") == "digital_brain_db" for t in registry["tables"]
        )
        # Disabled to avoid unnecessary noise in the Vault per user feedback
        pass

    if changed:
        save_registry(registry)


# init_vault() # Disabled: Now initialized dynamically per workspace via WorkspaceService


def parse_frontmatter(content: str, file_path: Optional[Path] = None):
    """Parses a markdown file to extract the YAML frontmatter and body.

    If the YAML is malformed we log an error and return empty metadata.
    ``file_path`` is used only for logging context.
    """
    # Regex to capture frontmatter between --- and --- at the start of the file
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
                    f"Malformed YAML frontmatter{location}; applying rescue parsing"
                )
                return fallback_metadata, body
            location = f" in {file_path}" if file_path else ""
            # malformed YAML is annoying but not fatal; debug instead of error
            log.debug(f"Error parsing YAML frontmatter{location}: {e}")
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
    Normalizes identification fields in frontmatter.
    Policy: the canonical field is 'id'. If legacy identifier keys exist,
    they are renamed to 'id' and deleted. If 'id' already exists, it's preserved.
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
    """Keeps table context fields synchronized (canonical + legacy)."""
    table_id = metadata.get("table_id")
    database_table_id = metadata.get("database_table_id")

    # Legacy compatibility: wiki pages must not behave as DB rows.
    if str(table_id or "").strip().lower() == "wiki":
        metadata.pop("table_id", None)
        table_id = None
    if str(database_table_id or "").strip().lower() == "wiki":
        metadata.pop("database_table_id", None)
        database_table_id = None

    if table_id and not database_table_id:
        metadata["database_table_id"] = table_id
    elif database_table_id and not table_id:
        metadata["table_id"] = database_table_id

    return metadata


def ensure_correct_page_location(file_path: Path, metadata: dict) -> Path:
    """Moves notes between Wiki/Templates/Calendar/BD based on metadata."""
    is_template = metadata.get("is_template") is True
    is_calendar = is_calendar_entry(metadata)
    is_dashworks = metadata.get("is_dashworks") is True

    if is_template:
        target_dir = get_p("PLANTILLES")
    elif is_calendar:
        target_dir = get_p("CALENDAR")
    elif is_dashworks:
        target_dir = get_p("DASHWORKS")
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        if table_folder:
            target_dir = table_folder
        else:
            target_dir = get_p("WIKI")

    target_dir.mkdir(parents=True, exist_ok=True)

    # We don't move notes that are already in user subfolders, except Templates/Calendar.
    can_relocate = (
        file_path.parent == get_p("VAULT")
        or file_path.parent == get_p("PLANTILLES")
        or file_path.parent == get_p("CALENDAR")
        or file_path.parent == get_p("WIKI")
        or file_path.parent == get_p("DASHWORKS")
    )

    if can_relocate and file_path.parent != target_dir:
        new_path = target_dir / file_path.name
        if file_path.exists() and file_path.is_file():
            file_path.rename(new_path)
        return new_path

    return file_path


def _process_metadata_paths(metadata: dict):
    """
    Transforms relative paths starting with Assets/
    into paths accessible via API /api/vault/assets/.
    """
    if not metadata:
        return metadata

    for key in ["cover", "icon"]:
        val = metadata.get(key)
        if isinstance(val, str) and val.startswith("Assets/"):
            # Replace Assets/ with the API path
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


def _sanitize_filename_base(title: str) -> str:
    """Sanitize a title into a filesystem-safe filename base (without extension)."""
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(title or "")).strip()
    safe = re.sub(r"\s+", " ", safe)
    if not safe:
        safe = "Untitled"
    if len(safe) > 200:
        safe = safe[:200].strip()
    return safe


def _resolve_unique_filename(
    target_dir: Path,
    base_name: str,
    exclude_path: Optional[Path] = None,
    extension: str = ".md",
) -> str:
    """Returns a unique filename base in target_dir, optionally ignoring exclude_path."""
    candidate = base_name
    counter = 2

    while True:
        candidate_path = target_dir / f"{candidate}{extension}"
        if not candidate_path.exists():
            return candidate

        if exclude_path is not None:
            try:
                if candidate_path.resolve() == exclude_path.resolve():
                    return candidate
            except Exception:
                if candidate_path == exclude_path:
                    return candidate

        candidate = f"{base_name} ({counter})"
        counter += 1


def _rename_page_file_to_match_title(file_path: Path, title: str) -> Path:
    """Renames page file so the filename matches title while preserving uniqueness."""
    target_dir = file_path.parent
    base_name = _sanitize_filename_base(title)
    extension = file_path.suffix or ".md"
    desired_name = _resolve_unique_filename(
        target_dir,
        base_name,
        exclude_path=file_path,
        extension=extension,
    )
    desired_path = target_dir / f"{desired_name}{extension}"

    if desired_path == file_path:
        return file_path

    file_path.rename(desired_path)
    return desired_path


def _safe_filename(title: str, target_dir: Path) -> str:
    """Generate a safe filename from a title, handling collisions.

    Returns the filename WITHOUT extension.
    """
    safe = _sanitize_filename_base(title)
    return _resolve_unique_filename(target_dir, safe)


def _is_dashworks_file_path(file_path: Path) -> bool:
    if not file_path or file_path.suffix.lower() != ".json" or not get_p("DASHWORKS"):
        return False
    try:
        file_path.resolve().relative_to(get_p("DASHWORKS").resolve())
        return True
    except Exception:
        return False


def _read_dashworks_file(file_path: Path) -> tuple[dict, str]:
    data = json.loads(file_path.read_text(encoding="utf-8"))
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    metadata = dict(metadata)

    file_id = data.get("id") or metadata.get("id") or file_path.stem
    title = data.get("title") or metadata.get("title") or file_path.stem
    parent_id = data.get("parent_id")

    metadata["id"] = file_id
    metadata["title"] = title
    if parent_id is not None:
        metadata["parent_id"] = parent_id
    metadata["is_dashworks"] = True
    metadata.setdefault("content_format", "json")

    body = data.get("content")
    if body is None:
        body = "{}"
    elif not isinstance(body, str):
        body = json.dumps(body, ensure_ascii=False, indent=2)

    return metadata, body


def _write_dashworks_file(
    file_path: Path,
    page_id: str,
    title: str,
    metadata: dict,
    content: str,
    parent_id: Optional[str] = None,
    is_database: bool = False,
):
    payload = {
        "id": page_id,
        "title": title,
        "parent_id": parent_id,
        "is_database": is_database,
        "metadata": metadata,
        "content": content,
    }
    file_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _ensure_page_extension(file_path: Path, is_dashworks: bool) -> Path:
    desired_extension = ".json" if is_dashworks else ".md"
    if file_path.suffix.lower() == desired_extension:
        return file_path

    base_name = _sanitize_filename_base(file_path.stem)
    desired_name = _resolve_unique_filename(
        file_path.parent,
        base_name,
        exclude_path=file_path,
        extension=desired_extension,
    )
    desired_path = file_path.parent / f"{desired_name}{desired_extension}"
    file_path.rename(desired_path)
    return desired_path


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
    return get_p("ASSETS") / db_segment / table_segment / prop_segment


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
    """Creates the physical table folder inside BD/DBName/ (ex: Gnosi/BD/Gnosi/Articles/).
    Includes migration logic: if the folder is in root or BD/, it moves it to the DB folder.
    """
    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        log.warning(f"Table {table.get('id')} ({table.get('name')}) does not have a 'folder' property defined.")
        return

    # Seek the folder of the database the table belongs to
    db_id = table.get("database_id")
    db_folder = "BD" # Default if not found
    
    if registry_data and "databases" in registry_data:
        for db in registry_data["databases"]:
            if db.get("id") == db_id:
                db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
                break

    # Correct final path: Gnosi / BD / DB Name / folder_rel
    target_path = get_p("VAULT") / db_folder / folder_rel
    
    # Migration routes (where the folder might be right now)
    legacy_root_path = get_p("VAULT") / folder_rel
    legacy_bd_path = get_p("DATABASES") / folder_rel

    try:
        # 1. MIGRATION from root (Gnosi/Articles)
        if legacy_root_path.exists() and legacy_root_path.is_dir() and legacy_root_path != (get_p("VAULT") / db_folder):
            if not target_path.exists():
                log.info(f"📦 Migrating table folder from ROOT to {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_root_path), str(target_path))
        
        # 2. MIGRATION from BD/ (Gnosi/BD/Articles)
        if legacy_bd_path.exists() and legacy_bd_path.is_dir() and legacy_bd_path != target_path:
            if not target_path.exists():
                log.info(f"📦 Migrating table folder from BD to {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_bd_path), str(target_path))
            else:
                # If it already exists at destination but also in BD/, try to merge or delete the old one if empty
                log.warning(f"⚠️ Legacy folder in BD/ still exists for {folder_rel}. Considering cleanup.")
                if not any(legacy_bd_path.iterdir()):
                    legacy_bd_path.rmdir()

        # 3. CREATION (if not migrated or didn't exist)
        if not target_path.exists():
            target_path.mkdir(parents=True, exist_ok=True)
            log.info(f"✅ Table folder created at {db_folder}/: {target_path}")
        # else:
            # log.info(f"ℹ️ Table folder already exists correctly at {db_folder}/: {target_path}")
            
    except Exception as e:
        log.error(f"❌ Error managing folder for table {folder_rel} at {db_folder}: {e}")


def _table_assets_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]]
) -> Path:
    """Returns the Assets/[DB]/[Table] directory for a table."""
    db_segment = _sanitize_asset_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _sanitize_asset_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table", "Table"
    )
    return get_p("ASSETS") / db_segment / table_segment


def _delete_asset_files_for_page(
    page_metadata: dict, table: Dict[str, Any], registry: dict
):
    """Deletes asset files referenced in a record's metadata."""
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
        # Normalize to list to treat single and multiple values identically
        paths = value if isinstance(value, list) else [value]
        for raw_path in paths:
            if not isinstance(raw_path, str):
                continue
            rel = raw_path.strip()
            if not rel.startswith("Assets/"):
                continue
            abs_path = get_p("VAULT") / rel
            if abs_path.is_file():
                try:
                    abs_path.unlink()
                    log.info(f"Asset deleted: {abs_path}")
                except Exception as exc:
                    log.warning(f"Could not delete {abs_path}: {exc}")


def _delete_asset_property_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]], prop_name: str
):
    """Recursively deletes the Assets/[DB]/[Table]/[Property] folder if it exists."""
    prop_dir = _property_assets_dir(table, database, prop_name)
    if prop_dir.is_dir():
        try:
            shutil.rmtree(prop_dir)
            log.info(f"Property folder deleted: {prop_dir}")
        except Exception as exc:
            log.warning(f"Could not delete folder {prop_dir}: {exc}")


def _delete_asset_table_dir(table: Dict[str, Any], database: Optional[Dict[str, Any]]):
    """Recursively deletes the Assets/[DB]/[Table] folder if it exists."""
    table_dir = _table_assets_dir(table, database)
    if table_dir.is_dir():
        try:
            shutil.rmtree(table_dir)
            log.info(f"Table folder deleted: {table_dir}")
        except Exception as exc:
            log.warning(f"Could not delete folder {table_dir}: {exc}")


def _copy_local_file_to_assets(local_path: Path, target_dir: Path) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = _sanitize_asset_segment(local_path.name, f"file-{uuid.uuid4().hex[:8]}")
    destination = target_dir / filename
    if destination.exists():
        stem = _sanitize_asset_segment(local_path.stem, "file")
        ext = local_path.suffix
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"
    shutil.copy2(local_path, destination)
    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


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

    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


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
    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


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
    """Normalizes the folder path to make it relative to get_p("VAULT").
    THIS VERSION detects if an absolute path from the Mac host is received and cleans it.
    """
    if not folder:
        return ""
    
    f = str(folder).replace("\\", "/")
    
    # Cleanup of redundant prefixes (Gnosi Segment)
    if "Gnosi/" in f:
        f = f.split("Gnosi/", 1)[1]
    elif f.startswith("/vault/"):
        f = f[7:]
    elif f.startswith("/vault"):
        f = f[6:]

    return f.strip().strip("/")


def _build_table_folder_index(registry: dict) -> dict:
    folder_to_table = {}
    
    # Database folder mapping for path prefixing
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
            
        # 2. Full path with DB prefix (e.g., "Gnosi/Areas")
        if db_prefix:
            full_path = _normalize_rel_folder(f"{db_prefix}/{raw_folder}")
            if full_path and full_path.lower() != plain_folder.lower():
                folder_to_table[full_path.lower()] = table_id
                
    return folder_to_table


def _resolve_table_id_from_context(
    metadata: dict, rel_folder: str, folder_to_table: dict, sorted_folders: Optional[List[str]] = None
) -> Optional[str]:
    # Canonical source: table folder from registry.
    folder_key = _normalize_rel_folder(rel_folder).lower()
    if folder_key:
        # Use provided sorted folders if available, otherwise calculate once
        if sorted_folders is None:
            sorted_folders = sorted(folder_to_table.keys(), key=len, reverse=True)
            
        for f in sorted_folders:
            if folder_key == f or folder_key.startswith(f + "/"):
                return folder_to_table[f]


    # Fallback for legacy/template notes outside table folders.
    res_id = metadata.get("table_id") or metadata.get("database_table_id")
    if str(res_id or "").strip().lower() == "wiki":
        return None
    return res_id


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

    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        return None

    # Trobar la carpeta de la base de dades
    db_id = table.get("database_id")
    db_folder = "BD"
    for db in registry.get("databases", []):
        if db.get("id") == db_id:
            db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
            break

    return get_p("VAULT") / db_folder / folder_rel


def _resolve_page_context_from_path(
    metadata: dict, file_path: Path
) -> tuple[str, Optional[str]]:
    rel_folder = str(file_path.parent.relative_to(get_p("VAULT"))).replace("\\", "/")
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
    """Recomputes cross-record formulas for a table after changes in a row."""
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
                if not get_rule_engine().table_has_cross_record_formulas(table_id):
                    break
            except Exception as e:
                log.warning(
                    f"Could not validate cross-record formulas for table {table_id}: {e}"
                )
                break

            for file_path in get_p("VAULT").rglob("*.md"):
                if any(part.startswith('.') for part in file_path.relative_to(get_p("VAULT")).parts):
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
                    updated = get_rule_engine().process_updates(
                        page_id, original, original.copy()
                    )
                except Exception as e:
                    log.warning(
                        f"Error recomputing row {page_id} from table {table_id}: {e}"
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
                    log.warning(f"Error saving recomputation for {page_id}: {e}")

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


def _read_frontmatter_partial(file_path: Path):
    """Reads only the top part of a markdown file to extract frontmatter.
    Extremely efficient for large vaults on slow drives (OneDrive).
    """
    lines = []
    frontmatter_started = False
    frontmatter_count = 0
    
    retries = 2
    last_error = None
    for attempt in range(retries + 1):
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    content_line = line.strip()
                    if content_line == '---':
                        frontmatter_count += 1
                        if frontmatter_count == 2:
                            lines.append(line)
                            # Read up to 60 more lines for body snippet (efficient partial read)
                            for _ in range(60):
                                try:
                                    body_line = next(f, None)
                                    if body_line is None: break
                                    lines.append(body_line)
                                except StopIteration:
                                    break
                            break
                        frontmatter_started = True
                    
                    if frontmatter_started:
                        lines.append(line)
                    elif content_line != "":
                        # If we find non-empty text before ---, it's not a valid frontmatter
                        break
                    
                    # Safety break: frontmatter usually at the very top
                    if len(lines) > 200:
                        break
                        
            content = "".join(lines)
            return parse_frontmatter(content, file_path)
        except OSError as e:
            if e.errno == 35: # Resource deadlock
                last_error = e
                if attempt < retries:
                    time.sleep(0.05) # Small wait
                    continue
            log.warning(f"Error in partial read of {file_path}: {e}")
            return {}, ""
        except Exception as e:
            log.warning(f"Error in partial read of {file_path}: {e}")
            return {}, ""
    
    if last_error:
        log.warning(f"Final error reading {file_path} after retries: {last_error}")
    return {}, ""


def _build_page_cache_entry(file_path: Path, stat_result) -> Dict[str, Any]:
    try:
        if _is_dashworks_file_path(file_path):
            metadata, _ = _read_dashworks_file(file_path)
        else:
            metadata, body = _read_frontmatter_partial(file_path)
            metadata = _process_metadata_paths(metadata)
            # Support Catalan 'data' as 'date' alias
            if "data" in metadata and "date" not in metadata:
                metadata["date"] = metadata["data"]
    except Exception as e:
        log.warning(f"Error parsing frontmatter for {file_path.name}: {e}")
        metadata = {}

    file_id = str(metadata.get("id") or file_path.stem)
    rel_folder = str(file_path.parent.relative_to(get_p("VAULT"))).replace("\\", "/")
    if rel_folder == ".":
        rel_folder = ""

    # Better title handling: metadata > filename stem > "Untitled"
    title = metadata.get("title")
    if not title:
        title = file_path.stem

    return {
        "path": str(file_path),
        "mtime_ns": stat_result.st_mtime_ns,
        "mtime": stat_result.st_mtime,
        "size": stat_result.st_size,
        "id": file_id,
        "title": title,
        "parent_id": metadata.get("parent_id"),
        "is_database": metadata.get("is_database", False),
        "metadata": {
            **metadata,
            "description": metadata.get("description") or (body.strip()[:500] if body else None)
        },
        "folder": rel_folder,
    }


def _get_cached_page_entries(
    search_paths: Optional[List[Path]] = None, 
    force_refresh: bool = False
) -> List[Dict[str, Any]]:
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path or not v_path.exists():
        return []
    v_str = str(v_path)

    # 1. Initialize from disk if needed
    if not _page_index_initialized.get(v_str):
        loaded = _load_page_index_from_disk(v_str)
        if not loaded:
            # Disk cache missing: mark as initialized to prevent repeated reads
            # and force a synchronous scan so the first response is never empty.
            with _page_index_lock:
                _page_index_entries.setdefault(v_str, {})
            _page_index_initialized[v_str] = True
            force_refresh = True

    # 2. If it's a read-only request (Fast Path), return immediately
    if not force_refresh:
        with _page_index_lock:
            entries = _page_index_entries.get(v_str, {})
            if search_paths:
                search_paths_strs = [str(p) for p in search_paths]
                return [
                    e for e in entries.values()
                    if any((e.get("path") or "").startswith(s) for s in search_paths_strs)
                ]
            return list(entries.values())

    # 3. Discovery (Slow Path) - Only reached if force_refresh=True
    # 3. Discovery (Slow Path) - Efficient walk skipping known heavy/redundant folders
    candidate_files = []
    
    # Folders to skip entirely
    SKIP_DIRS = {
        'assets', 'drawings', 'mail', 
        '.history', '.trash'
    }
    
    root_paths = search_paths if search_paths else [v_path]
    dashworks_path = get_p("DASHWORKS")
    
    for root in root_paths:
        if not root.exists(): continue
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip hidden and excluded folders
            dirnames[:] = [d for d in dirnames if not d.startswith('.') and d.lower() not in SKIP_DIRS]
            
            # Additional nested redundancy check: skipping duplicates like folder/folder
            rel_to_vault = Path(dirpath).relative_to(v_path)
            parts = rel_to_vault.parts
            if len(parts) >= 2:
                p_parent = parts[-2].lower().replace('_', '').replace('.', '')
                p_current = parts[-1].lower().replace('_', '').replace('.', '')
                if p_parent == p_current and len(p_parent) > 3:
                    dirnames[:] = [] # Stop recursion
                    continue

            for f in filenames:
                if f.startswith('.'): continue
                if f.endswith(".md"):
                    candidate_files.append(Path(dirpath) / f)
                elif f.endswith(".json") and dashworks_path and str(dirpath).startswith(str(dashworks_path)):
                    candidate_files.append(Path(dirpath) / f)

    log.info(f"🔍 Indexer found {len(candidate_files)} candidate files.")

    # 4. Prepare updates OUTSIDE lock
    new_entries = {}
    current_paths = set()

    # Get a snapshot of existing entries to avoid constant locking
    with _page_index_lock:
        if v_str not in _page_index_entries:
            _page_index_entries[v_str] = {}
        cached_snapshot = dict(_page_index_entries[v_str])

    for file_path in candidate_files:
        is_dashworks_file = _is_dashworks_file_path(file_path)
        try:
            rel_path = file_path.relative_to(v_path)
            parts = rel_path.parts
            # Ignore hidden folders and specifically .history or .trash
            if any(part.startswith('.') for part in parts):
                continue
            
            # Detect nested redundancy: [a, b, b, c] -> skip
            # Often caused by sync glitches: ismigar_gmail_com/ismigargmailcom/
            if len(parts) >= 2:
                is_redundant = False
                for i in range(len(parts) - 1):
                    # We only flag redundancy if the directory name matches exactly 
                    # its parent (ignoring case/underscores/dots)
                    p_parent = parts[i].lower().replace('_', '').replace('.', '')
                    p_current = parts[i+1].lower().replace('_', '').replace('.', '')
                    
                    # Safety check: p_current must be a directory (not the final file) to be a sync artifact folder
                    # Since parts includes the filename at the end, the last loop iteration
                    # compares the last folder with the filename. We want to avoid that for Wiki pages.
                    if i < len(parts) - 2: # Stop before the last part (filename)
                        if p_parent == p_current and len(p_parent) > 3:
                            # EXCEPTION: Allow similar names within the Calendar folder
                            # (e.g. ismigar_gmail_com/ismigargmailcom)
                            if "calendar" in [p.lower() for p in parts]:
                                continue
                            is_redundant = True
                            break
                if is_redundant:
                    continue
        except ValueError:
            continue

        path_str = str(file_path)
        current_paths.add(path_str)

        try:
            stat_result = file_path.stat()
        except (FileNotFoundError, PermissionError):
            continue

        cached = cached_snapshot.get(path_str)
        if (
            cached
            and cached.get("mtime_ns") == stat_result.st_mtime_ns
            and cached.get("size") == stat_result.st_size
        ):
            new_entries[path_str] = cached
            continue

        # Heavy part: parsing frontmatter
        new_entries[path_str] = _build_page_cache_entry(file_path, stat_result)

    # 5. Merge and persist inside lock (Briefly)
    with _page_index_lock:
        if not search_paths:
             _page_index_entries[v_str] = new_entries
             # Rebuild reverse ID map
             new_id_map = {}
             all_files_ordered = []
             for p_str, entry in new_entries.items():
                 all_files_ordered.append(Path(p_str))
                 pid = entry.get("id")
                 if pid:
                     # Keep most recent if duplicate ID exists in filesystem
                     existing_path = new_id_map.get(pid)
                     if not existing_path or entry.get("mtime", 0) > new_entries.get(existing_path, {}).get("mtime", 0):
                        new_id_map[pid] = p_str
             _page_id_to_path[v_str] = new_id_map
             # UPDATE GLOBAL RESOLVER
             path_resolver.update_index(v_path, new_id_map, all_files_ordered)
        else:
             _page_index_entries.setdefault(v_str, {}).update(new_entries)
             # Incremental update of ID map
             id_map = _page_id_to_path.setdefault(v_str, {})
             for p_str, entry in new_entries.items():
                 pid = entry.get("id")
                 if pid:
                     id_map[pid] = p_str
             # UPDATE GLOBAL RESOLVER INCREMENTALLY
             path_resolver.update_index(v_path, id_map, [Path(p) for p in _page_index_entries[v_str].keys()])
        
        _page_index_initialized[v_str] = True

    _save_page_index_to_disk(v_str)

    if search_paths:
        search_paths_strs = [str(p) for p in search_paths]
        return [
            e for e in new_entries.values()
            if any((e.get("path") or "").startswith(s) for s in search_paths_strs)
        ]

    return list(new_entries.values())


def _get_pages_snapshot(
    only_calendar: bool = False,
    background_tasks: Optional[BackgroundTasks] = None
) -> List[PageInfo]:
    global _last_vault_sync_time, _last_google_calendar_sync_time
    search_paths = None
    enabled_calendar_tables = []
    registry = load_registry()

    if only_calendar:
        try:
            from backend.services.integration_manager import integration_manager
            integrations = integration_manager.get_all_safe()
            enabled_calendar_tables = integrations.get("vault_calendar", {}).get("enabled_tables", [])
            
            search_paths = [get_p("CALENDAR")]
            # Find folders for enabled tables
            for table in registry.get("tables", []):
                if table.get("id") in enabled_calendar_tables:
                    folder_rel = table.get("folder")
                    if folder_rel:
                        search_paths.append(get_p("VAULT") / folder_rel)
        except Exception as e:
            log.warning(f"Could not prepare selective search paths for calendar: {e}")

    # Trigger background sync if background_tasks provided AND cooldown passed
    if background_tasks:
        now = time.monotonic()
        
        # 1. Disk Index Sync (Vault)
        if now - _last_vault_sync_time > _VAULT_SYNC_COOLDOWN_SECONDS:
            _last_vault_sync_time = now
            background_tasks.add_task(_get_cached_page_entries, search_paths, True)
            log.info("📡 Background sync triggered for page index.")
        
        # 2. Google Calendar Sync (Remote)
        # Triggered ONLY if specifically looking at calendar and cooldown passed
        if only_calendar and (now - _last_google_calendar_sync_time > _GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS):
            _last_google_calendar_sync_time = now
            try:
                from backend.services.vault_calendar_sync_service import calendar_sync_service
                background_tasks.add_task(calendar_sync_service.sync_all_calendars)
                log.info("📅 Background Google Calendar sync triggered.")
            except Exception as e:
                log.error(f"Could not trigger background Google Calendar sync: {e}")

    raw_entries = _get_cached_page_entries(search_paths=search_paths, force_refresh=False)
    if not raw_entries:
        return []

    # Filter out entries whose files no longer exist (deleted externally)
    entries = []
    stale_paths = []
    for e in raw_entries:
        p_str = e.get("path")
        if p_str and not Path(p_str).exists():
            stale_paths.append(p_str)
        else:
            entries.append(e)

    if stale_paths:
        from backend.services.context_vars import get_active_vault_path
        v_str = str(get_active_vault_path())
        with _page_index_lock:
            idx = _page_index_entries.get(v_str, {})
            id_map = _page_id_to_path.get(v_str, {})
            for p_str in stale_paths:
                entry = idx.pop(p_str, None)
                if entry:
                    id_map.pop(entry.get("id", ""), None)
        _last_vault_sync_time = 0.0
        log.info(f"🗑️ Pruned {len(stale_paths)} stale page entries from cache.")

    folder_to_table = _build_table_folder_index(registry)
    sorted_folders = sorted(folder_to_table.keys(), key=len, reverse=True)

    pages_by_id: Dict[str, PageInfo] = {}
    duplicate_ids = set()

    # If we did a selective scan, we should only process the entries relevant to those paths
    if search_paths:
        search_paths_strs = [str(p) for p in search_paths]
        relevant_entries = []
        for entry in entries:
            entry_path = entry.get("path") or ""
            # Check if this entry belongs to one of our requested folders
            if any(entry_path.startswith(s) for s in search_paths_strs):
                relevant_entries.append(entry)
        entries = relevant_entries

    # Llista d'IDs amagats
    try:
        session = get_mgmt_session()
        hidden_ids = {h[0] for h in session.query(HiddenEvent.event_id).all()}
        session.close()
    except Exception:
        hidden_ids = set()

    for entry in entries:
        metadata = entry.get("metadata", {})
        
        # 1. Skip if hidden
        if entry["id"] in hidden_ids:
            continue
            
        # 2. Resolve table context efficiently
        resolved_table_id = _resolve_table_id_from_context(
            metadata, entry["folder"], folder_to_table, sorted_folders=sorted_folders
        )
        
        # 2. Filter if requested (Server-side filtering for calendar performance)
        if only_calendar:
            table_id = resolved_table_id or metadata.get("table_id") or metadata.get("database_table_id")
            
            is_relevant = False
            # a) Is it in an enabled calendar table?
            if table_id and table_id in enabled_calendar_tables:
                is_relevant = True
            # b) Does it have an explicit date?
            elif metadata.get("date"):
                is_relevant = True
            # c) Is it an external source that isn't 'Gnosi'?
            else:
                source = (metadata.get("source") or "").strip().lower()
                if source and source not in {"gnosi", "gnosi vault"}:
                    is_relevant = True
            
            if not is_relevant:
                continue

        page_info = PageInfo(
            id=entry["id"],
            title=entry["title"],
            parent_id=entry["parent_id"],
            is_database=entry["is_database"],
            metadata=metadata,
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
            f"Deduplicated {len(duplicate_ids)} pages with repeated ID in the Vault"
        )

    pages = list(pages_by_id.values())
    pages.sort(key=lambda x: x.last_modified, reverse=True)
    return pages


@router.get("/pages", response_model=List[PageInfo])
async def list_pages(
    background_tasks: BackgroundTasks, 
    only_calendar: bool = Query(False)
):
    """Lists all pages in the root flatly by iterating through UUID.md files.
    Returns cached data instantly and triggers a background refresh.
    """
    return _get_pages_snapshot(only_calendar=only_calendar, background_tasks=background_tasks)


@router.get("/pages/by-table/{table_id}", response_model=List[PageInfo])
async def list_pages_by_table(table_id: str, include_templates: bool = Query(True)):
    """Returns only pages from a specific table to avoid loading the entire Vault."""
    pages = _get_pages_snapshot()
    filtered = [p for p in pages if p.resolved_table_id == table_id]
    if not include_templates:
        filtered = [p for p in filtered if not p.metadata.get("is_template")]
    return filtered


@router.get("/pages/by-table/{table_id}/snapshot", response_model=TablePagesSnapshot)
async def list_pages_by_table_snapshot(table_id: str):
    """Returns canonical snapshot per table: raw + real visible.

    This route avoids divergences between frontend sessions and establishes
     a single source of truth for the count of visible records.
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
    """Returns a lightweight summary of pages for the sidebar."""
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


def _get_unique_filepath(target_dir: Path, name: str, extension: str = ".md") -> Path:
    """Returns a unique filepath by appending (n) if it already exists."""
    safe_name = _safe_filename(str(name), target_dir)
    file_path = target_dir / f"{safe_name}{extension}"
    
    if not file_path.exists():
        return file_path
        
    # Collision! Append (n)
    counter = 1
    while True:
        candidate_name = f"{safe_name} ({counter})"
        file_path = target_dir / f"{candidate_name}{extension}"
        if not file_path.exists():
            return file_path
        counter += 1


@router.post("/pages", dependencies=[Depends(require_role("editor"))])
async def create_page(request: PageSaveRequest, background_tasks: BackgroundTasks):
    """Creates a new page with a UUID ID."""
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
    if metadata.get("is_dashworks") is True:
        metadata["content_format"] = "json"

    # Apply automations and formulas during creation as well (old_metadata empty)
    try:
        metadata = get_rule_engine().process_updates(page_id, {}, metadata)
    except Exception as e:
        log.error(f"Error processing automations on create for {page_id}: {e}")

    metadata = _persist_metadata_assets(metadata)

    is_template = metadata.get("is_template") is True
    is_dashworks = metadata.get("is_dashworks") is True

    # Determinar directori destí
    if is_template:
        target_dir = get_p("PLANTILLES")
    elif is_calendar_entry(metadata):
        target_dir = get_p("CALENDAR")
    elif is_dashworks:
        target_dir = get_p("DASHWORKS")
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        target_dir = table_folder if table_folder else get_p("WIKI")

    target_dir.mkdir(parents=True, exist_ok=True)

    # Generate filename from title (not UUID)
    file_extension = ".json" if is_dashworks else ".md"
    file_path = _get_unique_filepath(target_dir, request.title, extension=file_extension)
    
    log.info(f"Creating new page at: {file_path.absolute()}")

    frontmatter = generate_frontmatter(metadata)
    full_content = f"{frontmatter}\n{request.content}"

    try:
        if is_dashworks:
            _write_dashworks_file(
                file_path=file_path,
                page_id=page_id,
                title=request.title,
                metadata=metadata,
                content=request.content,
                parent_id=request.parent_id,
                is_database=request.is_database,
            )
        else:
            file_path.write_text(full_content, encoding="utf-8")
        background_tasks.add_task(
            trigger_n8n_webhook, file_path.name, "Universal", request.content
        )
        table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if table_id:
            background_tasks.add_task(
                _recompute_cross_record_formulas_for_table, table_id, page_id
            )
        
        # Registra la nova pàgina al mapa ID→path immediatament (evita 404 a autosave)
        try:
            v_path = get_active_vault_path()
            if v_path:
                v_str = str(v_path)
                with _page_index_lock:
                    _page_id_to_path.setdefault(v_str, {})[page_id] = str(file_path)
        except Exception:
            pass
        # Clear entries cache to force re-scan for the sidebar
        _clear_page_index_cache()

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
            "message": "Page created",
        }
    except Exception as e:
        log.error(f"Error creating the page: {e}")
        raise HTTPException(
            status_code=500, detail="Error writing the page file"
        )


def find_page_path(page_id: str) -> Optional[Path]:
    """Seeks the path of an .md file by ID recursively using an optimized in-memory index."""
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path: return None
    v_str = str(v_path)

    stale_detected = False

    # 1. High Performance Cache Lookup (O(1))
    # This is populated during list_pages (vault sync)
    with _page_index_lock:
        id_map = _page_id_to_path.get(v_str, {})
        path_str = id_map.get(page_id)
        if path_str:
            p = Path(path_str)
            if p.exists():
                return p
            # File deleted externally: prune stale entries
            id_map.pop(page_id, None)
            _page_index_entries.get(v_str, {}).pop(path_str, None)
            stale_detected = True

    # 2. Fallback: Search using the full entries cache
    with _page_index_lock:
        entries = _page_index_entries.get(v_str, {})
        for p_str, entry in list(entries.items()):
            if entry.get("id") == page_id:
                p = Path(p_str)
                if p.exists():
                    _page_id_to_path.setdefault(v_str, {})[page_id] = p_str
                    return p
                # File deleted externally: prune stale entry
                entries.pop(p_str, None)
                _page_id_to_path.get(v_str, {}).pop(page_id, None)
                stale_detected = True
                break

    if stale_detected:
        # Force immediate rescan on next list_pages call
        global _last_vault_sync_time
        _last_vault_sync_time = 0.0
        log.info(f"🗑️ Stale cache entry detected for page {page_id}. Rescan scheduled.")

    # 3. Last Resort Fallback: Direct file lookups (Avoid if possible)
    vault_root = get_p("VAULT")
    direct_path = vault_root / f"{page_id}.md"
    if direct_path.exists():
        return direct_path

    dashworks_direct_path = get_p("DASHWORKS") / f"{page_id}.json" if get_p("DASHWORKS") else None
    if dashworks_direct_path and dashworks_direct_path.exists():
        return dashworks_direct_path

    # 4. Full scan (cache fred o buit — costós però correcte)
    if vault_root and vault_root.exists():
        for md_file in vault_root.rglob("*.md"):
            try:
                raw = md_file.read_text(encoding="utf-8")
                fm, _ = parse_frontmatter(raw, md_file)
                if str(fm.get("id", "")) == page_id:
                    with _page_index_lock:
                        _page_id_to_path.setdefault(v_str, {})[page_id] = str(md_file)
                    return md_file
            except Exception:
                continue

    return None


@router.get("/pages/{page_id}")
async def get_page(page_id: str):
    """Returns the full content of a page by ID."""
    file_path = find_page_path(page_id)

    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Page not found (ID: {page_id})"
        )

    try:
        if _is_dashworks_file_path(file_path):
            metadata, body = _read_dashworks_file(file_path)
        else:
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
        log.error(f"Error reading page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading target file")


@router.put("/pages/{page_id}", dependencies=[Depends(require_role("editor"))])
async def save_page(
    page_id: str, request: PageSaveRequest, background_tasks: BackgroundTasks
):
    """Saves or updates a page existing or re-adapting its UUID."""
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
    if metadata.get("is_dashworks") is True:
        metadata["content_format"] = "json"

    is_template = metadata.get("is_template") is True
    is_dashworks = metadata.get("is_dashworks") is True
    if not file_path:
        # If it doesn't exist, we create it in the correct folder according to metadata.
        if is_template:
            target_dir = get_p("PLANTILLES")
        elif is_calendar_entry(metadata):
            target_dir = get_p("CALENDAR")
        elif is_dashworks:
            target_dir = get_p("DASHWORKS")
        else:
            table_folder = _resolve_table_folder_from_metadata(metadata)
            target_dir = table_folder if table_folder else get_p("WIKI")

        target_dir.mkdir(parents=True, exist_ok=True)
        safe_name = _safe_filename(request.title, target_dir)
        file_extension = ".json" if is_dashworks else ".md"
        file_path = target_dir / f"{safe_name}{file_extension}"
    else:
        # Ensure it's in the correct folder
        file_path = ensure_correct_page_location(file_path, metadata)
        file_path = _ensure_page_extension(file_path, is_dashworks)
        file_path = _rename_page_file_to_match_title(file_path, request.title)

    # Read previous metadata to detect manual overrides
    old_metadata = {}
    if file_path and file_path.exists():
        try:
            raw_content = file_path.read_text(encoding="utf-8")
            old_metadata, _ = parse_frontmatter(raw_content, file_path)
        except Exception:
            pass

    # Aplicar automatitzacions i fòrmules
    try:
        metadata = get_rule_engine().process_updates(page_id, old_metadata, metadata)
    except Exception as e:
        log.error(f"Error processing automations for {page_id}: {e}")

    metadata = _persist_metadata_assets(metadata)

    frontmatter = generate_frontmatter(metadata)
    # Evitar dobletes de salts inútils respectant body
    full_content = f"{frontmatter}\n{request.content.lstrip()}"

    try:
        if file_path and file_path.exists():
            _create_page_version(page_id, file_path)

        if is_dashworks:
            _write_dashworks_file(
                file_path=file_path,
                page_id=page_id,
                title=request.title,
                metadata=metadata,
                content=request.content,
                parent_id=request.parent_id,
                is_database=request.is_database,
            )
        else:
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
            "message": "Page saved successfully",
        }
    except Exception as e:
        log.error(f"Error saving page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error writing file to disk")


@router.patch("/pages/{page_id}", dependencies=[Depends(require_role("editor"))])
async def patch_page(
    page_id: str, request: PagePatchRequest, background_tasks: BackgroundTasks
):
    """Partial update of a page (e.g., metadata only)."""
    file_path = find_page_path(page_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Page not found")

    try:
        if _is_dashworks_file_path(file_path):
            metadata, body = _read_dashworks_file(file_path)
        else:
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
        if metadata.get("is_dashworks") is True:
            metadata["content_format"] = "json"

        # Move if type changes (template / non-template)
        file_path = ensure_correct_page_location(file_path, metadata)
        file_path = _ensure_page_extension(file_path, metadata.get("is_dashworks") is True)
        if request.title is not None:
            file_path = _rename_page_file_to_match_title(file_path, request.title)

        # Apply automations and formulas
        try:
            # Here 'metadata' already has the request changes, 'RuleEngine' will compare with 'original_metadata' (from file)
            raw_content = file_path.read_text(encoding="utf-8")
            original_metadata, _ = parse_frontmatter(raw_content, file_path)
            metadata = get_rule_engine().process_updates(page_id, original_metadata, metadata)
        except Exception as e:
            log.error(f"Error processing automations for {page_id}: {e}")

        metadata = _persist_metadata_assets(metadata)

        frontmatter = generate_frontmatter(metadata)
        full_content = f"{frontmatter}\n{content.lstrip()}"

        _create_page_version(page_id, file_path)
        if metadata.get("is_dashworks") is True:
            _write_dashworks_file(
                file_path=file_path,
                page_id=page_id,
                title=metadata.get("title", "Untitled"),
                metadata=metadata,
                content=content,
                parent_id=metadata.get("parent_id"),
                is_database=bool(metadata.get("is_database")),
            )
        else:
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
            "message": "Page partially updated",
        }
    except Exception as e:
        log.error(f"Error patching page {page_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/pages/{page_id}", dependencies=[Depends(require_role("admin"))])
async def delete_page(page_id: str):
    """Permanently deletes the .md page (use with care)."""
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
                f"Could not delete assets for record {page_id}: {asset_exc}"
            )

        # IMPORTANT: Never delete the table from the registry when deleting a page!
        # The registry contains the table schema, not its rows.
        # The following lines were removed because they caused errors when
        # deleting the last record of a table.
        # Original buggy code (removed):
        # registry["databases"] = [db for db in registry["databases"] if db.get("id") != page_id]
        # tables_to_remove = [t["id"] for t in registry["tables"] if t.get("database_id") == page_id]
        # registry["tables"] = [t for t in registry["tables"] if t.get("database_id") != page_id]
        # registry["views"] = [v for v in registry["views"] if v.get("table_id") not in tables_to_remove]

        file_path.unlink()
        return {"status": "success", "message": "Page deleted and registry cleaned"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-cover", dependencies=[Depends(require_role("editor"))])
async def upload_cover(file: UploadFile = File(...)):
    """Uploads an image to the Assets/Covers folder and returns the URL."""
    return _upload_image_to_assets_subdir(file, "Covers")


@router.post("/upload-icon", dependencies=[Depends(require_role("editor"))])
async def upload_icon(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    """Uploads an image to the Assets/Icons folder and returns the URL."""
    if not _is_image_upload(file):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    def debug_log(msg):
        with open("/tmp/gnosi_upload_debug.log", "a") as f:
            f.write(f"{datetime.now().isoformat()} | {msg}\n")
            f.flush()

    debug_log(f"START: upload_icon {file.filename} ({file.content_type})")
    try:
        payload = await file.read()
        debug_log(f"READ: {len(payload)} bytes")
        
        if len(payload) > 10 * 1024 * 1024:
            debug_log("ERROR: File too large")
            raise HTTPException(status_code=413, detail="Icon is too large (max 10MB)")

        icons_dir = get_p("ASSETS") / "Icons"
        icons_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(payload).hexdigest()[:12]
        ext = _normalize_icon_extension(file.filename or "", file.content_type or "")
        filename = f"icon-{digest}{ext}"
        icon_path = icons_dir / filename
        
        if not icon_path.exists():
            icon_path.write_bytes(payload)
            debug_log(f"SAVED: {icon_path}")
        else:
            debug_log(f"EXISTS: {icon_path}")

        # Schedule thumbnail creation in the background
        background_tasks.add_task(_maybe_create_icon_thumbnail, icon_path, digest)
        debug_log("SCHEDULED: thumbnail generation")

        icon_rel = str(icon_path.relative_to(get_p("VAULT"))).replace("\\", "/")
        result = {
            "url": f"/api/vault/assets/{icon_rel[len('Assets/') :]}",
            "path": icon_rel,
            "thumbnail_url": None,
            "thumbnail_path": None,
        }
        
        debug_log(f"FINISH: result URL {result.get('url')}")
        return result
    except Exception as e:
        debug_log(f"FATAL ERROR: {str(e)}")
        raise e


@router.post("/import-icon-url")
async def import_icon_from_url(request: IconUrlImportRequest):
    """Downloads an external icon URL and stores it in Assets/Icons."""
    url = str(request.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="URL must be http(s)")

    try:
        response = requests.get(url, timeout=12, stream=True)
        response.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not fetch icon URL: {exc}")

    content_type = str(response.headers.get("Content-Type") or "").split(";")[0].lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="URL does not point to an image")

    max_size = 10 * 1024 * 1024
    chunks = []
    total = 0
    try:
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_size:
                raise HTTPException(status_code=413, detail="Icon is too large (max 10MB)")
            chunks.append(chunk)
    finally:
        response.close()

    payload = b"".join(chunks)
    source_name = Path(urllib.parse.urlparse(url).path).name or "remote-icon"
    return _store_icon_bytes(payload, source_name, content_type)


@router.post("/assets/upload")
async def upload_asset(file: UploadFile = File(...), table_id: Optional[str] = Query(None)):
    """Puja una imatge o PDF a Assets/Inline o Assets/Files i retorna la URL.
    Si s'indica table_id, desa a Assets/<DB>/<Taula>/Inline/ o .../Files/.
    """
    is_image = _is_image_upload(file)
    subdir = "Inline" if is_image else "Files"

    if table_id:
        registry = load_registry()
        table, database = _resolve_table_and_database_for_assets(table_id, registry)
        if table:
            target_dir = _table_assets_dir(table, database) / subdir
        else:
            target_dir = get_p("ASSETS") / subdir
    else:
        target_dir = get_p("ASSETS") / subdir

    try:
        relative_path = _save_uploaded_file_to_assets(file, target_dir)
    except Exception as e:
        log.error(f"Error uploading asset: {e}")
        raise HTTPException(status_code=500, detail="Could not save file")
    url = f"/api/vault/assets/{relative_path[len('Assets/'):]}"
    return {"url": url, "path": relative_path, "is_image": is_image}


@router.get("/assets/{asset_path:path}")
async def get_asset(asset_path: str):
    """Serves files from the Vault Assets directory."""
    if not get_p("ASSETS"):
        raise HTTPException(status_code=500, detail="Assets path is not configured")

    try:
        assets_root = get_p("ASSETS").resolve()
        requested = (get_p("ASSETS") / asset_path).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid asset path")

    if not str(requested).startswith(str(assets_root)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")

    media_type, _ = mimetypes.guess_type(str(requested))
    return FileResponse(path=str(requested), media_type=media_type)


# --- Media Manager (ARXIU AVANÇAT) ---

@router.get("/media")
async def get_all_media(album: Optional[str] = Query(None)):
    """Llista tots els mitjans, opcionalment filtrats per àlbum."""
    return media_service.get_all_media(album)


@router.get("/media/albums")
async def get_albums():
    """Retorna la llista d'àlbums (carpetes)."""
    return media_service.get_albums()


@router.post("/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    album: str = Query("General"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Puja un fitxer de mitjans a un àlbum."""
    result = media_service.upload_media(file, album)
    return result


@router.patch("/media/metadata")
async def update_media_metadata(
    filename: str = Body(...),
    album: str = Body(...),
    metadata: Dict[str, Any] = Body(...)
):
    """Actualitza tags, descripció o data manualment."""
    success = media_service.update_metadata(filename, album, metadata)
    if not success:
        raise HTTPException(status_code=500, detail="Error de persistència")
    return {"status": "ok"}


@router.get("/images/{image_path:path}")
async def serve_vault_image(image_path: str):
    """Serveix imatges directament des de VAULT/Images."""
    v_path = get_p("VAULT")
    if not v_path:
        raise HTTPException(status_code=500, detail="Vault not configured")
        
    img_root = (v_path / "Images").resolve()
    
    # Decodificar el path per si ve amb caràcters escapats extra
    from starlette.concurrency import run_in_threadpool
    from backend.services.path_resolver import path_resolver
    from urllib.parse import unquote
    decoded_path = unquote(image_path)
    
    requested = (img_root / decoded_path).resolve()
    
    # Validació de seguretat robusta
    try:
        # is_relative_to està disponible a Python 3.9+
        if not requested.is_relative_to(img_root):
            log.warning(f"⛔ Intent d'accés fora del root de media: {requested} (root: {img_root})")
            raise HTTPException(status_code=403, detail="Access denied")
    except (ValueError, AttributeError):
        # Fallback per a versions anteriors o errors de resolució
        if not str(requested).startswith(str(img_root)):
            log.warning(f"⛔ Fallback startswith: Accés denegat per a {requested}")
            raise HTTPException(status_code=403, detail="Access denied")

    if not requested.exists() or not requested.is_file():
        log.error(f"❌ Imatge no trobada al disc: {requested}")
        raise HTTPException(status_code=404, detail="Image not found")

    # Detecció de fitxers placeholder de OneDrive (mida 0 bytes)
    try:
        if requested.stat().st_size == 0:
            log.warning(f"☁️ Fitxer placeholder detectat (0 bytes): {requested}. Cal descarregar-lo de OneDrive.")
            # Retornem 404 o un error que el frontend pugui identificar si calgués, 
            # però per ara amb el log n'hi ha prou per a depuració.
            raise HTTPException(status_code=404, detail="Image is an empty placeholder (OneDrive)")
    except Exception as e:
        log.error(f"Error comprovant mida del fitxer: {e}")

    media_type, _ = mimetypes.guess_type(str(requested))
    if not media_type:
        # Fallback segons extensió
        ext = requested.suffix.lower()
        media_type = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".svg": "image/svg+xml"
        }.get(ext, "application/octet-stream")
        
    return FileResponse(path=str(requested), media_type=media_type)


@router.get("/custom-icons")
async def get_custom_icons():
    """Returns the shared custom icon library for Vault icon picker."""
    return {"icons": _load_custom_icons()}


@router.put("/custom-icons")
async def save_custom_icons(request: CustomIconsRequest):
    """Persists the shared custom icon library for Vault icon picker."""
    saved = _save_custom_icons(request.icons)
    return {"icons": saved}


def _resolve_storage_dir(storage_folder: str, table, database, property_name: str) -> tuple[Path, str]:
    """Resolve the target directory and URL prefix based on storage_folder config.

    Returns (target_dir, url_prefix_type) where url_prefix_type is 'assets' or 'absolute'.
    """
    if storage_folder == "biblioteca":
        biblioteca = get_p("BIBLIOTECA")
        biblioteca.mkdir(parents=True, exist_ok=True)
        return biblioteca, "absolute"
    # Default: assets (nested per DB/Table/Property)
    return _property_assets_dir(table, database, property_name), "assets"


def _file_response_payload(dest_path: Path, url_prefix_type: str) -> dict:
    """Build the API response dict for a saved/linked file."""
    if url_prefix_type == "assets":
        vault = get_p("VAULT")
        try:
            rel = str(dest_path.relative_to(vault)).replace("\\", "/")
        except ValueError:
            rel = str(dest_path)
        # Strip leading "Assets/" to build the /api/vault/assets/ URL
        if rel.startswith("Assets/"):
            url = f"/api/vault/assets/{rel[len('Assets/'):]}"
        else:
            url = f"/api/vault/assets/{rel}"
        return {"path": rel, "url": url, "storage": "assets"}
    else:
        # Absolute path — returned as-is so the frontend can display the filename
        return {"path": str(dest_path), "url": None, "storage": "absolute"}


@router.post("/upload-property-file")
async def upload_property_file(
    table_id: str = Query(...),
    property_name: str = Query(...),
    storage_folder: str = Query(default="assets"),
    file: UploadFile = File(...),
):
    """Upload a file for a property. Routes to Assets/, Biblioteca/ or a free path
    depending on the storage_folder parameter (assets | biblioteca | free)."""
    registry = load_registry()
    table, database = _resolve_table_and_database_for_assets(table_id, registry)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    property_clean = str(property_name or "").strip()
    if not property_clean:
        raise HTTPException(status_code=400, detail="property_name is mandatory")

    target_dir, url_type = _resolve_storage_dir(storage_folder, table, database, property_clean)
    try:
        dest_path = Path(_save_uploaded_file_to_dir(file, target_dir))
    except Exception as e:
        log.error(f"Error uploading property file: {e}")
        raise HTTPException(status_code=500, detail="Could not save file")

    return _file_response_payload(dest_path, url_type)


def _save_uploaded_file_to_dir(upload: UploadFile, target_dir: Path) -> Path:
    """Save an UploadFile to target_dir and return the absolute destination path."""
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload.bin"
    ext = Path(original_name).suffix
    stem = _sanitize_asset_segment(Path(original_name).stem, "upload")
    destination = target_dir / f"{stem}{ext}"
    if destination.exists():
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"
    with open(destination, "wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)
    return destination


@router.post("/link-existing-file")
async def link_existing_file(body: dict):
    """Variant B: register an existing local file path without copying it.

    Body: { "file_path": "/absolute/path/to/file.pdf" }
    Returns the path and a display name.
    """
    file_path = str(body.get("file_path", "")).strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path is mandatory")

    p = Path(file_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    if not p.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    return {
        "path": str(p),
        "url": None,
        "storage": "absolute",
        "name": p.name,
        "size": p.stat().st_size,
    }


@router.post("/pick-folder")
async def pick_folder():
    """Open a native macOS folder-picker dialog and return the chosen path."""
    import subprocess
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        'set chosen to choose folder with prompt "Selecciona la carpeta de destinació"\n'
        'return POSIX path of chosen'
    )
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=60
        )
        chosen = result.stdout.strip()
        if not chosen:
            raise HTTPException(status_code=204, detail="No folder selected")
        return {"path": chosen}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Folder picker timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pick-file")
async def pick_file():
    """Open a native macOS file-picker dialog and return the chosen file path."""
    import subprocess
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        'set chosen to choose file with prompt "Selecciona el fitxer a enllaçar"\n'
        'return POSIX path of chosen'
    )
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=60
        )
        chosen = result.stdout.strip()
        if not chosen:
            raise HTTPException(status_code=204, detail="No file selected")
        p = Path(chosen)
        return {"path": chosen, "name": p.name, "size": p.stat().st_size if p.exists() else 0}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="File picker timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/unsplash/search")
async def unsplash_search(query: str = Query(...), page: int = Query(1)):
    """Searches images on Unsplash acting as a proxy."""
    unsplash_key = os.getenv("UNSPLASH_ACCESS_KEY")
    if not unsplash_key:
        raise HTTPException(
            status_code=500,
            detail="Unsplash API Key is not configured in .env (UNSPLASH_ACCESS_KEY)",
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
    """Duplicates an existing page and returns the new ID."""
    source_path = find_page_path(page_id)

    if not source_path or not source_path.exists():
        raise HTTPException(
            status_code=404, detail="Source page not found (non-existent ID)"
        )

    try:
        if _is_dashworks_file_path(source_path):
            metadata, body = _read_dashworks_file(source_path)
        else:
            raw_content = source_path.read_text(encoding="utf-8")
            metadata, body = parse_frontmatter(raw_content, source_path)

        # Nou UUID i ajustos de metadata
        new_page_id = str(uuid.uuid4())
        new_metadata = metadata.copy()
        new_metadata["id"] = new_page_id

        # Add prefix "(Copy)" to the title
        old_title = metadata.get("title", "Untitled")
        new_title = f"{old_title} (Copy)"
        new_metadata["title"] = new_title

        # Copies are created in the same directory as the original
        if _is_dashworks_file_path(source_path):
            new_file_path = source_path.parent / f"{new_page_id}.json"
            _write_dashworks_file(
                file_path=new_file_path,
                page_id=new_page_id,
                title=new_title,
                metadata=new_metadata,
                content=body,
                parent_id=new_metadata.get("parent_id"),
                is_database=bool(new_metadata.get("is_database")),
            )
        else:
            frontmatter = generate_frontmatter(new_metadata)
            full_content = f"{frontmatter}\n{body.lstrip()}"
            new_file_path = source_path.parent / f"{new_page_id}.md"
            new_file_path.write_text(full_content, encoding="utf-8")

        background_tasks.add_task(
            trigger_n8n_webhook, new_file_path.name, "Universal", body
        )

        return {
            "status": "created",
            "id": new_page_id,
            "message": "Page duplicated",
            "title": new_title,
        }

    except Exception as e:
        log.error(f"Error duplicating page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error duplicating target file")


def trigger_n8n_webhook(filename: str, folder: str, content: str):
    """Sends a POST to n8n invisibly when a note is saved or created."""
    try:
        url = "http://n8n:5678/webhook/vault-update"
        payload = {
            "event": "note_saved",
            "folder": folder,
            "filename": filename,
            "content": content[:2000],  # Limit content text for lightness
        }
        requests.post(url, json=payload, timeout=2)
    except Exception as e:
        log.warning(f"Could not notify event to n8n: {e}")


def build_id_title_index() -> Dict[str, str]:
    """Builds a global mapping page_id -> title for vault and dashworks."""
    index: Dict[str, str] = {}

    if get_p("VAULT") and get_p("VAULT").exists():
        for file_path in get_p("VAULT").rglob("*.md"):
            if ".history" in file_path.parts:
                continue
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                metadata, _ = parse_frontmatter(raw_content, file_path)
                page_id = str(
                    metadata.get("id") or metadata.get("migration_id") or file_path.stem
                )
                title = str(metadata.get("title") or file_path.stem)
                index[page_id] = title
            except Exception as e:
                log.warning(f"Error indexant {file_path.name}: {e}")

    if get_p("DASHWORKS") and get_p("DASHWORKS").exists():
        for file_path in get_p("DASHWORKS").rglob("*.json"):
            try:
                metadata, _ = _read_dashworks_file(file_path)
                page_id = str(metadata.get("id") or file_path.stem)
                title = str(metadata.get("title") or file_path.stem)
                index[page_id] = title
            except Exception as e:
                log.warning(f"Error indexant {file_path.name}: {e}")

    return index


def _iter_linkable_page_documents() -> List[tuple[Path, Dict[str, Any], str, bool]]:
    """Yields page documents as (path, metadata, body, is_dashworks)."""
    docs: List[tuple[Path, Dict[str, Any], str, bool]] = []

    if get_p("VAULT") and get_p("VAULT").exists():
        for file_path in get_p("VAULT").rglob("*.md"):
            if ".history" in file_path.parts:
                continue
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                metadata, body = parse_frontmatter(raw_content, file_path)
                docs.append((file_path, metadata, body, False))
            except Exception as e:
                log.warning(f"Error parsing linkable page {file_path.name}: {e}")

    if get_p("DASHWORKS") and get_p("DASHWORKS").exists():
        for file_path in get_p("DASHWORKS").rglob("*.json"):
            try:
                metadata, body = _read_dashworks_file(file_path)
                docs.append((file_path, metadata, body, True))
            except Exception as e:
                log.warning(f"Error parsing dashworks page {file_path.name}: {e}")

    return docs


@router.get("/global-index")
async def get_global_index():
    """Returns a global mapping id -> title for the entire Vault."""
    return build_id_title_index()


@router.get("/backlinks")
async def get_backlinks(id: str):
    """Finds all notes linking to a specific ID (both in metadata and body)."""
    backlinks = []
    seen_backlink_ids: set[str] = set()

    target_id = str(id or "").strip()
    if not target_id:
        return backlinks

    id_title_index = build_id_title_index()
    target_title = str(id_title_index.get(target_id) or "").strip().lower()
    title_to_ids = {}
    for page_id, title in id_title_index.items():
        key = str(title or "").strip().lower()
        if not key:
            continue
        title_to_ids.setdefault(key, set()).add(str(page_id))

    def _candidate_targets_from_ref(raw_ref: str) -> set[str]:
        candidates: set[str] = set()
        text = str(raw_ref or "").strip()
        if not text:
            return candidates

        try:
            text = urllib.parse.unquote(text)
        except Exception:
            pass

        base = text.split("#", 1)[0].strip()
        if not base:
            return candidates

        candidates.add(base)

        vault_page_match = re.search(r"(?:https?://[^/]+)?/vault/page/([^/?#]+)", base, re.IGNORECASE)
        if vault_page_match and vault_page_match.group(1):
            try:
                candidates.add(urllib.parse.unquote(vault_page_match.group(1).strip()))
            except Exception:
                candidates.add(vault_page_match.group(1).strip())

        api_page_match = re.search(r"(?:https?://[^/]+)?/api/vault/pages/([^/?#]+)", base, re.IGNORECASE)
        if api_page_match and api_page_match.group(1):
            try:
                candidates.add(urllib.parse.unquote(api_page_match.group(1).strip()))
            except Exception:
                candidates.add(api_page_match.group(1).strip())

        lowered = base.lower()
        for matched_id in title_to_ids.get(lowered, set()):
            candidates.add(matched_id)

        return {c.strip() for c in candidates if str(c).strip()}

    def _matches_target(raw_ref: str) -> bool:
        for candidate in _candidate_targets_from_ref(raw_ref):
            if candidate == target_id:
                return True
            if target_title and candidate.lower() == target_title:
                return True
            for resolved_id in title_to_ids.get(candidate.lower(), set()):
                if resolved_id == target_id:
                    return True
        return False

    documents = _iter_linkable_page_documents()
    if not documents:
        return backlinks

    # Busquem per tot el Vault/Dashworks notes que referenciïn aquest ID
    for file_path, metadata, body, _is_dashworks_doc in documents:
        try:
            # Do not count ourselves as backlink
            current_id = str(metadata.get("id", file_path.stem) or file_path.stem).strip()
            if not current_id:
                continue
            if current_id == target_id:
                continue
            if current_id in seen_backlink_ids:
                continue

            found = False
            # 1. Check Metadata
            for val in metadata.values():
                if val == target_id:
                    found = True
                    break
                if isinstance(val, list):
                    for item in val:
                        item_str = str(item).strip()
                        if item_str == target_id:
                            found = True
                            break
                        if isinstance(item, str) and _matches_target(item):
                            found = True
                            break
                    if found:
                        break
                if isinstance(val, str) and _matches_target(val):
                    found = True
                    break

            # 2. Check Body (WikiLinks and MD Links)
            if not found:
                # Obsidian style [[ID]] / [[Title]] / [[Title#Section|Alias]] (and ![[...]]).
                wiki_links = re.findall(r"!?\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|.*?)?\]\]", body)
                for raw_link in wiki_links:
                    base_target = str(raw_link or "").split("#", 1)[0].strip()
                    if _matches_target(base_target):
                        found = True
                        break

                # Standard MD links [text](ID)
                if not found:
                    md_links = re.findall(r"\[.*?\]\((.*?)\)", body)
                    for raw_link in md_links:
                        if _matches_target(raw_link):
                            found = True
                            break

            if found:
                seen_backlink_ids.add(current_id)
                backlinks.append(
                    {"id": current_id, "title": metadata.get("title") or file_path.stem}
                )
        except Exception as e:
            log.warning(f"Error processing backlinks for {file_path.name}: {e}")
            continue

    return backlinks


def _build_unlinked_mention_regex(target_title: str) -> Optional[re.Pattern]:
    safe_title = str(target_title or "").strip()
    if len(safe_title) < 2:
        return None

    escaped = re.escape(safe_title)
    return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)


def _strip_existing_links_for_mentions_scan(text: str) -> str:
    source = str(text or "")
    source = re.sub(r"```[\s\S]*?```", " ", source)
    source = re.sub(r"!?\[\[[^\]]+\]\]", " ", source)
    source = re.sub(r"\[[^\]]*\]\([^)]+\)", " ", source)
    return source


def _count_unlinked_mentions(text: str, target_title: str) -> int:
    pattern = _build_unlinked_mention_regex(target_title)
    if not pattern:
        return 0
    sanitized = _strip_existing_links_for_mentions_scan(text)
    return len(list(pattern.finditer(sanitized)))


def _first_unlinked_mention_snippet(text: str, target_title: str, radius: int = 48) -> str:
    pattern = _build_unlinked_mention_regex(target_title)
    if not pattern:
        return ""

    sanitized = _strip_existing_links_for_mentions_scan(text)
    match = pattern.search(sanitized)
    if not match:
        return ""

    start = max(0, match.start() - radius)
    end = min(len(sanitized), match.end() + radius)
    snippet = sanitized[start:end].replace("\n", " ").strip()
    return re.sub(r"\s+", " ", snippet)


def _link_mentions_in_plain_segments(body: str, target_title: str, target_id: str) -> tuple[str, int]:
    pattern = _build_unlinked_mention_regex(target_title)
    if not pattern:
        return str(body or ""), 0

    source = str(body or "")
    link_token = f"/vault/page/{urllib.parse.quote(str(target_id or '').strip())}"
    existing_link_pattern = re.compile(r"!?\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]+\)")

    parts = []
    last_index = 0
    replacements = 0

    for match in existing_link_pattern.finditer(source):
        plain_segment = source[last_index:match.start()]

        def _replace_title(m: re.Match) -> str:
            nonlocal replacements
            replacements += 1
            return f"[{m.group(0)}]({link_token})"

        linked_segment = pattern.sub(_replace_title, plain_segment)
        parts.append(linked_segment)
        parts.append(match.group(0))
        last_index = match.end()

    tail = source[last_index:]

    def _replace_title_tail(m: re.Match) -> str:
        nonlocal replacements
        replacements += 1
        return f"[{m.group(0)}]({link_token})"

    parts.append(pattern.sub(_replace_title_tail, tail))

    return "".join(parts), replacements


@router.get("/unlinked-mentions")
async def get_unlinked_mentions(id: str):
    """Finds notes mentioning target title in plain text without an actual link."""
    target_id = str(id or "").strip()
    if not target_id:
        return []

    id_title_index = build_id_title_index()
    target_title = str(id_title_index.get(target_id) or "").strip()
    if not target_title:
        target_path = find_page_path(target_id)
        if target_path and target_path.exists():
            if _is_dashworks_file_path(target_path):
                target_metadata, _ = _read_dashworks_file(target_path)
            else:
                raw_target = target_path.read_text(encoding="utf-8")
                target_metadata, _ = parse_frontmatter(raw_target, target_path)
            target_title = str(target_metadata.get("title") or "").strip()

    if len(target_title) < 2:
        return []

    results = []
    documents = _iter_linkable_page_documents()
    if not documents:
        return results

    for file_path, metadata, body, _is_dashworks_doc in documents:
        try:
            current_id = str(metadata.get("id") or file_path.stem)
            if current_id == target_id:
                continue

            count = _count_unlinked_mentions(body, target_title)
            if count <= 0:
                continue

            results.append(
                {
                    "id": current_id,
                    "title": metadata.get("title") or file_path.stem,
                    "count": count,
                    "snippet": _first_unlinked_mention_snippet(body, target_title),
                }
            )
        except Exception as e:
            log.warning(f"Error processing unlinked mentions for {file_path.name}: {e}")

    results.sort(key=lambda item: (-int(item.get("count") or 0), str(item.get("title") or "")))
    return results


@router.post("/link-unlinked-mentions")
async def link_unlinked_mentions(request: LinkMentionsRequest):
    """Converts plain mentions of target title into internal links in one source note or all notes."""
    target_id = str(request.target_id or "").strip()
    source_id = str(request.source_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="target_id is required")

    id_title_index = build_id_title_index()
    target_title = str(id_title_index.get(target_id) or "").strip()
    if len(target_title) < 2:
        raise HTTPException(status_code=400, detail="Target page title not found or too short")

    changed_notes = []
    total_replacements = 0

    if source_id:
        source_path = find_page_path(source_id)
        if not source_path or not source_path.exists():
            raise HTTPException(status_code=404, detail=f"Source page not found (ID: {source_id})")
        candidates = [source_path]
    else:
        candidates = [doc[0] for doc in _iter_linkable_page_documents()]

    for file_path in candidates:
        try:
            is_dashworks_doc = _is_dashworks_file_path(file_path)
            if is_dashworks_doc:
                metadata, body = _read_dashworks_file(file_path)
            else:
                raw_content = file_path.read_text(encoding="utf-8")
                metadata, body = parse_frontmatter(raw_content, file_path)
            current_id = str(metadata.get("id") or file_path.stem)
            if current_id == target_id:
                continue
            if source_id and current_id != source_id:
                continue

            updated_body, replacements = _link_mentions_in_plain_segments(
                body, target_title, target_id
            )
            if replacements <= 0:
                continue

            _create_page_version(current_id, file_path)
            if is_dashworks_doc:
                _write_dashworks_file(
                    file_path=file_path,
                    page_id=current_id,
                    title=str(metadata.get("title") or file_path.stem),
                    metadata=metadata,
                    content=updated_body,
                    parent_id=metadata.get("parent_id"),
                    is_database=bool(metadata.get("is_database")),
                )
            else:
                full_content = f"{generate_frontmatter(metadata)}\n{updated_body.lstrip()}"
                file_path.write_text(full_content, encoding="utf-8")

            changed_notes.append(
                {
                    "id": current_id,
                    "title": metadata.get("title") or file_path.stem,
                    "replacements": replacements,
                }
            )
            total_replacements += replacements
        except Exception as e:
            log.warning(f"Error linking unlinked mentions for {file_path.name}: {e}")

    changed_notes.sort(key=lambda item: str(item.get("title") or ""))
    return {
        "status": "success",
        "target_id": target_id,
        "target_title": target_title,
        "notes_changed": len(changed_notes),
        "total_replacements": total_replacements,
        "changed_notes": changed_notes,
    }


_registry_cache = None
_registry_cache_mtime = 0



def load_registry():
    """Reads the central registry and ensures it. 
    Cleanup: Deletes default taula_1 and normalizes paths to relative.
    Uses an in-memory cache to avoid redundant I/O.
    """
    global _registry_cache, _registry_cache_mtime
    
    registry_path = get_p("REGISTRY")
    if not registry_path or not registry_path.exists():
        return {"databases": [], "tables": [], "views": []}
    
    # Check cache
    try:
        mtime = registry_path.stat().st_mtime
        if _registry_cache is not None and mtime <= _registry_cache_mtime:
            return _registry_cache
    except Exception:
        pass

    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
        
        changed = False
        tables = data.get("tables", [])
        # 1. Cleanup: Delete default taula_1 if it exists
        if any(t.get("name") == "taula_1" for t in tables):
            data["tables"] = [t for t in tables if t.get("name") != "taula_1"]
            changed = True
            log.info("🗑️ Deleted default taula_1 from registry.")

        # 1.5 Cleanup: legacy wiki table is no longer supported as DB table.
        if any(str(t.get("id") or "").strip().lower() == "wiki" for t in data.get("tables", [])):
            data["tables"] = [
                t
                for t in data.get("tables", [])
                if str(t.get("id") or "").strip().lower() != "wiki"
            ]
            data["views"] = [
                v
                for v in data.get("views", [])
                if str(v.get("table_id") or "").strip().lower() != "wiki"
            ]
            changed = True
            log.info("🧹 Removed legacy wiki table and its views from registry.")

        # 2. Sanejament i creació de carpetes
        for table in data.get("tables", []):
            # Assegurar propietat 'folder' i que sigui RELATIVA (neteja host paths)
            folder_raw = table.get("folder") or table.get("name", "untitled_table")
            folder_normalized = _normalize_rel_folder(folder_raw)
            
            if table.get("folder") != folder_normalized:
                table["folder"] = folder_normalized
                changed = True
                log.info(f"🧹 Normalized table path '{table.get('name')}': {folder_normalized}")
            
            # Ensure physical folder
            try:
                _ensure_table_vault_folder(table, data)
            except Exception as e:
                log.error(f"❌ Error ensuring folder for table {table.get('name')}: {e}")
        
        if changed:
            save_registry(data)
        
        # Sync cache
        _registry_cache = data
        try:
            _registry_cache_mtime = registry_path.stat().st_mtime
        except Exception:
            _registry_cache_mtime = 0
            
        return data
    except Exception as e:
        log.error(f"❌ Error loading registry: {e}")
        return {"databases": [], "tables": [], "views": []}


def save_registry(data):
    """Saves the current state to the registry file and updates cache."""
    global _registry_cache, _registry_cache_mtime
    reg_path = get_p('REGISTRY')
    if not reg_path:
        log.warning("⚠️ Registry save attempt without configured path.")
        return
    try:
        reg_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception as e:
        log.error(f"❌ Error saving registry: {e}")


# ensure_default_registry_structure() # Desactivat: S'inicialitza dinàmicament per workspace


def _sort_key_name(item):
    """Sorting key that prioritizes 'order' and then the name (ignoring accents)."""
    order = item.get("order")
    # If it has order, return it as the first element of the tuple for sorting
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
    """Returns the full registry of databases, tables, and views (sorted alphabetically)."""
    try:
        registry = load_registry()
        registry["databases"] = sorted(
            registry.get("databases", []), key=_sort_key_name
        )
        registry["tables"] = sorted(
            [
                t
                for t in registry.get("tables", [])
                if str(t.get("id") or "").strip().lower() != "wiki"
            ],
            key=_sort_key_name,
        )
        registry["views"] = sorted(registry.get("views", []), key=_sort_key_name)
        return registry
    except Exception as e:
        logging.exception(f"ERROR in get_registry: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/registry")
async def update_registry(data: dict = Body(...)):
    """Updates the entire registry (use with care)."""
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
                status_code=500, detail=f"Could not open Zotero URI: {e}"
            )

    existing_path = _pick_existing_path(payload.file_path, payload.attachments)
    if not existing_path:
        raise HTTPException(
            status_code=404, detail="No valid local attachment found"
        )

    try:
        _safe_open_target(existing_path)
        return {"status": "ok", "opened_with": "file_path", "target": existing_path}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Could not open local file: {e}"
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
    tables = [
        t
        for t in registry.get("tables", [])
        if str(t.get("id") or "").strip().lower() != "wiki"
    ]
    if database_id:
        tables = [t for t in tables if t.get("database_id") == database_id]
    return sorted(tables, key=_sort_key_name)


@router.post("/tables")
async def create_table(table: dict = Body(...)):
    registry = load_registry()
    if "id" not in table:
        table["id"] = str(uuid.uuid4())
    
    # Ensure and normalize the folder property
    folder_raw = table.get("folder") or table.get("name", "untitled_table")
    table["folder"] = _normalize_rel_folder(folder_raw)

    # If already exists, update it (upsert)
    existing_idx = next(
        (i for i, t in enumerate(registry["tables"]) if t["id"] == table["id"]), None
    )
    if existing_idx is not None:
        old_table = registry["tables"][existing_idx]
        # Detect removed properties to delete their assets folders
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
    _ensure_table_vault_folder(table, registry)

    save_registry(registry)
    return table


@router.delete("/tables/{table_id}")
async def delete_table(table_id: str):
    registry = load_registry()
    # Get table info BEFORE deleting it from registry
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
            _ensure_table_vault_folder(t, registry)
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
            # Update all sent fields
            for key, value in data.items():
                v[key] = value
            found = True
            break

    if not found:
        # If it doesn't exist and we have enough data, we could create it,
        # but the expected behavior of PUT is update.
        # However, for robustness with the frontend, if they pass the whole object:
        if "id" in data and data["id"] == view_id:
            registry["views"].append(data)
        else:
            raise HTTPException(status_code=404, detail="View not found")

    save_registry(registry)
    return {"status": "success"}


# Ruta per retrocompatibilitat amb el frontend existent (SchemaConfigModal)
@router.post("/schema")
async def save_schema(folder: str, schema: dict = Body(...)):
    """
    Legacy route to save schemas per folder.
    Now we redirect it to table creation if needed, or save it as a local file.
    """
    schema_path = get_p('VAULT') / folder / "schema.json"
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    schema_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    return {"status": "success"}


@router.get("/schema")
async def get_schema(folder: str):
    schema_path = get_p('VAULT') / folder / "schema.json"
    if not schema_path.exists():
        return {}
    return json.loads(schema_path.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# EXCALIDRAW DRAWINGS ROUTES
# --------------------------------------------------------------------------


@router.get("/drawings")
async def list_drawings():
    """Lists all drawings in the vault (tldraw and excalidraw)."""
    dib_path = get_p('DIBUIXOS')
    dib_path.mkdir(parents=True, exist_ok=True)
    drawings = []
    seen_ids = set()

    # First search for .tldraw.json files (new format)
    for file_path in dib_path.glob("*.tldraw.json"):
        drawing_id = file_path.stem.replace(".tldraw", "")
        seen_ids.add(drawing_id)
        stat = file_path.stat()
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            # New format has { title, data, metadata }
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

    # Then search for .excalidraw.json files (old format)
    for file_path in get_p("DIBUIXOS").glob("*.excalidraw.json"):
        drawing_id = file_path.stem.replace(".excalidraw", "")
        if drawing_id in seen_ids:
            continue  # We already have the new format
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
    """Returns the data of a Tldraw drawing."""
    # Search first in new format (.tldraw.json)
    file_path = get_p("DIBUIXOS") / f"{drawing_id}.tldraw.json"
    if not file_path.exists():
        # Fallback to old format (.excalidraw.json)
        file_path = get_p("DIBUIXOS") / f"{drawing_id}.excalidraw.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Drawing not found")

    try:
        file_data = json.loads(file_path.read_text(encoding="utf-8"))
        # New format has { title, data, metadata } - return data
        if "data" in file_data:
            return file_data["data"]
        # Old format - return as-is
        return file_data
    except Exception as e:
        log.error(f"Error reading drawing {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading target file")


@router.put("/drawings/{drawing_id}")
async def save_drawing(drawing_id: str, request: DrawingSaveRequest):
    """Saves or updates a Tldraw drawing."""
    get_p("DIBUIXOS").mkdir(parents=True, exist_ok=True)
    file_path = get_p("DIBUIXOS") / f"{drawing_id}.tldraw.json"

    # Save title and data together
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
        log.error(f"Error saving drawing {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error writing target file")


@router.delete("/drawings/{drawing_id}")
async def delete_drawing(drawing_id: str):
    """Deletes a drawing."""
    dib_path = get_p('DIBUIXOS')
    file_path = dib_path / f"{drawing_id}.tldraw.json"
    if not file_path.exists():
        file_path = dib_path / f"{drawing_id}.excalidraw.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Drawing not found")

    file_path.unlink()
    return {"status": "success"}


def _create_page_version(page_id: str, file_path: Path):
    """Saves a version of the current file to .history/{page_id}/{timestamp}.md if cooldown passed."""
    if not file_path or not file_path.exists():
        return

    history_base = get_p("VAULT") / ".history" / page_id
    history_base.mkdir(parents=True, exist_ok=True)

    # 10-minute cooldown (600 seconds) to avoid saturating with auto-saves
    COOLDOWN = 600
    
    # Check the last saved version to respect cooldown
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
        log.info(f"Page version created: {version_path}")
    except Exception as e:
        log.warning(f"Could not create version for {page_id}: {e}")


@router.get("/pages/{page_id}/history")
async def get_page_history(page_id: str):
    """Returns the list of available versions for a page."""
    history_base = get_p("VAULT") / ".history" / page_id
    if not history_base.exists():
        return []
    
    versions = []
    # Glob returns files, we sort them descending by name (which is the timestamp)
    for f in sorted(history_base.glob("*.md"), key=lambda x: x.name, reverse=True):
        ts_str = f.stem
        try:
            # Try to format the timestamp to make it readable
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
    """Returns the content of a specific version."""
    version_path = get_p("VAULT") / ".history" / page_id / f"{timestamp}.md"
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Version not found")
    
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
        log.error(f"Error reading version {timestamp} of {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading the version")


@router.post("/pages/{page_id}/history/restore/{timestamp}")
async def restore_page_version(page_id: str, timestamp: str, background_tasks: BackgroundTasks):
    """Restores a page to a previous version."""
    version_path = get_p("VAULT") / ".history" / page_id / f"{timestamp}.md"
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Version not found")
    
    file_path = find_page_path(page_id)
    if not file_path:
         raise HTTPException(status_code=404, detail="Current page not found")

    # Save current version (state just before restoration) just in case
    _create_page_version(page_id, file_path)
    
    try:
        shutil.copy2(version_path, file_path)
        log.info(f"Page {page_id} restored to version {timestamp}")
        
        # Optionally recompute formulas if page belongs to a table
        raw_content = file_path.read_text(encoding="utf-8")
        metadata, _ = parse_frontmatter(raw_content, file_path)
        table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if table_id:
            background_tasks.add_task(_recompute_cross_record_formulas_for_table, table_id, page_id)
            
        return {"status": "success", "message": "Page restored successfully"}
    except Exception as e:
        log.error(f"Error restoring version {timestamp} of {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error restoring the version")


@router.delete("/pages/{page_id}/history")
async def purge_page_history(page_id: str):
    """Deletes all version history of a page."""
    history_base = get_p("VAULT") / ".history" / page_id
    if not history_base.exists():
        return {"status": "success", "message": "No history to delete"}
    
    try:
        shutil.rmtree(history_base)
        log.info(f"Page history for {page_id} purged")
        return {"status": "success", "message": "History deleted successfully"}
    except Exception as e:
        log.error(f"Error purging history for {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error deleting history")
