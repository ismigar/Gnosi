"""Typed Vault domain extracted from the historical route facade."""

from __future__ import annotations

import importlib as _legacy_importlib
from pathlib import Path
from re import Pattern
from types import ModuleType
from typing import TYPE_CHECKING

from backend.domains.vault.pages.foundation_values import copy_metadata, metadata_value
from backend.domains.vault.pages.markdown_writer import MarkdownWriterDependencies
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo
from backend.domains.vault.tables.formula_recalculation import FormulaRecalculationDependencies
from backend.utils.open_values import iterable_values

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy

    # Actual function owners; runtime assignments below retain captured overrides.
    from backend.domains.vault.api import pages_queries as _typed_queries
    from backend.services import frontmatter_fallback as _typed_frontmatter
    from backend.utils import safe_io as _typed_safe_io

    _parse_frontmatter_fallback = _typed_frontmatter.parse_frontmatter_fallback
    _sanitize_asset_segment = _typed_safe_io.sanitize_path_segment
    list_pages = _typed_queries.list_pages
    list_pages_by_table = _typed_queries.list_pages_by_table
    list_pages_by_table_snapshot = _typed_queries.list_pages_by_table_snapshot
else:
    _legacy: ModuleType

_foundation_initialized = False
_PAGE_MARKDOWN_WRITER_DEPENDENCIES: MarkdownWriterDependencies
_FORMULA_RECALCULATION_DEPENDENCIES: FormulaRecalculationDependencies
_ASSET_NAME_RE: Pattern[str]


def _relation_keys_for_metadata(metadata: RegistryData) -> set[str] | None:
    """`relation_keys` from the page's table schema, so that `strip` /
    `decorate` recognize relation fields by their current name. None if the
    table can't be resolved (→ `strip` strips by shape; `decorate` does nothing).
    Cheap: `_table_by_id` is cached."""
    try:
        tid = _legacy.get_table_id(metadata)
        if tid:
            return _legacy.relation_keys_from_table(_legacy._table_by_id(tid)) or None
    except Exception:
        return None
    return None


def parse_frontmatter(
    content: str, file_path: Path | None = None, render_snapshots: bool = False
) -> tuple[RegistryData, str]:
    """Parses a markdown file to extract the YAML frontmatter and body.

    If `file_path` allows deriving a vault root and the page has an `id`, it also
    merges the corresponding JSON sidecar (`.gnosi/page_meta/<id>.json`).
    This way internal flags (`*_manual`, `is_template`) live outside the `.md`
    but still appear in the metadata dict as always.

    """
    match = _legacy.re.match("^---\\s*\\n(.*?)\\n---\\s*\\n", content, _legacy.re.DOTALL)
    if match:
        yaml_content = match.group(1)
        body = content[match.end() :]
        if render_snapshots:
            body = _legacy.render_view_snapshots(body)
            body = _legacy.flatten_view_columns(body)
        else:
            body = _legacy.restore_view_fences(body)
            body = _legacy.strip_view_snapshots(body)
        try:
            decoded: object = _legacy.yaml.safe_load(yaml_content) or {}
            metadata = _legacy.apply_sidecar_to(decoded, file_path)
            strip_relations = _legacy.strip_relation_wikilinks
            metadata = strip_relations(metadata, _relation_keys_for_metadata(metadata))
            return (metadata, body)
        except _legacy.yaml.YAMLError as e:
            fallback = _parse_frontmatter_fallback(yaml_content)
            if fallback:
                location = f" in {file_path}" if file_path else ""
                _legacy.log.warning(
                    f"Malformed YAML frontmatter{location}; applying rescue parsing"
                )
                fallback_metadata = _legacy.apply_sidecar_to(fallback, file_path)
                strip_fallback_relations = _legacy.strip_relation_wikilinks
                fallback_metadata = strip_fallback_relations(
                    fallback_metadata, _relation_keys_for_metadata(fallback_metadata)
                )
                return (fallback_metadata, body)
            location = f" in {file_path}" if file_path else ""
            _legacy.log.debug(f"Error parsing YAML frontmatter{location}: {e}")
            return ({}, content)
    return ({}, content)


def generate_frontmatter(metadata: RegistryData) -> str:
    """Generates YAML frontmatter string from a dictionary.

    Internal keys (`*_manual`, `is_template`, …) are filtered out here: they
    must never appear in the `.md`. They are persisted to the JSON sidecar via
    `save_page_md`. If someone calls `generate_frontmatter` without later writing
    the sidecar (not the recommended pattern), these flags would be lost — that's
    why the rule is **always use `save_page_md` to write pages**.

    """
    if not metadata:
        return "---\n---\n"
    fm_meta, _sidecar = _legacy.split_sidecar_metadata(metadata)
    if not fm_meta:
        return "---\n---\n"
    yaml_str = _legacy.yaml.dump(
        fm_meta, default_flow_style=False, sort_keys=False, allow_unicode=True, width=4096
    )
    return f"---\n{yaml_str}---\n"


def _link_index_title_for(page_id: str) -> str | None:
    return _legacy.link_index_service.link_index_title_for(page_id, _legacy._link_index_view())


def _link_index_unique_id_for_title(title: str) -> str | None:
    return _legacy.link_index_service.link_index_unique_id_for_title(
        title, _legacy._link_index_view()
    )


def _load_table_rows(table_id: str) -> list[RegistryData]:
    """Load non-template rows with response-facing field names."""
    return _legacy.vault_view_snapshots.load_table_rows(
        table_id, _legacy.vault_view_snapshot_dependencies
    )


def _resolve_view_and_candidates(
    view_id: str, host_page_id: object
) -> tuple[RegistryData | None, list[RegistryData]]:
    """Resolve one saved view and its candidate rows."""
    return _legacy.vault_view_snapshots.resolve_view_and_candidates(
        view_id, host_page_id, _legacy.vault_view_snapshot_dependencies
    )


def _resolve_view_row_ids(view_id: str, host_page_id: object) -> list[str]:
    """Return the ordered page IDs produced by one saved view."""
    return _legacy.vault_view_snapshots.resolve_view_row_ids(
        view_id, host_page_id, _legacy.vault_view_snapshot_dependencies
    )


def _format_snapshot_cell(value: object, ftype: str | None) -> str:
    """Format one value for a materialized Markdown table cell."""
    return _legacy.vault_view_snapshots.format_snapshot_cell(
        value, ftype, _legacy.vault_view_snapshot_dependencies
    )


def _normalize_visible_properties(vis: object, base_table_id: str | None) -> list[RegistryData]:
    """Normalize visible property references for snapshot rendering."""
    return _legacy.vault_view_snapshots.normalize_visible_properties(vis, base_table_id)


def _resolve_view_table(view_id: str, host_page_id: object) -> RegistryData | None:
    """Resolve one table/list view into materialized headers and rows."""
    return _legacy.vault_view_snapshots.resolve_view_table(
        view_id, host_page_id, _legacy.vault_view_snapshot_dependencies
    )


def _view_snapshot_config(view_id: str) -> RegistryData:
    """Return persisted materialization settings for one view."""
    return _legacy.vault_view_snapshots.view_snapshot_config(
        view_id, _legacy.vault_view_snapshot_dependencies
    )


def refresh_view_snapshots(dry_run: bool = False) -> RegistryData:
    """Materializes the snapshot of ALL pages with an embedded view."""
    return _legacy.vault_view_snapshots.refresh_view_snapshots(
        dry_run, _legacy.vault_view_snapshot_dependencies
    )


def save_page_md(file_path: Path, metadata: RegistryData, body: str) -> None:
    """Writes an .md page with frontmatter / sidecar separation.

    1. Persists internal keys (`*_manual`, `is_template`, …) to the JSON
       sidecar at `<vault>/.gnosi/page_meta/<id>.json`.
    2. Writes the `.md` with only "clean" frontmatter + body.

    This is the canonical wrapper for writing pages. Replaces the
    `generate_frontmatter(metadata) + safe_write_text` pattern.

    "no junk in the .md" GUARANTEE: before serializing, canonicalizes the
    keys to the column's **current name** (resolves `fld_*` and old names/aliases).
    This way no write path can leave `fld_*` in the frontmatter. See the
    `vault_persist_by_name.md` directive.

    """
    return _legacy.page_markdown_writer.save_page_markdown(
        file_path, metadata, body, _PAGE_MARKDOWN_WRITER_DEPENDENCIES
    )


def normalize_metadata_ids(metadata: RegistryData) -> RegistryData:
    """
    Normalizes identification fields in frontmatter.
    Policy: the canonical field is 'id'. If legacy identifier keys exist,
    they are renamed to 'id' and deleted. If 'id' already exists, it's preserved.
    """
    legacy_fields: list[object] = ["source_id", "gnosi_id"]
    for key in list(metadata.keys()):
        normalized = _legacy.re.sub("[^a-z0-9]", "", str(key).lower())
        if normalized in {"sourceid", "gnosiid"}:
            legacy_fields.append(key)
    for field in set(legacy_fields):
        if field in metadata:
            if "id" not in metadata:
                metadata["id"] = metadata[field]
            del metadata[field]
    return metadata


def normalize_table_context(metadata: RegistryData) -> RegistryData:
    """Keeps table context fields synchronized (canonical + legacy)."""
    return _legacy.table_rows.normalize_table_context(metadata)


def ensure_correct_page_location(file_path: Path, metadata: RegistryData) -> Path:
    """Moves notes between Wiki/Templates/Calendar/BD based on metadata."""
    is_template = metadata.get("is_template") is True
    is_calendar = _legacy.is_calendar_entry(metadata)
    is_dashboard = metadata.get("is_dashboard") is True
    if is_template:
        target_dir = _legacy.get_p("PLANTILLES")
    elif is_calendar:
        target_dir = _legacy.get_p("CALENDAR")
    elif is_dashboard:
        target_dir = _legacy.get_p("DASHBOARDS")
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        if table_folder:
            target_dir = table_folder
        else:
            target_dir = _legacy.get_p("WIKI")
    can_relocate = (
        file_path.parent == _legacy.get_p("VAULT")
        or file_path.parent == _legacy.get_p("PLANTILLES")
        or file_path.parent == _legacy.get_p("CALENDAR")
        or (file_path.parent == _legacy.get_p("WIKI"))
        or (file_path.parent == _legacy.get_p("DASHBOARDS"))
    )
    if can_relocate and file_path.parent != target_dir:
        target_dir.mkdir(parents=True, exist_ok=True)
        unique_base = _resolve_unique_filename(
            target_dir, file_path.stem, exclude_path=file_path, extension=file_path.suffix
        )
        new_path = target_dir / f"{unique_base}{file_path.suffix}"
        if file_path.exists() and file_path.is_file():
            file_path.rename(new_path)
        return new_path
    return file_path


def _process_metadata_paths(metadata: RegistryData) -> RegistryData:
    """
    Transforms relative paths starting with Assets/
    into paths accessible via API /api/vault/assets/.
    """
    if not metadata:
        return metadata
    for key in ["cover", "icon"]:
        val = metadata.get(key)
        if isinstance(val, str) and val.startswith("Assets/"):
            metadata[key] = val.replace("Assets/", "/api/vault/assets/", 1)
    return metadata


def _normalize_schema_key(value: object) -> str:
    return _legacy.re.sub("[^a-z0-9]", "", str(value or "").lower())


def _sanitize_filename_base(title: str) -> str:
    """Sanitize a title into a filesystem-safe filename base (without extension)."""
    return _legacy.sanitize_vault_title(title, fallback="Untitled", max_len=200)


def _resolve_unique_filename(
    target_dir: Path,
    base_name: str,
    exclude_path: Path | None = None,
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
        target_dir, base_name, exclude_path=file_path, extension=extension
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


def _is_dashboard_file_path(file_path: Path) -> bool:
    if not file_path or file_path.suffix.lower() != ".json" or (not _legacy.get_p("DASHBOARDS")):
        return False
    try:
        file_path.resolve().relative_to(_legacy.get_p("DASHBOARDS").resolve())
        return True
    except Exception:
        return False


def _read_dashboard_file(file_path: Path) -> tuple[RegistryData, str]:
    data: object = _legacy.json.loads(file_path.read_text(encoding="utf-8"))
    raw_metadata = metadata_value(data, "metadata")
    # Preserve the original second lookup when the first value was a dictionary.
    raw_metadata = metadata_value(data, "metadata") if is_record(raw_metadata) else {}
    metadata = copy_metadata(raw_metadata)
    file_id = metadata_value(data, "id") or metadata.get("id") or file_path.stem
    title = metadata_value(data, "title") or metadata.get("title") or file_path.stem
    parent_id = metadata_value(data, "parent_id")
    metadata["id"] = file_id
    metadata["title"] = title
    if parent_id is not None:
        metadata["parent_id"] = parent_id
    metadata["is_dashboard"] = True
    metadata.setdefault("content_format", "json")
    raw_body = metadata_value(data, "content")
    if raw_body is None:
        body = "{}"
    elif not isinstance(raw_body, str):
        body = _legacy.json.dumps(raw_body, ensure_ascii=False, indent=2)
    else:
        body = _legacy.restore_view_fences(raw_body)
        body = _legacy.strip_view_snapshots(body)
    return (metadata, body)


def _write_dashboard_file(
    file_path: Path,
    page_id: str,
    title: str,
    metadata: RegistryData,
    content: str,
    parent_id: str | None = None,
    is_database: bool = False,
) -> None:
    payload = {
        "id": page_id,
        "title": title,
        "parent_id": parent_id,
        "is_database": is_database,
        "metadata": metadata,
        "content": content,
    }
    _legacy.safe_write_json(file_path, payload, indent=2, ensure_ascii=False)


def _ensure_page_extension(file_path: Path, is_dashboard: bool) -> Path:
    desired_extension = ".json" if is_dashboard else ".md"
    if file_path.suffix.lower() == desired_extension:
        return file_path
    base_name = _sanitize_filename_base(file_path.stem)
    desired_name = _resolve_unique_filename(
        file_path.parent, base_name, exclude_path=file_path, extension=desired_extension
    )
    desired_path = file_path.parent / f"{desired_name}{desired_extension}"
    file_path.rename(desired_path)
    return desired_path


def _is_asset_property(prop: RegistryData) -> bool:
    p_type = str((prop or {}).get("type") or "").strip().lower()
    if p_type in {"files", "file", "image", "images", "attachment", "attachments", "media"}:
        return True
    p_name = str((prop or {}).get("name") or "").strip().lower()
    return p_type == "url" and bool(_ASSET_NAME_RE.search(p_name))


def _stable_value_revision(value: object) -> str:
    return _legacy.hashlib.sha256(
        _legacy.json.dumps(
            value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), default=str
        ).encode("utf-8")
    ).hexdigest()


def _table_views_revision(registry: RegistryData, table_id: str) -> str:
    views = sorted(
        (
            view
            for view in iterable_values(registry.get("views", []))
            if str(metadata_value(view, "table_id") or "") == str(table_id)
        ),
        key=lambda view: str(metadata_value(view, "id") or ""),
    )
    return _stable_value_revision(views)


def _normalize_rel_folder(folder: object) -> str:
    """Normalize a host/container folder to a vault-relative path."""
    return _legacy.table_rows.normalize_relative_folder(folder)


def _build_table_folder_index(
    registry: RegistryData,
) -> dict[str, str]:
    """Map canonical table folders to immutable table IDs."""
    return _legacy.table_rows.build_table_folder_index(registry)


def _resolve_table_id_from_context(
    metadata: RegistryData,
    rel_folder: str,
    folder_to_table: dict[str, str],
    sorted_folders: list[str] | None = None,
) -> str | None:
    return _legacy.table_rows.resolve_table_id_from_context(
        metadata, rel_folder, folder_to_table, sorted_folders
    )


def _resolve_table_folder_from_metadata(
    metadata: RegistryData,
) -> Path | None:
    return _legacy.table_rows.resolve_table_folder_from_metadata(
        metadata, _legacy.table_row_query_dependencies
    )


def _resolve_page_context_from_path(
    metadata: RegistryData, file_path: Path
) -> tuple[str, str | None]:
    return _legacy.table_rows.resolve_page_context_from_path(
        metadata, file_path, _legacy.table_row_query_dependencies
    )


def _recompute_cross_record_formulas_for_table(
    table_id: str, exclude_page_id: str | None = None
) -> None:
    """Recomputes cross-record formulas for a table after changes in a row."""
    return _legacy.formula_recalculation.recompute_cross_record_formulas_for_table(
        table_id, exclude_page_id, _FORMULA_RECALCULATION_DEPENDENCIES
    )


def _vf_page_loader(table_id: str) -> list[PageInfo]:
    """Load canonical table rows for virtual-field computations."""
    return _legacy.table_rows.virtual_page_loader(table_id, _legacy.table_row_query_dependencies)


def _strip_virtual_keys(metadata: RegistryData, table: RegistryData | None) -> RegistryData:
    """Removes field keys with `type:'virtual'` from the metadata (by name or id)
    so the derived value (injected on READ) is never persisted to the `.md`."""
    if not table or not isinstance(metadata, dict):
        return metadata
    props = table.get("properties") or []
    drop = {
        metadata_value(p, "name")
        for p in iterable_values(props)
        if metadata_value(p, "type") == "virtual" and metadata_value(p, "name")
    }
    drop |= {
        metadata_value(p, "id")
        for p in iterable_values(props)
        if metadata_value(p, "type") == "virtual" and metadata_value(p, "id")
    }
    if not drop:
        return metadata
    return {k: v for k, v in metadata.items() if k not in drop}


def _get_pages_for_table(table_id: str) -> list[PageInfo]:
    """Fast-path for pages belonging to one table."""
    return _legacy.table_rows.get_pages_for_table(table_id, _legacy.table_row_query_dependencies)


def _enrich_table_query_pages(table_id: str, pages: list[PageInfo]) -> None:
    _legacy.table_rows.enrich_table_query_pages(
        table_id, pages, _legacy.table_row_query_dependencies
    )


def _enrich_single_query_page(
    metadata: RegistryData, page_id: str, file_path: Path
) -> tuple[RegistryData, str, str | None]:
    folder, table_id = _resolve_page_context_from_path(metadata, file_path)
    table_obj = _legacy._table_by_id(table_id)
    _legacy._vf_inject_for_single_page(
        table_obj, str(metadata.get("id") or page_id), metadata, _vf_page_loader
    )
    if table_obj:
        metadata = _legacy.to_response_names(metadata, table_obj)
    return (metadata, folder, table_id)


def _cached_page_entry_count(vault_key: str) -> int:
    return _legacy.page_index_service.cached_page_entry_count(vault_key)


def initialize_foundation(legacy: ModuleType) -> None:
    """Bind existing page providers once, at their ordered facade bootstrap slot.

    Definitions must exist before loading the facade: other domains capture
    these exact functions while constructing their dependency records.
    """
    global _legacy, _foundation_initialized
    global _parse_frontmatter_fallback
    global _PAGE_MARKDOWN_WRITER_DEPENDENCIES
    global _sanitize_asset_segment
    global _ASSET_NAME_RE
    global _FORMULA_RECALCULATION_DEPENDENCIES
    global list_pages
    global list_pages_by_table
    global list_pages_by_table_snapshot

    if _foundation_initialized:
        if _legacy is not legacy:
            raise RuntimeError("Page foundation is already bound to another facade")
        return
    _legacy = legacy
    _parse_frontmatter_fallback = _legacy.parse_frontmatter_fallback
    _PAGE_MARKDOWN_WRITER_DEPENDENCIES = _legacy.page_markdown_writer.MarkdownWriterDependencies(
        is_dashboard_file=lambda path: _is_dashboard_file_path(path),
        read_dashboard_file=lambda path: _read_dashboard_file(path),
        parse_frontmatter=lambda content, path: parse_frontmatter(content, path),
        new_uuid=lambda: str(_legacy.uuid.uuid4()),
        get_table_id=lambda metadata: _legacy.get_table_id(metadata),
        table_by_id=lambda table_id: _legacy._table_by_id(table_id),
        to_storage_names=lambda metadata, table: _legacy.to_storage_names(metadata, table)[0],
        strip_virtual_keys=lambda metadata, table: _strip_virtual_keys(metadata, table),
        relation_keys=lambda table: _legacy.relation_keys_from_table(table),
        decorate_relations=lambda metadata, relation_keys: _legacy.decorate_relation_wikilinks(
            metadata,
            relation_keys=relation_keys,
            id_to_title=_link_index_title_for,
            title_to_id=_link_index_unique_id_for_title,
        ),
        persist_sidecar=lambda metadata, path: _legacy.persist_sidecar_from(metadata, path),
        dump_yaml=lambda metadata: _legacy.yaml.dump(
            metadata, default_flow_style=False, sort_keys=False, allow_unicode=True, width=4096
        ),
        inject_view_snapshots=lambda body, page_id: _legacy.inject_view_snapshots(
            body,
            resolve_ids=_resolve_view_row_ids,
            id_to_title=_link_index_title_for,
            host_page_id=page_id,
            config_for=_view_snapshot_config,
            resolve_table=_resolve_view_table,
        ),
        compact_view_fences=lambda body: _legacy.compact_view_fences(body),
        write_text=lambda path, content: _legacy.safe_write_text(path, content),
        logger=_legacy.log,
    )
    _sanitize_asset_segment = _legacy.sanitize_path_segment
    _ASSET_NAME_RE = _legacy.re.compile(
        "(^|[\\s_\\-])(image|imatge|imagen|foto|cover|thumbnail|thumb)([\\s_\\-]|$)",
        _legacy.re.IGNORECASE,
    )
    _legacy.table_asset_paths.configure(
        _legacy.table_asset_paths.TableAssetPathDependencies(
            get_path=lambda key: _legacy.get_p(key),
            sanitize_segment=lambda value, fallback: _sanitize_asset_segment(value, fallback),
            is_asset_property=lambda prop: _is_asset_property(prop),
            property_assets_dir=lambda table, database, name: _legacy._property_assets_dir(
                table, database, name
            ),
            table_assets_dir=lambda table, database: _legacy._table_assets_dir(table, database),
            table_asset_paths=lambda table, database: _legacy._table_asset_paths(table, database),
            segments_collide=lambda first, second: _legacy._asset_segments_collide(first, second),
            revision=_legacy.path_collection_revision,
            write_text=lambda path, content: _legacy.safe_write_text(path, content),
            logger=_legacy.log,
        )
    )
    _legacy.table_folders.configure(
        _legacy.table_folders.TableFolderDependencies(
            get_path=lambda key: _legacy.get_p(key),
            normalize_folder=lambda value: _normalize_rel_folder(value),
            move=lambda source, destination: _legacy.shutil.move(source, destination),
            logger=_legacy.log,
        )
    )
    _legacy.table_asset_persistence.configure(
        _legacy.table_asset_persistence.TableAssetPersistenceDependencies(
            get_path=lambda key: _legacy.get_p(key),
            is_asset_property=lambda prop: _is_asset_property(prop),
            sanitize_segment=lambda value, fallback: _sanitize_asset_segment(value, fallback),
            sanitize_filename=lambda value: _sanitize_filename_base(value),
            write_bytes=lambda path, payload: _legacy.safe_write_bytes(path, payload),
            load_registry=lambda: _legacy.load_registry(),
            resolve_table=lambda table_id, registry: _legacy._resolve_table_and_database_for_assets(
                table_id, registry
            ),
            get_table_id=lambda metadata: _legacy.get_table_id(metadata),
            property_config_value=lambda prop, key: _legacy._property_config_value(prop, key),
            normalize_schema_key=lambda value: _normalize_schema_key(value),
            property_assets_dir=lambda table, database, name: _legacy._property_assets_dir(
                table, database, name
            ),
            copy_local_file=lambda source, target: _legacy._copy_local_file_to_assets(
                source, target
            ),
            save_data_url=lambda value, target: _legacy._save_data_url_image_to_assets(
                value, target
            ),
            persist_value=lambda value, target: _legacy._persist_asset_value(value, target),
            logger=_legacy.log,
        )
    )
    _legacy.table_asset_quarantine.configure(
        _legacy.table_asset_quarantine.TableAssetQuarantineDependencies(
            get_path=lambda key: _legacy.get_p(key),
            table_asset_paths=lambda table, database: _legacy._table_asset_paths(table, database),
            revision=_legacy.path_collection_revision,
            write_json=lambda path, value: _legacy.safe_write_json(path, value, indent=2),
            registry_mutation=lambda: _legacy.registry_mutation(),
            active_vault_path=_legacy.active_vault_path,
            logger=_legacy.log,
        )
    )
    _FORMULA_RECALCULATION_DEPENDENCIES = (
        _legacy.formula_recalculation.FormulaRecalculationDependencies(
            lock=_legacy._table_recalc_lock,
            states=_legacy._table_recalc_state,
            monotonic=lambda: _legacy.time.monotonic(),
            cooldown_seconds=_legacy._TABLE_RECALC_COOLDOWN_SECONDS,
            vault_root=lambda: _legacy.get_p("VAULT"),
            parse_frontmatter=lambda content, path: parse_frontmatter(content, path),
            table_has_cross_record_formulas=lambda table_id: (
                _legacy.get_rule_engine().table_has_cross_record_formulas(table_id)
            ),
            process_updates=lambda page_id, old, new: _legacy.get_rule_engine().process_updates(
                page_id, old, new
            ),
            save_page=lambda path, metadata, body: save_page_md(path, metadata, body),
            refresh_page_index=lambda path, metadata, body: _legacy._refresh_page_index_entry(
                path, metadata, body
            ),
            invalidate_pages_cache=lambda: _legacy._pages_cache_invalidate_all(),
            logger=_legacy.log,
        )
    )
    _legacy.page_queries_api.configure(
        _legacy.page_queries_api.PageQueryDependencies(
            get_pages_snapshot=_legacy._get_pages_snapshot,
            page_index_cache_path=lambda: _legacy.get_page_index_cache_path(),
            get_pages_for_table=lambda table_id: _legacy._get_pages_for_table(table_id),
            enrich_table_pages=_enrich_table_query_pages,
            visible_table_pages=_legacy._canonical_visible_table_pages,
            active_vault_path=_legacy.get_active_vault_path,
            get_indexer_status=_legacy.get_indexer_status,
            cached_entry_count=_cached_page_entry_count,
            find_page=lambda page_id, *, allow_full_scan=True: _legacy.find_page_path(
                page_id, allow_full_scan=allow_full_scan
            ),
            materialize_page=lambda path, label: _legacy._materialize_if_online_only(path, label),
            read_dashboard=lambda path: _read_dashboard_file(path),
            is_dashboard=lambda path: _is_dashboard_file_path(path),
            parse_frontmatter=parse_frontmatter,
            enrich_single_page=_enrich_single_query_page,
            file_etag=_legacy.file_etag,
            fetch_preview=lambda path, page_id: _legacy._fetch_preview_with_cache(path, page_id),
            warm_preview=lambda page_id: _legacy._bulk_warm_one(page_id),
            preview_concurrency=_legacy._PREVIEW_WARM_CONCURRENCY,
            preview_timeout_seconds=_legacy._PREVIEW_WARM_PER_ITEM_TIMEOUT_S,
        )
    )
    _legacy.page_queries_api.register_catalog_routes(_legacy.router)
    list_pages = _legacy.page_queries_api.list_pages
    list_pages_by_table = _legacy.page_queries_api.list_pages_by_table
    list_pages_by_table_snapshot = _legacy.page_queries_api.list_pages_by_table_snapshot
    _foundation_initialized = True


initialize_foundation(_legacy_importlib.import_module("backend.api.vault_routes"))
