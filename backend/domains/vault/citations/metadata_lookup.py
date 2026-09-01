"""Read-only metadata resolution for external reference identifiers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal, TypedDict, cast


Metadata = dict[str, object]
LookupSource = Literal["crossref", "arxiv", "pubmed", "openlibrary", "url"]


class LookupResponse(TypedDict):
    """Stable response returned by the metadata lookup endpoint."""

    source: LookupSource | None
    identifier: str | None
    suggested: Metadata
    error: str | None


@dataclass(frozen=True)
class MetadataLookupDependencies:
    """Provider, normalization, and citation-key ports used by lookup."""

    normalize_doi: Callable[[str], str | None]
    normalize_arxiv: Callable[[str], str | None]
    normalize_pmid: Callable[[str], str | None]
    normalize_isbn: Callable[[str], str | None]
    http_get: Callable[[str], str | None]
    http_get_public: Callable[[str], str | None]
    crossref_to_metadata: Callable[[Metadata], Metadata]
    arxiv_to_metadata: Callable[[str], Metadata]
    pubmed_to_metadata: Callable[[Metadata], Metadata]
    openlibrary_to_metadata: Callable[[Metadata], Metadata]
    html_to_metadata: Callable[[str, str], Metadata]
    inject_citation_key: Callable[[Metadata], Metadata]
    normalize_item_type: Callable[[Metadata], Metadata]


def _json_object(body: str) -> Metadata | None:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return None
    return cast(Metadata, parsed) if isinstance(parsed, dict) else None


def _suggested(metadata: Metadata, dependencies: MetadataLookupDependencies) -> Metadata:
    with_key = dependencies.inject_citation_key(metadata)
    return dependencies.normalize_item_type(with_key)


def _failure(source: LookupSource, identifier: str, error: str) -> LookupResponse:
    return {
        "source": source,
        "identifier": identifier,
        "suggested": {},
        "error": error,
    }


async def _lookup_crossref(
    doi: str,
    dependencies: MetadataLookupDependencies,
) -> LookupResponse:
    body = await asyncio.to_thread(
        dependencies.http_get,
        f"https://api.crossref.org/works/{doi}",
    )
    parsed = _json_object(body) if body else None
    work = parsed.get("message") if parsed else None
    if isinstance(work, dict) and work:
        return {
            "source": "crossref",
            "identifier": doi,
            "suggested": _suggested(
                dependencies.crossref_to_metadata(cast(Metadata, work)),
                dependencies,
            ),
            "error": None,
        }
    return _failure("crossref", doi, "CrossRef returned no valid data")


async def _lookup_arxiv(
    arxiv_id: str,
    dependencies: MetadataLookupDependencies,
) -> LookupResponse:
    body = await asyncio.to_thread(
        dependencies.http_get,
        f"http://export.arxiv.org/api/query?id_list={arxiv_id}",
    )
    suggested = _suggested(dependencies.arxiv_to_metadata(body), dependencies) if body else {}
    if suggested:
        return {
            "source": "arxiv",
            "identifier": arxiv_id,
            "suggested": suggested,
            "error": None,
        }
    return _failure("arxiv", arxiv_id, "arXiv returned no data")


async def _lookup_pubmed(
    pmid: str,
    dependencies: MetadataLookupDependencies,
) -> LookupResponse:
    body = await asyncio.to_thread(
        dependencies.http_get,
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
        f"esummary.fcgi?db=pubmed&id={pmid}&retmode=json&version=2.0",
    )
    parsed = _json_object(body) if body else None
    result = parsed.get("result") if parsed else None
    document = result.get(pmid) if isinstance(result, dict) else None
    if isinstance(document, dict) and document and not document.get("error"):
        return {
            "source": "pubmed",
            "identifier": pmid,
            "suggested": _suggested(
                dependencies.pubmed_to_metadata(cast(Metadata, document)),
                dependencies,
            ),
            "error": None,
        }
    return _failure("pubmed", pmid, "PubMed returned no data")


async def _lookup_openlibrary(
    isbn: str,
    dependencies: MetadataLookupDependencies,
) -> LookupResponse:
    body = await asyncio.to_thread(
        dependencies.http_get,
        f"https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data",
    )
    parsed = _json_object(body) if body else None
    book = parsed.get(f"ISBN:{isbn}") if parsed else None
    if isinstance(book, dict) and book:
        return {
            "source": "openlibrary",
            "identifier": isbn,
            "suggested": _suggested(
                dependencies.openlibrary_to_metadata(cast(Metadata, book)),
                dependencies,
            ),
            "error": None,
        }
    return _failure("openlibrary", isbn, "Open Library has no data for this ISBN")


async def _lookup_url(
    url: str,
    dependencies: MetadataLookupDependencies,
) -> LookupResponse:
    body = await asyncio.to_thread(dependencies.http_get_public, url)
    if body:
        return {
            "source": "url",
            "identifier": url,
            "suggested": _suggested(
                dependencies.html_to_metadata(body, url),
                dependencies,
            ),
            "error": None,
        }
    return _failure("url", url, "Could not download the page")


async def resolve_metadata(
    payload: Mapping[str, object],
    dependencies: MetadataLookupDependencies,
) -> LookupResponse:
    """Resolve one identifier using the established provider priority."""
    raw_url = cast(str, payload.get("url") or "")
    url = raw_url.strip()
    doi = dependencies.normalize_doi(cast(str, payload.get("doi") or ""))
    doi = doi or dependencies.normalize_doi(raw_url)
    arxiv_id = dependencies.normalize_arxiv(cast(str, payload.get("arxiv") or ""))
    arxiv_id = arxiv_id or dependencies.normalize_arxiv(raw_url)
    pmid = dependencies.normalize_pmid(cast(str, payload.get("pmid") or ""))
    isbn = dependencies.normalize_isbn(cast(str, payload.get("isbn") or ""))

    if doi:
        return await _lookup_crossref(doi, dependencies)
    if arxiv_id:
        return await _lookup_arxiv(arxiv_id, dependencies)
    if pmid:
        return await _lookup_pubmed(pmid, dependencies)
    if isbn:
        return await _lookup_openlibrary(isbn, dependencies)
    if url.startswith(("http://", "https://")):
        return await _lookup_url(url, dependencies)
    return {
        "source": None,
        "identifier": None,
        "suggested": {},
        "error": "No valid identifier (DOI/arXiv/PMID/ISBN/URL)",
    }


__all__ = [
    "LookupResponse",
    "Metadata",
    "MetadataLookupDependencies",
    "resolve_metadata",
]
