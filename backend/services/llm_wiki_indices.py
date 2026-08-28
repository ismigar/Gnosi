"""Deterministic managed indexes and logs for the LLM Wiki Brain table."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional, cast

from backend.config.logger_config import get_logger
from backend.domains.llm_wiki import index_rendering as llm_wiki_index_rendering
from backend.domains.llm_wiki import legacy_ports as llm_wiki_legacy_ports
from backend.domains.llm_wiki import search_index as llm_wiki_search_index
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

    resource_pages: list[dict[str, Any]] = []
    for (source_table_id, resource_id), resource_readings in resources.items():
        source_cfg: dict[str, Any] = next(
            (
                dict(item)
                for item in config.get("source_tables") or []
                if isinstance(item, dict) and item.get("table_id") == source_table_id
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

    dimension_pages: list[dict[str, Any]] = []
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
        table_id: {_page_id(page): page for page in _brain_pages(table_id) if _page_id(page)}
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
    _save_existing_page(
        cast(Path, path),
        meta,
        _replace_managed_block(body, marker_key, updated),
    )


def rebuild_search_cache(brain_table_id: str) -> int:
    """Write a rebuildable Brain-only lexical cache outside the synced vault."""
    def clear_search_cache(table_id: str) -> None:
        from backend.agent.vault_tools import clear_wiki_search_cache

        clear_wiki_search_cache(table_id)

    dependencies = llm_wiki_search_index.SearchDependencies(
        brain_pages=_brain_pages,
        metadata=_meta,
        note_kind=_note_kind,
        page_id=_page_id,
        page_path=_path,
        read_page=_read_page,
        safe_token=_safe_token,
        title=_title,
        vector=search_vector,
        local_data=llm_wiki_legacy_ports.local_data_path,
        json_writer=_write_search_json,
        upsert_records=upsert_search_records,
        clear_search_cache=clear_search_cache,
    )
    return llm_wiki_search_index.rebuild_search_cache(
        brain_table_id,
        dependencies=dependencies,
    )


def _fts_path(brain_table_id: str) -> Path:
    return llm_wiki_search_index.fts_path(
        brain_table_id,
        local_data=llm_wiki_legacy_ports.local_data_path,
        safe_token=_safe_token,
    )


def _write_search_json(
    path: Path,
    payload: object,
    *,
    indent: int,
    ensure_ascii: bool,
) -> object:
    safe_write_json(path, payload, indent=indent, ensure_ascii=ensure_ascii)
    return None


def upsert_search_records(
    brain_table_id: str,
    records: Iterable[dict[str, Any]],
    *,
    replace_snapshot: bool = False,
) -> int:
    """Apply only changed records to the FTS5 sidecar.

    ``replace_snapshot`` is used by a complete rebuild to remove deleted notes;
    callers receiving a file-change event can pass a smaller delta without
    rewriting unrelated records.
    """
    return llm_wiki_search_index.upsert_search_records(
        brain_table_id,
        records,
        replace_snapshot=replace_snapshot,
        path_for_index=_fts_path,
        logger=logger,
    )


def _rebuild_fts_index(brain_table_id: str, records: list[dict[str, Any]]) -> None:
    """Compatibility wrapper for callers that still request a full rebuild."""
    llm_wiki_search_index.rebuild_fts_index(
        brain_table_id,
        records,
        upsert_records=upsert_search_records,
    )


def mark_search_index_stale(brain_table_id: str, stale: bool = True) -> None:
    """Mark an index stale when a vault change arrives before reindexing."""
    llm_wiki_search_index.mark_search_index_stale(
        brain_table_id,
        stale,
        path_for_index=_fts_path,
        logger=logger,
    )


def search_index_candidates(
    brain_table_id: str,
    query: str,
    limit: int = 128,
) -> list[dict[str, Any]]:
    """Return lexical candidates from FTS5, falling back to the JSON cache."""
    return llm_wiki_search_index.search_index_candidates(
        brain_table_id,
        query,
        limit,
        path_for_index=_fts_path,
        load_cache=load_search_cache,
    )


def search_index_status(brain_table_id: str) -> dict[str, Any]:
    """Expose bounded freshness metadata for diagnostics and UX progress."""
    return llm_wiki_search_index.search_index_status(
        brain_table_id,
        path_for_index=_fts_path,
    )


def load_search_cache(brain_table_id: str) -> list[dict[str, Any]]:
    return llm_wiki_search_index.load_search_cache(
        brain_table_id,
        local_data=llm_wiki_legacy_ports.local_data_path,
        safe_token=_safe_token,
    )


def search_vector(text: str, dimensions: int = 192) -> list[float]:
    """Build a deterministic local hashed vector for hybrid cache search."""
    return llm_wiki_search_index.search_vector(text, dimensions)


def vector_similarity(left: list[Any], right: list[Any]) -> float:
    """Cosine similarity for normalized cache vectors."""
    return llm_wiki_search_index.vector_similarity(left, right)


def _index_rendering_dependencies() -> llm_wiki_index_rendering.RenderingDependencies:
    return llm_wiki_index_rendering.RenderingDependencies(
        metadata=_meta,
        note_kind=_note_kind,
        page_wikilink=_page_wikilink,
        sortable_integer=_sortable_integer,
        title=_title,
        table=_table,
        set_visible_note_type=_set_visible_note_type,
        upsert_managed_page=_upsert_managed_page,
        wikilink=_wikilink,
        index_prefix=_index_prefix,
        system_title=_system_title,
        role_resource_index=ROLE_RESOURCE_INDEX,
        role_dimension_index=ROLE_DIMENSION_INDEX,
        role_general_index=ROLE_GENERAL_INDEX,
    )


def _upsert_resource_index(
    brain_table_id: str,
    source_table_id: str,
    resource_id: str,
    readings: list[Any],
    source_config: dict[str, Any],
    config: dict[str, Any],
    props_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return llm_wiki_index_rendering.upsert_resource_index(
        brain_table_id,
        source_table_id,
        resource_id,
        readings,
        source_config,
        config,
        props_by_id,
        dependencies=_index_rendering_dependencies(),
    )


def _rebuild_dimension_indexes(
    brain_table_id: str,
    prop: dict[str, Any],
    readings: list[Any],
    permanents: list[Any],
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    return llm_wiki_index_rendering.rebuild_dimension_indexes(
        brain_table_id,
        prop,
        readings,
        permanents,
        config,
        dependencies=_index_rendering_dependencies(),
    )


def _rebuild_general_index(
    brain_table_id: str,
    resource_pages: list[dict[str, Any]],
    dimension_pages: list[dict[str, Any]],
    config: dict[str, Any],
) -> None:
    llm_wiki_index_rendering.rebuild_general_index(
        brain_table_id,
        resource_pages,
        dimension_pages,
        config,
        dependencies=_index_rendering_dependencies(),
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
    return "\n".join(
        [
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
        ]
    )


def _set_visible_note_type(
    metadata: dict[str, Any],
    config: dict[str, Any],
    props_by_id: dict[str, dict[str, Any]],
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
    page = _find_managed_page(brain_table_id, role, selector=selector)
    metadata = {
        "title": title,
        "table_id": brain_table_id,
        "note_type": "index"
        if role in {ROLE_GENERAL_INDEX, ROLE_RESOURCE_INDEX, ROLE_DIMENSION_INDEX}
        else "system",
        "llm_wiki_managed": True,
        "llm_wiki_role": role,
        **(selector or {}),
        **(extra_metadata or {}),
    }
    if page:
        path = _path(page)
        old_meta, body = _read_page(path)
        old_meta.update(metadata)
        _save_existing_page(
            cast(Path, path),
            old_meta,
            _replace_managed_block(body, managed_key, content),
        )
        return {
            "id": str(old_meta.get("id") or _page_id(page)),
            "title": str(old_meta.get("title") or title),
        }

    brain_dir = llm_wiki_legacy_ports.resolve_table_folder(
        {"table_id": brain_table_id}
    )
    if not brain_dir:
        raise RuntimeError("Could not resolve the Brain table folder")
    brain_dir.mkdir(parents=True, exist_ok=True)
    metadata["id"] = str(uuid.uuid4())
    path = llm_wiki_legacy_ports.unique_filepath(brain_dir, title, ".md")
    llm_wiki_legacy_ports.save_page(
        path,
        llm_wiki_storage.prepare_managed_markdown(metadata),
        _replace_managed_block("", managed_key, content),
    )
    llm_wiki_legacy_ports.register_page(path)
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
        if selector and any(
            str(meta.get(key) or "") != str(value or "") for key, value in selector.items()
        ):
            continue
        return page
    return None


def _replace_managed_block(body: str, key: str, content: str) -> str:
    start = MANAGED_START.format(key=key)
    end = MANAGED_END.format(key=key)
    block = f"{start}\n\n{content.strip()}\n\n{end}"
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
    llm_wiki_legacy_ports.save_page(
        path,
        llm_wiki_storage.prepare_managed_markdown(metadata),
        body.rstrip() + "\n",
    )
    llm_wiki_legacy_ports.register_page(path)


def _read_page(path: Optional[Path]) -> tuple[dict[str, Any], str]:
    if not path or not path.exists():
        return {}, ""
    return llm_wiki_legacy_ports.parse_frontmatter(
        path.read_text(encoding="utf-8"), path
    )


def _brain_pages(brain_table_id: str) -> list[Any]:
    return llm_wiki_legacy_ports.table_pages(brain_table_id)


def _table(table_id: str) -> Optional[dict[str, Any]]:
    return llm_wiki_legacy_ports.table_by_id(table_id)


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
    return str(llm_wiki_config.metadata_note_type(_meta(page)))


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
