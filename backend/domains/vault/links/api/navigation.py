"""Reverse-link observability and navigation HTTP adapters."""

from __future__ import annotations

import logging
import re
import time
import urllib.parse
from collections.abc import Callable, Sequence
from pathlib import Path
from fastapi import APIRouter
from fastapi.params import Depends as DependsParameter

from backend.domains.vault.links.api.dependencies import LinkApiDependencies
from backend.domains.vault.links.index_service import LINK_INDEX_SCHEMA_VERSION
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.links.schemas import (
    LinkIndexRebuildResponse,
    LinkIndexStatsResponse,
    VaultBacklinkResponse,
    VaultOutlinksResponse,
)


log = logging.getLogger(__name__)


def _fallback_title_to_ids(id_title_index: dict[str, str]) -> dict[str, set[str]]:
    title_to_ids: dict[str, set[str]] = {}
    for page_id, title in id_title_index.items():
        key = str(title or "").strip().lower()
        if key:
            title_to_ids.setdefault(key, set()).add(str(page_id))
    return title_to_ids


def _fallback_candidate_targets(
    raw_ref: str,
    title_to_ids: dict[str, set[str]],
) -> set[str]:
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
    patterns = (
        r"(?:https?://[^/]+)?/(?:vault/page|@[^/]+/knowledge/(?:page|dashboard))/([^/?#]+)",
        r"(?:https?://[^/]+)?/(?:api/vault|api/v1/vaults/[^/]+/knowledge)/pages/([^/?#]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, base, re.IGNORECASE)
        if match and match.group(1):
            try:
                candidates.add(urllib.parse.unquote(match.group(1).strip()))
            except Exception:
                candidates.add(match.group(1).strip())
    candidates.update(title_to_ids.get(base.lower(), set()))
    return {candidate.strip() for candidate in candidates if candidate.strip()}


def _fallback_matches_target(
    raw_ref: str,
    target_id: str,
    target_title: str,
    title_to_ids: dict[str, set[str]],
) -> bool:
    for candidate in _fallback_candidate_targets(raw_ref, title_to_ids):
        if candidate == target_id:
            return True
        if target_title and candidate.lower() == target_title:
            return True
        if target_id in title_to_ids.get(candidate.lower(), set()):
            return True
    return False


def _fallback_metadata_matches(
    metadata: PageMetadata,
    target_id: str,
    matches_target: Callable[[str], bool],
) -> bool:
    for value in metadata.values():
        if value == target_id:
            return True
        if isinstance(value, list) and any(
            str(item).strip() == target_id or (isinstance(item, str) and matches_target(item))
            for item in value
        ):
            return True
        if isinstance(value, str) and matches_target(value):
            return True
    return False


def _fallback_body_matches(body: str, matches_target: Callable[[str], bool]) -> bool:
    for raw_link in re.findall(
        r"!?\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|.*?)?\]\]",
        body,
    ):
        if matches_target(str(raw_link or "").split("#", 1)[0].strip()):
            return True
    return any(matches_target(raw_link) for raw_link in re.findall(r"\[.*?\]\((.*?)\)", body))


def _fallback_backlinks(
    target_id: str,
    dependencies: LinkApiDependencies,
) -> list[dict[str, object]]:
    backlinks: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    id_title_index = dependencies.build_id_title_index()
    target_title = str(id_title_index.get(target_id) or "").strip().lower()
    title_to_ids = _fallback_title_to_ids(id_title_index)

    def matches_target(raw_ref: str) -> bool:
        return _fallback_matches_target(
            raw_ref,
            target_id,
            target_title,
            title_to_ids,
        )

    for file_path, metadata, body, _is_dashboard in dependencies.iter_documents():
        try:
            current_id = str(metadata.get("id", file_path.stem) or file_path.stem).strip()
            if not current_id or current_id == target_id or current_id in seen_ids:
                continue
            found = _fallback_metadata_matches(metadata, target_id, matches_target)
            found_kind = "relation" if found else "link"
            if not found:
                found = _fallback_body_matches(body, matches_target)
            if found:
                seen_ids.add(current_id)
                backlinks.append(
                    {
                        "id": current_id,
                        "title": metadata.get("title") or file_path.stem,
                        "kind": found_kind,
                    }
                )
        except Exception as exc:
            log.warning("Error processing backlinks for %s: %s", file_path.name, exc)
    return backlinks


def _outlinks(page_id: str, dependencies: LinkApiDependencies) -> dict[str, object]:
    empty: dict[str, object] = {"links": [], "relations": [], "unresolved": []}
    view = dependencies.read_state()
    if not page_id or not view.built:
        return empty
    with view.lock:
        if page_id not in view.outlinks_by_source:
            return empty
        refs = set(view.outlinks_by_source.get(page_id, set()))
        kinds = dict(view.outlink_kinds_by_source.get(page_id, {}))
        title_to_ids: dict[str, set[str]] = {}
        stem_to_ids: dict[str, set[str]] = {}
        for candidate_id, metadata in view.page_meta_by_id.items():
            title = str(metadata.get("title") or "").strip().lower()
            if title:
                title_to_ids.setdefault(title, set()).add(candidate_id)
            path = str(metadata.get("path") or "")
            if path:
                stem_to_ids.setdefault(Path(path).stem.strip().lower(), set()).add(candidate_id)
        by_lower: dict[str, set[str]] = {}
        for raw in refs:
            by_lower.setdefault(raw.lower(), set()).add(raw)
        target_kind: dict[str, str] = {}
        unresolved: dict[str, str] = {}
        for lower, variants in by_lower.items():
            kind = (
                "relation"
                if any(kinds.get(value) == "relation" for value in variants | {lower})
                else "link"
            )
            target_ids = {value for value in variants | {lower} if value in view.page_meta_by_id}
            target_ids.update(title_to_ids.get(lower, set()))
            target_ids.update(stem_to_ids.get(lower, set()))
            target_ids.discard(page_id)
            if target_ids:
                for target_id in target_ids:
                    previous = target_kind.get(target_id)
                    if previous != "relation":
                        target_kind[target_id] = (
                            "relation" if kind == "relation" else (previous or kind)
                        )
            elif kind == "link":
                unresolved[lower] = max(
                    variants,
                    key=lambda value: (
                        any(character.isupper() for character in value),
                        len(value),
                    ),
                )
        links: list[dict[str, str]] = []
        relations: list[dict[str, str]] = []
        for target_id, kind in target_kind.items():
            metadata = view.page_meta_by_id.get(target_id) or {}
            entry = {
                "id": target_id,
                "title": str(metadata.get("title") or target_id),
            }
            (relations if kind == "relation" else links).append(entry)
    links.sort(key=lambda item: item["title"].lower())
    relations.sort(key=lambda item: item["title"].lower())
    unresolved_list = sorted(
        ({"title": value} for value in unresolved.values()),
        key=lambda item: item["title"].lower(),
    )
    return {"links": links, "relations": relations, "unresolved": unresolved_list}


def register_routes(
    router: APIRouter,
    *,
    admin_dependencies: Sequence[DependsParameter],
    dependencies: LinkApiDependencies,
) -> tuple[Callable[..., object], ...]:
    def get_link_index_stats() -> dict[str, object]:
        """Status of the wikilinks reverse index (debug/observability).

        See: docs/dev_memory/directives/wiki_inverse_link_index.md
        """
        view = dependencies.read_state()
        with view.lock:
            targets_with_backlinks = len(view.backlinks_by_target)
            unresolved_titles = len(view.backlinks_by_target_title)
            total_outlinks = sum(len(refs) for refs in view.outlinks_by_source.values())
            total_tokens = sum(len(tokens) for tokens in view.tokens_by_source.values())
            built_ts = view.build_ts
            sources = view.source_count
        cache_path = dependencies.get_cache_path()
        cache_exists = bool(cache_path and cache_path.exists())
        cache_size = cache_path.stat().st_size if cache_exists and cache_path else 0
        return {
            "built": view.built,
            "built_ts": built_ts,
            "built_age_seconds": (time.time() - built_ts) if built_ts else None,
            "schema_version": LINK_INDEX_SCHEMA_VERSION,
            "sources_indexed": sources,
            "targets_with_backlinks": targets_with_backlinks,
            "unresolved_title_buckets": unresolved_titles,
            "total_outlinks": total_outlinks,
            "total_tokens": total_tokens,
            "disk_cache": {
                "path": str(cache_path) if cache_path else None,
                "exists": cache_exists,
                "size_bytes": cache_size,
            },
        }

    def post_link_index_rebuild() -> dict[str, str]:
        """Forces a full rebuild of the reverse index in the background.

        Useful after massive external edits (OneDrive sync, import
        scripts) that did not go through the backend's write endpoints.
        """
        dependencies.resolve_kickoff_rebuild()()
        return {"status": "rebuild_scheduled"}

    def get_backlinks(id: str) -> list[dict[str, object]]:
        """Finds all notes linking to a specific ID (both in metadata and body).

        Fast path: direct lookup in the in-memory reverse index (`_backlinks_by_target`).
        Fallback: if the index hasn't been built yet (startup), scans the whole
        vault as before. See: docs/dev_memory/directives/wiki_inverse_link_index.md
        """
        target_id = str(id or "").strip()
        if not target_id:
            return []
        view = dependencies.read_state()
        if not view.built:
            return _fallback_backlinks(target_id, dependencies)
        with view.lock:
            target_title = (
                str((view.page_meta_by_id.get(target_id) or {}).get("title") or "").strip().lower()
            )
            results: list[dict[str, object]] = [
                dict(item) for item in view.backlinks_by_target.get(target_id, [])
            ]
            if target_title:
                seen_ids = {item["id"] for item in results}
                for item in view.backlinks_by_target_title.get(target_title, []):
                    if item["id"] not in seen_ids and item["id"] != target_id:
                        seen_ids.add(item["id"])
                        results.append(dict(item))
        return sorted(results, key=lambda item: str(item.get("title") or ""))

    def get_outlinks(id: str) -> dict[str, object]:
        """Outgoing references of a page, resolved and split by kind.

        Single source of truth for the editor's "Enllaços i mencions" panel so its
        outgoing counts line up with /backlinks and /api/graph (same resolution:
        id → title → filename stem; same link-vs-relation classification). Returns
        ``{links, relations, unresolved}`` where ``links``/``relations`` are resolved
        page refs and ``unresolved`` are wikilinks that point to no existing page.
        See feedback_links_panel_vs_graph_divergence.
        """
        return _outlinks(str(id or "").strip(), dependencies)

    router.add_api_route(
        "/link-index/stats",
        get_link_index_stats,
        methods=["GET"],
        response_model=LinkIndexStatsResponse,
    )
    router.add_api_route(
        "/link-index/rebuild",
        post_link_index_rebuild,
        methods=["POST"],
        dependencies=list(admin_dependencies),
        response_model=LinkIndexRebuildResponse,
    )
    router.add_api_route(
        "/backlinks",
        get_backlinks,
        methods=["GET"],
        response_model=list[VaultBacklinkResponse],
    )
    router.add_api_route(
        "/outlinks",
        get_outlinks,
        methods=["GET"],
        response_model=VaultOutlinksResponse,
    )
    return get_link_index_stats, post_link_index_rebuild, get_backlinks, get_outlinks


__all__ = ["register_routes"]
