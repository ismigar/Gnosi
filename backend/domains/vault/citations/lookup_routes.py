"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

from fastapi import APIRouter

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")
router = _strict_cast(APIRouter, _legacy.router)


def _ensure_recursos_citation_key(
    metadata: dict[_LegacyAny, _LegacyAny],
    table: dict[_LegacyAny, _LegacyAny] | None = None,
    *,
    regenerate: bool = False,
) -> dict[_LegacyAny, _LegacyAny]:
    """Guarantees that a page in the REFERENCES TABLE carries a `Citation Key`.

    Previously the key was only generated in the metadata lookup; a new entry
    or a normal save from the browser left the resource without a key and,
    therefore, not citable (`recursosPageToCsl`/`_recursos_metadata_to_csl`
    return None). Called from create/save/patch/duplicate, this function
    closes that gap: any persistence path leaves the resource citable.

    Gate EXCLUSIVE to designation: only acts if the page belongs to the
    references table designated in Settings (`get_reference_table_id`), not by
    any name/column heuristic. If the user changes the table in Settings, the
    generation follows the new one.

    Generates only when (1) it's the references table, (2) the cell is empty
    —or `regenerate=True`, e.g. when duplicating so the copy doesn't collide—
    and (3) there is some bibliographic data (Authors/Any/Title), so as not to
    stamp junk keys on completely empty rows. The key is unique against the
    ones already existing in the vault. Mutates and returns `metadata`."""
    ref_id = _legacy.get_reference_table_id()
    if not ref_id or _legacy.get_table_id(metadata) != ref_id:
        return metadata
    if table is None:
        table = _legacy._table_by_id(ref_id)
    ck_name = _legacy._citation_key_prop_name(table) or "Citation Key"
    if not regenerate and str(metadata.get(ck_name) or "").strip():
        return metadata
    authors = _legacy._find_structured_authors(metadata) or metadata.get("Authors")
    year, title = (metadata.get("Any"), metadata.get("Title"))
    has_authors = bool(authors) if isinstance(authors, list) else bool(str(authors or "").strip())
    if not (has_authors or str(year or "").strip() or str(title or "").strip()):
        return metadata
    ck = _legacy.generate_citation_key(
        authors, year, title or "", _legacy._existing_citation_keys()
    )
    if ck:
        metadata[ck_name] = ck
    return metadata


def _dedupe_citation_key(
    metadata: dict[_LegacyAny, _LegacyAny], page_id: str
) -> dict[_LegacyAny, _LegacyAny]:
    """Keeps a hand-typed `Citation Key` unique across the references table.

    The key is the CSL-JSON `id`: two records sharing one means citeproc only
    ever sees one of them and the other is silently cited as its sibling (the
    vault accumulated 18 such collisions before the 2026-07 rebuild). Generated
    keys are already unique (`generate_citation_key` checks the index), but the
    grid lets the user TYPE any key into the cell — this closes that last path
    by suffixing `a`/`b`/`c`… on collision, Better-BibTeX-style; the adjusted
    value is visible immediately in the PATCH response. Best-effort: the check
    reads the cite key index, so a sibling created milliseconds ago may not be
    visible yet. Mutates and returns `metadata`."""
    ref_id = _legacy.get_reference_table_id()
    if not ref_id or _legacy.get_table_id(metadata) != ref_id:
        return metadata
    ck_name = _legacy._citation_key_prop_name(_legacy._table_by_id(ref_id)) or "Citation Key"
    ck = str(metadata.get(ck_name) or "").strip()
    if not ck:
        return metadata
    try:
        from backend.services.context_vars import get_active_vault_path

        v_path = get_active_vault_path()
        if not v_path:
            return metadata
        idx = _legacy._ensure_cite_key_index(str(v_path))
    except Exception:
        return metadata
    holder = idx.get(ck)
    if not holder or str(holder.get("id")) == str(page_id):
        return metadata
    i = 0
    while True:
        cand = f"{ck}{_legacy._alpha_suffix(i)}"
        holder = idx.get(cand)
        if not holder or str(holder.get("id")) == str(page_id):
            metadata[ck_name] = cand
            return metadata
        i += 1


def _reference_autoria_prop(
    table: dict[_LegacyAny, _LegacyAny] | None,
) -> dict[_LegacyAny, _LegacyAny] | None:
    """Returns the table's first `autoria`-type property (structured author
    list), or None when the table doesn't have one."""
    for p in (table or {}).get("properties", []) or []:
        if p.get("type") == "autoria":
            return _strict_cast(dict[_LegacyAny, _LegacyAny] | None, p)
    return None


def _authors_string_to_autoria(authors: str) -> list[_LegacyAny]:
    """`"Cognom, Nom; …"` (canonical Recursos author string) → structured
    `autoria` list `[{"nom","cognom1","cognom2"}]`.

    Splits authors on ';'. For each author the text before the first comma is
    the family name(s) (first token → `cognom1`, the rest → `cognom2`) and the
    text after the comma is the given name(s) → `nom`. An author without a comma
    is treated as a single family/institution name (`cognom1`)."""
    out: list[_LegacyAny] = []
    for part in str(authors or "").split(";"):
        part = part.strip()
        if not part:
            continue
        if "," in part:
            family, given = part.split(",", 1)
        else:
            family, given = (part, "")
        fam_tokens = family.strip().split()
        author = {
            "nom": given.strip(),
            "cognom1": fam_tokens[0] if fam_tokens else "",
            "cognom2": " ".join(fam_tokens[1:]) if len(fam_tokens) > 1 else "",
        }
        if author["nom"] or author["cognom1"] or author["cognom2"]:
            out.append(author)
    return out


def _fill_autoria_from_authors(
    metadata: dict[_LegacyAny, _LegacyAny], table: dict[_LegacyAny, _LegacyAny] | None
) -> dict[_LegacyAny, _LegacyAny]:
    """Routes an imported `Authors` string into the table's `autoria` field.

    Create-from-source (PDF/DOI/ISBN/arXiv/PubMed/…) runs metadata through the
    canonical Zotero→Recursos mapper, which only knows the legacy text column
    `Authors`. When the references table has an `autoria`-type property (the
    structured field the user actually maintains), populate THAT instead so the
    import fills the real column rather than the deprecated text one — the
    feature must never leave the record's primary author field empty nor surface
    a stray legacy column.

    Gate EXCLUSIVE to designation (like `_ensure_recursos_citation_key`): only
    acts on the designated references table. Idempotent: only fills when the
    `autoria` cell is empty and an `Authors` value is present, and drops the
    consumed `Authors` key so the legacy column is left untouched (empty).
    Mutates and returns `metadata`."""
    ref_id = _legacy.get_reference_table_id()
    if not ref_id or _legacy.get_table_id(metadata) != ref_id:
        return metadata
    prop = _reference_autoria_prop(table)
    if not prop:
        return metadata
    name = prop.get("name")
    if not name or metadata.get(name) not in (None, "", []):
        return metadata
    parsed = _authors_string_to_autoria(str(metadata.get("Authors") or ""))
    if not parsed:
        return metadata
    metadata[name] = parsed
    metadata.pop("Authors", None)
    return metadata


def _normalize_pmid(raw: str) -> str | None:
    """Extracts a PMID (1-8 digits) from a string. Strict match to avoid
    confusing it with ISBN/other numbers: the field arrives already labeled as PMID."""
    if not raw:
        return None
    m = _legacy.re.match("^\\s*(?:pmid:?\\s*)?(\\d{1,8})\\s*$", str(raw), _legacy.re.IGNORECASE)
    return m.group(1) if m else None


def _pubmed_author_to_canonical(name: str) -> str:
    """`"Murphy SA"` (PubMed format: surname + initials) → `"Murphy, SA"` so
    the parser handles the surname correctly."""
    name = (name or "").strip()
    if not name or "," in name:
        return name
    toks = name.split()
    if len(toks) >= 2 and _legacy.re.fullmatch("[A-Za-z]{1,4}", toks[-1]):
        return f"{' '.join(toks[:-1])}, {toks[-1]}"
    return name


def _pubmed_to_recursos(doc: dict[_LegacyAny, _LegacyAny]) -> dict[_LegacyAny, _LegacyAny]:
    """Map a PubMed summary to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import pubmed_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos

    return _strict_cast(
        dict[_LegacyAny, _LegacyAny], zotero_item_to_recursos(pubmed_to_zotero_item(doc))
    )


@router.post(
    "/lookup-metadata",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def lookup_metadata(payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...)) -> _LegacyAny:
    """Resolves external metadata for a given identifier.

    Body (accepts all and picks the best; priority DOI > arXiv > PMID > ISBN > URL):
      { doi?: str, isbn?: str, arxiv?: str, pmid?: str, url?: str }

    Response:
      {
        "source": "crossref" | "arxiv" | "pubmed" | "openlibrary" | "url" | null,
        "identifier": str | null,
        "suggested": { "Title": ..., "Authors": ..., "Any": ..., "Citation Key": ... },
        "error": null | str
      }

    The `suggested` includes a `Citation Key` generated automatically (unique in
    the vault) so the reference is citable from the very first moment. It never
    modifies the Vault: it only suggests; the frontend accepts fields individually.

    """
    dependencies = _legacy.metadata_lookup.MetadataLookupDependencies(
        normalize_doi=lambda raw: _legacy._normalize_doi(raw),
        normalize_arxiv=lambda raw: _legacy._normalize_arxiv(raw),
        normalize_pmid=lambda raw: _normalize_pmid(raw),
        normalize_isbn=lambda raw: _legacy._normalize_isbn(raw),
        http_get=lambda url: _legacy._http_get(url),
        http_get_public=lambda url: _legacy._http_get_public(url),
        crossref_to_metadata=lambda work: _legacy._crossref_to_recursos(work),
        arxiv_to_metadata=lambda body: _legacy._arxiv_to_recursos(body),
        pubmed_to_metadata=lambda document: _pubmed_to_recursos(document),
        openlibrary_to_metadata=lambda book: _legacy._openlibrary_to_recursos(book),
        html_to_metadata=lambda body, url: _legacy._html_meta_to_recursos(body, url),
        inject_citation_key=lambda metadata: _legacy._inject_citation_key(metadata),
        normalize_item_type=lambda metadata: _legacy._normalize_suggested_item_type(metadata),
    )
    return await _legacy.metadata_lookup.resolve_metadata(payload, dependencies)


generate_citation_key_endpoint = _legacy.citation_keys_api.register_route(
    router, lambda: _legacy._existing_citation_keys
)


def _extract_text_from_pdf(data: bytes, max_pages: int = 5) -> str:
    """Text of the first `max_pages` pages of a PDF. Empty if pypdf is not
    available or the PDF is scanned (no text layer)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        _legacy.log.warning("pypdf not installed: PDF recognition disabled")
        return ""
    import io

    try:
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages[:max_pages]:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n".join(parts)
    except Exception as e:
        _legacy.log.warning(f"PDF il·legible: {e}")
        return ""


def _identifiers_from_text(text: str) -> dict[_LegacyAny, _LegacyAny]:
    """First DOI (and arXiv if there's an explicit prefix) found in a PDF's text."""
    found: dict[_LegacyAny, _LegacyAny] = {}
    doi = _legacy._normalize_doi(text or "")
    if doi:
        found["doi"] = doi
    if _legacy.re.search("arxiv\\s*[:.]", text or "", _legacy.re.IGNORECASE):
        arx = _legacy._normalize_arxiv(text)
        if arx:
            found["arxiv"] = arx
    return found


def _pdf_embedded_metadata(data: bytes) -> dict[_LegacyAny, _LegacyAny]:
    """Best-effort bibliographic metadata from a PDF's document-info dictionary.

    Reads `/Title`, `/Author` and the year from `/CreationDate`. These fields
    exist even in scanned PDFs with no text layer, so they let us register a
    source that carries no DOI/ISBN/arXiv. Returns `{}` when pypdf is missing or
    the PDF exposes nothing usable.
    """
    try:
        from pypdf import PdfReader
    except ImportError:
        return {}
    import io

    try:
        info = PdfReader(io.BytesIO(data)).metadata
    except Exception as e:
        _legacy.log.warning(f"PDF metadata unreadable: {e}")
        return {}
    if not info:
        return {}
    out: dict[_LegacyAny, _LegacyAny] = {}
    try:
        title = (info.title or "").strip()
        if title:
            out["title"] = title
        author = (info.author or "").strip()
        if author:
            out["author"] = author
        m = _legacy.re.search("\\d{4}", str(info.creation_date_raw or ""))
        if m:
            out["year"] = m.group(0)
    except Exception as e:
        _legacy.log.warning(f"PDF metadata fields unreadable: {e}")
    return out


def _title_from_filename(filename: str) -> str:
    """Human-readable title guessed from a PDF filename (last-resort source).

    Strips any path and the `.pdf` extension and turns underscores into spaces.
    Hyphens are kept (they are often part of real titles). Returns '' for an
    empty or extension-only name.
    """
    if not filename:
        return ""
    stem = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    stem = _legacy.re.sub("\\.pdf$", "", stem, flags=_legacy.re.IGNORECASE)
    stem = _legacy.re.sub("_+", " ", stem)
    return _strict_cast(str, _legacy.re.sub("\\s+", " ", stem).strip())


def _pdf_fallback_to_recursos(
    data: bytes, filename: str, ids: dict[_LegacyAny, _LegacyAny] | None = None
) -> dict[_LegacyAny, _LegacyAny]:
    """Minimal Recursos record for a PDF whose external lookup yielded nothing.

    Builds a Zotero `document` item from the PDF's embedded metadata (falling
    back to the filename for the title) and runs it through the same mapper +
    Citation Key pipeline as the identifier lookups, so the reference is
    registrable and citable even without (a resolvable) DOI/ISBN/arXiv/PMID.
    Any identifier that WAS detected in the text (`ids`) is still carried onto
    the record so it is not lost when the online source is unreachable. Returns
    `{}` when not even a title can be derived.
    """
    dependencies = _legacy.citation_pdf_fallback.PdfFallbackDependencies(
        embedded_metadata=lambda payload: _pdf_embedded_metadata(payload),
        title_from_filename=lambda value: _title_from_filename(value),
        parse_authors=lambda value: _legacy._parse_authors_to_csl(value),
        map_zotero_item=lambda item: _zotero_item_to_recursos(item),
        inject_citation_key=lambda metadata: _legacy._inject_citation_key(metadata),
    )
    return _strict_cast(
        dict[_LegacyAny, _LegacyAny],
        _legacy.citation_pdf_fallback.pdf_fallback_metadata(data, filename, ids, dependencies),
    )


@router.post(
    "/recognize-pdf",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def recognize_pdf(file: _legacy.UploadFile = _legacy.File(...)) -> _LegacyAny:
    """Detects a PDF's reference, with a metadata fallback for id-less sources.

    Strategy:
      1. Extract the first pages' text and look for a DOI/arXiv. If found, run
         the external lookup (CrossRef/arXiv) — the richest result.
      2. Otherwise (or if that lookup returns nothing) build a minimal record
         from the PDF's own document-info (`/Title`, `/Author`, `/CreationDate`)
         or the filename, so a scanned book / paper with no DOI/ISBN/arXiv can
         still be created and cited.

    Response: { identifiers, source, suggested, error }. The `suggested` already
    carries a `Citation Key`. Never writes anything to the Vault.
    """
    data = await file.read()
    text = await _legacy.asyncio.to_thread(_extract_text_from_pdf, data)
    ids = _identifiers_from_text(text) if text.strip() else {}
    if ids:
        result = await lookup_metadata(ids)
        if result.get("suggested"):
            return {
                "identifiers": ids,
                "source": result.get("source"),
                "suggested": result.get("suggested", {}),
                "error": result.get("error"),
            }
    fallback = await _legacy.asyncio.to_thread(
        _pdf_fallback_to_recursos, data, file.filename or "", ids
    )
    if fallback:
        return {
            "identifiers": ids,
            "source": "pdf",
            "suggested": _legacy._normalize_suggested_item_type(fallback),
            "error": None,
        }
    return {
        "identifiers": ids,
        "source": None,
        "suggested": {},
        "error": "Could not extract any metadata from the PDF",
    }


def _zotero_creators_to_authors(creators: _LegacyAny) -> str:
    """Map Zotero creators to a `"Surname, Name; …"` Resources string."""
    parts = []
    for c in creators or []:
        if not isinstance(c, dict) or (c.get("creatorType") or "author") != "author":
            continue
        last = (c.get("lastName") or "").strip()
        first = (c.get("firstName") or "").strip()
        name = (c.get("name") or "").strip()
        if last and first:
            parts.append(f"{last}, {first}")
        elif last:
            parts.append(last)
        elif name:
            parts.append(name)
    return "; ".join(parts)


def _zotero_item_to_recursos(item: dict[_LegacyAny, _LegacyAny]) -> dict[_LegacyAny, _LegacyAny]:
    """Zotero item (translation-server output) → Recursos fields.

    Thin wrapper around the central declarative mapper
    (`zotero_to_recursos_mapper.zotero_item_to_recursos`, L3.1). Kept
    as an alias to minimize the diff for callers; in a later cleanup
    the import can be substituted directly.

    """
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos

    return _strict_cast(dict[_LegacyAny, _LegacyAny], zotero_item_to_recursos(item))


@router.post(
    "/translate-url",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def translate_url(payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...)) -> _LegacyAny:
    """Captures a reference from a URL via Zotero translation-server.

    Body: { url }. Response with the same shape as `/lookup-metadata`:
    { source:'web', identifier, suggested (with Citation Key), count, error }.

    """
    dependencies = _legacy.citation_web_capture.WebCaptureDependencies(
        server_url=lambda: _legacy.os.environ.get(
            "TRANSLATION_SERVER_URL", "http://translation-server:1969"
        ),
        post_web=lambda server_url, body, content_type: (
            _legacy.translation_server_transport.post_web(
                server_url, body, content_type, _legacy.log
            )
        ),
        map_zotero_item=lambda item: _zotero_item_to_recursos(item),
        inject_citation_key=lambda metadata: _legacy._inject_citation_key(metadata),
        normalize_item_type=lambda metadata: _legacy._normalize_suggested_item_type(metadata),
    )
    return await _legacy.citation_web_capture.capture_url(payload, dependencies)


def _build_dedup_indexes(v_str: str) -> dict[_LegacyAny, _LegacyAny]:
    return _strict_cast(
        dict[_LegacyAny, _LegacyAny],
        _legacy.citation_io_api.build_dedup_indexes(v_str, _legacy._REFERENCES_IO_DEPENDENCIES),
    )


import_references = _legacy.citation_io_api.register_import_route(
    router,
    editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    dependencies=_legacy._REFERENCES_IO_DEPENDENCIES,
)


def _collect_table_reference_metas(
    table_id: str, wanted: set[_LegacyAny] | None
) -> list[dict[_LegacyAny, _LegacyAny]]:
    return _strict_cast(
        list[dict[_LegacyAny, _LegacyAny]],
        _legacy.citation_io_api.collect_table_reference_metas(
            table_id, wanted, _legacy._REFERENCES_IO_DEPENDENCIES
        ),
    )


def _metadata_mutation_dependencies() -> _legacy.metadata_mutations.MetadataMutationDependencies:
    return _legacy.metadata_mutations.MetadataMutationDependencies(
        registry_mutation=lambda: _legacy.registry_mutation(),
        load_registry=lambda: _legacy.load_registry(),
        save_registry=lambda registry: _legacy.save_registry(registry),
        new_id=lambda: str(_legacy.uuid.uuid4()),
        page_snapshot=lambda: _legacy._get_pages_snapshot(),
        find_page=lambda page_id: _legacy.find_page_path(page_id),
        parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
        save_page=lambda path, metadata, body: _legacy.save_page_md(path, metadata, body),
        file_etag=lambda path: _legacy.file_etag(path),
        refresh_page_index=lambda path, metadata, body: _legacy._refresh_page_index_entry(
            path, metadata, body
        ),
        invalidate_citation_index=lambda: _invalidate_cite_key_index(),
        invalidate_page_cache=lambda: _legacy._pages_cache_invalidate_all(),
        table_id=lambda metadata: _legacy.get_table_id(metadata),
        table_by_id=lambda table_id: _legacy._table_by_id(table_id),
        page_write_lock=lambda page_id: _legacy._get_page_write_lock(page_id),
    )


@router.post(
    "/promote-zotero-extra",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def promote_zotero_extra(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Promotes a `Zotero Extras` field to its own registry column.

    Body:
        {
          "table_id": "<uuid>",
          "zotero_field": "patentNumber",
          "column_name": "Patent No.",       # optional; default = zotero_field
          "column_type": "text",              # optional; default = "text"
          "page_ids": ["uuid1", ...],         # optional; without this, all
                                              #   pages in the table with the field
          "expected_etags": {"uuid1": "abc", ...}  # optional (collaboration Path A)
        }

    For each page:
      1. If `expected_etags[pid]` is present, validate against the current etag.
         Mismatch → marked as `conflict`, NOT written.
      2. Moves `Extras[zotero_field]` to `metadata[column_name]`.
      3. Deletes `Extras[zotero_field]`. If Extras ends up empty, deletes
         the whole key.
      4. Rewrites via `save_page_md`.

    """
    return await _legacy.metadata_mutations.promote_zotero_extra(
        payload, _metadata_mutation_dependencies()
    )


@router.post(
    "/bulk-update-metadata",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def bulk_update_metadata(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Applies the same metadata patch to a collection of pages.

    Body:
        {
          "page_ids": ["uuid1", "uuid2", ...],
          "updates": {"Item Type": "preprint", "Idioma": "en"},
          "remove": ["ObsoleteField"],
          "expected_etags": {"uuid1": "abc", ...}   # optional (collaboration Path A)
        }

    For each page:
      1. If `expected_etags[pid]` is present, validate against the current etag.
         Mismatch → marked as `conflict`, NOT written.
      2. Reads .md, parses frontmatter.
      3. Applies `updates` (None/'' → deleted) and `remove`.
      4. If the patch is identical to the current state → `skip`.
      5. `save_page_md` and returns the new etag to the client.

    Response:
        {
          "updated": N, "updated_ids": [...],
          "updated_with_etags": [{"page_id": "...", "etag": "..."}],
          "skipped": [...],
          "conflicts": [{"page_id": "...", "expected_etag": "...", "current_etag": "..."}],
          "errors": [{"page_id": "...", "error": "..."}]
        }

    A single error does NOT abort the rest. Conflicts are recoverable:
    the client can GET the new version, repeat the logic, and resend
    with the new etag.

    """
    return await _legacy.metadata_mutations.bulk_update_metadata(
        payload, _metadata_mutation_dependencies()
    )


@router.post(
    "/bulk-apply-template",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def bulk_apply_template(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Apply a table template body and declared properties to selected rows."""
    return await _legacy.metadata_mutations.bulk_apply_template(
        payload, _metadata_mutation_dependencies()
    )


list_csl_styles, upload_csl_style, export_references = (
    _legacy.citation_io_api.register_catalog_export_routes(
        router,
        upload_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
        export_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
        dependencies=_legacy._REFERENCES_IO_DEPENDENCIES,
    )
)
search_citations, resolve_by_citation_key = _legacy.citation_search.register_routes(
    router, _legacy._CITATION_SEARCH_DEPENDENCIES
)


def _fold_accents(s: _LegacyAny) -> str:
    return _strict_cast(str, _legacy.citation_search.fold_accents(s))


def _format_one_author(a: _LegacyAny) -> str:
    return _strict_cast(str, _legacy.citation_search.format_one_author(a))


def _cite_author_from_metadata(md: dict[_LegacyAny, _LegacyAny]) -> _LegacyAny:
    return _legacy.citation_search.cite_author_from_metadata(md)


def _cite_year_from_metadata(md: dict[_LegacyAny, _LegacyAny]) -> _LegacyAny:
    return _legacy.citation_search.cite_year_from_metadata(md)


def _cite_search_blob(
    title: _LegacyAny, ck: _LegacyAny, author: _LegacyAny, year: _LegacyAny, md: _LegacyAny
) -> str:
    return _strict_cast(str, _legacy.citation_search.cite_search_blob(title, ck, author, year, md))


def _enrich_cite_entry(entry: dict[_LegacyAny, _LegacyAny]) -> dict[_LegacyAny, _LegacyAny]:
    return _strict_cast(
        dict[_LegacyAny, _LegacyAny], _legacy.citation_search.enrich_cite_entry(entry)
    )


def _ensure_cite_key_index(v_str: str) -> dict[_LegacyAny, _LegacyAny]:
    return _strict_cast(
        dict[_LegacyAny, _LegacyAny],
        _legacy.citation_search.ensure_citation_index(
            v_str, _legacy.citation_index_state, _legacy._CITATION_SEARCH_DEPENDENCIES
        ),
    )


def _invalidate_cite_key_index(v_str: str | None = None) -> None:
    _legacy.citation_search.invalidate_citation_index(_legacy.citation_index_state, v_str)


def normalize_aliases(val: _LegacyAny) -> list[str]:
    """Normalize the `aliases` field of the frontmatter into a list of strings.

    Accepts a YAML list (`aliases: [a, b]`), a scalar, or a comma-separated
    string (`aliases: a, b`). Discards non-text values.

    """
    if val is None:
        return []
    if isinstance(val, str):
        parts = [p.strip() for p in val.split(",")]
        return [p for p in parts if p]
    if isinstance(val, (list, tuple)):
        out = []
        for item in val:
            s = str(item).strip()
            if s:
                out.append(s)
        return out
    s = str(val).strip()
    return [s] if s else []
