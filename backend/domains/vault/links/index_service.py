"""Reverse-link index services and persistence."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from backend.domains.vault.links.parsing import (
    extract_outlinks_with_kinds,
    resolve_page_id,
    tokenize_body,
)
from backend.domains.vault.links.state import LinkIndexState, LinkIndexView


log = logging.getLogger(__name__)
LINK_INDEX_SCHEMA_VERSION = 2
LINK_INDEX_PERSIST_DEBOUNCE = 5.0
Document = tuple[Path, dict[str, Any], str, bool]


class JsonWriter(Protocol):
    def __call__(self, path: Path, data: object, **kwargs: object) -> None: ...


@dataclass(frozen=True)
class LinkIndexDependencies:
    get_cache_path: Callable[[], Path | None]
    write_json: JsonWriter
    iter_documents: Callable[[], list[Document]]
    current_vault_key: Callable[[], str]
    get_body: Callable[[Path], str]
    is_dashboard: Callable[[Path], bool]
    read_dashboard: Callable[[Path], tuple[dict[str, Any], str]]
    parse_frontmatter: Callable[[str, Path], tuple[dict[str, Any], str]]
    write_text: Callable[[Path, str], None]


def resolve_link_index_cache_path(
    configured_path: Path | None,
    data_directory: Path,
) -> Path:
    return configured_path or data_directory / "cache" / "vault_link_index.json"


def link_index_title_for(page_id: str, view: LinkIndexView) -> str | None:
    page_id = str(page_id or "").strip()
    if not page_id or not view.built:
        return None
    with view.lock:
        metadata = view.page_meta_by_id.get(page_id) or {}
    title = str(metadata.get("title") or "").strip()
    return title or None


def link_index_unique_id_for_title(title: str, view: LinkIndexView) -> str | None:
    wanted = str(title or "").strip().lower()
    if not wanted or not view.built:
        return None
    with view.lock:
        matches = [
            page_id
            for page_id, metadata in view.page_meta_by_id.items()
            if str(metadata.get("title") or "").strip().lower() == wanted
        ]
    return matches[0] if len(matches) == 1 else None


def rebuild_backlinks_locked(state: LinkIndexState) -> None:
    by_target: dict[str, list[dict[str, str]]] = {}
    by_title: dict[str, list[dict[str, str]]] = {}
    title_to_ids: dict[str, set[str]] = {}
    stem_to_ids: dict[str, set[str]] = {}
    for page_id, metadata in state.page_meta_by_id.items():
        title = str(metadata.get("title") or "").strip().lower()
        if title:
            title_to_ids.setdefault(title, set()).add(page_id)
        node_path = str(metadata.get("path") or "")
        if node_path:
            stem = Path(node_path).stem.strip().lower()
            if stem:
                stem_to_ids.setdefault(stem, set()).add(page_id)

    for source_id, refs in state.outlinks_by_source.items():
        source_meta = state.page_meta_by_id.get(source_id) or {}
        source_title = source_meta.get("title") or source_id
        kinds = state.outlink_kinds_by_source.get(source_id, {})
        target_kind: dict[str, str] = {}
        unresolved_kind: dict[str, str] = {}
        for raw in refs:
            ref_lower = raw.lower()
            kind = kinds.get(raw) or kinds.get(ref_lower) or "link"
            target_ids: set[str] = set()
            if raw in state.page_meta_by_id:
                target_ids.add(raw)
            target_ids.update(title_to_ids.get(ref_lower, ()))
            target_ids.update(stem_to_ids.get(ref_lower, ()))
            if target_ids:
                for target_id in target_ids:
                    if target_id == source_id:
                        continue
                    previous = target_kind.get(target_id)
                    if previous != "relation":
                        target_kind[target_id] = (
                            "relation" if kind == "relation" else (previous or kind)
                        )
            else:
                previous = unresolved_kind.get(ref_lower)
                if previous != "relation":
                    unresolved_kind[ref_lower] = (
                        "relation" if kind == "relation" else (previous or kind)
                    )
        for target_id, kind in target_kind.items():
            by_target.setdefault(target_id, []).append(
                {"id": source_id, "title": str(source_title), "kind": kind}
            )
        for ref_lower, kind in unresolved_kind.items():
            by_title.setdefault(ref_lower, []).append(
                {"id": source_id, "title": str(source_title), "kind": kind}
            )
    state.backlinks_by_target.clear()
    state.backlinks_by_target.update(by_target)
    state.backlinks_by_target_title.clear()
    state.backlinks_by_target_title.update(by_title)


def save_link_index(state: LinkIndexState, dependencies: LinkIndexDependencies) -> None:
    try:
        cache_path = dependencies.get_cache_path()
        if not cache_path:
            return
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with state.lock:
            payload = {
                "schema_version": LINK_INDEX_SCHEMA_VERSION,
                "built_ts": state.build_ts,
                "outlinks": {
                    page_id: sorted(refs) for page_id, refs in state.outlinks_by_source.items()
                },
                "outlink_kinds": {
                    page_id: dict(kinds) for page_id, kinds in state.outlink_kinds_by_source.items()
                },
                "tokens": {
                    page_id: sorted(tokens) for page_id, tokens in state.tokens_by_source.items()
                },
                "meta": dict(state.page_meta_by_id),
            }
        dependencies.write_json(
            cache_path,
            payload,
            indent=None,
            ensure_ascii=False,
        )
        log.info("💾 Link-index cache saved (%s pages)", len(state.page_meta_by_id))
    except Exception as exc:
        log.error("❌ Error saving link-index cache: %s", exc)


def _string_map(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def load_link_index(state: LinkIndexState, dependencies: LinkIndexDependencies) -> bool:
    try:
        cache_path = dependencies.get_cache_path()
        if not cache_path or not cache_path.exists():
            return False
        loaded: object = json.loads(cache_path.read_text(encoding="utf-8"))
        data = _string_map(loaded)
        if data.get("schema_version") != LINK_INDEX_SCHEMA_VERSION:
            log.info("Link-index cache schema mismatch; ignoring it")
            return False
        outlinks_raw = _string_map(data.get("outlinks"))
        kinds_raw = _string_map(data.get("outlink_kinds"))
        tokens_raw = _string_map(data.get("tokens"))
        meta_raw = _string_map(data.get("meta"))
        with state.lock:
            state.outlinks_by_source.clear()
            for page_id, refs in outlinks_raw.items():
                if isinstance(refs, list):
                    state.outlinks_by_source[page_id] = {str(ref) for ref in refs}
            state.outlink_kinds_by_source.clear()
            for page_id, kinds in kinds_raw.items():
                if isinstance(kinds, dict):
                    state.outlink_kinds_by_source[page_id] = {
                        str(ref): str(kind) for ref, kind in kinds.items()
                    }
            state.tokens_by_source.clear()
            for page_id, tokens in tokens_raw.items():
                if isinstance(tokens, list):
                    state.tokens_by_source[page_id] = frozenset(str(token) for token in tokens)
            state.page_meta_by_id.clear()
            state.page_meta_by_id.update(
                {
                    page_id: dict(metadata)
                    for page_id, metadata in meta_raw.items()
                    if isinstance(metadata, dict)
                }
            )
            rebuild_backlinks_locked(state)
            state.built = True
            built_ts = data.get("built_ts")
            state.build_ts = float(built_ts) if isinstance(built_ts, (int, float)) else time.time()
            state.source_count = len(state.page_meta_by_id)
        log.info("📂 Link index loaded from disk (%s pages)", state.source_count)
        return True
    except Exception as exc:
        log.error("❌ Error loading link-index cache: %s", exc)
        return False


def get_link_index_terms(
    page_ids: Iterable[str],
    read_view: Callable[[], LinkIndexView],
    load_index: Callable[[], bool],
) -> tuple[dict[str, tuple[frozenset[str], frozenset[str]]], float]:
    view = read_view()
    if not view.built:
        load_index()
        view = read_view()
    requested = {str(page_id or "").strip() for page_id in page_ids if page_id}
    snapshot: dict[str, tuple[frozenset[str], frozenset[str]]] = {}
    with view.lock:
        for page_id in requested:
            if page_id not in view.tokens_by_source and page_id not in view.outlinks_by_source:
                continue
            references = set(view.outlinks_by_source.get(page_id, set()))
            for reference in tuple(references):
                target = view.page_meta_by_id.get(reference) or {}
                title = str(target.get("title") or "").strip()
                if title:
                    references.add(title)
            snapshot[page_id] = (
                view.tokens_by_source.get(page_id, frozenset()),
                frozenset(references),
            )
        built_at = float(view.build_ts or 0.0)
    return snapshot, built_at


def get_agent_index_freshness(
    *,
    requested_count: int,
    covered_count: int,
    direct_reads: int,
    stale_after_seconds: int,
    read_view: Callable[[], LinkIndexView],
    load_index: Callable[[], bool],
    current_vault_key: Callable[[], str],
    kickoff_rebuild: Callable[[], None],
) -> dict[str, object]:
    view = read_view()
    if not view.built:
        load_index()
        view = read_view()
    with view.lock:
        built_at = float(view.build_ts or 0.0)
    with view.rebuild_state_lock:
        rebuilding = bool(view.rebuild_in_progress)
    now = time.time()
    age_seconds = max(0, int(now - built_at)) if built_at else None
    stale_after = max(60, min(int(stale_after_seconds), 86_400))
    status = (
        "missing"
        if not built_at
        else "fresh"
        if age_seconds is not None and age_seconds < stale_after
        else "stale_while_revalidate"
    )
    refresh_scheduled = False
    if status != "fresh" and current_vault_key():
        kickoff_rebuild()
        refresh_scheduled = True
        view = read_view()
        with view.rebuild_state_lock:
            rebuilding = bool(view.rebuild_in_progress)
    bounded_requested = max(0, int(requested_count))
    bounded_covered = max(0, min(int(covered_count), bounded_requested))
    coverage_ratio = round(bounded_covered / bounded_requested, 4) if bounded_requested else 1.0
    return {
        "status": status,
        "checked_at": int(now),
        "index_built_at": int(built_at) if built_at else None,
        "age_seconds": age_seconds,
        "stale_after_seconds": stale_after,
        "requested_records": bounded_requested,
        "cached_records": bounded_covered,
        "coverage_ratio": coverage_ratio,
        "direct_reads": max(0, int(direct_reads)),
        "refresh_scheduled": refresh_scheduled,
        "refresh_running": rebuilding,
    }


def get_cached_document_texts(
    paths: Iterable[str],
    *,
    ensure_loaded: Callable[[], bool],
    read_cache: Callable[[], dict[str, tuple[int, dict[str, Any], str]]],
) -> dict[str, str]:
    cache = read_cache()
    if not cache:
        ensure_loaded()
        cache = read_cache()
    requested = {str(path or "").strip() for path in paths if path}
    return {path: cache[path][2] for path in requested if path in cache}


def rebuild_link_index(
    state: LinkIndexState,
    dependencies: LinkIndexDependencies,
    persist: bool = True,
) -> None:
    started = time.time()
    new_outlinks: dict[str, set[str]] = {}
    new_kinds: dict[str, dict[str, str]] = {}
    new_tokens: dict[str, frozenset[str]] = {}
    new_meta: dict[str, dict[str, object]] = {}
    for file_path, metadata, body, _is_dashboard in dependencies.iter_documents():
        try:
            page_id = resolve_page_id(metadata, file_path)
            if not page_id:
                continue
            refs, kinds = extract_outlinks_with_kinds(metadata, body)
            new_outlinks[page_id] = refs
            new_kinds[page_id] = kinds
            new_tokens[page_id] = tokenize_body(body)
            new_meta[page_id] = {
                "title": str(metadata.get("title") or file_path.stem),
                "path": str(file_path),
            }
        except Exception as exc:
            log.warning("link-index: error indexing %s: %s", file_path.name, exc)
    with state.lock:
        state.outlinks_by_source.clear()
        state.outlinks_by_source.update(new_outlinks)
        state.outlink_kinds_by_source.clear()
        state.outlink_kinds_by_source.update(new_kinds)
        state.tokens_by_source.clear()
        state.tokens_by_source.update(new_tokens)
        state.page_meta_by_id.clear()
        state.page_meta_by_id.update(new_meta)
        rebuild_backlinks_locked(state)
        state.built = True
        state.build_ts = time.time()
        state.source_count = len(new_meta)
    log.info(
        "🔗 link-index built in %.2fs (%s pages)",
        time.time() - started,
        len(new_meta),
    )
    if persist:
        save_link_index(state, dependencies)


def schedule_link_index_persist(
    state: LinkIndexState,
    dependencies: LinkIndexDependencies,
) -> None:
    with state.persist_lock:
        if state.persist_pending:
            return
        state.persist_pending = True

    def run() -> None:
        time.sleep(LINK_INDEX_PERSIST_DEBOUNCE)
        try:
            save_link_index(state, dependencies)
        except Exception as exc:
            log.debug("link-index debounced persist failed: %s", exc)
        finally:
            with state.persist_lock:
                state.persist_pending = False

    threading.Thread(target=run, daemon=True, name="link-index-persist").start()


def kickoff_link_index_rebuild(
    state: LinkIndexState,
    dependencies: LinkIndexDependencies,
) -> None:
    if not state.built:
        try:
            load_link_index(state, dependencies)
        except Exception as exc:
            log.warning("link-index disk load failed: %s", exc)
    if state.build_ts and (time.time() - state.build_ts) < 1800:
        log.info(
            "🔗 link-index rebuild skipped: cache de fa %ss (<1800s)",
            int(time.time() - state.build_ts),
        )
        return
    with state.rebuild_state_lock:
        if state.rebuild_in_progress:
            return
        state.rebuild_in_progress = True

    def run() -> None:
        try:
            rebuild_link_index(state, dependencies, persist=True)
        except Exception as exc:
            log.error("link-index rebuild failed: %s", exc)
        finally:
            with state.rebuild_state_lock:
                state.rebuild_in_progress = False

    threading.Thread(target=run, daemon=True, name="link-index-rebuild").start()


def update_link_index_for_page(
    file_path: Path,
    state: LinkIndexState,
    dependencies: LinkIndexDependencies,
) -> None:
    if not state.built or not file_path or not file_path.exists():
        return
    try:
        if dependencies.is_dashboard(file_path):
            metadata, body = dependencies.read_dashboard(file_path)
        else:
            raw = dependencies.get_body(file_path)
            if not raw:
                return
            metadata, body = dependencies.parse_frontmatter(raw, file_path)
    except Exception as exc:
        log.debug("link-index update skip %s: %s", file_path.name, exc)
        return
    page_id = resolve_page_id(metadata, file_path)
    if not page_id:
        return
    refs, kinds = extract_outlinks_with_kinds(metadata, body)
    with state.lock:
        state.outlinks_by_source[page_id] = refs
        state.outlink_kinds_by_source[page_id] = kinds
        state.tokens_by_source[page_id] = tokenize_body(body)
        state.page_meta_by_id[page_id] = {
            "title": str(metadata.get("title") or file_path.stem),
            "path": str(file_path),
        }
        rebuild_backlinks_locked(state)
    schedule_link_index_persist(state, dependencies)


def remove_from_link_index(
    page_id: str,
    state: LinkIndexState,
    dependencies: LinkIndexDependencies,
) -> None:
    if not state.built or not page_id:
        return
    page_id = str(page_id).strip()
    with state.lock:
        state.outlinks_by_source.pop(page_id, None)
        state.outlink_kinds_by_source.pop(page_id, None)
        state.tokens_by_source.pop(page_id, None)
        state.page_meta_by_id.pop(page_id, None)
        rebuild_backlinks_locked(state)
    schedule_link_index_persist(state, dependencies)


def rewrite_wikilinks_on_title_change(
    target_id: str,
    old_title: str,
    new_title: str,
    state: LinkIndexState,
    dependencies: LinkIndexDependencies,
    update_index: Callable[[Path], None],
) -> int:
    old_clean = str(old_title or "").strip()
    new_clean = str(new_title or "").strip()
    target_id = str(target_id or "").strip()
    if not old_clean or not new_clean or old_clean == new_clean:
        return 0
    if not state.built or not target_id:
        return 0
    with state.lock:
        by_id = list(state.backlinks_by_target.get(target_id, []))
        by_title = list(state.backlinks_by_target_title.get(old_clean.lower(), []))
        metadata_snapshot = dict(state.page_meta_by_id)
    seen: set[str] = set()
    candidates: list[dict[str, str]] = []
    for source in by_id + by_title:
        source_id = (source.get("id") or "").strip()
        if not source_id or source_id == target_id or source_id in seen:
            continue
        seen.add(source_id)
        candidates.append(source)
    if not candidates:
        return 0
    pattern = re.compile(
        r"(?P<open>!?\[\[)\s*"
        + re.escape(old_clean)
        + r"\s*(?P<section>#[^\]\|]+)?(?P<alias>\|[^\]]+)?(?P<close>\]\])",
        re.IGNORECASE,
    )

    def replace(match: re.Match[str]) -> str:
        section = match.group("section") or ""
        alias = match.group("alias") or ""
        return f"{match.group('open')}{new_clean}{section}{alias}{match.group('close')}"

    modified_count = 0
    for source in candidates:
        candidate_id = source.get("id")
        if not candidate_id:
            continue
        metadata = metadata_snapshot.get(candidate_id) or {}
        path_value = metadata.get("path") or source.get("path")
        if not path_value:
            continue
        path = Path(str(path_value))
        if not path.exists():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
            updated, replacements = pattern.subn(replace, raw)
            if replacements == 0 or updated == raw:
                continue
            dependencies.write_text(path, updated)
            modified_count += 1
            update_index(path)
        except Exception as exc:
            log.warning("🔁 rewrite skip %s: %s", path.name, exc)
    if modified_count:
        log.info(
            "🔁 Rewrote wikilinks: '%s' → '%s' on %s/%s source pages",
            old_clean,
            new_clean,
            modified_count,
            len(candidates),
        )
    return modified_count


__all__ = [
    "LINK_INDEX_SCHEMA_VERSION",
    "LinkIndexDependencies",
    "get_agent_index_freshness",
    "get_cached_document_texts",
    "get_link_index_terms",
    "kickoff_link_index_rebuild",
    "link_index_title_for",
    "link_index_unique_id_for_title",
    "load_link_index",
    "rebuild_backlinks_locked",
    "rebuild_link_index",
    "remove_from_link_index",
    "resolve_link_index_cache_path",
    "rewrite_wikilinks_on_title_change",
    "save_link_index",
    "schedule_link_index_persist",
    "update_link_index_for_page",
]
