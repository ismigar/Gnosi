"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from backend.domains.vault.links.document_cache import (
    DocumentCacheDependencies,
    ParsedDocumentCache,
)
from backend.domains.vault.links.document_inventory import DocumentCache, LinkableDocument
from backend.domains.vault.links.api.dependencies import LinkApiDependencies
from backend.domains.vault.links.state import IdTitleCacheEntry
from backend.domains.vault.pages.foundation_values import PageMetadata, metadata_value

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")
_ID_TITLE_TTL = 60.0
_id_title_cache: dict[str, IdTitleCacheEntry] = {}
_id_title_lock = _legacy.threading.Lock()
_id_title_refreshing: set[str] = set()


def _current_vault_key() -> str:
    """Key for this module's per-vault caches: str of the ACTIVE vault's path
    (via contextvar). Empty outside a request (or if there is no vault) → falls back to
    the previous behavior (a single entry with key "")."""
    try:
        from backend.services.context_vars import get_active_vault_path

        v = get_active_vault_path()
        return str(v) if v else ""
    except Exception:
        return ""


def _get_id_title_cache_path(v_str: str | None = None) -> Path | None:
    """Local path where the id→title index is persisted, PER VAULT (same pattern as
    `get_page_index_cache_path`: one file per vault via a hash of the path)."""
    base = _legacy.get_p("PAGE_INDEX_CACHE")
    p = (
        base.parent / "vault_id_title_index.json"
        if base
        else _legacy.resolve_data_dir() / "cache" / "vault_id_title_index.json"
    )
    if v_str:
        digest = _legacy.hashlib.sha256(v_str.encode("utf-8")).hexdigest()[:16]
        return p.with_name(f"{p.stem}_{digest}{p.suffix}")
    return p


def _save_id_title_to_disk(v_str: str, index: dict[str, str]) -> None:
    try:
        cache_path = _get_id_title_cache_path(v_str)
        if not cache_path:
            return
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        _legacy.safe_write_json(cache_path, index, indent=None, ensure_ascii=False)
    except Exception as e:
        _legacy.log.warning(f"id-title persist failed: {e}")


def _load_id_title_from_disk(v_str: str) -> bool:
    """Loads the persisted index for vault `v_str` and marks it STALE (ts=0) so that
    the first use triggers a background refresh against the vault's real state."""
    try:
        cache_path = _get_id_title_cache_path(v_str)
        if not cache_path or not cache_path.exists():
            return False
        data: object = _legacy.json.loads(cache_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        with _id_title_lock:
            _id_title_cache[v_str] = {"index": {str(k): str(v) for k, v in data.items()}, "ts": 0.0}
        _legacy.log.info(f"📂 id-title index loaded from disk ({len(data)} entries)")
        return True
    except Exception as e:
        _legacy.log.warning(f"id-title load skipped: {e}")
        return False


def _compute_id_title_index() -> dict[str, str]:
    """Actual computation: id→title for the whole vault and dashboards. May run an rglob on
    OneDrive cold (expensive). Call only outside the request (background)."""
    index: dict[str, str] = {}
    for file_path, metadata, _body, is_dashboard in _iter_linkable_page_documents():
        try:
            if is_dashboard:
                page_id = str(metadata.get("id") or file_path.stem)
            else:
                page_id = str(metadata.get("id") or metadata.get("migration_id") or file_path.stem)
            title = str(metadata.get("title") or file_path.stem)
            index[page_id] = title
        except Exception as e:
            _legacy.log.warning(f"Error indexing {file_path.name}: {e}")
    return index


def _refresh_id_title_index(v_str: str) -> None:
    """Recomputes and persists in the background FOR VAULT `v_str`. Only one concurrent
    refresh per vault. The thread SETS the vault's contextvar: threads do NOT
    inherit contextvars, so without this `_compute_id_title_index` would iterate
    the default vault and we would write wrong data under the `v_str` key."""
    with _id_title_lock:
        if v_str in _id_title_refreshing:
            return
        _id_title_refreshing.add(v_str)

    def _run() -> None:
        from backend.services.context_vars import active_vault_path

        token = None
        try:
            if v_str:
                token = active_vault_path.set(_legacy.Path(v_str))
            idx = _compute_id_title_index()
            with _id_title_lock:
                _id_title_cache[v_str] = {"index": idx, "ts": _legacy.time.time()}
            _save_id_title_to_disk(v_str, idx)
        except Exception as e:
            _legacy.log.warning(f"id-title refresh failed: {e}")
        finally:
            if token is not None:
                active_vault_path.reset(token)
            with _id_title_lock:
                _id_title_refreshing.discard(v_str)

    _legacy.threading.Thread(target=_run, daemon=True, name="id-title-refresh").start()


def build_id_title_index() -> dict[str, str]:
    """Global id→title with persistent cache + stale-while-revalidate.

    Never blocks the request if there is a cache (memory or disk): it returns a copy
    of the cached value and triggers the recomputation in the background. Only the
    very FIRST time, with no cache at all (not even on disk), is the synchronous cost paid.
    Returns a copy to prevent a consumer from mutating the shared cache.

    """
    now = _legacy.time.time()
    vkey = _current_vault_key()
    with _id_title_lock:
        entry = _id_title_cache.get(vkey)
        idx = entry.get("index") if entry else None
        ts = entry.get("ts", 0.0) if entry else 0.0
    if idx is not None:
        if now - ts >= _ID_TITLE_TTL:
            _refresh_id_title_index(vkey)
        return dict(idx)
    if _load_id_title_from_disk(vkey):
        _refresh_id_title_index(vkey)
        with _id_title_lock:
            entry = _id_title_cache.get(vkey)
            cur = entry.get("index") if entry else None
        return dict(cur) if cur else {}
    idx = _compute_id_title_index()
    with _id_title_lock:
        _id_title_cache[vkey] = {"index": idx, "ts": _legacy.time.time()}
    _save_id_title_to_disk(vkey, idx)
    return dict(idx)


_iter_docs_cache: DocumentCache = {}
_iter_docs_lock = _legacy.threading.Lock()
_ITER_DOCS_TTL = 60.0
_body_cache: dict[str, tuple[int, str]] = {}
_body_cache_lock = _legacy.threading.Lock()
_BODY_CACHE_PERSIST_DEBOUNCE = 10.0
_parsed_doc_cache: ParsedDocumentCache = {}
_parsed_doc_lock = _legacy.threading.Lock()
_PARSED_DOC_PERSIST_DEBOUNCE = 10.0


def _document_cache_dependencies() -> DocumentCacheDependencies:
    """Bind the links cache service to the current compatibility globals."""
    return _legacy.link_document_cache.DocumentCacheDependencies(
        body_cache=_legacy._body_cache,
        body_lock=_legacy._body_cache_lock,
        parsed_cache=_legacy._parsed_doc_cache,
        parsed_lock=_legacy._parsed_doc_lock,
        page_index_cache_path=lambda: _legacy.get_p("PAGE_INDEX_CACHE"),
        data_dir=_legacy.resolve_data_dir,
        write_json=lambda path, payload: _legacy.safe_write_json(
            path, payload, indent=None, ensure_ascii=False
        ),
        parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
        body_persist_debounce=_BODY_CACHE_PERSIST_DEBOUNCE,
        parsed_persist_debounce=_PARSED_DOC_PERSIST_DEBOUNCE,
        logger=_legacy.log,
    )


def _get_body_cache_path() -> Path | None:
    """Local path where the body cache is persisted. Same pattern as page-index."""
    return _legacy.link_document_cache.cache_path("body", _document_cache_dependencies())


def _save_body_cache_to_disk() -> None:
    """Persists the body cache to disk. Called under lock for a consistent
    snapshot. Typical size: 3500 × ~3KB body = ~10MB JSON."""
    _legacy.link_document_cache.save_body_cache(_document_cache_dependencies())


def _schedule_body_cache_persist() -> None:
    """Debounce persist: individual invalidations trigger a save to disk
    at most every `_BODY_CACHE_PERSIST_DEBOUNCE` seconds."""
    _legacy.link_document_cache.schedule_body_cache_persist(_document_cache_dependencies())


def _load_body_cache_from_disk() -> bool:
    """Loads the saved body cache. Returns True if it was useful. It does not
    validate mtimes here — that is done in `_get_body_for_path` for each
    entry queried (amortized cost)."""
    return _legacy.link_document_cache.load_body_cache(_document_cache_dependencies())


_last_stale_check = _legacy.page_state.last_stale_check
_STALE_CHECK_TTL = 600.0


def _get_body_for_path(file_path: Path) -> str:
    """Returns the body of an .md file, taking advantage of a cache with mtime-based invalidation.

    We iterate over ALL the Vault's .md files for /backlinks and /unlinked-mentions.
    We do NOT retry on Errno 35: with 3988 files, if N return a deadlock
    in parallel, retrying × N dramatically worsens the iteration (60+
    seconds instead of 5). We skip the file; the next invocation of
    /backlinks (once the TTL expires) will try again and pick up the ones that were missing.
    If a file fails repeatedly, its backlinks are left out of the
    result — acceptable gradual degradation.

    """
    return _legacy.link_document_cache.body_for_path(file_path, _document_cache_dependencies())


def _get_parsed_doc_cache_path() -> Path | None:
    """Local path where the parsed-document cache is persisted."""
    return _legacy.link_document_cache.cache_path("parsed_doc", _document_cache_dependencies())


def _save_parsed_doc_cache_to_disk() -> None:
    """Persists the parsed-document cache to disk.

    Entries whose metadata is not JSON-serializable are skipped rather than
    aborting the whole save: YAML can yield dates/objects that json rejects, and
    one odd page must not cost every other page its cached parse. A skipped
    entry is simply re-parsed after the next restart.
    """
    _legacy.link_document_cache.save_parsed_cache(_document_cache_dependencies())


def _schedule_parsed_doc_cache_persist() -> None:
    """Debounce persist, mirroring `_schedule_body_cache_persist`."""
    _legacy.link_document_cache.schedule_parsed_cache_persist(_document_cache_dependencies())


def _load_parsed_doc_cache_from_disk() -> bool:
    """Loads the saved parsed-document cache. Mtimes are not validated here —
    `_get_parsed_document` does it per entry queried (amortized cost)."""
    return _legacy.link_document_cache.load_parsed_cache(_document_cache_dependencies())


def _get_parsed_document(file_path: Path) -> tuple[PageMetadata, str] | None:
    """Returns (metadata, body) for an .md file, memoized by mtime.

    Returns None when the file is unreadable or empty, mirroring the behaviour
    `_iter_linkable_page_documents` had when `_get_body_for_path` returned "".
    """
    return _legacy.link_document_cache.parsed_document(file_path, _document_cache_dependencies())


def _iter_linkable_page_documents() -> list[LinkableDocument]:
    """Yields page documents as (path, metadata, body, is_dashboard).

    Cached per `_ITER_DOCS_TTL` seconds. When the list cache expires,
    individual bodies are not re-read if their mtime has not changed
    (see `_get_body_for_path`). So the 2nd/3rd/Nth invocation is O(stat()) per
    file instead of O(read).

    """
    dependencies = _legacy.link_document_inventory.DocumentInventoryDependencies(
        now=_legacy.time.time,
        current_vault_key=lambda: _current_vault_key(),
        cache=_iter_docs_cache,
        cache_lock=_iter_docs_lock,
        cache_ttl=_ITER_DOCS_TTL,
        vault_path=lambda: _legacy.get_p("VAULT"),
        list_markdown=lambda vault_path: _legacy.path_resolver.list_all_files(vault_path),
        parsed_document=lambda file_path: _get_parsed_document(file_path),
        dashboards_path=lambda: _legacy.get_p("DASHBOARDS"),
        read_dashboard=lambda file_path: _legacy._read_dashboard_file(file_path),
        logger=_legacy.log,
    )
    return _legacy.link_document_inventory.linkable_documents(dependencies)


def _read_parsed_doc_cache_snapshot() -> ParsedDocumentCache:
    with _legacy._parsed_doc_lock:
        return dict(_legacy._parsed_doc_cache)


def _build_alias_index() -> dict[str, list[str]]:
    v_path = _legacy.get_active_vault_path()
    if not v_path:
        return {}
    v_str = str(v_path)
    out: dict[str, list[str]] = {}
    with _legacy._page_index_lock:
        for entry in list(_legacy._page_index_entries.get(v_str, {}).values()):
            meta = entry.get("metadata") or {}
            aliases = _legacy.normalize_aliases(metadata_value(meta, "aliases"))
            if aliases:
                pid = entry.get("id")
                if pid:
                    out[str(pid)] = aliases
    return out


_LINK_INDEX_DEPENDENCIES = _legacy.link_index_service.LinkIndexDependencies(
    get_cache_path=lambda: _get_link_index_cache_path(),
    write_json=_legacy.safe_write_json,
    iter_documents=_iter_linkable_page_documents,
    current_vault_key=_current_vault_key,
    get_body=_get_body_for_path,
    is_dashboard=_legacy._is_dashboard_file_path,
    read_dashboard=_legacy._read_dashboard_file,
    parse_frontmatter=_legacy.parse_frontmatter,
    write_text=_legacy.safe_write_text,
)
_LINK_API_DEPENDENCIES = LinkApiDependencies(
    read_state=_legacy._link_index_view,
    build_id_title_index=build_id_title_index,
    build_alias_index=_build_alias_index,
    get_cache_path=lambda: _get_link_index_cache_path(),
    resolve_kickoff_rebuild=lambda: _legacy.kickoff_link_index_rebuild,
    iter_documents=_iter_linkable_page_documents,
    find_page=lambda page_id: _legacy.find_page_path(page_id),
    is_dashboard=_legacy._is_dashboard_file_path,
    read_dashboard=_legacy._read_dashboard_file,
    parse_frontmatter=_legacy.parse_frontmatter,
    resolve_create_page_version=lambda: _legacy._create_page_version,
    write_dashboard=_legacy._write_dashboard_file,
    save_page=_legacy.save_page_md,
    resolve_update_index=lambda: _legacy.update_link_index_for_page,
    is_safe_external_url=_legacy._is_safe_external_url,
    build_browser_path=_legacy.canonical_vault_browser_path,
)


def _get_link_index_cache_path() -> Path | None:
    return _legacy.link_index_service.resolve_link_index_cache_path(
        _legacy.get_p("LINK_INDEX_CACHE"), _legacy.resolve_data_dir()
    )


def _save_link_index_to_disk() -> None:
    _legacy.link_index_service.save_link_index(_legacy.link_index_state, _LINK_INDEX_DEPENDENCIES)


def _load_link_index_from_disk() -> bool:
    return _legacy.link_index_service.load_link_index(
        _legacy.link_index_state, _LINK_INDEX_DEPENDENCIES
    )


def get_link_index_terms(
    page_ids: Iterable[str],
) -> tuple[dict[str, tuple[frozenset[str], frozenset[str]]], float]:
    return _legacy.link_index_service.get_link_index_terms(
        page_ids, _legacy._link_index_view, _load_link_index_from_disk
    )


def get_agent_index_freshness(
    *, requested_count: int, covered_count: int, direct_reads: int, stale_after_seconds: int = 1800
) -> dict[str, object]:
    return _legacy.link_index_service.get_agent_index_freshness(
        requested_count=requested_count,
        covered_count=covered_count,
        direct_reads=direct_reads,
        stale_after_seconds=stale_after_seconds,
        read_view=_legacy._link_index_view,
        load_index=_legacy._load_link_index_from_disk,
        current_vault_key=_legacy._current_vault_key,
        kickoff_rebuild=_legacy.kickoff_link_index_rebuild,
    )


def get_cached_document_texts(paths: Iterable[str]) -> dict[str, str]:
    return _legacy.link_index_service.get_cached_document_texts(
        paths,
        ensure_loaded=_legacy._load_parsed_doc_cache_from_disk,
        read_cache=_legacy._read_parsed_doc_cache_snapshot,
    )


def _normalize_ref_for_index(raw_ref: str) -> str:
    return _legacy.link_parsing.normalize_ref(raw_ref)


def _extract_outlinks_with_kinds(
    metadata: PageMetadata, body: str
) -> tuple[set[str], dict[str, str]]:
    return _legacy.link_parsing.extract_outlinks_with_kinds(metadata, body)


def _extract_outlinks_from_doc(metadata: PageMetadata, body: str) -> set[str]:
    return _legacy.link_parsing.extract_outlinks(metadata, body)


def _tokenize_body_for_mentions(body: str) -> frozenset[str]:
    return _legacy.link_parsing.tokenize_body(body)


def _resolve_page_id_from_metadata(metadata: PageMetadata, file_path: Path) -> str:
    return _legacy.link_parsing.resolve_page_id(metadata, file_path)


def _rebuild_backlinks_invertion_locked() -> None:
    _legacy.link_index_service.rebuild_backlinks_locked(_legacy.link_index_state)


def _rebuild_link_index(persist: bool = True) -> None:
    _legacy.link_index_service.rebuild_link_index(
        _legacy.link_index_state, _LINK_INDEX_DEPENDENCIES, persist=persist
    )


def _schedule_link_index_persist() -> None:
    _legacy.link_index_service.schedule_link_index_persist(
        _legacy.link_index_state, _LINK_INDEX_DEPENDENCIES
    )


def kickoff_link_index_rebuild() -> None:
    _legacy.link_index_service.kickoff_link_index_rebuild(
        _legacy.link_index_state, _LINK_INDEX_DEPENDENCIES
    )


def update_link_index_for_page(file_path: Path) -> None:
    _legacy.link_index_service.update_link_index_for_page(
        file_path, _legacy.link_index_state, _LINK_INDEX_DEPENDENCIES
    )


_RELATION_SYNC_DEPENDENCIES = _legacy.relation_sync_domain.RelationSyncDependencies(
    normalize_name=_legacy.relation_rules._norm,
    relation_ids=lambda value: _legacy.relation_rules.to_ids(value),
    relation_changes=lambda old, new, origin, get_table: _legacy.relation_rules.relation_changes(
        old, new, origin, get_table
    ),
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    find_page=lambda page_id: _legacy.find_page_path(page_id),
    parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
    save_page=lambda path, metadata, body: _legacy.save_page_md(path, metadata, body),
    update_link_index=lambda path: update_link_index_for_page(path),
    active_vault_path=lambda: _legacy.get_active_vault_path(),
    build_page_cache_entry=lambda path, stat_result: _legacy._build_page_cache_entry(
        path, stat_result
    ),
    page_index_lock=lambda: _legacy._page_index_lock,
    page_index_entries=lambda: _legacy._page_index_entries,
    page_id_to_path=lambda: _legacy._page_id_to_path,
    bump_page_index_version=lambda vault_key: _legacy._bump_page_index_version(vault_key),
    invalidate_page_responses=lambda: _legacy._pages_cache_invalidate_all(),
    logger=_legacy.log,
)


def _inverse_relation_frontmatter_key(md: PageMetadata, inverse_name: str) -> str:
    """REAL frontmatter key for the inverse field: reuses the one that already exists
    (for normalization, e.g. an old variant of the name) or, if there is none,
    the registry name. Avoids creating a duplicate key that views would not
    see."""
    return _legacy.relation_sync_domain.inverse_frontmatter_key(
        md, inverse_name, _RELATION_SYNC_DEPENDENCIES
    )


def _apply_inverse_relation_change(
    target_id: str, inverse_name: str, host_id: str, op: str
) -> bool:
    """Adds/removes `host_id` in the inverse field of page `target_id`. Writes via
    `save_page_md` (decorates `id→[[Title|id]]` and canonicalizes the key). Idempotent:
    does not write if it is already in the desired state. Writing directly (not via the endpoint)
    avoids re-triggering the propagation → no recursion. Returns True if it wrote."""
    return _legacy.relation_sync_domain.apply_inverse_change(
        target_id, inverse_name, host_id, op, _RELATION_SYNC_DEPENDENCIES
    )


def _propagate_relation_inverse(
    page_id: str,
    table_id: str | None,
    old_meta: PageMetadata,
    new_meta: PageMetadata,
) -> None:
    """Propagates a page's relation field changes to the INVERSE field of
    the pages on the other side. Defensive: never blocks the caller nor propagates in a
    loop. Meant to run as a background task from PATCH/POST."""
    _legacy.relation_sync_domain.propagate_inverse(
        page_id,
        table_id,
        old_meta,
        new_meta,
        _RELATION_SYNC_DEPENDENCIES,
    )


def remove_from_link_index(page_id: str) -> None:
    _legacy.link_index_service.remove_from_link_index(
        page_id, _legacy.link_index_state, _LINK_INDEX_DEPENDENCIES
    )


def rewrite_wikilinks_on_title_change(target_id: str, old_title: str, new_title: str) -> int:
    return _legacy.link_index_service.rewrite_wikilinks_on_title_change(
        target_id,
        old_title,
        new_title,
        _legacy.link_index_state,
        _LINK_INDEX_DEPENDENCIES,
        update_link_index_for_page,
    )


get_global_index, get_alias_index = _legacy.link_overview_api.register_routes(
    _legacy.router, _LINK_API_DEPENDENCIES
)
get_link_preview = _legacy.link_preview_api.register_route(_legacy.router, _LINK_API_DEPENDENCIES)


def register_page_in_index(file_path: Path) -> None:
    """Inserts/updates in the in-memory page-index a page that was just written
    to disk, so it appears IMMEDIATELY in /pages (without waiting for the rebuild) and
    is deletable by id. Used by the importer, the web clipper, and the
    public API, which write .md files directly (not via the /pages flow)."""
    try:
        v = _legacy.get_active_vault_path()
        if not v:
            return
        entry = _legacy._build_page_cache_entry(
            _legacy.Path(file_path), _legacy.Path(file_path).stat()
        )
        if not entry:
            return
        with _legacy._page_index_lock:
            _legacy._page_index_entries.setdefault(str(v), {})[str(file_path)] = entry
        _legacy._bump_page_index_version(str(v))
    except Exception as e:
        _legacy.log.warning(f"register_page_in_index failed for {file_path}: {e}")
