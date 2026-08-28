"""Atomic AcademicWork import into the designated Resources table."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Iterable, cast

from fastapi import BackgroundTasks, HTTPException

from backend.services.context_vars import active_vault_path, get_primary_vault_path
from backend.services.literature_models import (
    canonical_work,
    deterministic_key,
    normalize_arxiv,
    normalize_doi,
    normalize_isbn13,
    normalize_pmcid,
    normalize_pmid,
    normalize_title,
)
from backend.services.workspace_service import WorkspaceContext


_IMPORT_LOCK = threading.RLock()


def _object(value: object) -> dict[str, Any]:
    """Narrow one dynamic academic/provider object to a mapping."""
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def suggested_resource_to_work(
    suggested: dict[str, Any], *, provider: str, provider_id: str,
) -> dict[str, Any]:
    """Convert the existing identifier-lookup suggestion into AcademicWork."""
    extras = _object(suggested.get("Zotero Extras"))
    authors_value = suggested.get("Authors") or []
    authors = [part.strip() for part in str(authors_value).split(";") if part.strip()] if isinstance(authors_value, str) else authors_value
    item_type = str(suggested.get("Item Type") or "").casefold()
    if "article" in item_type or "article" in str(extras.get("itemType") or "").casefold():
        canonical_type = "journal-article"
    elif any(value in item_type for value in ("book", "llibre", "libro", "livre")):
        canonical_type = "book"
    elif any(value in item_type for value in ("thesis", "tesi", "tesis", "thèse")):
        canonical_type = "thesis"
    elif "preprint" in item_type:
        canonical_type = "preprint"
    else:
        canonical_type = "other"
    url = str(suggested.get("URL") or extras.get("url") or "")
    open_access = suggested.get("Open Access") is True
    isbn_values = [value.strip() for value in str(suggested.get("ISBN") or "").replace(",", ";").split(";") if value.strip()]
    return canonical_work(
        provider,
        provider_id,
        title=suggested.get("Title"),
        authors=authors,
        dates={"issued": suggested.get("Any") or "", "online": "", "print": ""},
        year=suggested.get("Any"),
        abstract=suggested.get("Abstract") or extras.get("abstractNote") or "",
        type=canonical_type,
        publication={
            "container_title": suggested.get("Llibre/Revista") or "",
            "publisher": suggested.get("Editorial") or "",
            "volume": suggested.get("Volum") or "",
            "issue": suggested.get("Número") or "",
            "pages": suggested.get("Pàgines") or "",
        },
        language=suggested.get("Idioma") or "",
        identifiers={
            "doi": suggested.get("DOI"),
            "pmid": suggested.get("PMID"),
            "pmcid": suggested.get("PMCID"),
            "arxiv": suggested.get("arXiv"),
            "isbn13": isbn_values,
            "provider": {},
        },
        open_access={
            "is_oa": open_access if "Open Access" in suggested else None,
            "license": suggested.get("License") or extras.get("rights") or "",
            "best_location": {"url": url, "landing_page_url": url, "pdf_url": "", "is_oa": open_access, "license": ""} if url else None,
        },
        locations=[{"url": url, "landing_page_url": url, "pdf_url": "", "is_oa": open_access, "license": ""}] if url else [],
    )


def work_to_zotero(work: dict[str, Any]) -> dict[str, Any]:
    """Translate the canonical academic contract to the shared Zotero mapper."""
    publication = _object(work.get("publication"))
    identifiers = _object(work.get("identifiers"))
    open_access = _object(work.get("open_access"))
    locations = work.get("locations")
    first_location = locations[0] if isinstance(locations, list) and locations else {}
    location = _object(open_access.get("best_location") or first_location)
    dates = _object(work.get("dates"))
    type_map = {
        "journal-article": "journalArticle", "article": "journalArticle", "book": "book",
        "book-chapter": "bookSection", "chapter": "bookSection", "conference-paper": "conferencePaper",
        "proceedings-article": "conferencePaper", "thesis": "thesis", "dissertation": "thesis",
        "report": "report", "dataset": "dataset", "preprint": "preprint",
    }
    creators = []
    for author in work.get("authors") or []:
        if not isinstance(author, dict):
            creators.append({"creatorType": "author", "name": str(author)})
            continue
        entry: dict[str, Any] = {"creatorType": "author"}
        if author.get("family"):
            entry.update({"lastName": author.get("family"), "firstName": author.get("given") or ""})
        else:
            entry["name"] = author.get("literal") or ""
        creators.append(entry)
    isbn_values = [normalize_isbn13(value) for value in identifiers.get("isbn13") or []]
    item = {
        "itemType": type_map.get(str(work.get("type") or "").lower(), "document"),
        "title": work.get("title") or "",
        "creators": creators,
        "date": dates.get("issued") or work.get("year") or "",
        "abstractNote": work.get("abstract") or "",
        "publicationTitle": publication.get("container_title") or "",
        "publisher": publication.get("publisher") or "",
        "volume": publication.get("volume") or "",
        "issue": publication.get("issue") or "",
        "pages": publication.get("pages") or "",
        "DOI": normalize_doi(identifiers.get("doi")),
        "ISBN": "; ".join(value for value in isbn_values if value),
        "url": location.get("landing_page_url") or location.get("url") or "",
        "language": work.get("language") or "",
        "rights": open_access.get("license") or "",
    }
    return {key: value for key, value in item.items() if value not in (None, "", [])}


def work_to_resources(work: dict[str, Any]) -> dict[str, Any]:
    """Use the existing central Zotero mapper and citation-key generator."""
    from backend.api.vault_routes import _inject_citation_key, _normalize_suggested_item_type
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos

    identifiers = _object(work.get("identifiers"))
    open_access = _object(work.get("open_access"))
    suggested = zotero_item_to_recursos(work_to_zotero(work))
    suggested.update({
        "PMID": normalize_pmid(identifiers.get("pmid")),
        "PMCID": normalize_pmcid(identifiers.get("pmcid")),
        "arXiv": normalize_arxiv(identifiers.get("arxiv")),
        "Open Access": bool(open_access.get("is_oa")),
        "Literature Sources": json.dumps(work.get("sources") or [], ensure_ascii=False, separators=(",", ":")),
        "Literature Work Key": deterministic_key(work),
    })
    normalized = _normalize_suggested_item_type(
        _inject_citation_key(
            {key: value for key, value in suggested.items() if value not in (None, "", [])}
        )
    )
    return cast(dict[str, Any], normalized)


def _resource_key(metadata: dict[str, Any]) -> str:
    if normalize_doi(metadata.get("DOI")):
        return f"doi:{normalize_doi(metadata.get('DOI'))}"
    if normalize_pmid(metadata.get("PMID")):
        return f"pmid:{normalize_pmid(metadata.get('PMID'))}"
    if normalize_pmcid(metadata.get("PMCID")):
        return f"pmcid:{normalize_pmcid(metadata.get('PMCID'))}"
    if normalize_arxiv(metadata.get("arXiv")):
        return f"arxiv:{normalize_arxiv(metadata.get('arXiv'))}"
    for isbn in str(metadata.get("ISBN") or "").replace(",", ";").split(";"):
        normalized = normalize_isbn13(isbn)
        if normalized:
            return f"isbn13:{normalized}"
    title = normalize_title(metadata.get("Title") or metadata.get("title"))
    year = str(metadata.get("Any") or "")[:4]
    authors = str(metadata.get("Authors") or "")
    family = normalize_title(authors.split(";", 1)[0].split(",", 1)[0])
    return f"tay:{title}|{year}|{family}" if title and year.isdigit() and family else ""


def _existing_resources(table_id: str) -> dict[str, dict[str, Any]]:
    from backend.api.vault_routes import _resolve_table_folder_from_metadata, parse_frontmatter

    folder = _resolve_table_folder_from_metadata({"database_table_id": table_id})
    existing: dict[str, dict[str, Any]] = {}
    if not folder or not folder.exists():
        return existing
    for path in folder.glob("*.md"):
        try:
            metadata, _ = parse_frontmatter(path.read_text(encoding="utf-8"), path)
        except Exception:  # noqa: BLE001
            continue
        key = str(metadata.get("Literature Work Key") or _resource_key(metadata))
        if key:
            existing[key] = {"id": metadata.get("id"), "title": metadata.get("title") or metadata.get("Title"), "metadata": metadata}
    return existing


async def import_works(
    works: Iterable[dict[str, Any]], background_tasks: BackgroundTasks,
    context: WorkspaceContext, *, notebook_id: str = "", notebook_title: str = "",
) -> dict[str, Any]:
    """Deduplicate and import selected works inside one per-process atomic lock."""
    from backend.api.vault_routes import PageSaveRequest, create_page, ensure_reference_table_schema, get_reference_table_id
    from backend.services.notebook_service import add_resources, create_notebook

    selected = [work for work in works if isinstance(work, dict)][:500]
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one academic work.")
    primary = get_primary_vault_path() or Path(context.vault_path)
    token = active_vault_path.set(primary)
    try:
        table_id = str(get_reference_table_id() or "")
        if not table_id:
            raise HTTPException(status_code=409, detail="Configure a Resources table before importing literature.")
        ensure_reference_table_schema(table_id)
        imported: list[dict[str, Any]] = []
        existing_rows: list[dict[str, Any]] = []
        resource_ids: list[str] = []
        with _IMPORT_LOCK:
            existing = _existing_resources(table_id)
            for work in selected:
                key = deterministic_key(work)
                if key and key in existing:
                    row = {"work_id": work.get("id"), "resource_id": existing[key]["id"], "title": existing[key]["title"], "created": False}
                    existing_rows.append(row)
                    if row["resource_id"]:
                        resource_ids.append(str(row["resource_id"]))
                    continue
                metadata = work_to_resources(work)
                created = await create_page(PageSaveRequest(title=str(work.get("title") or "Untitled academic work")[:500], content=str(work.get("abstract") or ""), metadata={"database_table_id": table_id, "table_id": table_id, **metadata}), background_tasks, context)
                row = {"work_id": work.get("id"), "resource_id": created.get("id"), "title": created.get("title") or work.get("title"), "created": True}
                imported.append(row)
                if key:
                    existing[key] = {"id": created.get("id"), "title": row["title"], "metadata": created.get("metadata") or metadata}
                if created.get("id"):
                    resource_ids.append(str(created["id"]))
        notebook = None
        unique_ids = list(dict.fromkeys(resource_ids))
        if unique_ids and notebook_id:
            notebook = add_resources(notebook_id, context, unique_ids)
        elif unique_ids and notebook_title.strip():
            notebook = create_notebook(context, title=notebook_title.strip()[:160], visibility="private", conversation_mode="private_member", resource_ids=unique_ids)
        return {"imported": imported, "existing": existing_rows, "resource_ids": unique_ids, "notebook": notebook, "imported_count": len(imported), "existing_count": len(existing_rows)}
    finally:
        active_vault_path.reset(token)


def mark_resource_membership(works: Iterable[dict[str, Any]], context: WorkspaceContext) -> list[dict[str, Any]]:
    """Annotate search results using the same deterministic Resources keys."""
    from backend.api.vault_routes import get_reference_table_id

    primary = get_primary_vault_path() or Path(context.vault_path)
    token = active_vault_path.set(primary)
    try:
        table_id = str(get_reference_table_id() or "")
        existing = _existing_resources(table_id) if table_id else {}
        result = []
        for work in works:
            copy = dict(work)
            match = existing.get(deterministic_key(copy))
            copy["in_resources"] = bool(match)
            copy["resource_id"] = match.get("id") if match else None
            result.append(copy)
        return result
    finally:
        active_vault_path.reset(token)
