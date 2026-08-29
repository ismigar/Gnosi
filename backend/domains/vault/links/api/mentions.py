"""Unlinked-mention discovery and link action HTTP adapters."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.params import Depends as DependsParameter

from backend.domains.vault.links.api.dependencies import LinkApiDependencies
from backend.domains.vault.links.parsing import (
    TOKEN_SPLIT_RE,
    count_unlinked_mentions,
    first_unlinked_mention_snippet,
    link_mentions_in_plain_segments,
)
from backend.domains.vault.links.schemas import (
    LinkMentionsRequest,
    VaultLinkMentionsResponse,
    VaultUnlinkedMentionResponse,
)


log = logging.getLogger(__name__)


def _integer_value(value: object) -> int:
    if isinstance(value, (int, str, bytes, bytearray)):
        return int(value)
    return 0


def _target_title(target_id: str, dependencies: LinkApiDependencies) -> str:
    view = dependencies.read_state()
    if view.built:
        with view.lock:
            title = str((view.page_meta_by_id.get(target_id) or {}).get("title") or "").strip()
            if title:
                return title
    title = str(dependencies.build_id_title_index().get(target_id) or "").strip()
    if title:
        return title
    target_path = dependencies.find_page(target_id)
    if not target_path or not target_path.exists():
        return ""
    if dependencies.is_dashboard(target_path):
        metadata, _body = dependencies.read_dashboard(target_path)
    else:
        raw = target_path.read_text(encoding="utf-8")
        metadata, _body = dependencies.parse_frontmatter(raw, target_path)
    return str(metadata.get("title") or "").strip()


def _mention_candidates(
    target_id: str,
    title_tokens: frozenset[str],
    dependencies: LinkApiDependencies,
) -> set[str] | None:
    view = dependencies.read_state()
    if not view.built or not title_tokens:
        return None
    with view.lock:
        return {
            page_id
            for page_id, tokens in view.tokens_by_source.items()
            if page_id != target_id and title_tokens.issubset(tokens)
        }


def _link_one_candidate(
    file_path: Path,
    *,
    target_id: str,
    target_title: str,
    source_id: str,
    dependencies: LinkApiDependencies,
) -> dict[str, Any] | None:
    try:
        try:
            mtime_before = file_path.stat().st_mtime_ns
        except OSError:
            mtime_before = None
        is_dashboard = dependencies.is_dashboard(file_path)
        if is_dashboard:
            metadata, body = dependencies.read_dashboard(file_path)
        else:
            raw = file_path.read_text(encoding="utf-8")
            metadata, body = dependencies.parse_frontmatter(raw, file_path)
        current_id = str(metadata.get("id") or file_path.stem)
        if current_id == target_id or (source_id and current_id != source_id):
            return None
        updated_body, replacements = link_mentions_in_plain_segments(
            body,
            target_title,
            target_id,
            dependencies.build_browser_path,
        )
        if replacements <= 0:
            return None
        try:
            if mtime_before is not None and file_path.stat().st_mtime_ns != mtime_before:
                log.warning(
                    "Skipping mention-linking for %s: modified concurrently",
                    file_path.name,
                )
                return None
        except OSError:
            pass
        dependencies.resolve_create_page_version()(current_id, file_path)
        if is_dashboard:
            dependencies.write_dashboard(
                file_path=file_path,
                page_id=current_id,
                title=str(metadata.get("title") or file_path.stem),
                metadata=metadata,
                content=updated_body,
                parent_id=metadata.get("parent_id"),
                is_database=bool(metadata.get("is_database")),
            )
        else:
            dependencies.save_page(file_path, metadata, updated_body)
        return {
            "id": current_id,
            "title": metadata.get("title") or file_path.stem,
            "replacements": replacements,
            "_path": file_path,
        }
    except Exception as exc:
        log.warning("Error linking unlinked mentions for %s: %s", file_path.name, exc)
        return None


def _build_get_unlinked_mentions(
    dependencies: LinkApiDependencies,
) -> Callable[..., object]:
    def get_unlinked_mentions(id: str) -> list[dict[str, object]]:
        """Finds notes mentioning target title in plain text without an actual link.

        Fast path: pre-filters candidates with `_tokens_by_source` (set lookup) and
        only runs regex on documents where ALL title tokens
        appear. Typically reduces from 4000 → ~10-100 candidates.
        See: docs/dev_memory/directives/wiki_inverse_link_index.md
        """
        target_id = str(id or "").strip()
        if not target_id:
            return []
        target_title = _target_title(target_id, dependencies)
        if len(target_title) < 2:
            return []
        title_tokens = frozenset(
            token for token in TOKEN_SPLIT_RE.split(target_title.lower()) if len(token) >= 2
        )
        candidate_ids = _mention_candidates(target_id, title_tokens, dependencies)
        results: list[dict[str, object]] = []
        for file_path, metadata, body, _is_dashboard in dependencies.iter_documents():
            try:
                current_id = str(metadata.get("id") or file_path.stem)
                if current_id == target_id:
                    continue
                if candidate_ids is not None and current_id not in candidate_ids:
                    continue
                count = count_unlinked_mentions(body, target_title)
                if count <= 0:
                    continue
                results.append(
                    {
                        "id": current_id,
                        "title": metadata.get("title") or file_path.stem,
                        "count": count,
                        "snippet": first_unlinked_mention_snippet(body, target_title),
                    }
                )
            except Exception as exc:
                log.warning(
                    "Error processing unlinked mentions for %s: %s",
                    file_path.name,
                    exc,
                )
        results.sort(
            key=lambda item: (
                -_integer_value(item.get("count")),
                str(item.get("title") or ""),
            )
        )
        return results

    return get_unlinked_mentions


def _build_link_unlinked_mentions(
    dependencies: LinkApiDependencies,
) -> Callable[..., object]:
    async def link_unlinked_mentions(
        request: LinkMentionsRequest,
    ) -> dict[str, object]:
        """Converts plain mentions of target title into internal links in one source note or all notes."""
        target_id = str(request.target_id or "").strip()
        source_id = str(request.source_id or "").strip()
        if not target_id:
            raise HTTPException(status_code=400, detail="target_id is required")
        target_title = str(dependencies.build_id_title_index().get(target_id) or "").strip()
        if len(target_title) < 2:
            raise HTTPException(
                status_code=400,
                detail="Target page title not found or too short",
            )
        if source_id:
            source_path = dependencies.find_page(source_id)
            if not source_path or not source_path.exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"Source page not found (ID: {source_id})",
                )
            candidates = [source_path]
        else:
            candidates = [document[0] for document in dependencies.iter_documents()]
        changed_notes = [
            changed
            for file_path in candidates
            if (
                changed := _link_one_candidate(
                    file_path,
                    target_id=target_id,
                    target_title=target_title,
                    source_id=source_id,
                    dependencies=dependencies,
                )
            )
            is not None
        ]
        if len(changed_notes) > 20:
            dependencies.resolve_kickoff_rebuild()()
        elif changed_notes:
            update_index = dependencies.resolve_update_index()
            for note in changed_notes:
                path = note.get("_path")
                if isinstance(path, Path):
                    try:
                        update_index(path)
                    except Exception as exc:
                        log.debug("link-index update skip: %s", exc)
        total_replacements = sum(_integer_value(note.get("replacements")) for note in changed_notes)
        for note in changed_notes:
            note.pop("_path", None)
        changed_notes.sort(key=lambda item: str(item.get("title") or ""))
        return {
            "status": "success",
            "target_id": target_id,
            "target_title": target_title,
            "notes_changed": len(changed_notes),
            "total_replacements": total_replacements,
            "changed_notes": changed_notes,
        }

    return link_unlinked_mentions


def register_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
    dependencies: LinkApiDependencies,
) -> tuple[Callable[..., object], Callable[..., object]]:
    get_unlinked_mentions = _build_get_unlinked_mentions(dependencies)

    link_unlinked_mentions = _build_link_unlinked_mentions(dependencies)

    router.add_api_route(
        "/unlinked-mentions",
        get_unlinked_mentions,
        methods=["GET"],
        response_model=list[VaultUnlinkedMentionResponse],
    )
    router.add_api_route(
        "/link-unlinked-mentions",
        link_unlinked_mentions,
        methods=["POST"],
        dependencies=list(editor_dependencies),
        response_model=VaultLinkMentionsResponse,
    )
    return get_unlinked_mentions, link_unlinked_mentions


__all__ = ["register_routes"]
