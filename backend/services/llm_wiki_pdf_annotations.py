"""Persistent PDF highlights generated from grounded LLM Wiki citations."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import threading
from pathlib import Path
from typing import Callable, Optional, Protocol, TypedDict

from sqlalchemy.orm import Session

from backend.config.logger_config import get_logger
from backend.data.db import get_engine_for_path
from backend.models.pdf_annotation import PdfAnnotation
from backend.services.context_vars import get_active_vault_path
from backend.utils.open_values import iterable_values
from backend.domains.llm_wiki.pdf_quote_matching import PageTextIndex, index_page, reconcile_unknown_characters
from backend.domains.llm_wiki.pdf_highlight_selection import (
    MAX_HIGHLIGHTS_PER_PAGE,
    MAX_HIGHLIGHT_TEXT_FRACTION,
    highlight_priority,
)

logger = get_logger(__name__)

_ANNOTATION_COLOR = "#ffd400"
_MANAGED_PREFIX = "llm-wiki"
_ZOTERO_BLOB_PREFIX = "__ZOTERO_JSON__"
_READING_GEOMETRY_LOCK = threading.Lock()


class _PdfSearcher(Protocol):
    def get_next(self) -> tuple[int, int] | None: ...

    def close(self) -> object: ...


class _PdfTextPage(Protocol):
    def search(self, text: str, *, match_case: bool) -> _PdfSearcher: ...

    def count_rects(self, start: int, count: int) -> int: ...

    def get_rect(self, index: int) -> tuple[float, float, float, float]: ...

    def close(self) -> object: ...

    def count_chars(self) -> int: ...

    def get_text_range(self, index: int = 0, count: int = -1) -> str: ...


class _PdfPage(Protocol):
    def get_textpage(self) -> _PdfTextPage: ...

    def get_height(self) -> float: ...

    def close(self) -> object: ...


class _PdfDocument(Protocol):
    def __len__(self) -> int: ...

    def __getitem__(self, page_index: int) -> _PdfPage: ...

    def close(self) -> object: ...


class _PdfiumModule(Protocol):
    def open_document(self, path: str) -> _PdfDocument: ...


class _PdfiumAdapter:
    def __init__(self, document_factory: Callable[[str], _PdfDocument]) -> None:
        self._document_factory = document_factory

    def open_document(self, path: str) -> _PdfDocument:
        return self._document_factory(path)


class _CitationCandidate(TypedDict):
    managed_key: str
    source_uri: str
    pdf_path: Path
    page: int
    quote: str
    context: str
    segment_id: str
    priority: float


PositionResolver = Callable[[Path, int, str], Optional[dict[str, object]]]


def _load_pdfium() -> _PdfiumModule:
    """Load the optional PDF adapter at the one untyped vendor boundary."""
    import pypdfium2  # type: ignore[import-untyped]

    return _PdfiumAdapter(pypdfium2.PdfDocument)


def _normalized_text(value: object) -> str:
    return " ".join(str(value or "").split()).strip()


def _search_queries(quote: str) -> list[str]:
    normalized = _normalized_text(quote)
    return [normalized] if normalized else []


def _managed_key(resource_id: str, citation: dict[str, object]) -> str:
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
    document: _PdfDocument,
    page_number: int,
    quote: str,
    context: str = "",
    page_indexes: dict[int, PageTextIndex] | None = None,
    original_page_text: Callable[[int], str] | None = None,
) -> Optional[dict[str, object]]:
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
                repeated = searcher.get_next() if match else None
            finally:
                searcher.close()
            if not match or repeated:
                cached = page_indexes.get(page_index) if page_indexes is not None else None
                if cached is None:
                    cached = index_page(text_page)
                    if "\ufffe" in cached.text and original_page_text is not None:
                        cached = reconcile_unknown_characters(cached, original_page_text(page_index))
                    if page_indexes is not None:
                        page_indexes[page_index] = cached
                match = cached.find(quote, context)
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
                "start": start,
                "count": count,
                "page_text_length": text_page.count_chars(),
            }
    finally:
        text_page.close()
        page.close()
    return None


def _original_page_reader(pdf_path: Path) -> Callable[[int], str]:
    from pypdf import PdfReader
    reader: PdfReader | None = None
    def read(page_index: int) -> str:
        nonlocal reader
        if reader is None:
            reader = PdfReader(str(pdf_path))
        return str(reader.pages[page_index].extract_text() or "")
    return read


def _find_quote_position(pdf_path: Path, page_number: int, quote: str) -> Optional[dict[str, object]]:
    """Resolve one citation to Zotero-compatible PDF coordinates."""
    pypdfium2 = _load_pdfium()
    document = pypdfium2.open_document(str(pdf_path))
    try:
        return _find_quote_position_in_document(document, page_number, quote,
                                                original_page_text=_original_page_reader(pdf_path))
    finally:
        document.close()


def _citation_candidates(
    notes: list[dict[str, object]],
    origins: list[dict[str, object]],
    resource_id: str,
) -> dict[str, _CitationCandidate]:
    origins_by_id = {
        str(origin.get("origin_id") or ""): origin
        for origin in origins
        if str(origin.get("kind") or "").lower() == "pdf"
    }
    candidates: dict[str, _CitationCandidate] = {}
    for note in notes:
        for citation in iterable_values(note.get("citations") or []):
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
            priority = highlight_priority(
                quote,
                str(note.get("title") or ""),
                str(note.get("body_md") or ""),
                primary=citation.get("segment_id") == note.get("source_segment_id"),
            )
            if key in candidates:
                candidates[key]["priority"] = max(candidates[key]["priority"], priority)
                continue
            candidates[key] = {
                "managed_key": key,
                "source_uri": str(origin.get("_annotation_source_uri") or ""),
                "pdf_path": Path(str(origin.get("_annotation_pdf_path") or "")),
                "page": page_number,
                "quote": quote,
                "segment_id": str(citation.get("segment_id") or ""),
                "priority": priority,
                "context": next((str(segment.get("text") or "")
                                 for segment in iterable_values(origin.get("segments") or [])
                                 if isinstance(segment, dict) and segment.get("id") == citation.get("segment_id")), ""),
            }
    return candidates


def _zotero_annotation(
    candidate: _CitationCandidate,
    position: dict[str, object],
    *,
    created_at: Optional[dt.datetime] = None,
) -> dict[str, object]:
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
    candidates: dict[str, _CitationCandidate],
    position_resolver: Optional[PositionResolver],
) -> tuple[dict[str, tuple[_CitationCandidate, dict[str, object]]], list[str]]:
    """Resolve PDF geometry while reusing opened documents per attachment."""
    resolved: dict[str, tuple[_CitationCandidate, dict[str, object]]] = {}
    warnings: list[str] = []
    documents: dict[str, _PdfDocument] = {}
    indexes: dict[str, dict[int, PageTextIndex]] = {}
    original_readers: dict[str, Callable[[int], str]] = {}
    resolver: PositionResolver
    if position_resolver is None:
        pypdfium2 = _load_pdfium()

        def cached_resolver(
            pdf_path: Path, page_number: int, quote: str
        ) -> Optional[dict[str, object]]:
            path_key = str(pdf_path)
            document = documents.get(path_key)
            if document is None:
                document = pypdfium2.open_document(path_key)
                documents[path_key] = document
                original_readers[path_key] = _original_page_reader(pdf_path)
            return _find_quote_position_in_document(document, page_number, quote, candidate["context"],
                                                    indexes.setdefault(path_key, {}), original_readers[path_key])

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


def _select_annotation_highlights(
    resolved: dict[str, tuple[_CitationCandidate, dict[str, object]]],
) -> dict[str, tuple[_CitationCandidate, dict[str, object]]]:
    """Choose a few relevant spans without equating evidence coverage to ink.

    Limits are ceilings, never quotas. A page can have no suitable highlight.
    Coordinates eliminate overlaps even when two notes cite the same passage
    under different segment identities. Whole quotations and caveats survive.
    """
    pages: dict[tuple[str, int], list[tuple[str, _CitationCandidate, dict[str, object]]]] = {}
    for key, (candidate, position) in resolved.items():
        pages.setdefault((candidate["source_uri"], candidate["page"]), []).append(
            (key, candidate, position)
        )
    selected: dict[str, tuple[_CitationCandidate, dict[str, object]]] = {}
    for items in pages.values():
        lengths = [position.get("page_text_length") for _, _, position in items]
        page_length = max((length for length in lengths if isinstance(length, int)), default=0)
        if not page_length:
            # Injected geometry adapters may only provide rectangles. Original
            # contexts and distinct evidence give a conservative lower bound.
            page_length = max(
                max(len(candidate["context"]) for _, candidate, _ in items),
                sum(len(quote) for quote in {candidate["quote"] for _, candidate, _ in items}),
            )
        budget = int(page_length * MAX_HIGHLIGHT_TEXT_FRACTION)
        kept: list[tuple[_CitationCandidate, dict[str, object]]] = []
        used = 0
        for key, candidate, position in sorted(
            items, key=lambda item: (-item[1]["priority"], str(item[2]["sort_index"]), item[0])
        ):
            if candidate["priority"] <= 0 or used + len(candidate["quote"]) > budget:
                continue
            if any(
                candidate["segment_id"] == previous["segment_id"]
                or _positions_overlap(position, previous_position)
                for previous, previous_position in kept
            ):
                continue
            selected[key] = (candidate, position)
            kept.append((candidate, position))
            used += len(candidate["quote"])
            if len(kept) == MAX_HIGHLIGHTS_PER_PAGE:
                break
    return selected


def _positions_overlap(left: dict[str, object], right: dict[str, object]) -> bool:
    for a in iterable_values(left.get("rects") or []):
        for b in iterable_values(right.get("rects") or []):
            if (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))
                    and min(a[2], b[2]) > max(a[0], b[0])
                    and min(a[3], b[3]) > max(a[1], b[1])):
                return True
    return False


def _annotation_session(session: Optional[Session]) -> tuple[Session, bool]:
    """Return the injected session or open one for the active vault."""
    if session is not None:
        return session, False
    vault_path = get_active_vault_path()
    if vault_path is None:
        from backend.data.db import VaultNotConfiguredError

        raise VaultNotConfiguredError(
            "No vault configured. Please set DIGITAL_BRAIN_VAULT_PATH environment variable "
            "or configure a vault path in the application settings."
        )
    _engine, session_factory = get_engine_for_path(vault_path)
    return session_factory(), True


def _upsert_resolved_annotations(
    session: Session,
    resolved: dict[str, tuple[_CitationCandidate, dict[str, object]]],
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
    resolved: dict[str, tuple[_CitationCandidate, dict[str, object]]],
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


def reading_citation_issues(
    notes: list[dict[str, object]], origins: list[dict[str, object]],
) -> list[list[str]]:
    """Check full PDF geometry before review accepts notes, without writing highlights.

    Match each citation against its original segment and share page indexes
    across the batch. PDFium is serialized because reviews run concurrently.
    """
    segments = {str(segment["id"]): (origin, segment) for origin in origins
                for segment in iterable_values(origin.get("segments") or []) if isinstance(segment, dict)}
    groups = []
    for note in notes:
        citations = []
        for citation in iterable_values(note.get("citations") or []):
            if not isinstance(citation, dict):
                continue
            original = segments.get(str(citation.get("segment_id")))
            if original is not None:
                origin, segment = original
                citations.append({**citation, "origin_id": origin["origin_id"], "locator": segment["locator"]})
        groups.append(_citation_candidates([{"citations": citations}], origins, "reading-review"))
    candidates = {key: value for group in groups for key, value in group.items()}
    if not candidates:
        return [[] for _ in notes]
    with _READING_GEOMETRY_LOCK:
        resolved, _ = _resolve_annotation_candidates(candidates, None)
    return [[f"PDF citation on page {item['page']} cannot be located as one complete, unambiguous highlight: "
             f"{item['quote']!r}. Select a meaningful exact original quote that can be located, or remove this"
             " redundant citation while retaining the note's substantive evidence. Do not discard the idea"
             " or invent evidence to bypass this check."
             for key, item in group.items() if key not in resolved] for group in groups]


def sync_generated_pdf_annotations(
    notes: list[dict[str, object]],
    origins: list[dict[str, object]],
    resource_id: str,
    *,
    session: Optional[Session] = None,
    position_resolver: Optional[PositionResolver] = None,
) -> dict[str, object]:
    """Keep sparse key-idea highlights while retaining all evidence in the notes."""
    candidates = _citation_candidates(notes, origins, resource_id)
    with _READING_GEOMETRY_LOCK:
        matched, warnings = _resolve_annotation_candidates(candidates, position_resolver)
    resolved = _select_annotation_highlights(matched)
    # Do not retain a previously guessed prefix highlight when full evidence
    # matching now fails. Unavailable attachments preserve prior annotations.
    desired_keys = set(resolved) | {key for key, item in candidates.items()
                                    if not item["pdf_path"].is_file() or not item["source_uri"]}
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
        "matched": len(matched),
        "requested": len(candidates),
        "citation_matches": len(matched),
        "selected": len(resolved),
        "warnings": warnings,
    }
