"""Bounded, multilingual interpretation before capability routing."""
from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any, Iterable, Mapping

from backend.agent.turn_contract import detect_request_domains, normalize_request_text

INTERPRETER_VERSION = "semantic-v2"
_ACTION = {"create", "update", "delete", "send", "write", "fes", "haz", "crea", "envia", "elimina", "actualiza"}
_INVENTORY = {"all", "every", "list", "find", "search", "tots", "totes", "tinc", "quins", "quines", "todos", "todas", "busca", "encuentra", "font", "fonts", "fuente", "fuentes"}
_RELATION = {"related", "relation", "connect", "similar", "relacionat", "relacionades", "relacionadas", "vinculat", "relacionado", "relacionadas", "relacion"}
_ANALYSIS = {
    "why", "how", "compare", "summarize", "analysis", "com", "compara", "resumeix",
    "analitza", "analitzar", "analiza", "analizar", "analyze", "analyse", "explica",
    "explicar", "explain", "explique", "interpreta", "interpret", "como", "relacion",
}
_SYNONYMS = {
    "bibliografiques": "bibliografia", "bibliograficas": "bibliografia", "fonts": "font", "fuentes": "fuente",
    "notes": "nota", "notas": "nota", "recursos": "recurs", "resources": "resource",
    "cercar": "buscar", "cerca": "buscar", "troba": "buscar", "buscame": "buscar", "encuentra": "buscar",
}


def _tokens(message: Any) -> list[str]:
    normalized = normalize_request_text(message)
    return [token for token in normalized.split() if token]


def _rewrite(tokens: Iterable[str]) -> list[str]:
    output: list[str] = []
    for token in tokens:
        canonical = _SYNONYMS.get(token, token)
        if canonical not in output:
            output.append(canonical)
    return output[:48]


def interpret_request(message: str, *, mode: str = "", domains: Iterable[str] = ()) -> dict[str, Any]:
    """Return an auditable interpretation without making tool calls."""
    raw_tokens = _tokens(message)
    tokens = _rewrite(raw_tokens)
    selected_domains = list(dict.fromkeys(str(item) for item in domains if item)) or detect_request_domains(message)
    relation_requested = bool(set(tokens).intersection(_RELATION))
    has_action = bool(set(tokens).intersection(_ACTION)) or str(mode) == "action"
    has_inventory = bool(set(tokens).intersection(_INVENTORY)) or str(mode) in {"inventory", "lookup"}
    has_analysis = bool(set(tokens).intersection(_ANALYSIS)) or str(mode) == "analysis"
    operation = "action" if has_action else "inventory" if has_inventory else "analysis" if has_analysis else "conversation"
    concepts = [token for token in tokens if len(token) >= 4 and token not in _ACTION | _INVENTORY | _RELATION | _ANALYSIS][:16]
    confidence = 0.98 if operation == "conversation" and not message.strip() else 0.64
    if selected_domains:
        confidence += 0.16
    if concepts:
        confidence += 0.12
    if relation_requested:
        confidence += 0.04
    confidence = min(0.99, confidence)
    ambiguity = []
    if not tokens:
        ambiguity.append("empty_request")
    if operation in {"inventory", "analysis"} and not selected_domains and not concepts:
        ambiguity.append("missing_subject")
    abstain = confidence < 0.58 or "empty_request" in ambiguity
    normalized_query = " ".join(tokens)[:512]
    return {
        "schema_version": 2,
        "interpreter_version": INTERPRETER_VERSION,
        "operation": operation,
        "normalized_query": normalized_query,
        "query_digest": hashlib.sha256(normalized_query.encode("utf-8")).hexdigest()[:16],
        "domains": selected_domains[:8],
        "concepts": concepts,
        "relation_requested": relation_requested,
        "retrieval_strategies": ["exact_title", "lexical", "semantic"] + (["relation_graph"] if relation_requested else []),
        "ambiguities": ambiguity,
        "confidence": round(confidence, 3),
        "clarification_required": bool(ambiguity) and not abstain,
        "abstain": abstain,
    }


def broker_capabilities(intent: Mapping[str, Any], tool_metadata: Iterable[Mapping[str, Any]]) -> list[str]:
    """Select only relevant non-guarded tools; the model still owns execution."""
    domains = {str(item) for item in intent.get("domains") or []}
    selected: list[str] = []
    for item in tool_metadata:
        name = str(item.get("name") or "")
        effects = {str(effect) for effect in item.get("effects") or []}
        if effects.intersection({"local_write", "external_write", "destructive", "code_execution"}):
            continue
        if not domains or any(domain in name.lower() for domain in domains) or item.get("dynamic_context"):
            selected.append(name)
    return selected[:24]


def clarification_message(intent: Mapping[str, Any], language: str = "ca") -> str:
    """Return a short user-facing clarification without exposing classifier internals."""
    code = str((intent.get("ambiguities") or ["missing_subject"])[0])
    if code == "empty_request":
        messages = {
            "ca": "Què vols que faci? Escriu una pregunta o una acció concreta.",
            "es": "¿Qué quieres que haga? Escribe una pregunta o una acción concreta.",
            "fr": "Que veux-tu que je fasse ? Écris une question ou une action concrète.",
        }
    else:
        messages = {
            "ca": "Em falta el tema o la font concreta. Què vols buscar o analitzar?",
            "es": "Falta el tema o la fuente concreta. ¿Qué quieres buscar o analizar?",
            "fr": "Il me manque le sujet ou la source. Que veux-tu chercher ou analyser ?",
        }
    return messages.get(str(language or "").lower(), messages["ca"])
