"""Typed Vault domain extracted from the historical route facade."""

from __future__ import annotations

import asyncio
import importlib as _legacy_importlib
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.pages.patch_helpers import PatchReadResult
from backend.domains.vault.pages.state import PreviewDocument, PreviewPayload
from backend.domains.vault.schemas.trash import ResolveByTitleResponse
from backend.utils.open_values import get_value

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")
router: APIRouter = _legacy.router


@router.get("/resolve-by-title", response_model=ResolveByTitleResponse)
async def resolve_by_title(title: str) -> dict[str, object]:
    """Resolve a literal title (or a note alias) to a UUID via _page_index_entries.

    Use case: the frontend has received a wikilink `[[Foo]]` but its
    `idToTitle` is empty or stale (right after a parent_id mutation,
    a cache cleanup, or direct URL navigation). Instead of
    doing GET /pages/<title> and leaving the match to the backend (which now has
    title fallback thanks to `find_page_path`), the frontend can
    query here and get the UUID directly — fast and without noise.

    Besides the title, it also matches note aliases declared in the frontmatter
    (`aliases:`), so that `[[Alias]]` resolves to the page (Obsidian-style).

    """
    title_lower = str(title or "").strip().lower()
    if not title_lower:
        raise _legacy.HTTPException(status_code=400, detail="title is required")
    from backend.services.context_vars import get_active_vault_path

    v_path = get_active_vault_path()
    if not v_path:
        raise _legacy.HTTPException(status_code=503, detail="No active vault")
    v_str = str(v_path)
    alias_match = None
    with _legacy._page_index_lock:
        entries = _legacy._page_index_entries.get(v_str, {})
        for entry in list(entries.values()):
            entry_title = str(entry.get("title") or "").strip().lower()
            if entry_title and entry_title == title_lower:
                return {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "folder": entry.get("folder"),
                    "matched_alias": None,
                }
            if alias_match is None:
                meta = entry.get("metadata") or {}
                for alias in _legacy.normalize_aliases(get_value(meta, "aliases")):
                    if alias.strip().lower() == title_lower:
                        alias_match = entry
                        break
    if alias_match is not None:
        return {
            "id": alias_match.get("id"),
            "title": alias_match.get("title"),
            "folder": alias_match.get("folder"),
            "matched_alias": title,
        }
    return {"id": None, "title": None, "folder": None, "matched_alias": None}


def _extract_images_from_body(body: str, max_images: int = 6) -> list[str]:
    """Extracts the URLs of images referenced in the markdown (syntax ![alt](url))."""
    if not body:
        return []
    seen = set()
    out: list[str] = []
    for m in _legacy.re.finditer("!\\[[^\\]]*\\]\\(([^)]+)\\)", body):
        raw = m.group(1).strip()
        if raw.startswith("<") and raw.endswith(">"):
            raw = raw[1:-1]
        if " " in raw:
            raw = raw.split(" ", 1)[0]
        if not raw or raw in seen:
            continue
        seen.add(raw)
        out.append(raw)
        if len(out) >= max_images:
            break
    return out


async def _compute_preview(file_path: Path, page_id: str) -> PreviewDocument:
    """Read the file and build the two responses (short + full) for the
    preview, along with the mtime for cache invalidation.

    This function is reusable for:
      - `get_page_preview` (a single id, possible cache hit).
      - `bulk_warm_previews` (proactive warmup of a list of ids).

    Materializes the file if it is online-only BEFORE attempting to read it,
    thus avoiding the 4.55s retry queue; it only falls back to retry if the File
    Provider takes longer than expected.

    """
    try:
        mtime = file_path.stat().st_mtime
    except OSError:
        mtime = 0.0
    await _legacy._materialize_if_online_only(file_path, page_id)

    def _read_and_parse() -> tuple[PageMetadata, str, str]:
        if _legacy._is_dashboard_file_path(file_path):
            md, body = _legacy._read_dashboard_file(file_path)
            return (md, body, body)
        last_error = None
        delays = [0.05, 0.1, 0.2, 0.4, 0.8, 1.0, 1.0, 1.0]
        for attempt in range(len(delays) + 1):
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                md, body = _legacy.parse_frontmatter(raw_content, file_path)
                _, body_full = _legacy.parse_frontmatter(
                    raw_content, file_path, render_snapshots=True
                )
                return (md, body, body_full)
            except OSError as e:
                last_error = e
                if e.errno == 35 and attempt < len(delays):
                    _legacy.time.sleep(delays[attempt])
                    continue
                raise
        if last_error:
            raise last_error
        return ({}, "", "")

    metadata, body, body_full = await _legacy.asyncio.to_thread(_read_and_parse)
    excerpt = _legacy._build_preview_excerpt(body)
    short: PreviewPayload = {
        "id": str(metadata.get("id") or page_id),
        "title": metadata.get("title", "") or "",
        "excerpt": excerpt,
        "icon": metadata.get("icon"),
        "cover": metadata.get("cover"),
    }
    full_resp: PreviewPayload = {
        **short,
        "body_md": body_full or "",
        "images": _extract_images_from_body(body_full or ""),
    }
    return (short, full_resp, mtime)


async def _fetch_preview_with_cache(file_path: Path, page_id: str) -> PreviewDocument:
    """Wrapper with cache + in-flight dedup over `_compute_preview`.

    Single robust logic for `get_page_preview` and `bulk_warm_previews`:

      1. Read the file's mtime.
      2. Cache hit (mtime matches) → return immediately.
      3. Cache miss but there's a future already running for this id → share
         it (await; no one repeats the work).
      4. Cache miss and no future → create a new future, compute,
         store in the cache, signal the future. Always clears the
         in-flight map at the end, whether it succeeds or fails.

    """
    try:
        mtime = await _legacy.asyncio.to_thread(lambda: file_path.stat().st_mtime)
    except OSError:
        mtime = 0.0
    cached_short = _legacy._preview_cache_get(page_id, mtime, full=False)
    cached_full = _legacy._preview_cache_get(page_id, mtime, full=True)
    if cached_short is not None and cached_full is not None:
        return (cached_short, cached_full, mtime)
    loop = _legacy.asyncio.get_running_loop()
    with _legacy._preview_inflight_lock:
        existing = _legacy._preview_inflight.get(page_id)
        if existing is None:
            future: asyncio.Future[PreviewDocument] = loop.create_future()
            _legacy._preview_inflight[page_id] = future
            owner = True
        else:
            future = existing
            owner = False
    if not owner:
        return await future
    try:
        short, full_resp, real_mtime = await _compute_preview(file_path, page_id)
        _legacy._preview_cache_set(page_id, real_mtime, short, full_resp)
        result = (short, full_resp, real_mtime)
        future.set_result(result)
        return result
    except Exception as e:
        if not future.done():
            future.set_exception(e)
        raise
    finally:
        with _legacy._preview_inflight_lock:
            _legacy._preview_inflight.pop(page_id, None)


async def _bulk_warm_one(pid: str) -> str:
    """Warms up a single id and returns the status: 'cached' | 'warmed' | 'failed'.

    Never propagates exceptions: an individual failure must NOT bring down the batch.

    Robust against:
      - **Orphan ids** (stale pages in a database view that have already
        been removed from disk): `find_page_path(allow_full_scan=False)`
        avoids a full vault `rglob` when the id is not in the
        page index.
      - **Cache hit + miss race**: all the cache and in-flight dedup
        logic lives in `_fetch_preview_with_cache` — shared with
        `get_page_preview`.

    """
    try:
        file_path = await _legacy.asyncio.to_thread(
            _legacy.find_page_path, pid, allow_full_scan=False
        )
        if not file_path or not file_path.exists():
            return "failed"
        try:
            mtime = await _legacy.asyncio.to_thread(lambda: file_path.stat().st_mtime)
        except OSError:
            mtime = 0.0
        if _legacy._preview_cache_get(pid, mtime, full=True) is not None:
            return "cached"
        await _fetch_preview_with_cache(file_path, pid)
        return "warmed"
    except Exception as e:
        _legacy.log.debug(f"bulk warmup falla per {pid}: {e}")
        return "failed"


_legacy.page_queries_api.register_preview_routes(router)
get_page_preview = _legacy.page_queries_api.get_page_preview
bulk_warm_previews = _legacy.page_queries_api.bulk_warm_previews
_SAVE_HELPER_DEPENDENCIES = _legacy.page_save_helpers.SaveHelperDependencies(
    normalize_metadata_ids=lambda metadata: _legacy.normalize_metadata_ids(metadata),
    normalize_table_context=lambda metadata: _legacy.normalize_table_context(metadata),
    get_table_id=lambda metadata: _legacy.get_table_id(metadata),
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    to_storage_names=lambda metadata, table: _legacy.to_storage_names(metadata, table),
    created_iso=lambda timestamp: _legacy.datetime.fromtimestamp(
        timestamp, tz=_legacy.timezone.utc
    ).isoformat(),
    stamp_system_dates=lambda metadata, table, is_create, created_fallback: (
        _legacy.stamp_system_dates(
            metadata, table, is_create=is_create, created_fallback=created_fallback
        )
    ),
    get_path=lambda name: _legacy.get_p(name),
    is_calendar_entry=lambda metadata: _legacy.is_calendar_entry(metadata),
    resolve_table_folder=lambda metadata: _legacy._resolve_table_folder_from_metadata(metadata),
    canonicalize_id=lambda value: _legacy._canonicalize_id(value),
    parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
    active_vault_path=lambda: _legacy.get_active_vault_path(),
    index_lock=lambda: _legacy._page_index_lock,
    id_to_path=lambda: _legacy._page_id_to_path,
    safe_filename=lambda title, target_dir: _legacy._safe_filename(title, target_dir),
    ensure_correct_location=lambda path, metadata: _legacy.ensure_correct_page_location(
        path, metadata
    ),
    rename_to_title=lambda path, title: _legacy._rename_page_file_to_match_title(path, title),
    remove_from_index=lambda page_id, path: _legacy._remove_page_from_index_cache(page_id, path),
    add_to_index=lambda path: _legacy._add_page_to_index_cache(path),
    create_page_version=lambda page_id, path: _legacy._create_page_version(page_id, path),
    save_page=lambda path, metadata, content: _legacy.save_page_md(path, metadata, content),
    logger=lambda: _legacy.log,
)


def _prepare_save_metadata(
    metadata: PageMetadata, file_path: Path | None
) -> tuple[PageMetadata, PageMetadata | None]:
    return _legacy.page_save_helpers.prepare_save_metadata(
        metadata, file_path, _SAVE_HELPER_DEPENDENCIES
    )


def _locate_save_file(
    page_id: str,
    title: str,
    metadata: PageMetadata,
    file_path: Path | None,
) -> Path:
    return _legacy.page_save_helpers.locate_save_file(
        page_id, title, metadata, file_path, _SAVE_HELPER_DEPENDENCIES
    )


def _read_save_page(file_path: Path) -> tuple[PageMetadata, str]:
    return _legacy.page_save_helpers.read_save_page(file_path, _SAVE_HELPER_DEPENDENCIES)


def _write_save_page_with_version(
    page_id: str, file_path: Path, metadata: PageMetadata, content: str
) -> None:
    _legacy.page_save_helpers.write_save_page_with_version(
        page_id, file_path, metadata, content, _SAVE_HELPER_DEPENDENCIES
    )


_SAVE_PAGE_DEPENDENCIES = _legacy.page_save_service.SavePageDependencies(
    find_page=lambda page_id, *, allow_full_scan=True: _legacy.find_page_path(
        page_id, allow_full_scan=allow_full_scan
    ),
    file_etag=_legacy.file_etag,
    get_page_write_lock=lambda page_id: _legacy._get_page_write_lock(page_id),
    prepare_metadata=lambda metadata, path: _legacy._prepare_save_metadata(metadata, path),
    locate_file=lambda page_id, title, metadata, path: _legacy._locate_save_file(
        page_id, title, metadata, path
    ),
    read_page=lambda path: _legacy._read_save_page(path),
    process_updates=lambda page_id, old, new: _legacy.get_rule_engine().process_updates(
        page_id, old, new
    ),
    stamp_author=lambda metadata, user_id, is_create: _legacy._stamp_author(
        metadata, user_id, is_create
    ),
    persist_assets=lambda metadata: _legacy._persist_metadata_assets(metadata),
    ensure_citation_key=lambda metadata, table: _legacy._ensure_recursos_citation_key(
        metadata, table
    ),
    dedupe_citation_key=lambda metadata, page_id: _legacy._dedupe_citation_key(metadata, page_id),
    write_with_version=lambda page_id, path, metadata, content: (
        _legacy._write_save_page_with_version(page_id, path, metadata, content)
    ),
    refresh_page_index=lambda path, metadata, content: _legacy._refresh_page_index_entry(
        path, metadata, content
    ),
    invalidate_page_responses=lambda: _legacy._pages_cache_invalidate_all(),
    update_link_index=lambda: _legacy.update_link_index_for_page,
    rewrite_wikilinks=lambda: _legacy.rewrite_wikilinks_on_title_change,
    get_table_id=lambda metadata: _legacy.get_table_id(metadata),
    recompute_formulas=lambda: _legacy._recompute_cross_record_formulas_for_table,
    sync_calendar=lambda metadata, tasks: _legacy.sync_to_google_calendar_if_needed(
        metadata, tasks
    ),
    propagate_translation=lambda: _legacy._propagate_translation_staleness,
    resolve_page_context=lambda metadata, path: _legacy._resolve_page_context_from_path(
        metadata, path
    ),
)
_PATCH_HELPER_DEPENDENCIES = _legacy.page_patch_helpers.PatchHelperDependencies(
    find_page_for_write=lambda page_id: _legacy._find_page_path_for_write(page_id),
    file_etag=lambda path: _legacy.file_etag(path),
    is_dashboard_file=lambda path: _legacy._is_dashboard_file_path(path),
    read_dashboard_file=lambda path: _legacy._read_dashboard_file(path),
    parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
    normalize_metadata_ids=lambda metadata: _legacy.normalize_metadata_ids(metadata),
    normalize_table_context=lambda metadata: _legacy.normalize_table_context(metadata),
    get_table_id=lambda metadata: _legacy.get_table_id(metadata),
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    to_storage_names=lambda metadata, table: _legacy.to_storage_names(metadata, table),
    created_iso=lambda timestamp: _legacy.datetime.fromtimestamp(
        timestamp, tz=_legacy.timezone.utc
    ).isoformat(),
    stamp_system_dates=lambda metadata, table, is_create, created_fallback: (
        _legacy.stamp_system_dates(
            metadata, table, is_create=is_create, created_fallback=created_fallback
        )
    ),
    ensure_correct_location=lambda path, metadata: _legacy.ensure_correct_page_location(
        path, metadata
    ),
    rename_to_title=lambda path, title: _legacy._rename_page_file_to_match_title(path, title),
    remove_from_index=lambda page_id, path: _legacy._remove_page_from_index_cache(page_id, path),
    add_to_index=lambda path: _legacy._add_page_to_index_cache(path),
    active_vault_path=lambda: _legacy.get_active_vault_path(),
    index_lock=lambda: _legacy._page_index_lock,
    index_entries=lambda: _legacy._page_index_entries,
    id_to_path=lambda: _legacy._page_id_to_path,
    build_cache_entry=lambda path, stat_result, metadata, content: (
        _legacy._build_cache_entry_from_memory(path, stat_result, metadata, content)
    ),
    bump_index_version=lambda vault_key: _legacy._bump_page_index_version(vault_key),
    add_to_path_resolver=lambda vault_path, page_id, path: _legacy.path_resolver.add_file(
        vault_path, page_id, path
    ),
    body_cache_lock=lambda: _legacy._body_cache_lock,
    body_cache=lambda: _legacy._body_cache,
    invalidate_page_responses=lambda: _legacy._pages_cache_invalidate_all(),
    invalidate_citation_index=lambda: _legacy._invalidate_cite_key_index(),
    iter_docs_lock=lambda: _legacy._iter_docs_lock,
    iter_docs_cache=lambda: _legacy._iter_docs_cache,
    path_factory=lambda value: _legacy.Path(value),
    logger=lambda: _legacy.log,
)


def _find_and_read_patch_page(
    page_id: str, expected_etag: str | None, force: bool
) -> PatchReadResult:
    return _legacy.page_patch_helpers.find_and_read_patch_page(
        page_id, expected_etag, force, _PATCH_HELPER_DEPENDENCIES
    )


def _prepare_patch_metadata(
    metadata: PageMetadata, file_path: Path
) -> tuple[PageMetadata, PageMetadata | None]:
    return _legacy.page_patch_helpers.prepare_patch_metadata(
        metadata, file_path, _PATCH_HELPER_DEPENDENCIES
    )


def _relocate_patch_file(
    page_id: str,
    file_path: Path,
    metadata: PageMetadata,
    title: str | None,
) -> Path:
    return _legacy.page_patch_helpers.relocate_patch_file(
        page_id, file_path, metadata, title, _PATCH_HELPER_DEPENDENCIES
    )


def _update_patch_caches(
    page_id: str,
    file_path: Path,
    metadata: PageMetadata,
    content: str,
    original_metadata: PageMetadata,
) -> None:
    _legacy.page_patch_helpers.update_patch_caches(
        page_id, file_path, metadata, content, original_metadata, _PATCH_HELPER_DEPENDENCIES
    )


_PATCH_PAGE_DEPENDENCIES = _legacy.page_patch_service.PatchPageDependencies(
    find_and_read=lambda page_id, expected_etag, force: _legacy._find_and_read_patch_page(
        page_id, expected_etag, force
    ),
    get_page_write_lock=lambda page_id: _legacy._get_page_write_lock(page_id),
    prepare_metadata=lambda metadata, path: _legacy._prepare_patch_metadata(metadata, path),
    relocate_file=lambda page_id, path, metadata, title: _legacy._relocate_patch_file(
        page_id, path, metadata, title
    ),
    process_updates=lambda page_id, old, new: _legacy.get_rule_engine().process_updates(
        page_id, old, new
    ),
    stamp_author=lambda metadata, user_id, is_create: _legacy._stamp_author(
        metadata, user_id, is_create
    ),
    persist_assets=lambda metadata: _legacy._persist_metadata_assets(metadata),
    ensure_citation_key=lambda metadata: _legacy._ensure_recursos_citation_key(metadata),
    dedupe_citation_key=lambda metadata, page_id: _legacy._dedupe_citation_key(metadata, page_id),
    save_page=lambda path, metadata, content: _legacy.save_page_md(path, metadata, content),
    update_caches=lambda page_id, path, metadata, content, original_metadata: (
        _legacy._update_patch_caches(page_id, path, metadata, content, original_metadata)
    ),
    create_content_version=lambda: _legacy._create_page_version_from_content,
    create_file_version=lambda: _legacy._create_page_version,
    update_link_index=lambda: _legacy.update_link_index_for_page,
    rewrite_wikilinks=lambda: _legacy.rewrite_wikilinks_on_title_change,
    get_table_id=lambda metadata: _legacy.get_table_id(metadata),
    recompute_formulas=lambda: _legacy._recompute_cross_record_formulas_for_table,
    sync_calendar=lambda metadata, tasks: _legacy.sync_to_google_calendar_if_needed(
        metadata, tasks
    ),
    propagate_translation=lambda: _legacy._propagate_translation_staleness,
    propagate_relations=lambda: _legacy._propagate_relation_inverse,
    resolve_page_context=lambda metadata, path: _legacy._resolve_page_context_from_path(
        metadata, path
    ),
    file_etag=_legacy.file_etag,
    safe_error_detail=_legacy.safe_error_detail,
)
save_page, patch_page = _legacy.page_commands_api.register_write_routes(
    router,
    editor_dependency=_legacy.require_role("editor"),
    workspace_context_dependency=_legacy.get_workspace_context,
    save_dependencies=_SAVE_PAGE_DEPENDENCIES,
    patch_dependencies=_PATCH_PAGE_DEPENDENCIES,
)
