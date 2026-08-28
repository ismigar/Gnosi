"""Persistent PDF highlights generated from grounded LLM Wiki citations."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from backend.config.logger_config import get_logger
from backend.data.db import get_engine_for_path
from backend.models.pdf_annotation import PdfAnnotation
from backend.services.context_vars import get_active_vault_path

logger = get_logger(__name__)

_ANNOTATION_COLOR = "#ffd400"
_MANAGED_PREFIX = "llm-wiki"
_ZOTERO_BLOB_PREFIX = "__ZOTERO_JSON__"


def _normalized_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _shorten_at_word_boundary(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    shortened = text[:limit]
    last_space = shortened.rfind(" ")
    return (shortened[:last_space] if last_space >= max(16, limit // 2) else shortened).strip()


def _search_queries(quote: str) -> list[str]:
    normalized = _normalized_text(quote)
    candidates = [normalized]
    for limit in (120, 96, 72, 48, 32):
        candidates.append(_shorten_at_word_boundary(normalized, limit))
    return list(dict.fromkeys(candidate for candidate in candidates if len(candidate) >= 12))


def _managed_key(resource_id: str, citation: dict[str, Any]) -> str:
    stable_value = "|".join(
        (
            str(citation.get("origin_id") or ""),
            str(citation.get("segment_id") or ""),
            _normalized_text(citation.get("quote")).casefold(),
        )
    )
    digest = hashlib.sha256(stable_value.encode("utf-8")).hexdigest()[:32]
    return f"{_MANAGED_PREFIX}:{resource_id}:{digest}"


def _find_quote_position_in_document(
    document: Any,
    page_number: int,
    quote: str,
) -> Optional[dict[str, Any]]:
    page_index = page_number - 1
    if page_index < 0 or page_index >= len(document):
        return None
    page = document[page_index]
    text_page = page.get_textpage()
    try:
        for query in _search_queries(quote):
            searcher = text_page.search(query, match_case=False)
            try:
                match = searcher.get_next()
            finally:
                searcher.close()
            if not match:
                continue
            start, count = match
            rect_count = text_page.count_rects(start, count)
            rects = [
                [round(float(value), 3) for value in text_page.get_rect(index)]
                for index in range(rect_count)
            ]
            rects = [rect for rect in rects if rect[2] > rect[0] and rect[3] > rect[1]]
            if not rects:
                continue
            page_height = float(page.get_height())
            top = max(0, int(page_height - max(rect[3] for rect in rects)))
            sort_index = "|".join(
                (
                    str(page_index)[:5].zfill(5),
                    str(start)[:6].zfill(6),
                    str(top)[:5].zfill(5),
                )
            )
            return {
                "page_index": page_index,
                "rects": rects,
                "sort_index": sort_index,
                "matched_text": query,
            }
    finally:
        text_page.close()
        page.close()
    return None


def _find_quote_position(pdf_path: Path, page_number: int, quote: str) -> Optional[dict[str, Any]]:
    """Resolve one citation to Zotero-compatible PDF coordinates."""
    import pypdfium2

    document = pypdfium2.PdfDocument(str(pdf_path))
    try:
        return _find_quote_position_in_document(document, page_number, quote)
    finally:
        document.close()


def _citation_candidates(
    notes: list[dict[str, Any]],
    origins: list[dict[str, Any]],
    resource_id: str,
) -> dict[str, dict[str, Any]]:
    origins_by_id = {
        str(origin.get("origin_id") or ""): origin
        for origin in origins
        if str(origin.get("kind") or "").lower() == "pdf"
    }
    candidates: dict[str, dict[str, Any]] = {}
    for note in notes:
        for citation in note.get("citations") or []:
            if not isinstance(citation, dict):
                continue
            origin = origins_by_id.get(str(citation.get("origin_id") or ""))
            locator = citation.get("locator") or {}
            quote = _normalized_text(citation.get("quote"))
            try:
                page_number = int(locator.get("page") or 0)
            except (TypeError, ValueError):
                page_number = 0
            if not origin or not quote or page_number < 1:
                continue
            key = _managed_key(resource_id, citation)
            candidates[key] = {
                "managed_key": key,
                "source_uri": str(origin.get("_annotation_source_uri") or ""),
                "pdf_path": Path(str(origin.get("_annotation_pdf_path") or "")),
                "page": page_number,
                "quote": quote,
            }
    return candidates


def _zotero_annotation(
    candidate: dict[str, Any],
    position: dict[str, Any],
    *,
    created_at: Optional[dt.datetime] = None,
) -> dict[str, Any]:
    now = dt.datetime.now(dt.timezone.utc)
    created = created_at or now
    if created.tzinfo is None:
        created = created.replace(tzinfo=dt.timezone.utc)
    return {
        "id": candidate["managed_key"],
        "type": "highlight",
        "color": _ANNOTATION_COLOR,
        "sortIndex": position["sort_index"],
        "pageLabel": str(candidate["page"]),
        "dateCreated": created.isoformat(),
        "dateModified": now.isoformat(),
        "authorName": "Gnosi Brain",
        "isAuthorNameAuthoritative": True,
        "text": candidate["quote"],
        "comment": "",
        "tags": [{"name": "Brain citation"}],
        "position": {
            "pageIndex": position["page_index"],
            "rects": position["rects"],
        },
    }


def _resolve_annotation_candidates(
    candidates: dict[str, dict[str, Any]],
    position_resolver: Optional[Callable[[Path, int, str], Optional[dict[str, Any]]]],
) -> tuple[dict[str, tuple[dict[str, Any], dict[str, Any]]], list[str]]:
    """Resolve PDF geometry while reusing opened documents per attachment."""
    resolved: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    warnings: list[str] = []
    documents: dict[str, Any] = {}
    resolver: Callable[[Path, int, str], Optional[dict[str, Any]]]
    if position_resolver is None:
        import pypdfium2

        def cached_resolver(
            pdf_path: Path, page_number: int, quote: str
        ) -> Optional[dict[str, Any]]:
            path_key = str(pdf_path)
            document = documents.get(path_key)
            if document is None:
                document = pypdfium2.PdfDocument(path_key)
                documents[path_key] = document
            return _find_quote_position_in_document(document, page_number, quote)

        resolver = cached_resolver
    else:
        resolver = position_resolver

    try:
        for key, candidate in candidates.items():
            pdf_path = candidate["pdf_path"]
            if not candidate["source_uri"] or not pdf_path.is_file():
                unavailable = candidate["source_uri"] or pdf_path
                warnings.append(
                    "PDF citation highlight skipped because the attachment is "
                    f"unavailable: {unavailable}"
                )
                continue
            try:
                position = resolver(pdf_path, candidate["page"], candidate["quote"])
            except Exception as exc:  # noqa: BLE001
                logger.warning("llm_wiki PDF citation geometry failed: %s", exc)
                position = None
            if position:
                resolved[key] = (candidate, position)
            else:
                warnings.append(
                    f"PDF citation highlight text was not found on page {candidate['page']}: "
                    f"{candidate['quote'][:80]}"
                )
    finally:
        for document in documents.values():
            document.close()
    return resolved, warnings


def _annotation_session(session: Optional[Session]) -> tuple[Session, bool]:
    """Return the injected session or open one for the active vault."""
    if session is not None:
        return session, False
    _engine, session_factory = get_engine_for_path(get_active_vault_path())
    return session_factory(), True


def _upsert_resolved_annotations(
    session: Session,
    resolved: dict[str, tuple[dict[str, Any], dict[str, Any]]],
    existing_by_key: dict[str, PdfAnnotation],
) -> tuple[int, int]:
    """Create or update all resolved managed annotations."""
    created = 0
    updated = 0
    for key, (candidate, position) in resolved.items():
        item = existing_by_key.get(key)
        payload = _zotero_annotation(
            candidate,
            position,
            created_at=item.created_at if item is not None else None,
        )
        blob = _ZOTERO_BLOB_PREFIX + json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        if item is None:
            item = PdfAnnotation(managed_key=key)
            session.add(item)
            created += 1
        else:
            updated += 1
        item.source_uri = candidate["source_uri"]
        item.page = candidate["page"]
        item.type = "highlight"
        item.color = _ANNOTATION_COLOR
        item.rects_json = None
        item.text = candidate["quote"]
        item.comment = blob
        item.tags = "gnosi:llm-wiki"
    return created, updated


def _persist_managed_annotations(
    session: Session,
    resource_id: str,
    desired_keys: set[str],
    resolved: dict[str, tuple[dict[str, Any], dict[str, Any]]],
) -> tuple[int, int, int]:
    """Apply one transaction and return created, updated and removed counts."""
    prefix = f"{_MANAGED_PREFIX}:{resource_id}:"
    existing_items = (
        session.query(PdfAnnotation).filter(PdfAnnotation.managed_key.like(f"{prefix}%")).all()
    )
    existing_by_key = {str(item.managed_key): item for item in existing_items if item.managed_key}
    created, updated = _upsert_resolved_annotations(
        session,
        resolved,
        existing_by_key,
    )
    removed = 0
    for item in existing_items:
        if item.managed_key not in desired_keys:
            session.delete(item)
            removed += 1
    session.commit()
    return created, updated, removed


def sync_generated_pdf_annotations(
    notes: list[dict[str, Any]],
    origins: list[dict[str, Any]],
    resource_id: str,
    *,
    session: Optional[Session] = None,
    position_resolver: Optional[Callable[[Path, int, str], Optional[dict[str, Any]]]] = None,
) -> dict[str, Any]:
    """Upsert managed citation highlights and remove only obsolete managed ones."""
    candidates = _citation_candidates(notes, origins, resource_id)
    desired_keys = set(candidates)
    resolved, warnings = _resolve_annotation_candidates(candidates, position_resolver)
    active_session, owns_session = _annotation_session(session)
    try:
        created, updated, removed = _persist_managed_annotations(
            active_session,
            resource_id,
            desired_keys,
            resolved,
        )
    except Exception:
        active_session.rollback()
        raise
    finally:
        if owns_session:
            active_session.close()

    return {
        "created": created,
        "updated": updated,
        "removed": removed,
        "matched": len(resolved),
        "requested": len(candidates),
        "warnings": warnings,
    }
