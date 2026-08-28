"""Creator-name normalization shared by citation providers."""

from __future__ import annotations

import re

from backend.domains.vault.citations.normalizers.types import Creator


def split_full_name(full: str) -> Creator | None:
    """Convert a natural-order full name into a Zotero creator."""
    normalized = (full or "").strip()
    if not normalized:
        return None
    parts = normalized.split()
    if len(parts) >= 2:
        return {
            "creatorType": "author",
            "lastName": parts[-1],
            "firstName": " ".join(parts[:-1]),
        }
    return {"creatorType": "author", "name": normalized}


def pubmed_name_to_creator(name: str) -> Creator | None:
    """Convert PubMed's family/initials spelling into a Zotero creator."""
    normalized = (name or "").strip()
    if not normalized:
        return None
    if "," in normalized:
        family, _, given = normalized.partition(",")
        family = family.strip()
        given = given.strip()
        if not family:
            return None
        creator: Creator = {"creatorType": "author", "lastName": family}
        if given:
            creator["firstName"] = given
        return creator
    tokens = normalized.split()
    if len(tokens) >= 2 and re.fullmatch(r"[A-Za-z]{1,4}", tokens[-1]):
        return {
            "creatorType": "author",
            "lastName": " ".join(tokens[:-1]),
            "firstName": tokens[-1],
        }
    return {"creatorType": "author", "name": normalized}


__all__ = ["pubmed_name_to_creator", "split_full_name"]
