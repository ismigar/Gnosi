"""Bibliographic import/export and CSL catalog HTTP adapters."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.params import Depends as DependsParameter
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from backend.domains.vault.citations.export_contracts import (
    DedupIndexes,
    Metadata,
    ReferenceRegistry,
    ReferenceTable,
)
from backend.domains.vault.citations.keys import generate_citation_key
from backend.domains.vault.citations.state import citation_index_state
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.services.workspace_service import WorkspaceContext, get_workspace_context
from backend.utils.metadata_io import MetadataUnavailable, read_vault_text

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
    load_registry: Callable[[], ReferenceRegistry]
    item_type_catalog_names: Callable[[ReferenceTable, ReferenceRegistry], list[str]]
    resolve_existing_keys: Callable[[], Callable[[], set[str]]]
    normalize_item_type: Callable[[str, list[str]], str]
    resolve_ensure_index: Callable[[], Callable[[str], dict[str, Metadata]]]
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    normalize_doi: Callable[[str], str | None]
    normalize_isbn: Callable[[str], str | None]
    normalize_title: Callable[[object], str]
    detect_format: Callable[[str], str]
    parse_references: Callable[[str, str], list[Metadata]]
    serialize_references: Callable[[list[Metadata], str], str]
    find_existing_match: Callable[[Metadata, DedupIndexes, set[str]], tuple[str, str] | None]
    add_to_indexes: Callable[[Metadata, str, DedupIndexes], None]
    resolve_create_page: Callable[
        [],
        Callable[
            [PageSaveRequest, BackgroundTasks],
            Awaitable[Metadata],
        ],
    ]
    resolve_invalidate_index: Callable[[], Callable[[], None]]
    page_snapshot: Callable[[], list[object]]
    list_styles: Callable[[], Sequence[Mapping[str, object]]]
    save_uploaded_style: Callable[[bytes, str], Mapping[str, object]]


def _read_reference(
    page_id: str, indexed_path: object, root: Path | None, dependencies: ReferencesIoDependencies,
) -> Metadata | None:
    path = dependencies.find_page(page_id)
    if path is None and isinstance(indexed_path, (str, Path)) and indexed_path:
        path = Path(indexed_path)
    if path is None:
        return None
    return _read_reference_path(path, root, dependencies)


def _read_reference_path(
    path: Path, root: Path | None, dependencies: ReferencesIoDependencies,
) -> Metadata | None:
    try:
        raw = read_vault_text(path, root=root)
        metadata, _body = dependencies.parse_frontmatter(raw, path)
        return metadata
    except FileNotFoundError:
        return None
    except OSError as error:
        raise MetadataUnavailable.from_oserror(path, error) from error


def build_dedup_indexes(
    vault_key: str,
    dependencies: ReferencesIoDependencies,
    *,
    table_id: str | None = None,
    existing_keys: set[str] | None = None,
) -> dict[str, dict[str, str]]:
    index = dependencies.resolve_ensure_index()(vault_key)
    references = [(key, entry) for key, entry in index.items()]
    if table_id:
        # A cold citation index cannot contain a key that has never been read.
        indexed = {str(entry.get("id") or "") for _, entry in references}
        for page in dependencies.page_snapshot():
            page_id = str(getattr(page, "id", "") or "")
            if page_id and page_id not in indexed and getattr(page, "resolved_table_id", None) == table_id:
                references.append(("", {"id": page_id, "path": getattr(page, "path", None),
                                        "title": getattr(page, "title", "")}))
    doi_index: dict[str, str] = {}
    isbn_index: dict[str, str] = {}
    title_index: dict[str, str] = {}
    for indexed_key, entry in references:
        try:
            metadata = _read_reference(str(entry.get("id") or ""), entry.get("path"), Path(vault_key), dependencies)
            if metadata is None:
                continue
            citation_key = str(metadata.get("Citation Key") or indexed_key).strip()
            if not citation_key:
                continue
            if existing_keys is not None:
                existing_keys.add(citation_key)
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
        except AttributeError:
            continue
    return {"doi": doi_index, "isbn": isbn_index, "title": title_index}


def _read_export_page(
    page: object, root: Path | None, table_id: str, dependencies: ReferencesIoDependencies,
) -> Metadata | None:
    source = getattr(page, "path", None)
    snapshot_path = Path(source) if isinstance(source, (str, Path)) and source else None
    if snapshot_path is not None and root is not None:
        snapshot_path = root / snapshot_path
    metadata = _read_reference_path(snapshot_path, root, dependencies) if snapshot_path else None
    relocated = False
    if metadata is None:
        resolved = dependencies.find_page(str(getattr(page, "id", "") or ""))
        if resolved is None or resolved == snapshot_path:
            return None
        metadata = _read_reference_path(resolved, root, dependencies)
        relocated = snapshot_path is not None
    if metadata is not None:
        stored_table = metadata.get("database_table_id") or metadata.get("table_id")
        if (relocated or stored_table) and str(stored_table or "") != table_id:
            return None
    return metadata


def _export_index_entries(
    root: Path | None, wanted: set[str], missing: set[str], dependencies: ReferencesIoDependencies,
) -> list[Metadata]:
    if root is None:
        return []
    vault_key = str(root)
    if missing:
        try:
            index = dependencies.resolve_ensure_index()(vault_key)
            return [index[key] for key in wanted if key in index]
        except (MetadataUnavailable, OSError):
            pass  # The scoped table pages can still establish the keys.
    # A complete local selection can include a previously indexed duplicate.
    # Consult existing hints without opening other files to rebuild the index.
    with citation_index_state.lock:
        cached = citation_index_state.indexes.get(vault_key, {})
        return [cached[key] for key in wanted if key in cached]


def _indexed_export_pages(
    cold: list[tuple[int, object]], entries: list[Metadata],
) -> tuple[list[tuple[int, object]], list[tuple[int, object]]]:
    ids = {str(entry["id"]) for entry in entries if entry.get("id")}
    paths = {str(entry["path"]) for entry in entries if entry.get("path")}
    indexed: list[tuple[int, object]] = []
    unknown: list[tuple[int, object]] = []
    for position, page in cold:
        page_id = str(getattr(page, "id", "") or "")
        path = str(getattr(page, "path", "") or "")
        group = indexed if page_id in ids or path in paths else unknown
        group.append((position, page))
    return indexed, unknown


def _fill_selected_exports(
    cold: list[tuple[int, object]], wanted: set[str], missing: set[str],
    matches: dict[int, Metadata], root: Path | None, table_id: str,
    dependencies: ReferencesIoDependencies,
) -> None:
    entries = _export_index_entries(root, wanted, missing, dependencies)
    indexed, unknown = _indexed_export_pages(cold, entries)
    failure: MetadataUnavailable | None = None
    for group in (indexed, unknown):
        for position, page in group:
            if group is unknown and not missing:
                break
            try:
                metadata = _read_export_page(page, root, table_id, dependencies)
            except MetadataUnavailable as error:
                # The unavailable page may be unrelated. Another candidate can establish the key.
                if failure is None:
                    failure = error
                continue
            key = metadata.get("Citation Key") if metadata is not None else None
            if metadata is not None and isinstance(key, str) and key in wanted:
                matches[position] = metadata
                missing.discard(key)
    if missing and failure is not None:
        raise failure


def collect_table_reference_metas(
    table_id: str,
    wanted: set[str] | None,
    dependencies: ReferencesIoDependencies,
) -> list[Metadata]:
    vault_path = dependencies.active_vault_path()
    root = Path(vault_path) if vault_path else None
    matches: dict[int, Metadata] = {}
    cold: list[tuple[int, object]] = []
    missing = set(wanted or ())
    for position, page in enumerate(dependencies.page_snapshot()):
        if getattr(page, "resolved_table_id", None) != table_id:
            continue
        metadata = getattr(page, "metadata", None)
        if not isinstance(metadata, dict) or not metadata.get("Citation Key"):
            if wanted is not None:
                cold.append((position, page))
                continue
            page_id = str(getattr(page, "id", "") or "")
            metadata = _read_reference(page_id, getattr(page, "path", None), root, dependencies)
        if metadata is None:
            continue
        key = metadata.get("Citation Key")
        if key and (wanted is None or key in wanted):
            matches[position] = metadata
            if isinstance(key, str):
                missing.discard(key)

    if wanted and cold:
        _fill_selected_exports(cold, wanted, missing, matches, root, table_id, dependencies)
        return [matches[position] for position in sorted(matches)]
    return list(matches.values())


async def _create_imported_page(
    create: Callable[[PageSaveRequest, BackgroundTasks], Awaitable[Metadata]],
    request: PageSaveRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> Metadata:
    """Pass the authenticated context only to the canonical HTTP handler.

    Legacy plugins/tests may replace the facade callback with a two-argument
    function. Resolve it once per entry, just as before, and retain that call.
    Import locally: core composition registers before this citation module.
    """
    from backend.domains.vault.api import core_routes

    if create is core_routes.create_page:
        return await core_routes.create_page(request, background_tasks, context)
    return await create(request, background_tasks)


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
        context: WorkspaceContext = Depends(get_workspace_context),
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
        registry = await asyncio.to_thread(dependencies.load_registry)
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
        vault_keys = await asyncio.to_thread(dependencies.resolve_existing_keys())
        vault_path = dependencies.active_vault_path()
        dedup: DedupIndexes = (
            await asyncio.to_thread(build_dedup_indexes, str(vault_path), dependencies,
                                    table_id=table_id, existing_keys=vault_keys)
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
                result = await _create_imported_page(
                    dependencies.resolve_create_page(),
                    request,
                    background_tasks,
                    context,
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

    async def upload_csl_style(file: UploadFile = File(...)) -> Mapping[str, object]:
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
