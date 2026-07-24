"""Per-vault configuration for the built-in LLM Wiki ("Brain") plugin.

Version 2 separates the Brain table from the source tables and stores field
roles by property id.  That makes the feature independent from localized
column names and allows more than one source table.

The file lives at ``<vault>/.gnosi/llm_wiki.json`` so it follows the vault
between devices.  Large derived artifacts and transient jobs do not live here;
see :mod:`backend.services.llm_wiki_storage`.
"""
from __future__ import annotations

import json
import re
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Optional

cfg_lock = threading.RLock()

CONFIG_FILENAME = "llm_wiki.json"
CONFIG_VERSION = 2

CATEGORICAL_TYPES = {"relation", "select", "multi_select", "status"}
FILE_TYPES = {"files", "file", "attachment", "attachments"}
URL_TYPES = {"url"}

DEFAULT_CONFIG: dict[str, Any] = {
    "version": CONFIG_VERSION,
    # Generated Brain content is English by default. UI copy remains localized.
    "ui_locale": "en",
    "brain_table_id": "",
    # Kept as a read/write compatibility alias for the v1 endpoints.
    "target_table": "",
    "source_tables": [],
    "index_field_ids": [],
    "brain_roles": {},
    "configured": False,
}


def config_path() -> Path:
    """Return ``<active vault>/.gnosi/llm_wiki.json``."""
    from backend.api.vault_routes import get_p

    return get_p("GNOSI_CONFIG") / CONFIG_FILENAME


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def _property_id(prop: dict) -> str:
    return str(prop.get("id") or "").strip()


def _property_type(prop: dict) -> str:
    return str(prop.get("type") or "").strip().lower()


def _properties(table: Optional[dict]) -> list[dict]:
    return [p for p in ((table or {}).get("properties") or []) if isinstance(p, dict)]


def _legacy_reference_table_id() -> str:
    """Best-effort v1 migration source without making config reads fail."""
    try:
        from backend.api.vault_routes import get_reference_table_id

        return str(get_reference_table_id() or "").strip()
    except Exception:
        return ""


def _empty_source(table_id: str, *, include_body: bool = False) -> dict[str, Any]:
    return {
        "table_id": table_id,
        "title_property_id": "",
        "attachment_property_ids": [],
        "url_property_ids": [],
        "language_property_id": "",
        "include_body": include_body,
        "relation_property_id": "",
        "dimension_mappings": {},
    }


def normalize_config(raw: Any, *, reference_table_id: str = "") -> dict[str, Any]:
    """Normalize a v1/v2 payload without touching disk.

    A v1 ``target_table`` becomes ``brain_table_id``.  When v1 had a
    designated references table, it is adopted as the first source table.
    """
    data = raw if isinstance(raw, dict) else {}
    brain_id = str(data.get("brain_table_id") or data.get("target_table") or "").strip()
    sources: list[dict[str, Any]] = []
    seen: set[str] = set()
    raw_sources = data.get("source_tables")
    for item in raw_sources if isinstance(raw_sources, list) else []:
        if isinstance(item, str):
            item = {"table_id": item}
        if not isinstance(item, dict):
            continue
        table_id = str(item.get("table_id") or "").strip()
        if not table_id or table_id in seen:
            continue
        normalized = _empty_source(table_id)
        normalized.update({
            "title_property_id": str(item.get("title_property_id") or "").strip(),
            "attachment_property_ids": _unique_strings(item.get("attachment_property_ids")),
            "url_property_ids": _unique_strings(item.get("url_property_ids")),
            "language_property_id": str(item.get("language_property_id") or "").strip(),
            "include_body": bool(item.get("include_body", False)),
            "relation_property_id": str(item.get("relation_property_id") or "").strip(),
            "dimension_mappings": _normalize_dimension_mappings(item.get("dimension_mappings")),
        })
        sources.append(normalized)
        seen.add(table_id)

    legacy_source = str(reference_table_id or "").strip()
    if not sources and legacy_source:
        # Preserve the v1 body fallback for an already configured References
        # table. Newly selected sources require an attachment or URL.
        sources.append(_empty_source(legacy_source, include_body=True))

    roles = data.get("brain_roles")
    roles = {
        str(key): str(value or "").strip()
        for key, value in (roles.items() if isinstance(roles, dict) else [])
        if str(key).strip() and str(value or "").strip()
    }
    index_ids = _unique_strings(data.get("index_field_ids"))
    ui_locale = str(data.get("ui_locale") or "en").split("-", 1)[0].lower()
    if ui_locale not in {"ca", "en", "es", "fr"}:
        ui_locale = "en"

    return {
        "version": CONFIG_VERSION,
        "ui_locale": ui_locale,
        "brain_table_id": brain_id,
        "target_table": brain_id,
        "source_tables": sources,
        "index_field_ids": index_ids,
        "brain_roles": roles,
        "configured": bool(data.get("configured") or brain_id or sources),
    }


def _unique_strings(value: Any) -> list[str]:
    values = value if isinstance(value, list) else ([] if value in (None, "") else [value])
    return list(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def _normalize_dimension_mappings(value: Any) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(value, dict):
        return out
    for brain_field_id, mapping in value.items():
        field_id = str(brain_field_id or "").strip()
        if not field_id or not isinstance(mapping, dict):
            continue
        mode = str(mapping.get("mode") or "ai").strip().lower()
        if mode not in {"source", "ai", "fixed", "empty"}:
            mode = "ai"
        out[field_id] = {
            "mode": mode,
            "source_property_id": str(mapping.get("source_property_id") or "").strip(),
            "fixed_value": deepcopy(mapping.get("fixed_value")),
        }
    return out


def load_config() -> dict[str, Any]:
    """Read and normalize the active vault configuration."""
    path = config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    return normalize_config(data, reference_table_id=_legacy_reference_table_id())


def save_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Normalize and atomically persist a v2 configuration."""
    from backend.utils.safe_io import safe_write_json

    normalized = normalize_config(cfg)
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(path, normalized, indent=2, ensure_ascii=False)
    return normalized


def migrate_config() -> dict[str, Any]:
    """Persist the normalized v2 representation when the file is still v1."""
    path = config_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        raw = {}
    normalized = normalize_config(raw, reference_table_id=_legacy_reference_table_id())
    if raw != normalized:
        with cfg_lock:
            return save_config(normalized)
    return normalized


def get_brain_table_id() -> str | None:
    table_id = str(load_config().get("brain_table_id") or "").strip()
    return table_id or None


def set_brain_table_id(table_id: str | None) -> None:
    """Compatibility helper used by the legacy Brain-table endpoints."""
    with cfg_lock:
        cfg = load_config()
        cfg["brain_table_id"] = str(table_id or "").strip()
        cfg["target_table"] = cfg["brain_table_id"]
        cfg["configured"] = True
        save_config(cfg)


def set_full_config(cfg: dict[str, Any]) -> dict[str, Any]:
    with cfg_lock:
        return save_config(cfg)


def get_source_table_ids() -> list[str]:
    return [
        str(source.get("table_id") or "")
        for source in load_config().get("source_tables") or []
        if str(source.get("table_id") or "")
    ]


def get_source_config(table_id: str) -> Optional[dict[str, Any]]:
    wanted = str(table_id or "").strip()
    for source in load_config().get("source_tables") or []:
        if source.get("table_id") == wanted:
            return deepcopy(source)
    return None


def is_source_table(table_id: str) -> bool:
    return bool(get_source_config(table_id))


def auto_detect_source(
    table: dict,
    brain_table: Optional[dict] = None,
    index_field_ids: Optional[Iterable[str]] = None,
    current: Optional[dict] = None,
) -> dict[str, Any]:
    """Fill missing source roles from property types and semantic names.

    Explicit current choices always win.  Missing dimension mappings use a
    compatible same-name source property or fall back to AI classification.
    """
    table_id = str(table.get("id") or "").strip()
    result = _empty_source(table_id)
    if current:
        result.update(normalize_config({"source_tables": [current]})["source_tables"][0])

    props = _properties(table)
    by_id = {_property_id(prop): prop for prop in props if _property_id(prop)}

    if result["title_property_id"] not in by_id:
        title = next((p for p in props if _property_type(p) == "title"), None)
        if title is None:
            title = next((p for p in props if _norm(p.get("name")) in {"title", "titol", "nom", "name"}), None)
        result["title_property_id"] = _property_id(title or {})

    valid_files = set(result["attachment_property_ids"]) & set(by_id)
    if not valid_files:
        valid_files = {
            _property_id(prop)
            for prop in props
            if _property_type(prop) in FILE_TYPES
            or _norm(prop.get("name")) in {"files", "fitxers", "arxius", "arxiusadjunt", "adjunts", "attachments"}
        }
    result["attachment_property_ids"] = [pid for pid in by_id if pid in valid_files]

    valid_urls = set(result["url_property_ids"]) & set(by_id)
    if not valid_urls:
        valid_urls = {
            _property_id(prop)
            for prop in props
            if _property_type(prop) in URL_TYPES or _norm(prop.get("name")) in {"url", "enllac", "link"}
        }
    result["url_property_ids"] = [pid for pid in by_id if pid in valid_urls]

    if result["language_property_id"] not in by_id:
        lang = next(
            (p for p in props if _norm(p.get("name")) in {"language", "idioma", "llengua", "lang"}),
            None,
        )
        result["language_property_id"] = _property_id(lang or {})

    brain_props = {
        _property_id(prop): prop
        for prop in _properties(brain_table)
        if _property_id(prop)
    }
    source_by_name = {_norm(prop.get("name")): prop for prop in props}
    mappings = _normalize_dimension_mappings(result.get("dimension_mappings"))
    for brain_field_id in _unique_strings(list(index_field_ids or [])):
        brain_prop = brain_props.get(brain_field_id)
        if not brain_prop:
            continue
        existing = mappings.get(brain_field_id)
        if existing and (
            existing["mode"] != "source"
            or existing.get("source_property_id") in by_id
        ):
            continue
        source_prop = source_by_name.get(_norm(brain_prop.get("name")))
        compatible = source_prop and _compatible_dimension_types(
            _property_type(source_prop), _property_type(brain_prop)
        )
        mappings[brain_field_id] = {
            "mode": "source" if compatible else "ai",
            "source_property_id": _property_id(source_prop or {}) if compatible else "",
            "fixed_value": None,
        }
    result["dimension_mappings"] = mappings
    return result


def _compatible_dimension_types(source_type: str, brain_type: str) -> bool:
    if source_type == brain_type:
        return True
    option_types = {"select", "multi_select", "status"}
    return source_type in option_types and brain_type in option_types


def property_by_id(table: Optional[dict], property_id: str) -> Optional[dict]:
    wanted = str(property_id or "").strip()
    return next((p for p in _properties(table) if _property_id(p) == wanted), None)


def eligible_index_properties(
    brain_table: Optional[dict],
    *,
    excluded_ids: Optional[Iterable[str]] = None,
) -> list[dict]:
    """Categorical Brain properties that can produce deterministic indexes."""
    excluded = set(_unique_strings(list(excluded_ids or [])))
    return [
        deepcopy(prop)
        for prop in _properties(brain_table)
        if _property_id(prop)
        and _property_id(prop) not in excluded
        and _property_type(prop) in CATEGORICAL_TYPES
    ]
