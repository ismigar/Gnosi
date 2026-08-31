"""Typed Vault domain extracted from the historical route facade."""

from __future__ import annotations

import logging as _logging
import re as _re
import shutil as _shutil
import subprocess as _ext_subprocess
import tempfile as _ext_tempfile
import uuid as _uuid
from collections.abc import Iterable, Mapping
from pathlib import Path

from fastapi import Depends, Query
from fastapi.responses import Response

from backend.api.vault_routes import router as router
from backend.domains.vault.citations import authors as _authors
from backend.domains.vault.citations import exporting as _exporting
from backend.domains.vault.citations import formatting as _formatting
from backend.domains.vault.citations import io_api as _io_api
from backend.domains.vault.citations import keys as _keys
from backend.domains.vault.citations import reference_configuration as _configuration
from backend.domains.vault.citations import references_api as _references_api
from backend.domains.vault.citations import search as _search
from backend.domains.vault.citations.export_composition import vault as _vault
from backend.domains.vault.citations.export_contracts import (
    CitationPageEntry,
    DedupIndexes,
    Metadata,
    ReferenceRegistry,
    ReferenceTable,
)
from backend.services.csl_styles import CslStyle
from backend.services.csl_type_resolver import resolve_csl_type as _resolve_csl_type
from backend.services.workspace_service import require_role as _require_role

_log = _logging.getLogger("backend.api.vault_routes")


def _citation_page_metadata_snapshot(vault_key: str) -> dict[object, Metadata]:
    with _vault._page_index_lock:
        return {
            entry.get("id"): entry.get("metadata") or {}
            for entry in _vault._page_index_entries.get(vault_key, {}).values()
            if entry.get("id")
        }


def _citation_page_entry_count(vault_key: str) -> int:
    with _vault._page_index_lock:
        return len(_vault._page_index_entries.get(vault_key, {}))


def _citation_page_entries(vault_key: str) -> list[CitationPageEntry]:
    with _vault._page_index_lock:
        return list(_vault._page_index_entries.get(vault_key, {}).values())


def _references_detect_format(raw: str) -> str:
    from backend.services import references_io

    return references_io.detect_format(raw)


def _references_parse(raw: str, fmt: str) -> list[Metadata]:
    from backend.services import references_io

    return references_io.parse_references(raw, fmt)


def _references_serialize(metadata: list[Metadata], fmt: str) -> str:
    from backend.services import references_io

    return references_io.serialize_references(metadata, fmt)


def _references_find_existing(
    entry: Metadata,
    indexes: DedupIndexes,
    keys: set[str],
) -> tuple[str, str] | None:
    from backend.services.import_dedup import find_existing_match

    return find_existing_match(entry, indexes, keys)


def _references_add_indexes(entry: Metadata, key: str, indexes: DedupIndexes) -> None:
    from backend.services.import_dedup import add_to_indexes

    add_to_indexes(entry, key, indexes)


def _references_normalize_title(value: object) -> str:
    from backend.services.import_dedup import normalize_title_for_dedup

    return normalize_title_for_dedup(value)


def _references_normalize_item_type(value: str, catalog: list[str]) -> str:
    from backend.services.csl_type_resolver import normalize_item_type

    return normalize_item_type(value, catalog)


def _references_list_styles() -> list[CslStyle]:
    from backend.services.csl_styles import list_styles

    return list_styles()


def _references_save_style(raw: bytes, filename: str) -> CslStyle:
    from backend.services.csl_styles import save_uploaded_style

    return save_uploaded_style(raw, filename)


_CITATION_FORMATTING_DEPENDENCIES = _formatting.FormattingDependencies(
    active_vault_path=_vault.get_active_vault_path,
    resolve_ensure_index=lambda: _vault._ensure_cite_key_index,
    page_metadata_snapshot=_citation_page_metadata_snapshot,
    find_page=lambda page_id: _vault.find_page_path(page_id),
    parse_frontmatter=_vault.parse_frontmatter,
    resolve_csl_type=_resolve_csl_type,
)
_CITATION_SEARCH_DEPENDENCIES: _search.CitationSearchDependencies = (
    _search.CitationSearchDependencies(
        page_entry_count=_citation_page_entry_count,
        page_entries=_citation_page_entries,
        resolve_reference_table_id=lambda: _vault.get_reference_table_id(),
        canonicalize_id=lambda page_id: _vault._canonicalize_id(page_id),
        active_vault_path=_vault.get_active_vault_path,
        resolve_ensure_index=lambda: _vault._ensure_cite_key_index,
    )
)
_REFERENCE_API_DEPENDENCIES = _references_api.ReferenceApiDependencies(
    resolve_get_table_id=lambda: _vault.get_reference_table_id,
    resolve_primary_table=lambda: _vault._reference_table_by_id_primary,
    resolve_table=lambda: _vault._table_by_id,
    resolve_ensure_schema=lambda: _vault.ensure_reference_table_schema,
    resolve_set_table_id=lambda: _vault._set_reference_table_id,
    resolve_invalidate_index=lambda: _vault._invalidate_cite_key_index,
    resolve_create_table=lambda: _vault.create_table,
)
_REFERENCES_IO_DEPENDENCIES: _io_api.ReferencesIoDependencies = _io_api.ReferencesIoDependencies(
    active_vault_path=_vault.get_active_vault_path,
    load_registry=lambda: _vault.load_registry(),
    item_type_catalog_names=lambda table, registry: _item_type_catalog_names(table, registry),
    resolve_existing_keys=lambda: _vault._existing_citation_keys,
    normalize_item_type=_references_normalize_item_type,
    resolve_ensure_index=lambda: _vault._ensure_cite_key_index,
    find_page=lambda page_id: _vault.find_page_path(page_id),
    parse_frontmatter=_vault.parse_frontmatter,
    normalize_doi=lambda value: _normalize_doi(value),
    normalize_isbn=lambda value: _normalize_isbn(value),
    normalize_title=_references_normalize_title,
    detect_format=_references_detect_format,
    parse_references=_references_parse,
    serialize_references=_references_serialize,
    find_existing_match=_references_find_existing,
    add_to_indexes=_references_add_indexes,
    resolve_create_page=lambda: _vault.create_page,
    resolve_invalidate_index=lambda: _vault._invalidate_cite_key_index,
    page_snapshot=lambda: _vault._get_pages_snapshot(),
    list_styles=_references_list_styles,
    save_uploaded_style=_references_save_style,
)


def _parse_authors_to_csl(authors_str: str) -> list[dict[str, str]]:
    return _authors.parse_authors_to_csl(authors_str)


def _normalize_authors_field(v: object) -> str:
    return _authors.normalize_authors_field(v)


def _find_structured_authors(metadata: Metadata) -> list[Metadata]:
    return _authors.find_structured_authors(metadata)


def _structured_authors_to_csl(authors: list[Metadata]) -> list[dict[str, str]]:
    return _authors.structured_authors_to_csl(authors)


def _recursos_metadata_to_csl(title: str, m: Metadata) -> Metadata | None:
    return _authors.recursos_metadata_to_csl(title, m, _resolve_csl_type)


def _resolve_csl_path(style: str) -> Path | None:
    return _formatting.resolve_csl_path(style)


def _build_csl_items_for_keys(keys: list[str]) -> list[Metadata]:
    return _formatting.build_csl_items_for_keys(keys, _CITATION_FORMATTING_DEPENDENCIES)


_PANDOC_MISSING_MSG = _formatting.PANDOC_MISSING_MSG


def _pandoc_bin() -> str:
    return _formatting.pandoc_binary(path_factory=_vault.Path, which=_shutil.which)


def _run_export_pandoc(
    command: list[str], working_directory: Path
) -> _ext_subprocess.CompletedProcess[str]:
    return _ext_subprocess.run(
        command, cwd=working_directory, capture_output=True, text=True, timeout=60
    )


_CITATION_EXPORT_DEPENDENCIES = _exporting.ExportDependencies(
    find_page=lambda page_id: _vault.find_page_path(page_id),
    active_vault_path=lambda: _vault.get_active_vault_path(),
    ensure_citation_index=lambda vault_path: _vault._ensure_cite_key_index(vault_path),
    parse_frontmatter=lambda content, path: _vault.parse_frontmatter(content, path),
    metadata_to_csl=lambda title, metadata: _recursos_metadata_to_csl(title, metadata),
    resolve_csl_path=lambda style: _resolve_csl_path(style),
    pandoc_binary=lambda: _pandoc_bin(),
    temporary_directory=lambda prefix: _ext_tempfile.TemporaryDirectory(prefix=prefix),
    run_process=_run_export_pandoc,
    pandoc_missing_message=lambda: _PANDOC_MISSING_MSG,
)
format_citation, format_citations, format_bibliography = _formatting.register_routes(
    router, _CITATION_FORMATTING_DEPENDENCIES
)


def _extract_csl_entries(html_out: str) -> list[str]:
    return _formatting.extract_csl_entries(html_out)


@router.get("/export/{page_id}", response_model=None)
async def export_page(
    page_id: str,
    format: str = Query("docx", pattern="^(docx|odt|html|pdf|tex|markdown)$"),
    csl: str = Query("apa"),
    locale: str = Query("en-US"),
) -> Response:
    """Exports a Vault page to the requested format with resolved citations.

    Workflow:
      1. Loads the page's Markdown (frontmatter + body).
      2. Identifies all `[@key]` references in the body.
      3. Resolves each key to a Recursos entry. Generates a CSL-JSON
         with only the used subset (not all 4198 entries).
      4. Locates the `.csl` style in frontend/public/csl/styles/.
      5. Invokes pandoc with --citeproc --csl --bibliography and returns
         the resulting binary as a download.

    If pandoc is unavailable or fails, 500 with stderr.

    """
    return await _exporting.export_page(page_id, format, csl, locale, _CITATION_EXPORT_DEPENDENCIES)


_DOI_RE = _re.compile("10\\.\\d{4,9}/[-._;()/:A-Z0-9]+", _re.IGNORECASE)
_ARXIV_RE = _re.compile(
    "(?:arxiv:)?(\\d{4}\\.\\d{4,5}(?:v\\d+)?|[a-z\\-]+/\\d{7}(?:v\\d+)?)", _re.IGNORECASE
)


def _normalize_doi(raw: str) -> str | None:
    """Extracts a valid DOI from a string (may come with a `doi:` or `https://doi.org/` prefix)."""
    if not raw:
        return None
    m = _DOI_RE.search(raw)
    return m.group(0) if m else None


def _normalize_isbn(raw: str) -> str | None:
    """Extracts an ISBN-10 or ISBN-13 from a string."""
    if not raw:
        return None
    cleaned = _re.sub("[-\\s]", "", raw)
    m = _re.search("97[89]\\d{10}|\\d{9}[\\dX]", cleaned)
    return m.group(0) if m else None


def _normalize_arxiv(raw: str) -> str | None:
    """Extracts an arXiv id (new format YYMM.NNNNN or old category/YYMMNNN)."""
    if not raw:
        return None
    m = _ARXIV_RE.search(raw)
    return m.group(1) if m else None


def _crossref_to_recursos(work: Metadata) -> Metadata:
    """CrossRef → Recursos fields mapping.

    Thin wrapper around the L3 pipeline:
        crossref_to_zotero_item  →  zotero_item_to_recursos
    (see `backend/services/lookup_normalizers.py` and
    `backend/services/zotero_to_recursos_mapper.py`).

    """
    from backend.services.lookup_normalizers import crossref_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos

    return zotero_item_to_recursos(crossref_to_zotero_item(work))


def _openlibrary_to_recursos(book: Metadata) -> Metadata:
    """Map Open Library data to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import openlibrary_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos

    return zotero_item_to_recursos(openlibrary_to_zotero_item(book))


def _arxiv_to_recursos(entry_xml: str) -> Metadata:
    """Map arXiv Atom XML to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import arxiv_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos

    return zotero_item_to_recursos(arxiv_to_zotero_item(entry_xml))


def _html_meta_to_recursos(html: str, url: str) -> Metadata:
    """Map HTML meta tags to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import html_meta_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos

    return zotero_item_to_recursos(html_meta_to_zotero_item(html, url))


def _http_get(url: str, headers: dict[str, str] | None = None, timeout: float = 8.0) -> str | None:
    """Simple HTTP GET with timeout via urllib stdlib. Returns text or None on error."""
    import urllib.error
    import urllib.request

    req_headers = headers or {
        "User-Agent": "Gnosi/0.1 (https://github.com/ismigar/Gnosi; mailto:ismigar@gmail.com)",
        "Accept": "application/json, text/html, application/xml; q=0.9, */*; q=0.8",
    }
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data: bytes = resp.read()
            return data.decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        _log.warning(f"HTTP GET {url[:80]}... failed: {e}")
        return None


def _http_get_public(url: str, timeout: float = 8.0, max_redirects: int = 5) -> str | None:
    """HTTP GET for user-supplied URLs, hardened against SSRF.

    Validates every hop against `_is_safe_external_url` (rejecting private,
    loopback and link-local addresses) and follows redirects manually so a 3xx
    to an internal host cannot be reached. Returns text or None on error.
    """
    import urllib.error
    import urllib.parse
    import urllib.request

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        __module__ = "backend.api.vault_routes"

        def redirect_request(self, *args: object, **kwargs: object) -> None:
            return None

    opener = urllib.request.build_opener(_NoRedirect)
    headers = {
        "User-Agent": "Gnosi/0.1 (https://github.com/ismigar/Gnosi; mailto:ismigar@gmail.com)",
        "Accept": "application/json, text/html, application/xml; q=0.9, */*; q=0.8",
    }
    current = url
    for _ in range(max_redirects + 1):
        ok, reason = _vault._is_safe_external_url(current)
        if not ok:
            _log.warning(f"Blocked SSRF-unsafe URL {current[:80]}...: {reason}")
            return None
        try:
            with opener.open(
                urllib.request.Request(current, headers=headers), timeout=timeout
            ) as resp:
                data: bytes = resp.read()
                return data.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                location = e.headers.get("Location")
                if not location:
                    return None
                current = urllib.parse.urljoin(current, location)
                continue
            _log.warning(f"HTTP GET {current[:80]}... failed: {e}")
            return None
        except (urllib.error.URLError, TimeoutError) as e:
            _log.warning(f"HTTP GET {current[:80]}... failed: {e}")
            return None
    return None


def _ck_norm(s: str) -> str:
    return _keys.normalize_key_part(s)


def _first_author_family(authors: object) -> str:
    return _keys.first_author_family(authors)


def _org_acronym(family: str) -> str:
    return _keys.organization_acronym(family)


def _title_token(title: object) -> str:
    return _keys.title_token(title)


def _alpha_suffix(i: int) -> str:
    return _keys.alpha_suffix(i)


def generate_citation_key(
    authors: object, year: object, title: object = "", existing: set[str] | None = None
) -> str:
    return _keys.generate_citation_key(authors, year, title, existing)


def _existing_citation_keys() -> set[str]:
    return _keys.existing_citation_keys(_vault.get_active_vault_path, _vault._ensure_cite_key_index)


def _inject_citation_key(suggested: Metadata) -> Metadata:
    return _keys.inject_citation_key(suggested, _vault._existing_citation_keys())


def _item_type_catalog_names(
    table: ReferenceTable | None, registry: ReferenceRegistry | None = None
) -> list[str]:
    """Option names of a table's 'Item Type' select catalog ([] if none).

    Same name normalization as `_citation_key_prop_name` (lowercase, no
    spaces) so an equivalent column name ('item type') still counts. Passing
    the registry resolves `config.catalog_ref` shared catalogs too.
    """
    from backend.services.option_catalogs import get_prop_options

    for p in (table or {}).get("properties") or []:
        if str(p.get("name") or "").lower().replace(" ", "") == "itemtype":
            return [o["name"] for o in get_prop_options(p, (registry or {}).get("option_catalogs"))]
    return []


def _normalize_suggested_item_type(
    suggested: Metadata,
) -> Metadata:
    """Rewrites `suggested['Item Type']` (canonical Zotero key) into the label
    the designated references table's catalog uses.

    Every suggestion path (lookup by identifier, web capture, PDF recognition)
    calls this right before responding, and the modal applies the suggested
    values verbatim — so the vault only ever stores catalog labels and
    grouping/filtering by Item Type never splits 'Llibre' vs 'book'. The
    resolution ranking lives in `csl_type_resolver.normalize_item_type`.
    Best-effort: with no designated table (or no catalog) bare keys still
    become a human label in the catalog's inferred locale, en-US as last resort.
    """
    if not isinstance(suggested, dict) or not suggested.get("Item Type"):
        return suggested
    from backend.services.csl_type_resolver import normalize_item_type

    table = registry = None
    try:
        tid = _vault.get_reference_table_id()
        if tid:
            registry = _vault.load_registry()
            table = next((t for t in registry.get("tables", []) if t.get("id") == tid), None)
    except Exception as e:
        _log.warning(f"item-type normalization: reference table unavailable: {e}")
    suggested["Item Type"] = normalize_item_type(
        str(suggested["Item Type"]), _vault._item_type_catalog_names(table, registry)
    )
    return suggested


def _citation_key_prop_name(table: Mapping[str, object] | None) -> str | None:
    """Actual name of the 'Citation Key' column of a citable table, or None.

    Backend mirror of the frontend's `tableHasCitationKey` (VaultDashboard.jsx):
    a table is "a Recursos table" (citable) if it has a column whose name,
    normalized (lowercase, no spaces), is `citationkey`. We return the
    actual name (e.g. 'Citation Key') so we can write to it with the exact key
    read by `_recursos_metadata_to_csl` and the citation index."""
    properties = (table or {}).get("properties", []) or []
    if not isinstance(properties, Iterable):
        raise TypeError("Citation table properties must be iterable")
    raw_property: object
    for raw_property in properties:
        if not isinstance(raw_property, Mapping):
            raise TypeError("Citation table properties must contain mappings")
        prop: Mapping[object, object] = raw_property
        name = prop.get("name")
        if str(name or "").lower().replace(" ", "") == "citationkey":
            name = prop.get("name")
            if not isinstance(name, str):
                raise TypeError("Citation Key property name must be a string")
            return name
    return None


def get_reference_table_id() -> str | None:
    """Id of the designated references table — the ONLY source of truth.

    The references functionality (automatic Citation Key, BibTeX import/export,
    "Create from a source", citation resolution) doesn't belong to a table
    by its name, but to whichever one the user designates in Settings. If the
    designation changes, all the functionality moves with it.

    Priority:
      1. `target_table` from the references config (Settings; reuses
         `zotero_db_config.json`).
      2. Auto-migration (vaults predating the designation, like those that already
         had "Recursos"): adopts the first table with a 'Citation Key' column and
         persists it as `target_table`. From then on the functionality
         follows the designation, not any heuristic.

    Returns None if there is no designation and no citable table (References not
    enabled yet)."""
    try:
        from backend.services.reference_table_config import (
            CONFIG_PATH,
            DEFAULT_CONFIG,
            cfg_lock,
            load_json,
            save_json,
        )
    except Exception:
        return None
    dependencies = _configuration.ReferenceConfigurationDependencies(
        config_path=CONFIG_PATH,
        defaults=DEFAULT_CONFIG,
        config_lock=cfg_lock,
        load_json=lambda path, default: load_json(path, default),
        save_json=lambda path, config: save_json(path, config),
        load_registry=lambda: _vault.load_registry(),
        citation_key_property=lambda table: _citation_key_prop_name(table),
        logger=_log,
    )
    return _configuration.reference_table_id(dependencies)


def ensure_reference_table_schema(table_id: str) -> int:
    """Adds to the table whichever citable columns it's missing (idempotent).

    This way the user doesn't need to know that "a Citation Key field is needed":
    when designating/creating the references table, the system guarantees the
    schema for them. Returns the number of columns added."""
    if not table_id:
        return 0
    with _vault.registry_mutation():
        reg = _vault.load_registry()
        table = next((t for t in reg.get("tables", []) or [] if t.get("id") == table_id), None)
        if not table:
            return 0
        props = table.setdefault("properties", [])
        existing = {str(p.get("name") or "").lower().replace(" ", "") for p in props}
        added = 0
        for name, ptype in _vault._REFERENCE_SCHEMA:
            norm = name.lower().replace(" ", "")
            if norm not in existing:
                props.append({"id": str(_uuid.uuid4()), "name": name, "type": ptype})
                existing.add(norm)
                added += 1
        if added:
            _vault.save_registry(reg)
            _log.info(f"📚 References schema: +{added} columns in {table_id}")
    return added


def _set_reference_table_id(table_id: str | None) -> None:
    """Persists the references table designation (Settings → `target_table`)."""
    from backend.services.reference_table_config import (
        CONFIG_PATH,
        DEFAULT_CONFIG,
        cfg_lock,
        load_json,
        save_json,
    )

    with cfg_lock:
        cfg = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
        cfg["target_table"] = (table_id or "").strip()
        cfg["references_configured"] = True
        save_json(CONFIG_PATH, cfg)


def _reference_table_by_id_primary(table_id: str) -> ReferenceTable | None:
    """Resolves a table by its id in the PRINCIPAL vault's registry.

    The references table designation (Zotero) is GLOBAL and the table lives in
    the Principal vault; without this, in a non-default vault `_table_by_id`
    would look for it in the wrong registry and wouldn't find it."""
    from backend.services.context_vars import active_vault_path, get_primary_vault_path

    base = get_primary_vault_path()
    if not base:
        return _vault._table_by_id(table_id)
    token = active_vault_path.set(base)
    try:
        return _vault._table_by_id(table_id)
    finally:
        active_vault_path.reset(token)


get_reference_table, set_reference_table, create_reference_table, clear_reference_table = (
    _references_api.register_routes(
        router,
        post_dependencies=[Depends(_require_role("editor"))],
        create_dependencies=[Depends(_require_role("editor"))],
        delete_dependencies=[Depends(_require_role("editor"))],
        dependencies=_REFERENCE_API_DEPENDENCIES,
    )
)
