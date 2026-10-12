"""Author normalization and Recursos-to-CSL mapping."""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from typing import Any, TypeVar

from backend.domains.vault.registry.records import RecordReader, is_object_list, is_record
from backend.services.reference_names import role_fields
from backend.services.reference_metadata import bibliographic_values, csl_details

MetadataKey = TypeVar("MetadataKey", str, object)


def parse_authors_to_csl(authors_str: str) -> list[dict[str, str]]:
    if not authors_str or not isinstance(authors_str, str):
        return []
    parts = (
        [value.strip() for value in authors_str.split(";") if value.strip()]
        if ";" in authors_str
        else [authors_str.strip()]
    )
    result: list[dict[str, str]] = []
    for author in parts:
        if ", " in author and len(author.split(",")) == 2:
            family, given = [value.strip() for value in author.split(",", 1)]
            if family:
                result.append({"family": family, "given": given})
        elif "," in author:
            for subauthor in [value.strip() for value in author.split(",") if value.strip()]:
                tokens = subauthor.split()
                result.append(
                    {"family": tokens[0]}
                    if len(tokens) == 1
                    else {"family": tokens[-1], "given": " ".join(tokens[:-1])}
                )
        else:
            tokens = author.split()
            result.append(
                {"family": tokens[0]}
                if len(tokens) == 1
                else {"family": tokens[-1], "given": " ".join(tokens[:-1])}
            )
    return result


def normalize_authors_field(value: object) -> str:
    if isinstance(value, str):
        return value

    def one(author: object) -> str:
        if isinstance(author, dict):
            family = " ".join(
                part
                for part in (
                    str(author.get("cognom1") or "").strip(),
                    str(author.get("cognom2") or "").strip(),
                )
                if part
            ).strip()
            given = str(author.get("nom") or "").strip()
            return f"{family}, {given}" if family and given else family or given
        return str(author or "").strip()

    if isinstance(value, list):
        return "; ".join(name for name in (one(item) for item in value) if name)
    return one(value)


def find_structured_authors(
    metadata: dict[MetadataKey, object],
) -> list[dict[object, object]]:
    roles = role_fields({str(k): v for k, v in metadata.items()})
    ordered = sorted(metadata.items(), key=lambda pair: 0 if str(pair[0]) in ("Autoría", "Autoria", "Authors") else 1)
    for name, value in ordered:
        if roles.get(str(name), "author") != "author":
            continue
        if is_object_list(value) and any(
            is_record(author) and any(key in author for key in ("cognom1", "cognom2", "nom"))
            for author in value
        ):
            return [author for author in value if is_record(author)]
    return []


def structured_authors_to_csl(
    authors: Sequence[RecordReader],
) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for author in authors:
        family = " ".join(
            part
            for part in (
                str(author.get("cognom1") or "").strip(),
                str(author.get("cognom2") or "").strip(),
            )
            if part
        )
        given = str(author.get("nom") or "").strip()
        if not family and not given:
            continue
        if not family:
            result.append({"literal": given})
            continue
        entry = {"family": family}
        if given:
            entry["given"] = given
        result.append(entry)
    return result


def recursos_metadata_to_csl(
    title: str,
    metadata: dict[str, Any],
    resolve_csl_type: Callable[[object], str],
) -> dict[str, Any] | None:
    metadata = bibliographic_values(metadata)
    citation_key = metadata.get("Citation Key")
    if not citation_key:
        return None
    item: dict[str, Any] = {
        "id": citation_key,
        "type": resolve_csl_type(metadata.get("Item Type", "")),
        "title": title or metadata.get("Title") or "",
    }
    authors = structured_authors_to_csl(find_structured_authors(metadata))
    if not authors:
        authors = parse_authors_to_csl(str(metadata.get("Authors") or ""))
    if authors:
        item["author"] = authors
    item.update(csl_details(metadata))
    item["title"] = title or metadata.get("Title") or ""
    return item


__all__ = [
    "find_structured_authors",
    "normalize_authors_field",
    "parse_authors_to_csl",
    "recursos_metadata_to_csl",
    "structured_authors_to_csl",
]
