"""Role-aware bibliographic names, independent of a Vault or citation renderer."""
from __future__ import annotations

from typing import Any, Mapping

from backend.services.reference_catalog import REFERENCE_CREATOR_ROLES


def role_fields(metadata: Mapping[str, Any]) -> dict[str, str]:
    roles = dict(REFERENCE_CREATOR_ROLES)
    configured = metadata.get("_citation_roles")
    if isinstance(configured, dict):
        roles.update({k: v for k, v in configured.items() if isinstance(k, str) and v in roles.values()})
    return roles


def structured_names(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [p for p in value if isinstance(p, dict) and any(k in p for k in ("nom", "cognom1", "cognom2"))]


def author_names(metadata: Mapping[str, Any]) -> list[dict[str, Any]]:
    roles = role_fields(metadata)
    for name in ("Autoría", "Autoria", "Autors", "Authors", "Author", *roles):
        if roles.get(name, "author") != "author":
            continue
        people = structured_names(metadata.get(name))
        if people:
            return people
    # Compatibility with renamed author columns predating explicit role bindings.
    for name, value in metadata.items():
        if name not in roles and structured_names(value):
            return structured_names(value)
    return []


def to_csl_names(value: object) -> list[dict[str, str]]:
    result = []
    for person in structured_names(value):
        family = " ".join(str(person.get(k) or "").strip() for k in ("cognom1", "cognom2")).strip()
        given = str(person.get("nom") or "").strip()
        if family:
            result.append({"family": family, **({"given": given} if given else {})})
        elif given:
            result.append({"literal": given})
    return result


def zotero_name(person: Mapping[str, Any]) -> dict[str, str]:
    if person.get("name"):
        return {"nom": str(person["name"]), "cognom1": "", "cognom2": ""}
    return {"nom": str(person.get("firstName") or ""), "cognom1": str(person.get("lastName") or ""), "cognom2": ""}


def text_names(value: object, *, bibtex: bool = False) -> list[str]:
    if isinstance(value, str):
        return [part.strip() for part in value.split(";") if part.strip()]
    result = []
    for name in to_csl_names(value):
        if name.get("literal"):
            literal = name["literal"]
            result.append("{" + literal + "}" if bibtex else literal)
        else:
            result.append(name["family"] + (", " + name["given"] if name.get("given") else ""))
    return result


def parse_names(value: str, *, bibtex: bool = False) -> list[dict[str, str]]:
    import re

    # BibTeX corporate names use a protected brace group; never split its 'and'.
    parts = re.split(r"\s+and\s+(?![^{}]*\})", value) if bibtex else value.split(";")
    result = []
    for raw in parts:
        raw = raw.strip()
        if not raw:
            continue
        if raw.startswith("{") and raw.endswith("}"):
            result.append({"nom": raw[1:-1], "cognom1": "", "cognom2": ""})
            continue
        if "," in raw:
            family, given = raw.split(",", 1)
        else:
            tokens = raw.split()
            family, given = tokens[-1], " ".join(tokens[:-1])
        result.append({"nom": given.strip(), "cognom1": family.strip(), "cognom2": ""})
    return result
