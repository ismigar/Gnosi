"""Deterministic matching for attached Vault inventories."""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)


MAX_SEARCH_HITS = 8


MAX_CONTEXT_TABLE_ROWS = 100


MAX_CONTEXT_TABLE_FIELDS = 12


MAX_CONTEXT_INVENTORY_ROWS = 100


MAX_CONTEXT_INVENTORY_QUERY_CHARS = 500


INVENTORY_CONCEPT_EXPANSIONS = {
    "bibliografia": {
        "bibliografia",
        "bibliografica",
        "bibliograficas",
        "bibliografico",
        "bibliograficos",
        "referencia",
        "referencias",
        "fuente",
        "fuentes",
        "cerca",
        "recuperacio",
        "informacio",
        "literatura",
        "academica",
    },
    "bibliografica": {
        "bibliografia",
        "bibliografica",
        "bibliograficas",
        "bibliografico",
        "bibliograficos",
        "referencia",
        "referencias",
        "fuente",
        "fuentes",
        "cerca",
        "recuperacio",
        "informacio",
        "literatura",
        "academica",
    },
    "bibliograficas": {
        "bibliografia",
        "bibliografica",
        "bibliograficas",
        "bibliografico",
        "bibliograficos",
        "referencia",
        "referencias",
        "fuente",
        "fuentes",
        "cerca",
        "recuperacio",
        "informacio",
        "literatura",
        "academica",
    },
    "fuente": {
        "fuente",
        "fuentes",
        "font",
        "fonts",
        "source",
        "sources",
        "referencia",
        "referencias",
        "bibliografia",
        "bibliografica",
        "cerca",
        "recuperacio",
        "informacio",
    },
    "fuentes": {
        "fuente",
        "fuentes",
        "font",
        "fonts",
        "source",
        "sources",
        "referencia",
        "referencias",
        "bibliografia",
        "bibliografica",
        "cerca",
        "recuperacio",
        "informacio",
    },
}


INVENTORY_TYPE_ALIASES = {
    "source": {
        "font",
        "fonts",
        "fuente",
        "fuentes",
        "source",
        "sources",
        "ressource",
        "ressources",
        "recurs",
        "recursos",
        "resource",
        "resources",
    },
    "note": {
        "nota",
        "notas",
        "note",
        "notes",
        "cervell digital",
        "digital brain",
    },
    "article": {"article", "articles", "articulo", "articulos"},
    "task": {"tasca", "tasques", "tarea", "tareas", "task", "tasks"},
    "project": {
        "projecte",
        "projectes",
        "proyecto",
        "proyectos",
        "project",
        "projects",
        "projet",
        "projets",
    },
    "qualification": {
        "titulacio",
        "titulacions",
        "titulacion",
        "titulaciones",
        "qualification",
        "qualifications",
        "degree",
        "degrees",
        "diploma",
        "diplomas",
    },
    "area": {"area", "areas", "arees"},
    "blog": {"blog", "blogs", "bitacora", "journal"},
}


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[\wàèéíòóúïüçñ]{4,}", (text or "").lower()))


def score_text(query: str, text: str) -> int:
    """Word-overlap score, the same cheap heuristic as `vault_tools`."""
    base = _tokenize(query)
    return len(base & _tokenize(text)) if base else 0


def excerpt_around(text: str, query: str, width: int = 400) -> str:
    """Returns the fragment of `text` around the first query word that matches."""
    body = (text or "").strip()
    for word in sorted(_tokenize(query), key=len, reverse=True):
        pos = body.lower().find(word)
        if pos >= 0:
            start = max(0, pos - width // 2)
            return ("…" if start else "") + body[start : start + width].strip() + "…"
    return body[:width]


def _normalized_words(text: Any, *, minimum_length: int = 2) -> List[str]:
    """Return accent-insensitive words for deterministic inventory matching."""
    decomposed = unicodedata.normalize("NFKD", str(text or "").casefold())
    normalized = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return [token for token in re.findall(r"[a-z0-9]+", normalized) if len(token) >= minimum_length]


def _normalized_phrase(text: Any) -> str:
    """Return a stable searchable representation without locale-specific accents."""
    return " ".join(_normalized_words(text, minimum_length=1))


def _token_trigrams(token: str) -> set[str]:
    """Return bounded character trigrams for deterministic fuzzy matching."""
    value = f"  {str(token or '')[:64]}  "
    return {value[index : index + 3] for index in range(max(0, len(value) - 2))}


def _semantic_token_match(token: str, candidates: set[str]) -> bool:
    """Match conservative inflections and close lexical forms without a model."""
    if token in candidates:
        return True
    if len(token) < 5:
        return False
    source = _token_trigrams(token)
    for candidate in candidates:
        if len(candidate) < 5 or abs(len(candidate) - len(token)) > 4:
            continue
        target = _token_trigrams(candidate)
        union = source | target
        if union and len(source & target) / len(union) >= 0.62:
            return True
    return False


def _inventory_query_terms(
    query: str,
    *,
    vault_path: Any = None,
) -> tuple[list[str], list[str]]:
    """Return literal terms and bounded semantic expansion terms."""
    tokens = list(dict.fromkeys(_normalized_words(query)))
    expanded: list[str] = []
    for token in tokens:
        profile = INVENTORY_CONCEPT_EXPANSIONS.get(token)
        if profile:
            expanded.extend(profile)
    if vault_path:
        try:
            from backend.services.agent_semantic_memory import expand_terms

            learned_triggers = [*tokens, " ".join(tokens)]
            for learned_term in expand_terms(vault_path, learned_triggers):
                expanded.extend(_normalized_words(learned_term, minimum_length=2))
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not read reviewed semantic associations: %s", exc)
    if not expanded:
        return tokens, []
    # Preserve the literal query in the payload while making the matcher
    # explicit about the additional vocabulary it considered.
    return tokens, list(dict.fromkeys(expanded))


def _inventory_match(
    query: str,
    title: str,
    body: str,
    metadata: Any,
    related_text: str = "",
    expanded_tokens: Optional[List[str]] = None,
) -> Tuple[int, List[str], str]:
    """Score one canonical record and identify where every query token matched."""
    query_tokens, default_expanded_tokens = _inventory_query_terms(query)
    expanded_tokens = list(
        dict.fromkeys(expanded_tokens if expanded_tokens is not None else default_expanded_tokens)
    )
    if not query_tokens:
        return 1, ["all"], "direct"
    normalized_title = _normalized_phrase(title)
    normalized_body = _normalized_phrase(body)
    normalized_relations = _normalized_phrase(related_text)
    normalized_metadata = _normalized_phrase(
        json.dumps(
            metadata or {},
            ensure_ascii=False,
            default=str,
        )
    )
    title_tokens = set(normalized_title.split())
    body_tokens = set(normalized_body.split())
    metadata_tokens = set(normalized_metadata.split())
    relation_tokens = set(normalized_relations.split())
    direct_tokens = title_tokens | body_tokens | metadata_tokens
    combined_tokens = direct_tokens | relation_tokens
    match_tokens = query_tokens
    if expanded_tokens:
        # A concept query is satisfied by one canonical vocabulary term. This
        # lets “fuentes bibliográficas” reach “Cerca i recuperació d'informació”
        # while keeping ordinary multi-word queries strict.
        match_tokens = list(dict.fromkeys((*query_tokens, *expanded_tokens)))
    matched = [token for token in match_tokens if _semantic_token_match(token, combined_tokens)]
    if (not expanded_tokens and len(matched) != len(query_tokens)) or not matched:
        return 0, [], ""
    match_kind = (
        "direct"
        if all(_semantic_token_match(token, direct_tokens) for token in matched)
        else "relation"
    )
    basis = []
    if any(_semantic_token_match(token, title_tokens) for token in matched):
        basis.append("title")
    if any(_semantic_token_match(token, body_tokens) for token in matched):
        basis.append("body")
    if any(_semantic_token_match(token, metadata_tokens) for token in matched):
        basis.append("metadata")
    if any(_semantic_token_match(token, relation_tokens) for token in matched):
        basis.append("relations")
    normalized_query = " ".join(query_tokens)
    score = (
        (100 if normalized_query and normalized_query in normalized_title else 0)
        + (40 * sum(_semantic_token_match(token, title_tokens) for token in matched))
        + (8 * sum(_semantic_token_match(token, metadata_tokens) for token in matched))
        + (4 * sum(_semantic_token_match(token, relation_tokens) for token in matched))
        + sum(_semantic_token_match(token, body_tokens) for token in matched)
    )
    return max(1, score), basis, match_kind


def _bounded_context_value(value: Any) -> Any:
    """Bound one selected table value before returning it to the model."""
    if isinstance(value, dict):
        return {
            str(key)[:128]: _bounded_context_value(item) for key, item in list(value.items())[:20]
        }
    if isinstance(value, list):
        return [_bounded_context_value(item) for item in value[:50]]
    if isinstance(value, str):
        return value[:2_000]
    return value


def _canonical_metadata(metadata: Any) -> Dict[str, Any]:
    """Project heterogeneous Vault fields into bounded provenance metadata."""
    source = metadata if isinstance(metadata, dict) else {}
    normalized = {_normalized_phrase(key): value for key, value in source.items()}
    candidates = {
        "year": ("any", "ano", "year", "annee"),
        "item_type": ("item type", "tipus", "tipo", "type"),
        "verification_status": (
            "estat de verificacio",
            "estat verificacio",
            "verification status",
            "estado de verificacion",
            "statut de verification",
        ),
        "author": ("autoria", "autor", "author", "auteur"),
        "url": ("url", "source url", "enllac", "enlace", "link"),
    }
    projected: Dict[str, Any] = {}
    for canonical, aliases in candidates.items():
        value = next(
            (
                normalized[alias]
                for alias in aliases
                if alias in normalized and normalized[alias] not in (None, "", [], {})
            ),
            None,
        )
        if value is not None:
            projected[canonical] = _bounded_context_value(value)
    return projected
