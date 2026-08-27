"""Deterministic Better BibTeX-style citation keys."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.domains.vault.citations.authors import parse_authors_to_csl


ORG_KEY_STOPWORDS = {
    "de",
    "del",
    "dels",
    "la",
    "las",
    "les",
    "los",
    "el",
    "l",
    "d",
    "i",
    "y",
    "of",
    "the",
    "and",
    "en",
    "a",
    "per",
    "para",
    "sobre",
}
ORG_KEY_MIN_WORDS = 3


def normalize_key_part(value: str) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFD", str(value))
    normalized = "".join(
        character for character in normalized if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^a-z0-9]", "", normalized.lower())


def first_author_family(authors: Any) -> str:
    if isinstance(authors, list):
        for author in authors:
            if not isinstance(author, dict):
                continue
            family = (
                " ".join(
                    part
                    for part in (
                        str(author.get("cognom1") or "").strip(),
                        str(author.get("cognom2") or "").strip(),
                    )
                    if part
                )
                or str(author.get("family") or "").strip()
            )
            if family:
                return family
            name = str(author.get("nom") or author.get("literal") or "").strip()
            if name:
                return name.split()[-1]
        return ""
    if isinstance(authors, str) and authors.strip():
        parsed = parse_authors_to_csl(authors)
        if parsed:
            return str(parsed[0].get("family") or parsed[0].get("given") or "").strip()
    return ""


def organization_acronym(family: str) -> str:
    words = [
        word
        for word in re.split(r"[\s'’.\-]+", family or "")
        if normalize_key_part(word) and normalize_key_part(word) not in ORG_KEY_STOPWORDS
    ]
    if len(words) < ORG_KEY_MIN_WORDS:
        return ""
    acronym = "".join(normalize_key_part(word)[0] for word in words)
    return acronym if len(acronym) >= 2 else ""


def title_token(title: str) -> str:
    stopwords = {
        "the",
        "a",
        "an",
        "el",
        "la",
        "els",
        "les",
        "un",
        "una",
        "uns",
        "unes",
        "le",
        "de",
        "del",
        "of",
        "on",
        "in",
        "to",
        "and",
        "i",
        "y",
    }
    for token in re.findall(r"[a-zA-ZÀ-ÿ0-9]+", title or ""):
        if normalize_key_part(token) and normalize_key_part(token) not in stopwords:
            return str(token)
    return ""


def alpha_suffix(index: int) -> str:
    result = ""
    index += 1
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        result = chr(ord("a") + remainder) + result
    return result


def generate_citation_key(
    authors: Any,
    year: Any,
    title: str = "",
    existing: set[str] | None = None,
) -> str:
    raw_family = first_author_family(authors)
    family = organization_acronym(raw_family) or normalize_key_part(raw_family)
    if not family:
        family = normalize_key_part(title_token(title)) or "ref"
    normalized_year = ""
    try:
        if year not in (None, "", "null"):
            normalized_year = str(int(float(str(year))))
    except (TypeError, ValueError, OverflowError):
        normalized_year = normalize_key_part(str(year)) if year else ""
    base = f"{family}{normalized_year or 'nd'}"
    occupied = existing or set()
    if base not in occupied:
        return base
    index = 0
    while True:
        candidate = f"{base}{alpha_suffix(index)}"
        if candidate not in occupied:
            return candidate
        index += 1


def existing_citation_keys(
    active_vault_path: Callable[[], str | Path | None],
    ensure_index: Callable[[str], dict[str, object]],
) -> set[str]:
    try:
        vault_path = active_vault_path()
        if not vault_path:
            return set()
        return set(ensure_index(str(vault_path)))
    except Exception:
        return set()


def inject_citation_key(
    suggested: dict[str, Any],
    occupied: set[str],
) -> dict[str, Any]:
    if not suggested or suggested.get("Citation Key"):
        return suggested
    citation_key = generate_citation_key(
        suggested.get("Authors"),
        suggested.get("Any"),
        str(suggested.get("Title") or ""),
        occupied,
    )
    if citation_key:
        suggested["Citation Key"] = citation_key
    return suggested


__all__ = [
    "alpha_suffix",
    "first_author_family",
    "generate_citation_key",
    "existing_citation_keys",
    "inject_citation_key",
    "normalize_key_part",
    "organization_acronym",
    "title_token",
]
