"""Bibliographic import/export and CSL catalog HTTP adapters."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.params import Depends as DependsParameter
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from backend.domains.vault.citations.keys import generate_citation_key
from backend.domains.vault.schemas.pages import PageSaveRequest


log = logging.getLogger(__name__)


class CitationIoResponseModel(BaseModel):
    """Base contract that preserves provider-specific response extensions."""

    model_config = ConfigDict(extra="allow")


class ImportedReferenceItemResponse(CitationIoResponseModel):
    id: str | None
    citation_key: str
    title: str


class SkippedReferenceDetailResponse(CitationIoResponseModel):
    key: str
    reason: str
    existing_key: str
    title: str | None


class ImportReferenceErrorResponse(CitationIoResponseModel):
    title: str | None
    error: str


class ImportReferencesResponse(CitationIoResponseModel):
    created: int
    skipped: int
    items: list[ImportedReferenceItemResponse]
    skipped_details: list[SkippedReferenceDetailResponse]
    skipped_keys: list[str]
    skip_summary: dict[str, int]
    errors: list[ImportReferenceErrorResponse]
    format: str
    message: str | None = None


class CslStyleResponse(CitationIoResponseModel):
    id: str
    file: str
    title: str | None


class CslStylesResponse(CitationIoResponseModel):
    styles: list[CslStyleResponse]


@dataclass(frozen=True)
class ReferencesIoDependencies:
    active_vault_path: Callable[[], str | Path | None]
    load_registry: Callable[[], dict[str, Any]]
    item_type_catalog_names: Callable[[dict[str, Any], dict[str, Any]], list[str]]
    resolve_existing_keys: Callable[[], Callable[[], set[str]]]
    normalize_item_type: Callable[[str, list[str]], str]
    resolve_ensure_index: Callable[[], Callable[[str], dict[str, dict[str, Any]]]]
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[dict[str, Any], str]]
    normalize_doi: Callable[[str], str | None]
    normalize_isbn: Callable[[str], str | None]
    normalize_title: Callable[[object], str]
    detect_format: Callable[[str], str]
    parse_references: Callable[[str, str], list[dict[str, Any]]]
    serialize_references: Callable[[list[dict[str, Any]], str], str]
    find_existing_match: Callable[
        [dict[str, Any], dict[str, Any], set[str]], tuple[str, str] | None
    ]
    add_to_indexes: Callable[[dict[str, Any], str, dict[str, Any]], None]
    resolve_create_page: Callable[
        [],
        Callable[
            [PageSaveRequest, BackgroundTasks],
            Awaitable[dict[str, Any]],
        ],
    ]
    resolve_invalidate_index: Callable[[], Callable[[], None]]
    page_snapshot: Callable[[], list[object]]
    list_styles: Callable[[], list[dict[str, Any]]]
    save_uploaded_style: Callable[[bytes, str], dict[str, Any]]


def build_dedup_indexes(
    vault_key: str,
    dependencies: ReferencesIoDependencies,
) -> dict[str, dict[str, str]]:
    index = dependencies.resolve_ensure_index()(vault_key)
    doi_index: dict[str, str] = {}
    isbn_index: dict[str, str] = {}
    title_index: dict[str, str] = {}
    for citation_key, entry in index.items():
        try:
            page_path = dependencies.find_page(str(entry.get("id") or ""))
            if not page_path:
                continue
            metadata, _body = dependencies.parse_frontmatter(
                page_path.read_text(encoding="utf-8"),
                page_path,
            )
            doi = str(metadata.get("DOI") or "").strip()
            if doi:
                normalized_doi = dependencies.normalize_doi(doi)
                if normalized_doi:
                    doi_index.setdefault(normalized_doi.lower(), citation_key)
            isbn = str(metadata.get("ISBN") or "").strip()
            if isbn:
                normalized_isbn = dependencies.normalize_isbn(isbn)
                if normalized_isbn:
                    isbn_index.setdefault(normalized_isbn, citation_key)
            normalized_title = dependencies.normalize_title(
                metadata.get("Title") or entry.get("title") or ""
            )
            if normalized_title:
                title_index.setdefault(normalized_title, citation_key)
        except (OSError, AttributeError):
            continue
    return {"doi": doi_index, "isbn": isbn_index, "title": title_index}


def collect_table_reference_metas(
    table_id: str,
    wanted: set[str] | None,
    dependencies: ReferencesIoDependencies,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for page in dependencies.page_snapshot():
        if getattr(page, "resolved_table_id", None) != table_id:
            continue
        metadata = getattr(page, "metadata", {}) or {}
        if not isinstance(metadata, dict):
            metadata = {}
        if not metadata.get("Citation Key"):
            page_path = dependencies.find_page(str(getattr(page, "id", "") or ""))
            if not page_path:
                continue
            try:
                metadata, _body = dependencies.parse_frontmatter(
                    page_path.read_text(encoding="utf-8"),
                    page_path,
                )
            except OSError:
                continue
        citation_key = metadata.get("Citation Key")
        if not citation_key:
            continue
        if wanted is not None and citation_key not in wanted:
            continue
        result.append(metadata)
    return result


def register_import_route(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
    dependencies: ReferencesIoDependencies,
) -> Callable[..., object]:
    async def import_references(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        table_id: str = Query(...),
        fmt: str = Query("auto"),
    ) -> dict[str, object]:
        """Imports a .bib/.ris file, creating pages in the `table_id` table.

        Generates `Citation Key` when missing. Skips duplicate entries by comparing
        against the vault using four criteria (in priority order):
          1. Identical Citation Key
          2. Normalized DOI
          3. Normalized ISBN
          4. Normalized title (lowercase, no accents/punctuation)

        Response:
            {
              "created": N, "skipped": M,
              "items": [{id, citation_key, title}, ...],
              "skipped_details": [
                  {"key": "smith2020", "reason": "doi", "existing_key": "smith2020a"},
                  {"key": "...", "reason": "title", "existing_key": "..."},
                  ...
              ],
              "skipped_keys": [...],          # compat: keys only (deprecated)
              "skip_summary": {"citation_key": N1, "doi": N2, "isbn": N3, "title": N4},
              "errors": [...],
              "format": "bibtex" | "ris"
            }

        Never touches existing pages under any circumstance.
        """
        raw = (await file.read()).decode("utf-8", errors="replace")
        detected = dependencies.detect_format(raw) if fmt == "auto" else fmt
        entries = dependencies.parse_references(raw, fmt)
        if not entries:
            return {
                "created": 0,
                "skipped": 0,
                "items": [],
                "skipped_details": [],
                "skipped_keys": [],
                "skip_summary": {},
                "errors": [],
                "format": detected,
                "message": "No references were found in the file",
            }
        registry = dependencies.load_registry()
        table = next(
            (
                item
                for item in registry.get("tables", [])
                if isinstance(item, dict) and item.get("id") == table_id
            ),
            None,
        )
        if not table:
            raise HTTPException(status_code=404, detail=f"Table {table_id} not found")
        item_type_catalog = dependencies.item_type_catalog_names(table, registry)
        vault_keys = dependencies.resolve_existing_keys()()
        vault_path = dependencies.active_vault_path()
        dedup: dict[str, Any] = (
            build_dedup_indexes(str(vault_path), dependencies)
            if vault_path
            else {"doi": {}, "isbn": {}, "title": {}}
        )
        used = set(vault_keys)
        created: list[dict[str, object]] = []
        skipped_details: list[dict[str, object]] = []
        errors: list[dict[str, object]] = []
        skip_summary = {"citation_key": 0, "doi": 0, "isbn": 0, "title": 0}
        for entry in entries:
            try:
                match = dependencies.find_existing_match(entry, dedup, vault_keys)
                if match is not None:
                    reason, existing_key = match
                    file_key = str(entry.get("Citation Key") or "").strip()
                    skipped_details.append(
                        {
                            "key": file_key or existing_key,
                            "reason": reason,
                            "existing_key": existing_key,
                            "title": entry.get("Title"),
                        }
                    )
                    skip_summary[reason] = skip_summary.get(reason, 0) + 1
                    continue
                citation_key = str(entry.get("Citation Key") or "").strip()
                if not citation_key or citation_key in used:
                    citation_key = generate_citation_key(
                        entry.get("Authors"),
                        entry.get("Any"),
                        str(entry.get("Title") or ""),
                        used,
                    )
                entry["Citation Key"] = citation_key
                used.add(citation_key)
                if entry.get("Item Type"):
                    entry["Item Type"] = dependencies.normalize_item_type(
                        str(entry["Item Type"]),
                        item_type_catalog,
                    )
                title = str(entry.get("Title") or citation_key)
                metadata = dict(entry)
                metadata["database_table_id"] = table_id
                metadata["table_id"] = table_id
                request = PageSaveRequest(title=title, content="", metadata=metadata)
                result = await dependencies.resolve_create_page()(
                    request,
                    background_tasks,
                )
                created.append(
                    {
                        "id": result.get("id"),
                        "citation_key": citation_key,
                        "title": title,
                    }
                )
                dependencies.add_to_indexes(entry, citation_key, dedup)
                vault_keys.add(citation_key)
            except Exception as exc:
                log.warning(
                    "import-references: failed entry (%s): %s",
                    entry.get("Title"),
                    exc,
                )
                errors.append({"title": entry.get("Title"), "error": str(exc)})
        dependencies.resolve_invalidate_index()()
        return {
            "created": len(created),
            "skipped": len(skipped_details),
            "items": created,
            "skipped_details": skipped_details,
            "skipped_keys": [item["key"] for item in skipped_details],
            "skip_summary": skip_summary,
            "errors": errors,
            "format": detected,
        }

    router.add_api_route(
        "/import-references",
        import_references,
        methods=["POST"],
        dependencies=list(editor_dependencies),
        response_model=ImportReferencesResponse,
        response_model_exclude_unset=True,
    )
    return import_references


def register_catalog_export_routes(
    router: APIRouter,
    *,
    upload_dependencies: Sequence[DependsParameter],
    export_dependencies: Sequence[DependsParameter],
    dependencies: ReferencesIoDependencies,
) -> tuple[Callable[..., object], ...]:
    async def list_csl_styles() -> dict[str, object]:
        """List of the CSL styles available in the catalog (frontend/public/csl/styles).

        Each entry: `{id, file, title}`. `title` is the `<title>` extracted from the XML
        (the official CSL denomination, e.g. "American Psychological Association 7th edition").

        The frontend uses this endpoint to populate the `CslStylePicker`; falls back to the
        hardcoded list in `cslEngine.AVAILABLE_STYLES` if the call fails.
        """
        return {"styles": dependencies.list_styles()}

    async def upload_csl_style(file: UploadFile = File(...)) -> dict[str, Any]:
        """Uploads a CSL (`.csl`) file to the catalog.

        Validates that it's well-formed CSL XML (root `<style>`, reasonable size),
        saves it with the (sanitized) name, and returns the extracted metadata. The
        user can use the style immediately after the frontend's next
        load (styles are served via Vite's static HTTP).
        """
        raw = await file.read()
        try:
            return dependencies.save_uploaded_style(raw, file.filename or "unnamed.csl")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    async def export_references(
        table_id: str = Query(...),
        fmt: str = Query("bibtex"),
        keys: str = Query(""),
    ) -> Response:
        """Exports a table's references to BibTeX or RIS (download).

        `keys` optional: CSV of citation keys to export only a subset.
        """
        if fmt not in ("bibtex", "ris"):
            raise HTTPException(
                status_code=400,
                detail="format ha de ser 'bibtex' o 'ris'",
            )
        if not dependencies.active_vault_path():
            raise HTTPException(status_code=400, detail="Cap vault actiu")
        wanted = {key.strip() for key in keys.split(",") if key.strip()} or None
        metadata = await asyncio.to_thread(
            collect_table_reference_metas,
            table_id,
            wanted,
            dependencies,
        )
        text = dependencies.serialize_references(metadata, fmt)
        extension = "bib" if fmt == "bibtex" else "ris"
        return Response(
            content=text,
            media_type=(
                "application/x-bibtex" if fmt == "bibtex" else "application/x-research-info-systems"
            ),
            headers={"Content-Disposition": f'attachment; filename="recursos.{extension}"'},
        )

    router.add_api_route(
        "/csl/styles",
        list_csl_styles,
        methods=["GET"],
        response_model=CslStylesResponse,
    )
    router.add_api_route(
        "/csl/styles",
        upload_csl_style,
        methods=["POST"],
        dependencies=list(upload_dependencies),
        response_model=CslStyleResponse,
    )
    router.add_api_route(
        "/export-references",
        export_references,
        methods=["GET"],
        dependencies=list(export_dependencies),
        response_model=None,
        response_class=Response,
    )
    return list_csl_styles, upload_csl_style, export_references


__all__ = [
    "CslStyleResponse",
    "CslStylesResponse",
    "ImportedReferenceItemResponse",
    "ImportReferenceErrorResponse",
    "ImportReferencesResponse",
    "ReferencesIoDependencies",
    "SkippedReferenceDetailResponse",
    "build_dedup_indexes",
    "collect_table_reference_metas",
    "register_catalog_export_routes",
    "register_import_route",
]
