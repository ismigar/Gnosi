"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")


@_legacy.router.get("/virtual-fields", response_model=None)
async def list_virtual_fields() -> _LegacyAny:
    """Catalogue of virtual field computers available for the schema config UI."""
    return {"computers": _legacy._vf_list_specs()}


_legacy.page_queries_api.register_status_routes(_legacy.router)
get_indexer_status_endpoint = _legacy.page_queries_api.get_indexer_status_endpoint
list_sidebar_summary = _legacy.page_queries_api.list_sidebar_summary


def _get_unique_filepath(
    target_dir: _legacy.Path, name: str, extension: str = ".md"
) -> _legacy.Path:
    """Returns a unique filepath by appending (n) if it already exists."""
    safe_name = _legacy._safe_filename(str(name), target_dir)
    file_path = target_dir / f"{safe_name}{extension}"
    if not file_path.exists():
        return file_path
    counter = 1
    while True:
        candidate_name = f"{safe_name} ({counter})"
        file_path = target_dir / f"{candidate_name}{extension}"
        if not file_path.exists():
            return file_path
        counter += 1


_user_label_cache = _legacy.page_state.user_label_cache


def _resolve_user_label(user_id: str | None) -> str:
    """Display name of a user by their id (falls back to email or id). Cached in memory
    since names rarely change. Used for the Created/Edited by authorship."""
    if not user_id:
        return ""
    if user_id in _user_label_cache:
        return _strict_cast(str, _user_label_cache[user_id])
    label = user_id
    try:
        from backend.data.management_db import get_mgmt_db
        from backend.models.management import User

        gen = get_mgmt_db()
        db = next(gen)
        try:
            u = db.query(User).filter(User.id == user_id).first()
            if u:
                label = u.name or u.email or user_id
        finally:
            try:
                next(gen)
            except StopIteration:
                pass
    except Exception:
        label = user_id
    _user_label_cache[user_id] = label
    return label


def _stamp_author(
    metadata: dict[_LegacyAny, _LegacyAny], user_id: str | None, is_create: bool
) -> None:
    """Stamps authorship onto the frontmatter: `created_by`/`created_at` (only on
    creation, not overwritten if already present) and `last_edited_by`/`last_edited_at` (on
    every save). Lets the Created/Edited by fields show the REAL author per
    page (not just the derived owner), also useful in multi-user mode."""
    label = _resolve_user_label(user_id)
    if not label:
        return
    now = _legacy.datetime.now(_legacy.timezone.utc).isoformat()
    if is_create:
        metadata.setdefault("created_by", label)
        metadata.setdefault("created_at", now)
    metadata["last_edited_by"] = label
    metadata["last_edited_at"] = now


def _prepare_create_table_metadata(
    metadata: dict[str, _LegacyAny],
) -> tuple[dict[str, _LegacyAny], dict[str, _LegacyAny] | None]:
    return _strict_cast(
        tuple[dict[str, _LegacyAny], dict[str, _LegacyAny] | None],
        _legacy.table_rows.prepare_create_table_metadata(
            metadata, _legacy.table_metadata_dependencies
        ),
    )


def _index_created_page(page_id: str, file_path: _legacy.Path) -> None:
    try:
        vault_path = _legacy.get_active_vault_path()
        if not vault_path:
            return
        vault_key = str(vault_path)
        new_entry = _legacy._build_page_cache_entry(file_path, file_path.stat())
        with _legacy._page_index_lock:
            _legacy._page_index_entries.setdefault(vault_key, {})[str(file_path)] = new_entry
            _legacy._page_id_to_path.setdefault(vault_key, {})[page_id] = str(file_path)
            _legacy._bump_page_index_version(vault_key)
        _legacy.path_resolver.add_file(vault_path, page_id, file_path)
    except Exception as exc:
        _legacy.log.warning(
            "Could not insert new page into index cache, falling back to clear: %s", exc
        )
        _legacy._clear_page_index_cache()


def _queue_planning_recalculation(background_tasks: _legacy.BackgroundTasks) -> None:
    try:
        from backend.services.planning_scheduler import enqueue_recalculation

        background_tasks.add_task(
            enqueue_recalculation, _legacy.Path(_legacy.get_active_vault_path())
        )
    except Exception as exc:
        _legacy.log.debug("Could not queue planning recalculation: %s", exc)


def _emit_page_created(page_id: str, title: str) -> None:
    try:
        from backend.services import plugin_events

        plugin_events.emit("page:created", {"page_id": page_id, "title": title})
    except Exception:
        pass


_CREATE_PAGE_DEPENDENCIES = _legacy.page_create_service.CreatePageDependencies(
    new_id=lambda: str(_legacy.uuid.uuid4()),
    normalize_metadata=lambda metadata: _legacy.normalize_table_context(
        _legacy.normalize_metadata_ids(metadata)
    ),
    prepare_table_metadata=_prepare_create_table_metadata,
    process_updates=lambda page_id, old, new: _legacy.get_rule_engine().process_updates(
        page_id, old, new
    ),
    stamp_author=lambda metadata, user_id, is_create: _stamp_author(metadata, user_id, is_create),
    persist_assets=lambda metadata: _legacy._persist_metadata_assets(metadata),
    ensure_citation_key=lambda metadata, table: _legacy._ensure_recursos_citation_key(
        metadata, table
    ),
    dedupe_citation_key=lambda metadata, page_id: _legacy._dedupe_citation_key(metadata, page_id),
    fill_authorship=lambda metadata, table: _legacy._fill_autoria_from_authors(metadata, table),
    path_for=lambda key: _legacy.get_p(key),
    is_calendar_entry=lambda metadata: _legacy.is_calendar_entry(metadata),
    table_folder=lambda metadata: _legacy._resolve_table_folder_from_metadata(metadata),
    canonicalize_id=lambda page_id: _legacy._canonicalize_id(page_id),
    parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
    unique_file_path=lambda directory, name, extension: _get_unique_filepath(
        directory, name, extension
    ),
    save_page=lambda path, metadata, content: _legacy.save_page_md(path, metadata, content),
    get_table_id=lambda metadata: _legacy.get_table_id(metadata),
    recompute_formulas=_legacy._recompute_cross_record_formulas_for_table,
    index_created_page=_index_created_page,
    invalidate_page_responses=lambda: _legacy._pages_cache_invalidate_all(),
    add_page_index=lambda path: _legacy._add_page_to_index_cache(path),
    update_link_index=lambda path: _legacy.update_link_index_for_page(path),
    queue_planning=_queue_planning_recalculation,
    propagate_relations=lambda page_id, table_id, old, new: _legacy._propagate_relation_inverse(
        page_id, table_id, old, new
    ),
    resolve_page_context=lambda metadata, path: _legacy._resolve_page_context_from_path(
        metadata, path
    ),
    emit_created=_emit_page_created,
)
create_page = _legacy.page_commands_api.register_create_route(
    _legacy.router,
    editor_dependency=_legacy.require_role("editor"),
    workspace_context_dependency=_legacy.get_workspace_context,
    dependencies=_CREATE_PAGE_DEPENDENCIES,
)
_DAILY_DATE_RE = _legacy.re.compile("^\\d{4}-\\d{2}-\\d{2}$")
_daily_note_lock = _legacy.asyncio.Lock()


def _daily_notes_dependencies() -> _legacy.daily_notes_service.DailyNotesDependencies:
    """Bind daily-note workflows to current compatibility seams."""
    return _legacy.daily_notes_service.DailyNotesDependencies(
        templates_directory=lambda: _legacy.get_p("PLANTILLES"),
        daily_directory=lambda: _legacy.get_p("DAILY"),
        parse_frontmatter=lambda raw, path: _legacy.cast(
            tuple[_legacy.daily_notes_service.Metadata, str], _legacy.parse_frontmatter(raw, path)
        ),
        plugin_state=lambda: _legacy.cast(
            _legacy.daily_notes_service.Metadata, _legacy._load_plugins_state()
        ),
        table_by_id=lambda table_id: _legacy.cast(
            _legacy.Optional[_legacy.daily_notes_service.Metadata], _legacy._table_by_id(table_id)
        ),
        pages_for_table=lambda table_id: _legacy.cast(
            list[object], _legacy._get_pages_for_table(_legacy.cast(str, table_id))
        ),
        read_property=lambda metadata, prop: _legacy.action_rules_service.read_prop_value(
            metadata, prop
        ),
        effect_write_key=lambda metadata, prop: _legacy.cast(
            _legacy.Optional[str], _legacy.action_rules_service.effect_write_key(metadata, prop)
        ),
        source_config=lambda: _legacy.cast(
            _legacy.daily_notes_service.DailySource, _legacy._daily_source_config()
        ),
        find_in_table=lambda table, date_prop, date: _legacy._find_daily_note_in_table(
            table, date_prop, date
        ),
        find_in_folder=lambda date: _legacy._find_daily_note_id(date),
        template_content=lambda: _legacy._load_daily_template_content(),
        get_page=lambda page_id: _legacy.get_page(page_id),
        create_page=lambda title, content, metadata, background_tasks: _legacy.create_page(
            _legacy.PageSaveRequest(
                title=title,
                content=content,
                metadata=_legacy.cast(_legacy.Dict[str, _legacy.Any], metadata),
            ),
            _legacy.cast(_legacy.BackgroundTasks, background_tasks),
        ),
        creation_lock=_legacy._daily_note_lock,
        logger=_legacy.log,
    )


def _load_daily_template_content() -> str:
    """Returns the body of the daily-note template, if one is configured.

    A template page (in the Templates folder) flagged with
    `metadata.is_daily_template: true` is used as the initial content for new
    daily notes — mirroring Obsidian's "Daily note template" setting. Returns
    an empty string when none exists.
    """
    return _strict_cast(
        str, _legacy.daily_notes_service.load_template_content(_daily_notes_dependencies())
    )


def _find_daily_note_id(date_str: str) -> str | None:
    """Returns the page id of the daily note for `date_str`, or None.

    Daily notes are stored as `Daily Notes/{date}.md`, so the common case is an
    O(1) path check. Falls back to scanning the folder by frontmatter `date`
    for notes created with a non-ISO title.
    """
    return _strict_cast(
        str | None,
        _legacy.daily_notes_service.find_folder_note_id(date_str, _daily_notes_dependencies()),
    )


def _norm_date(value: _LegacyAny) -> str:
    """Normalizes a frontmatter date to a bare `YYYY-MM-DD` for comparison.

    Date columns may store an ISO datetime (`2026-06-30T08:00:00`) or just the
    day; we only key daily notes by the day, so trim to the first 10 chars when
    they form a valid ISO date.
    """
    return _strict_cast(str, _legacy.daily_notes_service.normalize_date(value))


def _daily_source_config() -> tuple[
    dict[_LegacyAny, _LegacyAny] | None, dict[_LegacyAny, _LegacyAny] | None
]:
    """Resolves the DB (table) configured as the backing store for daily notes.

    The daily-notes plugin can be pointed at a database table (e.g. "Bitàcora")
    via `plugins.json` → `settings["daily-notes"]`:
        {"source_table_id": "<table id>", "date_property": "<prop id or name>"}

    Returns `(table, date_prop)` when a valid table + date column resolve, else
    `(None, None)` — in which case the classic `Daily Notes/` folder is used.
    The date column is auto-detected (first `date`-typed property) when the
    stored `date_property` is missing or no longer matches.

    """
    return _strict_cast(
        tuple[dict[_LegacyAny, _LegacyAny] | None, dict[_LegacyAny, _LegacyAny] | None],
        _legacy.cast(
            _legacy.Tuple[_legacy.Optional[dict], _legacy.Optional[dict]],
            _legacy.daily_notes_service.resolve_source(_daily_notes_dependencies()),
        ),
    )


def _find_daily_note_in_table(
    table: dict[_LegacyAny, _LegacyAny], date_prop: dict[_LegacyAny, _LegacyAny], date_str: str
) -> str | None:
    """Returns the page id of the BD row whose date column equals `date_str`."""
    return _strict_cast(
        str | None,
        _legacy.daily_notes_service.find_table_note_id(
            _legacy.cast(_legacy.daily_notes_service.Metadata, table),
            _legacy.cast(_legacy.daily_notes_service.Metadata, date_prop),
            date_str,
            _daily_notes_dependencies(),
        ),
    )


@_legacy.router.get("/daily", response_model=None)
async def list_daily_notes() -> _LegacyAny:
    """Lists existing daily notes (one per day), newest first.

    Used by the sidebar list and by prev/next navigation to jump to the
    nearest existing note without creating empty ones on every arrow press.

    When the plugin is configured to use a BD as its source, the list is built
    from that table's rows (keyed by the date column) instead of the
    `Daily Notes/` folder.
    """
    return await _legacy.daily_notes_service.list_notes(_daily_notes_dependencies())


@_legacy.router.post(
    "/daily",
    dependencies=[
        _legacy.Depends(_legacy.require_role("editor")),
        _legacy.Depends(_legacy.require_plugins("daily-notes")),
    ],
    response_model=None,
)
async def get_or_create_daily_note(
    request: _legacy.DailyNoteRequest, background_tasks: _legacy.BackgroundTasks
) -> _LegacyAny:
    """Gets (or atomically creates) the daily note for a given date.

    The date arrives as an ISO `YYYY-MM-DD` string in the client's local time.
    If a note already exists it's returned as-is; otherwise a new one is
    created in the `Daily Notes` folder, seeded with the daily template (if
    configured). This single round-trip avoids the find→create race that two
    separate calls would expose, and `_daily_note_lock` serializes concurrent
    requests so two simultaneous POSTs can't both miss the find and create
    duplicates.
    """
    date_str = (request.date or "").strip()
    if not _legacy.daily_notes_service.valid_date(date_str):
        raise _legacy.HTTPException(status_code=422, detail="date must be in YYYY-MM-DD format")
    return await _legacy.daily_notes_service.get_or_create_note(
        date_str, background_tasks, _daily_notes_dependencies()
    )


def _extract_tags(raw: _LegacyAny) -> list[_LegacyAny]:
    """Normalizes a `tags` frontmatter value (list or CSV string) to a list."""
    return _strict_cast(list[_LegacyAny], _legacy.tags_query.extract_tags(raw))


@_legacy.router.get("/tags", response_model=None)
async def list_vault_tags() -> _LegacyAny:
    """Aggregates all `tags` across the vault with their page counts.

    Powers the Obsidian-style Tags page: each tag lists the pages that carry
    it so the UI can navigate straight to them. Built from the in-memory page
    snapshot (same source the sidebar uses), so it's O(pages) and cache-warm.

    Two unified sources:
      * the `tags` field from the frontmatter (Obsidian style), and
      * the value of each table's semantic tags field — a `multi_select`
        with `config.role == "tags"` (or named tags/etiquetes/labels), an array
        of option names in the row's metadata.
    A page counts ONCE per tag even if it carries it on both
    sides (e.g. the same tag in the frontmatter and in the table column).

    """
    return await _legacy.tags_query.list_vault_tags()
