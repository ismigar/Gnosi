"""Deterministic managed indexes and logs for the LLM Wiki Brain table."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional

from backend.config.logger_config import get_logger
from backend.services import llm_wiki_config, llm_wiki_storage
from backend.utils.safe_io import safe_write_json

logger = get_logger(__name__)

MANAGED_START = "<!-- gnosi:llm-wiki:start {key} -->"
MANAGED_END = "<!-- gnosi:llm-wiki:end {key} -->"

ROLE_GENERAL_INDEX = "general-index"
ROLE_RESOURCE_INDEX = "resource-index"
ROLE_DIMENSION_INDEX = "dimension-index"
ROLE_SCHEMA = "schema"
ROLE_LOG = "log"

SYSTEM_TITLES = {
    "ca": {
        ROLE_GENERAL_INDEX: "Índex general",
        ROLE_SCHEMA: "Esquema del Cervell",
        ROLE_LOG: "Registre del Cervell",
    },
    "en": {
        ROLE_GENERAL_INDEX: "General index",
        ROLE_SCHEMA: "Brain schema",
        ROLE_LOG: "Brain log",
    },
    "es": {
        ROLE_GENERAL_INDEX: "Índice general",
        ROLE_SCHEMA: "Esquema del Cerebro",
        ROLE_LOG: "Registro del Cerebro",
    },
    "fr": {
        ROLE_GENERAL_INDEX: "Index général",
        ROLE_SCHEMA: "Schéma du Cerveau",
        ROLE_LOG: "Journal du Cerveau",
    },
}


def ensure_system_pages(brain_table_id: str, config: dict[str, Any]) -> dict[str, str]:
    """Create the three system pages without adopting same-title manual pages."""
    migrate_managed_frontmatter(brain_table_id)
    brain_table = _table(brain_table_id) or {}
    props_by_id = {
        str(prop.get("id") or ""): prop
        for prop in brain_table.get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }
    index_metadata: dict[str, Any] = {}
    system_metadata: dict[str, Any] = {}
    _set_visible_note_type(index_metadata, config, props_by_id, "index")
    _set_visible_note_type(system_metadata, config, props_by_id, "system")
    schema_content = _schema_content(config)
    general = _upsert_managed_page(
        brain_table_id,
        _system_title(ROLE_GENERAL_INDEX, config),
        ROLE_GENERAL_INDEX,
        "general",
        "_There are no resource or field indexes yet._",
        index_metadata,
    )
    schema = _upsert_managed_page(
        brain_table_id,
        _system_title(ROLE_SCHEMA, config),
        ROLE_SCHEMA,
        "schema",
        schema_content,
        system_metadata,
    )
    log_page = _upsert_managed_page(
        brain_table_id,
        _system_title(ROLE_LOG, config),
        ROLE_LOG,
        "log",
        "_The log is empty._",
        system_metadata,
    )
    return {
        ROLE_GENERAL_INDEX: general["id"],
        ROLE_SCHEMA: schema["id"],
        ROLE_LOG: log_page["id"],
    }


def migrate_managed_frontmatter(brain_table_id: str) -> int:
    """Move legacy managed metadata from Brain Markdown files to sidecars."""
    migrated = 0
    for page in _brain_pages(brain_table_id):
        path = _path(page)
        if not path:
            continue
        metadata, body = _read_page(path)
        if not any(str(key).startswith("llm_wiki_") for key in metadata):
            continue
        _save_existing_page(path, metadata, body)
        migrated += 1
    if migrated:
        logger.info(
            "LLM Wiki moved managed metadata for %d Brain pages to sidecars",
            migrated,
        )
    return migrated


def rebuild_indexes(brain_table_id: str, config: dict[str, Any]) -> dict[str, Any]:
    """Rebuild every managed resource/dimension/general index and search cache."""
    ensure_system_pages(brain_table_id, config)
    source_records_synced = sync_source_dimensions(brain_table_id, config)
    pages = _brain_pages(brain_table_id)
    brain_table = _table(brain_table_id)
    props_by_id = {
        str(prop.get("id") or ""): prop
        for prop in (brain_table or {}).get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }

    readings = [
        page
        for page in pages
        if _note_kind(page) == "lectura" and not _meta(page).get("llm_wiki_stale")
    ]
    permanents = [page for page in pages if _note_kind(page) == "permanent"]
    resources: dict[tuple[str, str], list[Any]] = {}
    for page in readings:
        meta = _meta(page)
        source_table_id = str(meta.get("llm_wiki_source_table_id") or "")
        resource_id = str(meta.get("llm_wiki_resource_id") or "")
        if source_table_id and resource_id:
            resources.setdefault((source_table_id, resource_id), []).append(page)

    resource_pages = []
    for (source_table_id, resource_id), resource_readings in resources.items():
        source_cfg = next(
            (
                item
                for item in config.get("source_tables") or []
                if item.get("table_id") == source_table_id
            ),
            {},
        )
        resource_pages.append(
            _upsert_resource_index(
                brain_table_id,
                source_table_id,
                resource_id,
                resource_readings,
                source_cfg,
                config,
                props_by_id,
            )
        )

    dimension_pages = []
    for field_id in config.get("index_field_ids") or []:
        prop = props_by_id.get(str(field_id))
        if not prop:
            continue
        dimension_pages.extend(
            _rebuild_dimension_indexes(
                brain_table_id,
                prop,
                readings,
                permanents,
                config,
            )
        )

    _rebuild_general_index(brain_table_id, resource_pages, dimension_pages, config)
    cache_count = rebuild_search_cache(brain_table_id)
    return {
        "resource_indexes": len(resource_pages),
        "dimension_indexes": len(dimension_pages),
        "reading_notes": len(readings),
        "permanent_notes": len(permanents),
        "search_cache_notes": cache_count,
        "source_records_synced": source_records_synced,
    }


def sync_source_dimensions(
    brain_table_id: str,
    config: dict[str, Any],
) -> int:
    """Synchronize configured source fields into existing managed reading notes."""
    from backend.services import llm_wiki

    brain_table = _table(brain_table_id) or {}
    brain_props = {
        str(prop.get("id") or ""): prop
        for prop in brain_table.get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }
    source_configs = {
        str(item.get("table_id") or ""): item
        for item in config.get("source_tables") or []
        if isinstance(item, dict) and item.get("table_id")
    }
    source_tables = {
        table_id: _table(table_id) or {"id": table_id, "properties": []}
        for table_id in source_configs
    }
    source_pages = {
        table_id: {
            _page_id(page): page
            for page in _brain_pages(table_id)
            if _page_id(page)
        }
        for table_id in source_configs
    }

    mapped_cache: dict[tuple[str, str], dict[str, Any]] = {}
    updated = 0
    for page in _brain_pages(brain_table_id):
        meta = _meta(page)
        if _note_kind(page) != "lectura" or not meta.get("llm_wiki_managed"):
            continue
        source_table_id = str(meta.get("llm_wiki_source_table_id") or "")
        resource_id = str(meta.get("llm_wiki_resource_id") or "")
        source_config = source_configs.get(source_table_id)
        source_page = (source_pages.get(source_table_id) or {}).get(resource_id)
        if not source_config or source_page is None:
            continue

        cache_key = (source_table_id, resource_id)
        mapped = mapped_cache.get(cache_key)
        if mapped is None:
            mapped, _ai_specs = llm_wiki._dimension_context(  # noqa: SLF001
                config,
                source_tables[source_table_id],
                source_config,
                _meta(source_page),
            )
            mapped_cache[cache_key] = mapped
        path = _path(page)
        if not path:
            continue
        metadata, body = _read_page(path)
        changed = False
        for field_id, mapping in (source_config.get("dimension_mappings") or {}).items():
            if str((mapping or {}).get("mode") or "ai") != "source":
                continue
            prop = brain_props.get(str(field_id))
            name = str((prop or {}).get("name") or "")
            if not name:
                continue
            value = mapped.get(str(field_id))
            if value in (None, "", [], {}):
                if name in metadata:
                    metadata.pop(name, None)
                    changed = True
            elif metadata.get(name) != value:
                metadata[name] = value
                changed = True

        cleaned_body = _remove_redundant_source_links(body)
        if cleaned_body != body:
            body = cleaned_body
            changed = True
        if changed:
            _save_existing_page(path, metadata, body)
            updated += 1
    return updated


def _remove_redundant_source_links(body: str) -> str:
    """Remove source wikilinks appended to managed citation deep links."""
    return re.sub(
        r"(?m)(\]\(gnosi-cite:\?[^)\n]+\))\s*·\s*\[\[[^\]\n]+\]\](?=\s*$)",
        r"\1",
        str(body or ""),
    )


def append_log(
    brain_table_id: str,
    *,
    resource_title: str,
    resource_id: str,
    source_table_id: str,
    report: dict[str, Any],
) -> None:
    """Append one compact semantic entry to the managed Brain log."""
    ensure_system_pages(brain_table_id, llm_wiki_config.load_config())
    page = _find_managed_page(brain_table_id, ROLE_LOG)
    if not page:
        return
    path = _path(page)
    meta, body = _read_page(path)
    marker_key = "log"
    existing = _managed_content(body, marker_key)
    if existing.strip() in {"_The log is empty._", "_El registre encara és buit._"}:
        existing = ""
    timestamp = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    warnings = report.get("warnings") or []
    entry = (
        f"- **{timestamp}** · {_wikilink(resource_id, resource_title)} · "
        f"table `{source_table_id}` · {report.get('source_count', 0)} sources · "
        f"{len(report.get('created') or [])} created · "
        f"{len(report.get('updated') or [])} updated · "
        f"model `{report.get('model') or '—'}`"
    )
    if warnings:
        entry += f" · {len(warnings)} warnings"
    updated = (existing.rstrip() + "\n" + entry).strip()
    _save_existing_page(path, meta, _replace_managed_block(body, marker_key, updated))


def rebuild_search_cache(brain_table_id: str) -> int:
    """Write a rebuildable Brain-only lexical cache outside the synced vault."""
    from backend.api.vault_routes import get_p

    records = []
    for page in _brain_pages(brain_table_id):
        if _meta(page).get("is_template"):
            continue
        path = _path(page)
        _metadata, body = _read_page(path)
        records.append({
            "id": _page_id(page),
            "title": _title(page),
            "note_type": _note_kind(page),
            "managed_role": str(_meta(page).get("llm_wiki_role") or ""),
            "excerpt": " ".join(body.split())[:1200],
            "vector": search_vector(f"{_title(page)}\n{body}"),
            "source_table_id": str(_meta(page).get("llm_wiki_source_table_id") or ""),
            "resource_id": str(_meta(page).get("llm_wiki_resource_id") or ""),
        })
    root = get_p("LOCAL_DATA") / "llm_wiki"
    root.mkdir(parents=True, exist_ok=True)
    safe_write_json(
        root / f"search-{_safe_token(brain_table_id)}.json",
        {"brain_table_id": brain_table_id, "updated_at": dt.datetime.now().isoformat(), "notes": records},
        indent=2,
        ensure_ascii=False,
    )
    return len(records)


def load_search_cache(brain_table_id: str) -> list[dict[str, Any]]:
    from backend.api.vault_routes import get_p

    path = get_p("LOCAL_DATA") / "llm_wiki" / f"search-{_safe_token(brain_table_id)}.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        notes = payload.get("notes") if isinstance(payload, dict) else []
        return [item for item in notes if isinstance(item, dict)]
    except Exception:
        return []


def search_vector(text: str, dimensions: int = 192) -> list[float]:
    """Build a deterministic local hashed vector for hybrid cache search."""
    normalized = unicodedata.normalize("NFKD", str(text or "").casefold())
    normalized = "".join(
        char for char in normalized
        if not unicodedata.combining(char)
    )
    words = re.findall(r"[a-z0-9]{2,}", normalized)
    features = list(words)
    features.extend(
        word[index:index + 3]
        for word in words
        for index in range(max(0, len(word) - 2))
    )
    vector = [0.0] * dimensions
    for feature in features:
        digest = hashlib.sha256(feature.encode("utf-8")).digest()
        slot = int.from_bytes(digest[:4], "big") % dimensions
        vector[slot] += 1.0
    norm = math.sqrt(sum(value * value for value in vector))
    return [round(value / norm, 7) for value in vector] if norm else vector


def vector_similarity(left: list[Any], right: list[Any]) -> float:
    """Cosine similarity for normalized cache vectors."""
    if not left or not right or len(left) != len(right):
        return 0.0
    try:
        return float(sum(float(a) * float(b) for a, b in zip(left, right)))
    except (TypeError, ValueError):
        return 0.0


def _upsert_resource_index(
    brain_table_id: str,
    source_table_id: str,
    resource_id: str,
    readings: list[Any],
    source_config: dict[str, Any],
    config: dict[str, Any],
    props_by_id: dict[str, dict],
) -> dict[str, Any]:
    readings = sorted(
        readings,
        key=lambda page: (
            _sortable_integer(_meta(page).get("llm_wiki_origin_order")),
            _sortable_integer(
                _meta(page).get("Posició") or _meta(page).get("position"),
            ),
            _title(page).casefold(),
        ),
    )
    resource_title = next(
        (
            str(_meta(page).get("llm_wiki_resource_title") or "")
            for page in readings
            if _meta(page).get("llm_wiki_resource_title")
        ),
        resource_id,
    )
    grouped: dict[tuple[int, str], list[Any]] = {}
    for page in readings:
        meta = _meta(page)
        key = (
            _sortable_integer(meta.get("llm_wiki_origin_order")),
            str(meta.get("llm_wiki_origin_label") or "Source"),
        )
        grouped.setdefault(key, []).append(page)
    lines = []
    for (_order, label), notes in sorted(grouped.items(), key=lambda item: item[0]):
        lines.extend([f"## {label}", ""])
        for page in notes:
            position = _meta(page).get("Posició") or _meta(page).get("position") or "—"
            lines.append(f"{position}. {_page_wikilink(page)}")
        lines.append("")

    metadata: dict[str, Any] = {
        "llm_wiki_source_table_id": source_table_id,
        "llm_wiki_resource_id": resource_id,
        "llm_wiki_resource_title": resource_title,
    }
    for field_id in config.get("index_field_ids") or []:
        prop = props_by_id.get(str(field_id))
        if not prop:
            continue
        name = str(prop.get("name") or "")
        value = next((_meta(page).get(name) for page in readings if _meta(page).get(name)), None)
        if value not in (None, "", [], {}):
            metadata[name] = value
    relation_prop = props_by_id.get(str(source_config.get("relation_property_id") or ""))
    if relation_prop:
        metadata[str(relation_prop.get("name"))] = [f"[[{resource_title}|{resource_id}]]"]
    _set_visible_note_type(metadata, config, props_by_id, "index")
    return _upsert_managed_page(
        brain_table_id,
        f"{_index_prefix(config)} · {resource_title}",
        ROLE_RESOURCE_INDEX,
        f"resource:{source_table_id}:{resource_id}",
        "\n".join(lines).strip(),
        metadata,
        selector={
            "llm_wiki_source_table_id": source_table_id,
            "llm_wiki_resource_id": resource_id,
        },
    )


def _rebuild_dimension_indexes(
    brain_table_id: str,
    prop: dict,
    readings: list[Any],
    permanents: list[Any],
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    field_name = str(prop.get("name") or prop.get("id") or "")
    field_id = str(prop.get("id") or "")
    grouped: dict[str, dict[str, Any]] = {}
    for page in [*readings, *permanents]:
        for raw_value in _as_values(_meta(page).get(field_name)):
            value_key = _value_key(raw_value)
            item = grouped.setdefault(value_key, {"value": raw_value, "readings": [], "permanents": []})
            item["readings" if _note_kind(page) == "lectura" else "permanents"].append(page)

    out = []
    for value_key, item in sorted(grouped.items(), key=lambda pair: _value_label(pair[1]["value"]).casefold()):
        label = _value_label(item["value"])
        lines = ["## Reading notes", ""]
        reading_groups: dict[str, list[Any]] = {}
        for page in item["readings"]:
            resource = str(_meta(page).get("llm_wiki_resource_title") or "No resource")
            reading_groups.setdefault(resource, []).append(page)
        if not reading_groups:
            lines.append("_No reading notes._")
        for resource, pages in sorted(reading_groups.items(), key=lambda pair: pair[0].casefold()):
            lines.extend([f"### {resource}", ""])
            for page in sorted(
                pages,
                key=lambda p: (
                    _sortable_integer(_meta(p).get("llm_wiki_origin_order")),
                    _sortable_integer(_meta(p).get("Posició")),
                ),
            ):
                lines.append(f"- {_page_wikilink(page)}")
            lines.append("")
        lines.extend(["## Manual permanent notes", ""])
        if item["permanents"]:
            lines.extend(
                f"- {_page_wikilink(page)}"
                for page in sorted(item["permanents"], key=lambda p: _title(p).casefold())
            )
        else:
            lines.append("_No manual permanent notes._")

        metadata = {field_name: item["value"]}
        brain_table = _table(brain_table_id)
        props_by_id = {
            str(p.get("id") or ""): p
            for p in (brain_table or {}).get("properties") or []
            if isinstance(p, dict)
        }
        _set_visible_note_type(metadata, config, props_by_id, "index")
        out.append(
            _upsert_managed_page(
                brain_table_id,
                f"{_index_prefix(config)} · {field_name}: {label}",
                ROLE_DIMENSION_INDEX,
                f"dimension:{field_id}:{value_key}",
                "\n".join(lines).strip(),
                metadata,
                selector={
                    "llm_wiki_dimension_field_id": field_id,
                    "llm_wiki_dimension_value_key": value_key,
                },
            )
        )
    return out


def _rebuild_general_index(
    brain_table_id: str,
    resource_pages: list[dict[str, Any]],
    dimension_pages: list[dict[str, Any]],
    config: dict[str, Any],
) -> None:
    lines = ["## Field indexes", ""]
    if dimension_pages:
        lines.extend(
            f"- {_wikilink(page['id'], page['title'])}"
            for page in sorted(dimension_pages, key=lambda p: p["title"].casefold())
        )
    else:
        lines.append("_No indexed fields yet._")
    lines.extend(["", "## Processed resources", ""])
    if resource_pages:
        lines.extend(
            f"- {_wikilink(page['id'], page['title'])}"
            for page in sorted(resource_pages, key=lambda p: p["title"].casefold())
        )
    else:
        lines.append("_No processed resources yet._")
    _upsert_managed_page(
        brain_table_id,
        _system_title(ROLE_GENERAL_INDEX, config),
        ROLE_GENERAL_INDEX,
        "general",
        "\n".join(lines).strip(),
    )


def _system_title(role: str, config: dict[str, Any]) -> str:
    locale = str(config.get("ui_locale") or "en").split("-", 1)[0].lower()
    titles = SYSTEM_TITLES.get(locale) or SYSTEM_TITLES["en"]
    return titles[role]


def _index_prefix(config: dict[str, Any]) -> str:
    locale = str(config.get("ui_locale") or "en").split("-", 1)[0].lower()
    return {"ca": "Índex", "en": "Index", "es": "Índice", "fr": "Index"}.get(
        locale,
        "Index",
    )


def _schema_content(config: dict[str, Any]) -> str:
    source_lines = []
    for source in config.get("source_tables") or []:
        source_lines.append(
            f"- Table `{source.get('table_id')}` · attachments "
            f"{', '.join(source.get('attachment_property_ids') or []) or '—'} · URL "
            f"{', '.join(source.get('url_property_ids') or []) or '—'}"
        )
    return "\n".join([
        "This document describes the managed Brain schema. Content outside the managed "
        "block is preserved.",
        "",
        f"- Configuration version: `{config.get('version', 2)}`",
        f"- Brain table: `{config.get('brain_table_id') or '—'}`",
        f"- Index fields: `{', '.join(config.get('index_field_ids') or []) or '—'}`",
        "- Sources:",
        *(source_lines or ["  - No configured sources"]),
        "",
        "Convention: reading notes are atomic and managed; permanent notes are manual; "
        "indexes rewrite only their delimited blocks.",
    ])


def _set_visible_note_type(
    metadata: dict[str, Any],
    config: dict[str, Any],
    props_by_id: dict[str, dict],
    kind: str,
) -> None:
    role_id = str((config.get("brain_roles") or {}).get("note_type") or "")
    prop = props_by_id.get(role_id)
    if prop and prop.get("name"):
        metadata[str(prop["name"])] = llm_wiki_config.note_type_value(
            kind,
            config,
            prop,
        )


def _upsert_managed_page(
    brain_table_id: str,
    title: str,
    role: str,
    managed_key: str,
    content: str,
    extra_metadata: Optional[dict[str, Any]] = None,
    selector: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    from backend.api.vault_routes import (
        _get_unique_filepath,
        _resolve_table_folder_from_metadata,
        register_page_in_index,
        save_page_md,
    )

    page = _find_managed_page(brain_table_id, role, selector=selector)
    metadata = {
        "title": title,
        "table_id": brain_table_id,
        "note_type": "index" if role in {ROLE_GENERAL_INDEX, ROLE_RESOURCE_INDEX, ROLE_DIMENSION_INDEX} else "system",
        "llm_wiki_managed": True,
        "llm_wiki_role": role,
        **(selector or {}),
        **(extra_metadata or {}),
    }
    if page:
        path = _path(page)
        old_meta, body = _read_page(path)
        old_meta.update(metadata)
        _save_existing_page(path, old_meta, _replace_managed_block(body, managed_key, content))
        return {"id": str(old_meta.get("id") or _page_id(page)), "title": str(old_meta.get("title") or title)}

    brain_dir = _resolve_table_folder_from_metadata({"table_id": brain_table_id})
    if not brain_dir:
        raise RuntimeError("Could not resolve the Brain table folder")
    brain_dir.mkdir(parents=True, exist_ok=True)
    metadata["id"] = str(uuid.uuid4())
    path = _get_unique_filepath(brain_dir, title, ".md")
    save_page_md(
        path,
        llm_wiki_storage.prepare_managed_markdown(metadata),
        _replace_managed_block("", managed_key, content),
    )
    register_page_in_index(path)
    return {"id": metadata["id"], "title": title}


def _find_managed_page(
    brain_table_id: str,
    role: str,
    *,
    selector: Optional[dict[str, Any]] = None,
) -> Any:
    for page in _brain_pages(brain_table_id):
        meta = _meta(page)
        if meta.get("llm_wiki_role") != role:
            continue
        if selector and any(str(meta.get(key) or "") != str(value or "") for key, value in selector.items()):
            continue
        return page
    return None


def _replace_managed_block(body: str, key: str, content: str) -> str:
    start = MANAGED_START.format(key=key)
    end = MANAGED_END.format(key=key)
    block = f"{start}\n{content.strip()}\n{end}"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.DOTALL)
    if pattern.search(body or ""):
        return pattern.sub(block, body).rstrip() + "\n"
    prefix = str(body or "").rstrip()
    return ((prefix + "\n\n") if prefix else "") + block + "\n"


def _managed_content(body: str, key: str) -> str:
    start = MANAGED_START.format(key=key)
    end = MANAGED_END.format(key=key)
    match = re.search(re.escape(start) + r"\n?(.*?)\n?" + re.escape(end), body or "", re.DOTALL)
    return match.group(1).strip() if match else ""


def _save_existing_page(path: Path, metadata: dict[str, Any], body: str) -> None:
    from backend.api.vault_routes import register_page_in_index, save_page_md

    save_page_md(
        path,
        llm_wiki_storage.prepare_managed_markdown(metadata),
        body.rstrip() + "\n",
    )
    register_page_in_index(path)


def _read_page(path: Optional[Path]) -> tuple[dict[str, Any], str]:
    if not path or not path.exists():
        return {}, ""
    from backend.api.vault_routes import parse_frontmatter

    return parse_frontmatter(path.read_text(encoding="utf-8"), path)


def _brain_pages(brain_table_id: str) -> list[Any]:
    from backend.api.vault_routes import _get_pages_for_table

    return list(_get_pages_for_table(brain_table_id) or [])


def _table(table_id: str) -> Optional[dict]:
    from backend.api.vault_routes import _table_by_id

    return _table_by_id(table_id)


def _meta(page: Any) -> dict[str, Any]:
    return llm_wiki_storage.page_metadata(page)


def _page_id(page: Any) -> str:
    if isinstance(page, dict):
        return str(page.get("id") or _meta(page).get("id") or "")
    return str(getattr(page, "id", "") or _meta(page).get("id") or "")


def _wikilink(target_id: Any, title: Any) -> str:
    """Create a stable-ID wikilink with a human-readable visible alias."""
    return f"[[{str(target_id or '')}|{str(title or '')}]]"


def _page_wikilink(page: Any) -> str:
    """Create a stable-ID wikilink for a Brain page."""
    return _wikilink(_page_id(page), _title(page))


def _title(page: Any) -> str:
    if isinstance(page, dict):
        return str(page.get("title") or _meta(page).get("title") or "")
    return str(getattr(page, "title", "") or _meta(page).get("title") or "")


def _path(page: Any) -> Optional[Path]:
    value = page.get("path") if isinstance(page, dict) else getattr(page, "path", None)
    return Path(value) if value else None


def _note_kind(page: Any) -> str:
    return llm_wiki_config.metadata_note_type(_meta(page))


def _as_values(value: Any) -> list[Any]:
    if value in (None, "", [], {}):
        return []
    return value if isinstance(value, list) else [value]


def _value_label(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("title") or value.get("id") or "")
    raw = str(value or "").strip()
    if raw.startswith("[[") and raw.endswith("]]"):
        return raw[2:-2].split("|", 1)[0].strip()
    return raw


def _value_key(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]


def _safe_token(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isalnum() or ch in {"-", "_"})[:120]


def _sortable_integer(value: Any) -> int:
    """Return a stable numeric sort key for typed or legacy position values."""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        match = re.search(r"-?\d+", str(value or ""))
        return int(match.group(0)) if match else 0


def _normalized(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())
