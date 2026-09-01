"""Canonical normalization shared by academic provider adapters."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from backend.services.literature_models import clean_text, normalize_language, normalize_title


def _date_parts(parts: Any) -> str:
    if isinstance(parts, list) and parts and isinstance(parts[0], list):
        values = parts[0]
    elif isinstance(parts, list):
        values = parts
    else:
        return ""
    return "-".join(
        str(value).zfill(2) if index else str(value) for index, value in enumerate(values[:3])
    )


def _authors(values: Any) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for value in values if isinstance(values, list) else []:
        if not isinstance(value, dict):
            result.append({"literal": clean_text(value, 400)})
            continue
        result.append(
            {
                "given": clean_text(value.get("given") or value.get("firstName"), 200),
                "family": clean_text(value.get("family") or value.get("lastName"), 200),
                "literal": clean_text(value.get("name") or value.get("collectiveName"), 400),
                "orcid": clean_text(value.get("ORCID") or value.get("orcid"), 120),
            }
        )
    return result


def _occurrence(
    provider: str, provider_id: Any, url: Any, *, score: Any = None, citations: Any = None
) -> list[dict[str, Any]]:
    try:
        normalized_score = float(score) if score not in (None, "") else None
    except (TypeError, ValueError):
        normalized_score = None
    try:
        normalized_citations = int(citations) if citations not in (None, "") else None
    except (TypeError, ValueError):
        normalized_citations = None
    return [
        {
            "provider": provider,
            "provider_id": clean_text(provider_id, 500),
            "url": clean_text(url, 4_000),
            "score": normalized_score,
            "citations": normalized_citations,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }
    ]


def _location(
    url: Any, *, pdf_url: Any = "", is_oa: bool | None = None, license_value: Any = ""
) -> list[dict[str, Any]]:
    landing = clean_text(url, 4_000)
    pdf = clean_text(pdf_url, 4_000)
    if not landing and not pdf:
        return []
    return [
        {
            "url": landing or pdf,
            "landing_page_url": landing,
            "pdf_url": pdf,
            "is_oa": is_oa,
            "license": clean_text(license_value, 300),
        }
    ]


def _filters(filters: dict[str, Any]) -> dict[str, Any]:
    return filters if isinstance(filters, dict) else {}


def _truthy_provider_value(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    normalized = clean_text(value, 20).lower()
    if normalized in {"1", "true", "t", "yes", "y"}:
        return True
    if normalized in {"0", "false", "f", "no", "n"}:
        return False
    return None


def _inferred_language(work: dict[str, Any]) -> str:
    """Infer a language conservatively when a provider omits the field."""
    tokens = set(normalize_title(f"{work.get('title') or ''} {work.get('abstract') or ''}").split())
    markers = {
        "ca": {
            "aquest",
            "amb",
            "catalana",
            "dels",
            "historia",
            "historica",
            "les",
            "perioditzacio",
        },
        "de": {"der", "die", "geschichte", "historische", "mit", "periodisierung", "und", "von"},
        "en": {"and", "for", "historical", "history", "of", "periodization", "the", "with"},
        "es": {"del", "el", "historia", "historica", "las", "los", "para", "periodizacion"},
        "fr": {"des", "et", "historique", "histoire", "les", "periodisation", "pour", "une"},
        "it": {"della", "delle", "periodizzazione", "storia", "storica", "una"},
        "pt": {"das", "dos", "historia", "historica", "periodizacao", "uma"},
    }
    scores = {language: len(tokens & values) for language, values in markers.items()}
    best = max(scores, key=lambda language: scores[language])
    ordered = sorted(scores.values(), reverse=True)
    return best if scores[best] >= 2 and (len(ordered) < 2 or ordered[0] > ordered[1]) else ""


def filter_works(works: list[dict[str, Any]], filters: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply canonical filters consistently after provider-side filtering."""
    selected = _filters(filters)
    try:
        year_from = (
            int(str(selected.get("date_from") or "")[:4]) if selected.get("date_from") else None
        )
        year_to = int(str(selected.get("date_to") or "")[:4]) if selected.get("date_to") else None
    except ValueError:
        year_from = year_to = None
    raw_languages = selected.get("languages")
    if not isinstance(raw_languages, list):
        raw_languages = re.split(r"[,;\s]+", str(selected.get("language") or ""))
    languages = {normalize_language(value) for value in raw_languages if str(value).strip()}
    wanted_type = clean_text(selected.get("type"), 100).lower()
    aliases = {"article": "journal-article", "journalarticle": "journal-article"}
    wanted_type = aliases.get(wanted_type, wanted_type)
    result: list[dict[str, Any]] = []
    for work in works:
        year = work.get("year")
        if year_from and (not isinstance(year, int) or year < year_from):
            continue
        if year_to and (not isinstance(year, int) or year > year_to):
            continue
        work_language = normalize_language(work.get("language")) or _inferred_language(work)
        if languages and work_language not in languages:
            continue
        work_type = aliases.get(
            clean_text(work.get("type"), 100).lower(), clean_text(work.get("type"), 100).lower()
        )
        if wanted_type and work_type != wanted_type:
            continue
        if (
            selected.get("open_access") is True
            and (work.get("open_access") or {}).get("is_oa") is not True
        ):
            continue
        if selected.get("full_text") is True:
            locations = work.get("locations") or []
            has_verified_full_text = any(
                isinstance(location, dict)
                and (location.get("pdf_url") or location.get("is_oa") is True)
                for location in locations
            )
            if not has_verified_full_text:
                continue
        if selected.get("peer_reviewed") is True and work.get("peer_reviewed") is not True:
            continue
        result.append(work)
    return result


def _matches_mandatory_concept(work: dict[str, Any], query: str) -> bool:
    """Reject provider relaxations that lose the first mandatory Boolean group."""
    match = re.match(r"^\s*\((.+?)\)\s+AND\b", str(query or ""), flags=re.IGNORECASE)
    expression = match.group(1) if match else str(query or "")
    if not match and not (
        re.search(r"\s+OR\s+", expression, flags=re.IGNORECASE) and '"' in expression
    ):
        return True
    alternatives = re.split(r"\s+OR\s+", expression.strip(" ()"), flags=re.IGNORECASE)
    haystack = set(
        normalize_title(f"{work.get('title') or ''} {work.get('abstract') or ''}").split()
    )

    def root(token: str) -> str:
        if token.startswith("periodiz"):
            return "periodiz"
        if token.startswith("histor"):
            return "histor"
        return token

    haystack_roots = {root(token) for token in haystack}
    for alternative in alternatives:
        tokens = [
            root(token)
            for token in normalize_title(alternative.strip(' "')).split()
            if len(token) > 2
        ]
        if tokens and set(tokens).issubset(haystack_roots):
            return True
    return False
