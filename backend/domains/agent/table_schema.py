"""Exact schema requests and responses, independent of record search."""
from __future__ import annotations

import re
from typing import Any


def schema_request_arguments(text: str) -> dict[str, Any] | None:
    """Accept a complete read request for a named table's field definitions."""
    verb = r"(?:llista(?: m)?|llistar|mostra(?: m)?|lista(?: me)?|muestra(?: me)?|list|show(?: me)?|quines son|cuales son|what are|affiche(?: moi)?|liste(?: moi)?|quelles sont)"
    fields = r"(?:propietats|propiedades|properties|camps|campos|fields|proprietes|champs|columns|columnes|columnas|colonnes)"
    prefix = rf"^{verb}\b.*?\b{fields}\s+(?:de la|de|of the|of|dans la|du|de la)\s+"
    match = re.fullmatch(prefix + r"(?:taula|tabla|table)\s+(.+)", text)
    if match is None:
        match = re.fullmatch(prefix + r"(.+?)\s+table", text)
    if match is None:
        return None
    return {"query": "", "record_types": [match.group(1).strip()], "schema_only": True}


def schema_response(payload: dict[str, Any], language: str) -> str:
    labels = {
        "ca": ("Propietats", "La taula no està disponible en el context adjunt", "La taula no té propietats definides"),
        "es": ("Propiedades", "La tabla no está disponible en el contexto adjunto", "La tabla no tiene propiedades definidas"),
        "en": ("Properties", "The table is not available in the attached context", "The table has no defined properties"),
        "fr": ("Propriétés", "La table n’est pas disponible dans le contexte joint", "La table n’a pas de propriétés définies"),
    }[language]
    tables = payload.get("tables") or []
    if not tables or payload.get("record_types_unresolved"):
        return labels[1] + "."
    sections = []
    for table in tables:
        lines = [f"{labels[0]} · {table['name']}"]
        for field in table["fields"]:
            line = f"- {field.get('name') or field.get('id')} — {field.get('type', '?')}"
            if field.get("options"):
                line += ": " + ", ".join(str(option.get("name") or option.get("id")) for option in field["options"])
            if field.get("relation_database_id"):
                line += f" → {field['relation_database_id']}"
            lines.append(line)
        if not table["fields"]:
            lines.append(labels[2] + ".")
        sections.append("\n".join(lines))
    return "\n\n".join(sections)
