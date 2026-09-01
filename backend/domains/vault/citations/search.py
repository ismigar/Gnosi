"""Citation-key indexing, search and resolution routes."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from backend.domains.vault.citations.authors import find_structured_authors
from backend.domains.vault.citations.state import CitationIndexState


@dataclass(frozen=True)
class CitationSearchDependencies:
    page_entry_count: Callable[[str], int]
    page_entries: Callable[[str], Sequence[Mapping[str, object]]]
    resolve_reference_table_id: Callable[[], str | None]
    canonicalize_id: Callable[[str], str]
    active_vault_path: Callable[[], str | Path | None]
    resolve_ensure_index: Callable[[], Callable[[str], dict[str, dict[str, object]]]]


class CitationSearchItemResponse(BaseModel):
    id: str | None
    title: str | None
    citation_key: str | None
    folder: str | None
    author: str | None
    year: str | None


class CitationResolutionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None
    title: str | None
    folder: str | None
    citation_key: str
    author: str | None = None
    year: str | None = None


def fold_accents(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(
        character for character in normalized if not unicodedata.combining(character)
    ).lower()


def format_one_author(author: object) -> str:
    if isinstance(author, dict):
        parts = [str(author.get(key) or "").strip() for key in ("nom", "cognom1", "cognom2")]
        return " ".join(part for part in parts if part).strip()
    return str(author or "").strip()


def cite_author_from_metadata(metadata: dict[str, object]) -> str | None:
    structured = find_structured_authors(metadata)
    if structured:
        joined = ", ".join(
            name for name in (format_one_author(author) for author in structured) if name
        )
        if joined:
            return joined
    for key in ("Authors", "Autor", "Autors", "Author"):
        value = metadata.get(key)
        if not value:
            continue
        if isinstance(value, list):
            value = ", ".join(name for name in (format_one_author(item) for item in value) if name)
        else:
            value = format_one_author(value)
        text = str(value).strip()
        if text:
            return text
    return None


def cite_year_from_metadata(metadata: dict[str, object]) -> str | None:
    for key in ("Any", "Year", "Data", "Date"):
        value = metadata.get(key)
        if value in (None, ""):
            continue
        match = re.search(r"(\d{4})", str(value))
        if match:
            return match.group(1)
    return None


def cite_search_blob(
    title: object,
    citation_key: object,
    author: object,
    year: object,
    metadata: dict[str, object] | None,
) -> str:
    parts = [str(title or ""), str(citation_key or ""), str(author or ""), str(year or "")]
    if metadata:
        for key in (
            "Llibre/Revista",
            "Editorial",
            "Lloc",
            "DOI",
            "ISBN",
            "ISSN",
            "Idioma",
            "Item Type",
            "Volum",
            "Número",
            "URL",
        ):
            value = metadata.get(key)
            if value:
                parts.append(str(value))
        tags = metadata.get("Tags")
        if isinstance(tags, list):
            parts.extend(str(tag) for tag in tags if tag)
        elif tags:
            parts.append(str(tags))
    return " ".join(parts).lower()


def enrich_cite_entry(entry: dict[str, object]) -> dict[str, object]:
    result = {
        "id": entry.get("id"),
        "title": entry.get("title"),
        "citation_key": entry.get("citation_key"),
        "folder": entry.get("folder"),
        "author": entry.get("author"),
        "year": entry.get("year"),
    }
    if result["author"] or result["year"]:
        return result
    path_value = entry.get("path")
    if not path_value:
        return result
    path = Path(str(path_value))
    if not path.exists():
        return result
    try:
        with path.open("r", encoding="utf-8") as source:
            head = source.read(4096)
        if not head.startswith("---"):
            return result
        author_match = re.search(
            r"^(?:Autors?|Authors?):\s*['\"]?([^'\"\n\r]+)",
            head,
            re.MULTILINE,
        )
        if author_match:
            result["author"] = author_match.group(1).strip()
        year_match = re.search(
            r"^(?:Any|Year|Data):\s*['\"]?(\d{4})",
            head,
            re.MULTILINE,
        )
        if year_match:
            result["year"] = year_match.group(1).strip()
    except OSError:
        pass
    return result


def _matches_reference_table(
    table_value: object,
    canonical_reference: str | None,
    dependencies: CitationSearchDependencies,
) -> bool:
    if not canonical_reference:
        return True
    page_table = dependencies.canonicalize_id(str(table_value).strip()) if table_value else ""
    return page_table == canonical_reference


def _metadata_citation_entry(
    entry: Mapping[str, object],
    metadata: dict[str, object],
    canonical_reference: str | None,
    dependencies: CitationSearchDependencies,
) -> tuple[str, dict[str, object]] | None:
    citation_key = str(metadata.get("Citation Key") or "").strip()
    if not citation_key:
        return None
    table_value = metadata.get("table_id") or metadata.get("database_table_id")
    if not _matches_reference_table(table_value, canonical_reference, dependencies):
        return "", {}
    author = cite_author_from_metadata(metadata)
    year = cite_year_from_metadata(metadata)
    return citation_key, {
        "id": entry.get("id"),
        "title": entry.get("title"),
        "folder": entry.get("folder"),
        "citation_key": citation_key,
        "author": author,
        "year": year,
        "path": entry.get("path"),
        "search": cite_search_blob(
            entry.get("title"),
            citation_key,
            author,
            year,
            metadata,
        ),
    }


def _file_citation_entry(
    entry: Mapping[str, object],
    canonical_reference: str | None,
    dependencies: CitationSearchDependencies,
) -> tuple[str, dict[str, object]] | None:
    path_value = entry.get("path")
    if not path_value:
        return None
    path = Path(str(path_value))
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as source:
            head = source.read(4096)
        if not head.startswith("---"):
            return None
        key_match = re.search(
            r"^Citation Key:\s*['\"]?([^'\"\n\r]+)",
            head,
            re.MULTILINE,
        )
        if not key_match:
            return None
        table_match = re.search(
            r"^(?:database_table_id|table_id):\s*['\"]?([^'\"\n\r]+)",
            head,
            re.MULTILINE,
        )
        table_value = table_match.group(1).strip() if table_match else ""
        if not _matches_reference_table(table_value, canonical_reference, dependencies):
            return None
        citation_key = key_match.group(1).strip()
        if not citation_key:
            return None
        return citation_key, {
            "id": entry.get("id"),
            "title": entry.get("title"),
            "folder": entry.get("folder"),
            "citation_key": citation_key,
            "author": None,
            "year": None,
            "path": str(path),
            "search": cite_search_blob(
                entry.get("title"),
                citation_key,
                None,
                None,
                None,
            ),
        }
    except OSError:
        return None


def ensure_citation_index(
    vault_key: str,
    state: CitationIndexState,
    dependencies: CitationSearchDependencies,
) -> dict[str, dict[str, object]]:
    with state.lock:
        current_size = dependencies.page_entry_count(vault_key)
        if vault_key in state.indexes and state.sizes_at_build.get(vault_key) == current_size:
            return state.indexes[vault_key]
        index: dict[str, dict[str, object]] = {}
        reference_id = dependencies.resolve_reference_table_id()
        canonical_reference = dependencies.canonicalize_id(reference_id) if reference_id else None
        for entry in dependencies.page_entries(vault_key):
            metadata = entry.get("metadata") or {}
            if not isinstance(metadata, dict):
                metadata = {}
            metadata_entry = _metadata_citation_entry(
                entry,
                metadata,
                canonical_reference,
                dependencies,
            )
            if metadata_entry is not None:
                citation_key, citation = metadata_entry
                if citation_key and citation_key not in index:
                    index[citation_key] = citation
                continue
            file_entry = _file_citation_entry(entry, canonical_reference, dependencies)
            if file_entry is not None:
                citation_key, citation = file_entry
                if citation_key not in index:
                    index[citation_key] = citation
        state.indexes[vault_key] = index
        state.sizes_at_build[vault_key] = current_size
        return index


def invalidate_citation_index(
    state: CitationIndexState,
    vault_key: str | None = None,
) -> None:
    with state.lock:
        if vault_key is None:
            state.indexes.clear()
            state.sizes_at_build.clear()
        else:
            state.indexes.pop(vault_key, None)
            state.sizes_at_build.pop(vault_key, None)


def _build_search_citations(
    dependencies: CitationSearchDependencies,
) -> Callable[..., object]:
    async def search_citations(q: str = "", limit: int = 30) -> list[dict[str, object]]:
        """Searches Recursos pages for the CitePicker (Cmd+Shift+I).

        Free-text filter that searches ALL fields cached in page_index:
        `Citation Key`, `Títol`, `Autor`, `Any`, journal, publisher, DOI, etc.
        Returns `limit` (30 by default) results sorted by best
        match (key > title > author > other fields). Doesn't reopen any
        vault file (works with a cloud / online-only vault).

        Response: `[{ id, title, citation_key, author, year, folder }, ...]`
        Designed for an autocomplete picker — it's not a full catalog
        indexing endpoint.
        """
        vault_path = dependencies.active_vault_path()
        if not vault_path:
            raise HTTPException(status_code=503, detail="No active vault")
        index = dependencies.resolve_ensure_index()(str(vault_path))
        query = fold_accents(str(q or "").strip())
        if not query:
            items = sorted(
                index.values(),
                key=lambda item: str(item.get("citation_key") or "").lower(),
            )[:limit]
            return [enrich_cite_entry(item) for item in items]
        candidates: list[tuple[int, dict[str, object]]] = []
        for entry in index.values():
            citation_key = fold_accents(entry.get("citation_key"))
            title = fold_accents(entry.get("title"))
            author = fold_accents(entry.get("author"))
            blob = fold_accents(entry.get("search"))
            score = -1
            if citation_key.startswith(query):
                score = 100 - len(citation_key)
            elif title.startswith(query):
                score = 70 - len(title) // 10
            elif query in citation_key:
                score = 55 - len(citation_key)
            elif query in title:
                score = 45 - len(title) // 10
            elif query in author:
                score = 35
            elif query in blob:
                score = 15
            if score >= 0:
                candidates.append((score, entry))
        candidates.sort(key=lambda candidate: -candidate[0])
        return [enrich_cite_entry(entry) for _score, entry in candidates[:limit]]

    return search_citations


def _build_resolve_by_citation_key(
    dependencies: CitationSearchDependencies,
) -> Callable[..., object]:
    async def resolve_by_citation_key(key: str) -> dict[str, object]:
        """Resolves a citation key (like `smith2020`) to UUID + title by querying
        the pages of the Recursos table.

        Designed for the `[@key]` citation system in the BlockEditor: the frontend
        looks up a single key and receives the dest so the clickable chip can open the
        reference page. Implementation: iterates over `_page_index_entries`
        and, for the pages of the table configured as "Recursos" (or
        any with a `Citation Key` field), reads the frontmatter to
        make an exact match (case-sensitive — citation keys are ASCII lowercase).

        Optimization: if the user has thousands of pages, scanning is slow.
        We keep a `_cite_key_index` cache in the module with (citation_key →
        {page_id, title}) that's renewed when files change. See
        `_invalidate_cite_key_index` for the invalidation.
        """
        key_norm = str(key or "").strip()
        if not key_norm:
            raise HTTPException(status_code=400, detail="key is required")
        vault_path = dependencies.active_vault_path()
        if not vault_path:
            raise HTTPException(status_code=503, detail="No active vault")
        entry = dependencies.resolve_ensure_index()(str(vault_path)).get(key_norm)
        if entry:
            return entry
        return {
            "id": None,
            "title": None,
            "folder": None,
            "citation_key": key_norm,
        }

    return resolve_by_citation_key


def register_routes(
    router: APIRouter,
    dependencies: CitationSearchDependencies,
) -> tuple[Callable[..., object], Callable[..., object]]:
    search_citations = _build_search_citations(dependencies)

    resolve_by_citation_key = _build_resolve_by_citation_key(dependencies)

    router.add_api_route(
        "/search-citations",
        search_citations,
        methods=["GET"],
        response_model=list[CitationSearchItemResponse],
    )
    router.add_api_route(
        "/resolve-by-citation-key",
        resolve_by_citation_key,
        methods=["GET"],
        response_model=CitationResolutionResponse,
        response_model_exclude_unset=True,
    )
    return search_citations, resolve_by_citation_key


__all__ = [
    "CitationResolutionResponse",
    "CitationSearchDependencies",
    "CitationSearchItemResponse",
    "cite_author_from_metadata",
    "cite_search_blob",
    "cite_year_from_metadata",
    "enrich_cite_entry",
    "ensure_citation_index",
    "fold_accents",
    "format_one_author",
    "invalidate_citation_index",
    "register_routes",
]
