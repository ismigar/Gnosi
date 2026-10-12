#!/usr/bin/env python3
"""Generate the shared Resources field catalog from the pinned Zotero/CSL schema."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]

# Persisted column names, matching the existing Resources frontmatter contract.
TEXT_COLUMNS = {
    "title": "Title", "container-title": "Llibre/Revista", "publisher": "Editorial",
    "publisher-place": "Lloc", "volume": "Volum", "issue": "Número", "page": "Pàgines",
    "edition": "Edició", "DOI": "DOI", "ISBN": "ISBN", "ISSN": "ISSN", "PMID": "PMID",
    "PMCID": "PMCID", "URL": "URL", "language": "Idioma", "abstract": "Abstract",
    "archive": "Arxiu bibliogràfic", "archive_location": "Localització a l’arxiu",
    "authority": "Autoritat", "call-number": "Signatura", "chapter-number": "Número de capítol",
    "collection-title": "Col·lecció", "collection-number": "Número de col·lecció",
    "dimensions": "Durada o dimensions", "event-place": "Lloc del congrés",
    "event-title": "Congrés", "genre": "Tipus de document", "journalAbbreviation": "Revista abreujada",
    "license": "Llicència", "medium": "Suport", "note": "Notes bibliogràfiques",
    "number": "Número de document", "number-of-pages": "Núm. pàgines",
    "number-of-volumes": "Núm. volums", "original-publisher": "Editorial original",
    "original-publisher-place": "Lloc original", "part-number": "Número de part",
    "part-title": "Títol de la part", "references": "Referències relacionades", "scale": "Escala",
    "section": "Secció", "source": "Catàleg", "status": "Estat de publicació",
    "title-short": "Títol abreujat", "version": "Versió",
}
DATE_COLUMNS = {"accessed": "Data de consulta", "original-date": "Data original", "submitted": "Data de presentació"}
CREATOR_COLUMNS = {
    "author": "Autoría", "editor": "Editors", "translator": "Traductors",
    "container-author": "Autors del llibre", "collection-editor": "Editors de col·lecció",
    "director": "Directors", "producer": "Productors", "executive-producer": "Productors executius",
    "composer": "Compositors", "interviewer": "Entrevistadors", "recipient": "Destinataris",
    "performer": "Intèrprets", "host": "Presentadors", "guest": "Convidats", "narrator": "Narradors",
    "organizer": "Organitzadors", "chair": "Presidents de sessió", "script-writer": "Guionistes",
    "original-author": "Autors originals", "reviewed-author": "Autors ressenyats",
    "series-creator": "Creadors de sèrie", "contributor": "Col·laboradors de l’obra",
}


def derive(schema: dict[str, Any]) -> dict[str, Any]:
    csl = schema["csl"]
    texts = {column: variable for variable, column in TEXT_COLUMNS.items()}
    candidates = {column: list(csl["fields"]["text"][variable]) for variable, column in TEXT_COLUMNS.items()}
    # Expand type-specific names (university, reportNumber, websiteTitle, etc.).
    for item in schema["itemTypes"]:
        for field in item.get("fields", []):
            base = field.get("baseField")
            for names in candidates.values():
                if base in names and field["field"] not in names:
                    names.append(field["field"])
    # Separate institutions from commercial publishers without renaming existing data.
    candidates["Institució"] = ["university", "institution"]
    texts["Institució"] = "publisher"
    candidates["Editorial"] = [f for f in candidates["Editorial"] if f not in candidates["Institució"]]
    dates = {column: variable for variable, column in DATE_COLUMNS.items()}
    for variable, column in DATE_COLUMNS.items():
        candidates[column] = [csl["fields"]["date"][variable]]
    roles = {column: role for role, column in CREATOR_COLUMNS.items()}
    creator_columns: dict[str, dict[str, str]] = {}
    relevant = {}
    for item in schema["itemTypes"]:
        key = item["itemType"]
        fields = {f["field"] for f in item.get("fields", [])}
        relevant[key] = [name for name, sources in candidates.items() if fields.intersection(sources)]
        creator_columns[key] = {}
        for creator in item.get("creatorTypes", []):
            source = creator["creatorType"]
            role = csl["names"].get(source) or ("author" if creator.get("primary") else None)
            if role in CREATOR_COLUMNS:
                column = CREATOR_COLUMNS[role]
                creator_columns[key][source] = column
                if column not in relevant[key]:
                    relevant[key].append(column)
        if "date" in fields:
            relevant[key].extend(["Any", "Mes", "Dia"])
    return {
        "REFERENCE_TEXT_FIELDS": texts,
        "REFERENCE_DATE_FIELDS": dates,
        "REFERENCE_DATE_SOURCES": {"issued": ["date", *dict.fromkeys(f["field"] for item in schema["itemTypes"] for f in item.get("fields", []) if f.get("baseField") == "date")]},
        "REFERENCE_CREATOR_ROLES": roles,
        "REFERENCE_ZOTERO_FIELDS": candidates,
        "ZOTERO_CREATOR_COLUMNS": creator_columns,
        "REFERENCE_TYPE_FIELDS": relevant,
    }


def main() -> None:
    schema = json.loads((ROOT / "pipeline/skills/zotero_schema/schema.json").read_text())
    constants = derive(schema)
    header = "GENERATED — DO NOT EDIT. Run pipeline/skills/zotero_schema/scripts/build_reference_catalog.py."
    py = [f'"""{header}"""', ""]
    ts = [f"// {header}", ""]
    for name, value in constants.items():
        if name in {"REFERENCE_ZOTERO_FIELDS", "REFERENCE_TYPE_FIELDS", "REFERENCE_DATE_SOURCES"}:
            python_type, ts_type = "dict[str, list[str]]", "Readonly<Record<string, readonly string[]>>"
        elif name == "ZOTERO_CREATOR_COLUMNS":
            python_type, ts_type = "dict[str, dict[str, str]]", "Readonly<Record<string, Readonly<Record<string, string>>>>"
        else:
            python_type, ts_type = "dict[str, str]", "Readonly<Record<string, string>>"
        py.append(f"{name}: {python_type} = {{")
        ts.append(f"export const {name}: {ts_type} = {{")
        for key, val in value.items():
            py.append(f"    {key!r}: {val!r},")
            ts.append(f"    {json.dumps(key, ensure_ascii=False)}: {json.dumps(val, ensure_ascii=False)},")
        py.extend(["}", ""])
        ts.extend(["};", ""])
    (ROOT / "backend/services/reference_catalog.py").write_text("\n".join(py))
    (ROOT / "frontend/src/generated/referenceCatalog.ts").write_text("\n".join(ts))


if __name__ == "__main__":
    main()
