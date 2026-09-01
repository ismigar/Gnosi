"""Compatibility exports for governed turn planning and verification."""

from __future__ import annotations

from backend.domains.agent.turn_evidence import (
    CITATION_MARKER_RE,
    MAX_CITATION_CLAIMS,
    MAX_CITATION_SOURCES,
    NOTEBOOK_EVIDENCE_TOOL_NAMES,
    _blocked_text,
    _bounded_label,
    _citation_evidence,
    _citation_id,
    _claim_citations,
    _current_turn_tool_messages,
    _safe_job,
    _safe_source_href,
    _tool_payload,
    configure_browser_path_resolver,
    verify_response,
)
from backend.domains.agent.turn_planning import (
    COMPLETION_RE,
    DOMAIN_ALIASES,
    DOMAIN_TOOL_MARKERS,
    GUARDED_EFFECTS,
    LOCAL_PROVIDERS,
    PRIVATE_CONTEXT_TYPES,
    TURN_BUDGETS,
    _response_language,
    _tool_effects,
    _tool_matches_domains,
    build_turn_plan,
    detect_request_domains,
    normalize_request_text,
    turn_budgets_for_mode,
)
from backend.services.vault_routing import canonical_vault_browser_path

configure_browser_path_resolver(lambda area, path: canonical_vault_browser_path(area, path))

__all__ = [
    "CITATION_MARKER_RE",
    "COMPLETION_RE",
    "DOMAIN_ALIASES",
    "DOMAIN_TOOL_MARKERS",
    "GUARDED_EFFECTS",
    "LOCAL_PROVIDERS",
    "MAX_CITATION_CLAIMS",
    "MAX_CITATION_SOURCES",
    "NOTEBOOK_EVIDENCE_TOOL_NAMES",
    "PRIVATE_CONTEXT_TYPES",
    "TURN_BUDGETS",
    "_blocked_text",
    "_bounded_label",
    "_citation_evidence",
    "_citation_id",
    "_claim_citations",
    "_current_turn_tool_messages",
    "_response_language",
    "_safe_job",
    "_safe_source_href",
    "_tool_effects",
    "_tool_matches_domains",
    "_tool_payload",
    "build_turn_plan",
    "canonical_vault_browser_path",
    "detect_request_domains",
    "normalize_request_text",
    "turn_budgets_for_mode",
    "verify_response",
]
