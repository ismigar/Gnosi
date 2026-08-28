"""Compatibility facade for typed academic connector adapters."""

from __future__ import annotations

import socket
import sys
from typing import cast

from backend.domains.literature.connectors.commercial import (
    search_dimensions,
    search_scopus,
    search_springer_nature,
    search_web_of_science,
)
from backend.domains.literature.connectors.crossref import (
    _crossref_work,
    search_crossref,
    search_datacite,
    search_scielo_articles,
)
from backend.domains.literature.connectors.dispatcher import (
    SEARCHERS,
    enrich_unpaywall,
    run,
    search_source,
)
from backend.domains.literature.connectors.generic import search_generic_json
from backend.domains.literature.connectors.graphs import (
    _openalex_identifier,
    _openalex_work,
    _semantic_scholar_identifier,
    _semantic_scholar_work,
    openalex_neighbors,
    search_openalex,
    search_semantic_scholar,
    semantic_scholar_neighbors,
)
from backend.domains.literature.connectors.normalization import (
    _authors,
    _date_parts,
    _filters,
    _inferred_language,
    _location,
    _matches_mandatory_concept,
    _occurrence,
    _truthy_provider_value,
    filter_works,
)
from backend.domains.literature.connectors.public import (
    search_core,
    search_doaj,
    search_eric,
    search_europe_pmc,
    search_hal,
    search_open_library,
    search_openaire,
    search_pubmed,
)
from backend.domains.literature.connectors.runtime import (
    ConnectorRuntime,
    configure_runtime,
)
from backend.domains.literature.connectors.transport import (
    CONNECTOR_AUDIT_VERSION,
    DEFAULT_TIMEOUT_SECONDS,
    MAX_REDIRECTS,
    MAX_RESPONSE_BYTES,
    USER_AGENT,
    ConnectorError,
    _auditable_url,
    _is_public_address,
    _record_request,
    _retry_after,
    begin_request_audit,
    end_request_audit,
    safe_get_bytes,
    safe_get_json,
    validate_public_https_url,
)
from backend.domains.literature.connectors.xml import (
    _xml_text,
    _xml_texts,
    fetch_oai_page,
    parse_oai_page,
    parse_safe_xml,
    search_arxiv,
)
from backend.services.literature_models import (
    canonical_work,
    clean_text,
    normalize_doi,
    normalize_language,
    normalize_title,
)

__all__ = [
    "CONNECTOR_AUDIT_VERSION",
    "DEFAULT_TIMEOUT_SECONDS",
    "MAX_REDIRECTS",
    "MAX_RESPONSE_BYTES",
    "SEARCHERS",
    "USER_AGENT",
    "ConnectorError",
    "_auditable_url",
    "_authors",
    "_crossref_work",
    "_date_parts",
    "_filters",
    "_inferred_language",
    "_is_public_address",
    "_location",
    "_matches_mandatory_concept",
    "_occurrence",
    "_openalex_identifier",
    "_openalex_work",
    "_record_request",
    "_retry_after",
    "_semantic_scholar_identifier",
    "_semantic_scholar_work",
    "_truthy_provider_value",
    "_xml_text",
    "_xml_texts",
    "begin_request_audit",
    "canonical_work",
    "clean_text",
    "end_request_audit",
    "enrich_unpaywall",
    "fetch_oai_page",
    "filter_works",
    "normalize_doi",
    "normalize_language",
    "normalize_title",
    "openalex_neighbors",
    "parse_oai_page",
    "parse_safe_xml",
    "run",
    "safe_get_bytes",
    "safe_get_json",
    "search_arxiv",
    "search_core",
    "search_crossref",
    "search_datacite",
    "search_dimensions",
    "search_doaj",
    "search_eric",
    "search_europe_pmc",
    "search_generic_json",
    "search_hal",
    "search_open_library",
    "search_openaire",
    "search_openalex",
    "search_pubmed",
    "search_scielo_articles",
    "search_scopus",
    "search_semantic_scholar",
    "search_source",
    "search_springer_nature",
    "search_web_of_science",
    "semantic_scholar_neighbors",
    "socket",
    "validate_public_https_url",
]


def _current_facade() -> ConnectorRuntime:
    """Return this module through the narrow typed runtime protocol."""
    return cast(ConnectorRuntime, sys.modules[__name__])


configure_runtime(_current_facade)
