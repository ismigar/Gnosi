"""Canonical academic-work normalization and deterministic deduplication."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from copy import deepcopy
from datetime import datetime, timezone
from difflib import SequenceMatcher
from html import unescape
from typing import Any, Iterable


PROVIDER_PRIORITY = {
    "crossref": 10,
    "datacite": 20,
    "europe-pmc": 30,
    "pubmed": 35,
    "arxiv": 40,
    "doaj-articles": 45,
    "hal": 50,
    "openaire": 55,
    "eric": 60,
    "core": 65,
    "scielo-articles": 70,
    "open-library": 80,
}


def now_iso() -> str:
    """Return a timezone-aware retrieval timestamp."""
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: Any, limit: int = 50_000) -> str:
    """Normalize arbitrary provider text while preserving readable Unicode."""
    text = re.sub(r"<[^>]+>", " ", unescape(unescape(str(value or ""))))
    text = " ".join(text.split()).strip()
    return text[:limit]


def normalize_title(value: Any) -> str:
    """Return the Unicode-aware exact-title deduplication representation."""
    text = unicodedata.normalize("NFKD", clean_text(value).casefold())
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^\w]+", " ", text, flags=re.UNICODE)
    return " ".join(text.split())


def normalize_doi(value: Any) -> str:
    """Normalize a DOI without accepting surrounding resolver syntax."""
    text = clean_text(value, 500).lower()
    text = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", text)
    match = re.search(r"10\.\d{4,9}/[-._;()/:a-z0-9]+", text, re.IGNORECASE)
    return match.group(0).rstrip(".,;:)]}").lower() if match else ""


def normalize_pmid(value: Any) -> str:
    text = clean_text(value, 80)
    match = re.fullmatch(r"(?:pmid:\s*)?(\d{1,10})", text, re.IGNORECASE)
    return match.group(1) if match else ""


def normalize_pmcid(value: Any) -> str:
    text = clean_text(value, 80).upper().replace(" ", "")
    match = re.fullmatch(r"PMC(\d{1,12})", text)
    return f"PMC{match.group(1)}" if match else ""


def normalize_arxiv(value: Any) -> str:
    text = clean_text(value, 160).lower()
    text = re.sub(r"^(?:https?://arxiv\.org/(?:abs|pdf)/|arxiv:\s*)", "", text)
    text = re.sub(r"\.pdf$", "", text)
    text = re.sub(r"v\d+$", "", text)
    match = re.fullmatch(r"(?:[a-z-]+(?:\.[a-z-]+)?/\d{7}|\d{4}\.\d{4,5})", text)
    return match.group(0) if match else ""


def normalize_isbn13(value: Any) -> str:
    digits = re.sub(r"[^0-9]", "", clean_text(value, 80))
    if len(digits) != 13 or not digits.startswith(("978", "979")):
        return ""
    total = sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(digits[:12]))
    check = (10 - total % 10) % 10
    return digits if check == int(digits[-1]) else ""


def normalize_language(value: Any) -> str:
    text = clean_text(value, 40).lower().replace("_", "-")
    aliases = {"eng": "en", "spa": "es", "cat": "ca", "fra": "fr", "fre": "fr"}
    return aliases.get(text, text[:12])


def normalize_authors(values: Any) -> list[dict[str, str]]:
    """Normalize structured or literal author representations."""
    if values is None:
        return []
    if isinstance(values, str):
        values = [part.strip() for part in re.split(r"\s*;\s*", values) if part.strip()]
    if not isinstance(values, list):
        values = [values]
    authors: list[dict[str, str]] = []
    for value in values:
        if isinstance(value, dict):
            given = clean_text(value.get("given") or value.get("given_name"), 200)
            family = clean_text(value.get("family") or value.get("family_name"), 200)
            literal = clean_text(
                value.get("literal")
                or value.get("name")
                or " ".join(filter(None, (given, family))),
                400,
            )
            orcid = clean_text(value.get("orcid") or value.get("ORCID"), 120)
        else:
            literal = clean_text(value, 400)
            given = ""
            family = ""
            if "," in literal:
                family, given = [part.strip() for part in literal.split(",", 1)]
            elif literal:
                parts = literal.split()
                family = parts[-1]
                given = " ".join(parts[:-1])
            orcid = ""
        if literal or given or family:
            authors.append({"given": given, "family": family, "literal": literal, "orcid": orcid})
    return authors[:200]


def first_author_family(work: dict[str, Any]) -> str:
    authors = work.get("authors") if isinstance(work.get("authors"), list) else []
    if not authors:
        return ""
    author = authors[0] if isinstance(authors[0], dict) else {"literal": authors[0]}
    family = author.get("family") or str(author.get("literal") or "").split()[-1:]
    if isinstance(family, list):
        family = family[0] if family else ""
    return normalize_title(family)


def _year(value: Any) -> int | None:
    if isinstance(value, int) and 1000 <= value <= 3000:
        return value
    match = re.search(r"\b(1[5-9]\d{2}|20\d{2}|2100)\b", clean_text(value, 80))
    return int(match.group(1)) if match else None


def empty_work(provider: str, provider_id: Any = "") -> dict[str, Any]:
    """Create a complete canonical work shell for one provider occurrence."""
    retrieved_at = now_iso()
    provider_id_text = clean_text(provider_id, 500)
    return {
        "id": "",
        "title": "",
        "normalized_title": "",
        "authors": [],
        "dates": {"issued": "", "online": "", "print": ""},
        "year": None,
        "abstract": "",
        "abstract_available": False,
        "type": "other",
        "peer_reviewed": None,
        "publication": {
            "container_title": "",
            "publisher": "",
            "volume": "",
            "issue": "",
            "pages": "",
        },
        "language": "",
        "identifiers": {
            "doi": "",
            "pmid": "",
            "pmcid": "",
            "arxiv": "",
            "isbn13": [],
            "provider": {},
        },
        "open_access": {"is_oa": None, "license": "", "best_location": None},
        "locations": [],
        "sources": [
            {
                "provider": provider,
                "provider_id": provider_id_text,
                "url": "",
                "score": None,
                "citations": None,
                "retrieved_at": retrieved_at,
            }
        ],
        "metrics": {"citations": {}},
        "provenance": {},
        "conflicts": {},
        "duplicate_key": "",
        "possible_duplicates": [],
        "in_resources": False,
        "resource_id": None,
    }


def canonical_work(provider: str, provider_id: Any, **fields: Any) -> dict[str, Any]:
    """Build and normalize a canonical work from provider-specific fields."""
    work = empty_work(provider, provider_id)
    for key, value in fields.items():
        if key in work and value is not None:
            work[key] = value
    work["title"] = clean_text(work.get("title"), 2_000)
    work["normalized_title"] = normalize_title(work["title"])
    work["authors"] = normalize_authors(work.get("authors"))
    work["year"] = _year(work.get("year") or (work.get("dates") or {}).get("issued"))
    work["abstract"] = clean_text(work.get("abstract"), 50_000)
    work["abstract_available"] = bool(work["abstract"])
    work["language"] = normalize_language(work.get("language"))
    identifiers_value = work.get("identifiers")
    identifiers: dict[str, Any] = identifiers_value if isinstance(identifiers_value, dict) else {}
    identifiers = {
        "doi": normalize_doi(identifiers.get("doi")),
        "pmid": normalize_pmid(identifiers.get("pmid")),
        "pmcid": normalize_pmcid(identifiers.get("pmcid")),
        "arxiv": normalize_arxiv(identifiers.get("arxiv")),
        "isbn13": list(
            dict.fromkeys(
                filter(
                    None, (normalize_isbn13(item) for item in identifiers.get("isbn13", []) or [])
                )
            )
        ),
        "provider": identifiers.get("provider")
        if isinstance(identifiers.get("provider"), dict)
        else {},
    }
    identifiers["provider"].setdefault(provider, clean_text(provider_id, 500))
    work["identifiers"] = identifiers
    sources = work.get("sources") if isinstance(work.get("sources"), list) else []
    if not sources:
        sources = empty_work(provider, provider_id)["sources"]
    work["sources"] = sources
    occurrence = work["sources"][0]
    if isinstance(occurrence, dict):
        occurrence["provider"] = provider
        occurrence["provider_id"] = clean_text(occurrence.get("provider_id") or provider_id, 500)
        occurrence.setdefault("retrieved_at", now_iso())
    work["duplicate_key"] = deterministic_key(work)
    stable = (
        work["duplicate_key"]
        or f"source:{provider}:{clean_text(provider_id, 500)}:{work['normalized_title']}"
    )
    work["id"] = hashlib.sha256(stable.encode("utf-8")).hexdigest()[:24]
    work["provenance"] = _initial_provenance(work, provider)
    return work


def deterministic_key(work: dict[str, Any]) -> str:
    """Return the strongest deterministic duplicate key available."""
    identifiers_value = work.get("identifiers")
    identifiers: dict[str, Any] = identifiers_value if isinstance(identifiers_value, dict) else {}
    if normalize_doi(identifiers.get("doi")):
        return f"doi:{normalize_doi(identifiers['doi'])}"
    if normalize_pmid(identifiers.get("pmid")):
        return f"pmid:{normalize_pmid(identifiers['pmid'])}"
    if normalize_pmcid(identifiers.get("pmcid")):
        return f"pmcid:{normalize_pmcid(identifiers['pmcid'])}"
    if normalize_arxiv(identifiers.get("arxiv")):
        return f"arxiv:{normalize_arxiv(identifiers['arxiv'])}"
    for isbn in identifiers.get("isbn13", []) or []:
        normalized = normalize_isbn13(isbn)
        if normalized:
            return f"isbn13:{normalized}"
    title = normalize_title(work.get("title") or work.get("normalized_title"))
    year = _year(work.get("year"))
    family = first_author_family(work)
    if title and year and family:
        return f"tay:{title}|{year}|{family}"
    return ""


def _initial_provenance(work: dict[str, Any], provider: str) -> dict[str, list[str]]:
    paths = (
        "title",
        "authors",
        "year",
        "abstract",
        "type",
        "peer_reviewed",
        "publication",
        "language",
        "identifiers",
        "open_access",
        "locations",
    )
    return {path: [provider] for path in paths if work.get(path) not in (None, "", [], {})}


def _field_score(field: str, value: Any, provider: str) -> tuple[int, int]:
    priority = PROVIDER_PRIORITY.get(provider, 1_000)
    if isinstance(value, (list, dict)):
        completeness = len(value)
    else:
        completeness = len(clean_text(value))
    if field == "abstract":
        return (-completeness, priority)
    return (priority, -completeness)


def _source_provider(work: dict[str, Any]) -> str:
    sources = work.get("sources") if isinstance(work.get("sources"), list) else []
    return clean_text(
        (sources[0] if sources and isinstance(sources[0], dict) else {}).get("provider"), 100
    )


def merge_works(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Merge deterministic duplicates while preserving provenance and conflicts."""
    merged = deepcopy(left)
    left_provider = _source_provider(left)
    right_provider = _source_provider(right)
    for field in (
        "title",
        "authors",
        "year",
        "abstract",
        "type",
        "peer_reviewed",
        "publication",
        "language",
        "open_access",
    ):
        old = merged.get(field)
        new = right.get(field)
        if new in (None, "", [], {}):
            continue
        if old not in (None, "", [], {}) and old != new:
            variants = merged.setdefault("conflicts", {}).setdefault(field, [])
            for value, provider in ((old, left_provider), (new, right_provider)):
                candidate = {"value": value, "provider": provider}
                if candidate not in variants:
                    variants.append(candidate)
        if old in (None, "", [], {}) or _field_score(field, new, right_provider) < _field_score(
            field, old, left_provider
        ):
            merged[field] = deepcopy(new)
        providers = merged.setdefault("provenance", {}).setdefault(field, [])
        for provider in right.get("provenance", {}).get(field, [right_provider]):
            if provider and provider not in providers:
                providers.append(provider)

    identifiers = merged.setdefault("identifiers", {})
    incoming_value = right.get("identifiers")
    incoming_ids: dict[str, Any] = incoming_value if isinstance(incoming_value, dict) else {}
    for key in ("doi", "pmid", "pmcid", "arxiv"):
        identifiers[key] = identifiers.get(key) or incoming_ids.get(key) or ""
    identifiers["isbn13"] = list(
        dict.fromkeys((identifiers.get("isbn13") or []) + (incoming_ids.get("isbn13") or []))
    )
    identifiers["provider"] = {
        **(identifiers.get("provider") or {}),
        **(incoming_ids.get("provider") or {}),
    }

    merged["locations"] = _unique_dicts(
        (merged.get("locations") or []) + (right.get("locations") or []),
        ("url", "landing_page_url", "pdf_url"),
    )
    merged["sources"] = _unique_dicts(
        (merged.get("sources") or []) + (right.get("sources") or []),
        ("provider", "provider_id", "url"),
    )
    citations = merged.setdefault("metrics", {}).setdefault("citations", {})
    citations.update((right.get("metrics") or {}).get("citations") or {})
    merged["abstract_available"] = bool(merged.get("abstract"))
    merged["normalized_title"] = normalize_title(merged.get("title"))
    merged["duplicate_key"] = deterministic_key(merged)
    stable = merged["duplicate_key"] or merged.get("id") or right.get("id") or ""
    merged["id"] = hashlib.sha256(stable.encode("utf-8")).hexdigest()[:24]
    return merged


def _unique_dicts(values: Iterable[Any], identity_keys: tuple[str, ...]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    seen: set[tuple[str, ...]] = set()
    for value in values:
        if not isinstance(value, dict):
            continue
        identity = tuple(clean_text(value.get(key), 2_000) for key in identity_keys)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(deepcopy(value))
    return unique


def deduplicate_works(works: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply deterministic unions and annotate unmerged fuzzy candidates."""
    groups: dict[str, dict[str, Any]] = {}
    singles: list[dict[str, Any]] = []
    for raw in works:
        work = deepcopy(raw)
        key = deterministic_key(work)
        if key:
            groups[key] = merge_works(groups[key], work) if key in groups else work
        else:
            singles.append(work)
    merged = list(groups.values()) + singles
    for index, work in enumerate(merged):
        title = normalize_title(work.get("title"))
        if len(title) < 20:
            continue
        for other in merged[index + 1 :]:
            other_title = normalize_title(other.get("title"))
            if len(other_title) < 20:
                continue
            ratio = SequenceMatcher(None, title, other_title).ratio()
            if ratio < 0.92:
                continue
            warning = {
                "result_id": other.get("id"),
                "title": other.get("title"),
                "similarity": round(ratio, 3),
            }
            reverse = {
                "result_id": work.get("id"),
                "title": work.get("title"),
                "similarity": round(ratio, 3),
            }
            work.setdefault("possible_duplicates", []).append(warning)
            other.setdefault("possible_duplicates", []).append(reverse)
    return merged
