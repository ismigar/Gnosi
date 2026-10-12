"""Extended BibTeX/RIS fields and a bounded, bibliographic-only round-trip envelope."""
from __future__ import annotations

import base64
import json
import re
from typing import Any

from backend.services.reference_catalog import REFERENCE_CREATOR_ROLES, REFERENCE_DATE_FIELDS, REFERENCE_TEXT_FIELDS, ZOTERO_CREATOR_COLUMNS
from backend.services.reference_dates import date_text, import_date, issued_date
from backend.services.reference_metadata import bibliographic_values
from backend.services.reference_names import author_names, parse_names, role_fields, text_names

BIB_FIELDS = {
    "series": "Col·lecció", "seriesnumber": "Número de col·lecció", "volumes": "Núm. volums",
    "pagetotal": "Núm. pàgines", "shorttitle": "Títol abreujat", "shortjournal": "Revista abreujada",
    "institution": "Institució", "school": "Institució", "type": "Tipus de document",
    "eventtitle": "Congrés", "venue": "Lloc del congrés", "version": "Versió",
    "urldate": "Data de consulta", "origdate": "Data original", "origpublisher": "Editorial original",
    "origlocation": "Lloc original", "abstract": "Abstract", "note": "Notes bibliogràfiques",
    "location": "Lloc", "pmid": "PMID", "pmcid": "PMCID", "rights": "Llicència",
    "archive": "Arxiu bibliogràfic", "archive_location": "Localització a l’arxiu",
    "chapter": "Número de capítol", "section": "Secció", "howpublished": "Suport",
}
BIB_ROLES = {"author": "Autoría", "editor": "Editors", "translator": "Traductors", "bookauthor": "Autors del llibre", "editora": "Editors de col·lecció"}
RIS_FIELDS = {"ET": "Edició", "AB": "Abstract", "ST": "Títol abreujat", "J2": "Revista abreujada",
              "Y2": "Data de consulta", "T3": "Col·lecció", "M1": "Número de document",
              "M3": "Tipus de document", "NV": "Núm. volums", "DB": "Arxiu bibliogràfic",
              "AN": "Localització a l’arxiu", "CN": "Signatura", "DP": "Catàleg"}
EXTRA_KEYS = {"Zotero Extras", "BibTeX Extras", "RIS Extras"}
CANONICAL = set(REFERENCE_TEXT_FIELDS) | set(REFERENCE_DATE_FIELDS) | set(REFERENCE_CREATOR_ROLES) | EXTRA_KEYS | {"Any", "Mes", "Dia", "Item Type", "Citation Key", "Authors", "Títol del llibre", "Data de publicació", "Full Citation"}


def canonical_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    values = bibliographic_values(metadata)
    result = {k: v for k, v in values.items() if k in CANONICAL}
    for name, role in role_fields(values).items():
        column = next((key for key, val in REFERENCE_CREATOR_ROLES.items() if val == role), None)
        if column and name in values:
            result[column] = values[name]
    people = author_names(values)
    if people:
        result["Autoría"] = people
        if result.get("Authors") == "; ".join(text_names(people)):
            result.pop("Authors", None)
    return result


def encode_metadata(metadata: dict[str, Any], standard: object, parsed: dict[str, Any]) -> str:
    payload = {"v": 1, "metadata": canonical_metadata(metadata), "standard": standard, "parsed": parsed}
    return base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()).decode()


def restore_metadata(out: dict[str, Any], encoded: str, standard: object) -> dict[str, Any]:
    """Restore exact names/precision only while the visible standard data matches.

    Externally edited exports win over stale embedded values. A malformed or
    oversized envelope is kept in Extras by the caller, never executed.
    """
    if len(encoded) > 2_000_000:
        return out
    try:
        payload = json.loads(base64.b64decode(encoded, altchars=b'-_', validate=True))
    except (ValueError, UnicodeError):
        return out
    if not isinstance(payload, dict) or payload.get("v") != 1 or not isinstance(payload.get("metadata"), dict):
        return out
    saved = {k: v for k, v in payload["metadata"].items() if k in CANONICAL}
    if payload.get("standard") == standard:
        if saved.get("Autoría"):
            saved.setdefault("Authors", "; ".join(text_names(saved["Autoría"])))
        return saved
    previous = payload.get("parsed")
    if not isinstance(previous, dict):
        return out
    restored = dict(out)
    for key, value in saved.items():
        if key not in previous:
            restored.setdefault(key, value)
        elif key in out and out[key] == previous[key]:
            restored[key] = value
    return restored


def import_bib_details(out: dict[str, Any], fields: dict[str, str]) -> dict[str, Any]:
    for source, column in BIB_FIELDS.items():
        if fields.get(source):
            out[column] = fields[source]
    for source, column in BIB_ROLES.items():
        if fields.get(source):
            out[column] = parse_names(fields[source], bibtex=True)
    if fields.get("date"):
        out.update(import_date(fields["date"]))
        if not import_date(fields["date"]):
            out["Data de publicació"] = fields["date"]
    for key, column in (("month", "Mes"), ("day", "Dia")):
        raw = fields.get(key, "")
        months = {name: str(index) for index, name in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
        raw = months.get(raw.lower()[:3], raw) if key == "month" else raw
        if raw.isdigit():
            out[column] = int(raw)
    if out.get("Item Type") in {"report", "thesis", "patent", "standard"} and fields.get("number"):
        out["Número de document"] = fields["number"]
        out.pop("Número", None)
    known = set(BIB_FIELDS) | set(BIB_ROLES) | {"title", "year", "date", "month", "day", "journal", "booktitle", "publisher", "address", "volume", "number", "pages", "edition", "doi", "isbn", "issn", "url", "language", "gnosimetadata"}
    extras = {k: v for k, v in fields.items() if k not in known}
    if extras:
        out["BibTeX Extras"] = extras
    standard = {k: v for k, v in fields.items() if k != "gnosimetadata"}
    standard.update({"$type": out["Item Type"], "$key": out.get("Citation Key", "")})
    encoded = fields.get("gnosimetadata", "")
    restored = restore_metadata(out, encoded, standard)
    if encoded and restored is out:
        out.setdefault("BibTeX Extras", {})["gnosimetadata"] = encoded
    return restored


def export_bib_details(metadata: dict[str, Any], fields: list[tuple[str, str]], btype: str) -> list[tuple[str, str]]:
    values = canonical_metadata(metadata)
    result = dict(fields)
    for source, column in BIB_FIELDS.items():
        if source in {"location", "school"}:
            continue
        if values.get(column):
            result[source] = str(values[column])
    if btype in {"phdthesis", "mastersthesis"} and result.get("institution"):
        result["school"] = result.pop("institution")
    if values.get("Número de document"):
        result["number"] = str(values["Número de document"])
    for field, column in BIB_ROLES.items():
        people = text_names(values.get(column), bibtex=True)
        if people:
            result[field] = " and ".join(people)
    date = date_text(issued_date(values))
    if date and (values.get("Mes") or values.get("Dia") or not re.fullmatch(r"-?\d{1,4}", date)):
        result["date"] = date
    for field, column in (("month", "Mes"), ("day", "Dia")):
        if values.get(column):
            result[field] = str(values[column])
    extras = values.get("BibTeX Extras")
    if isinstance(extras, dict):
        for key, value in extras.items():
            if re.fullmatch(r"[A-Za-z][\w-]*", key) and key != "gnosimetadata":
                result.setdefault(key, str(value))
    return list(result.items())


def ris_roles(item_type: str) -> dict[str, str]:
    """Use type-specific RIS creator tags, following Zotero's RIS translator."""
    columns = ZOTERO_CREATOR_COLUMNS.get(item_type, {})
    primary = {
        "film": "director", "tvBroadcast": "director", "radioBroadcast": "director",
        "videoRecording": "director", "audioRecording": "composer", "podcast": "podcaster",
    }.get(item_type, "author")
    roles = {"AU": columns.get(primary, "Autoría"), "A1": columns.get(primary, "Autoría")}
    secondary = {
        "book": "seriesEditor", "report": "seriesEditor", "audioRecording": "performer",
        "presentation": "presenter", "interview": "interviewer", "email": "recipient",
        "instantMessage": "recipient", "letter": "recipient", "bill": "sponsor",
    }.get(item_type, "editor" if item_type in {"journalArticle", "bookSection", "conferencePaper", "dictionaryEntry", "document", "encyclopediaArticle"} else "")
    tertiary = "seriesEditor" if item_type in {"bookSection", "conferencePaper", "dictionaryEntry", "encyclopediaArticle", "map"} else {
        "book": "editor", "thesis": "contributor", "film": "producer", "tvBroadcast": "producer",
        "radioBroadcast": "producer", "videoRecording": "producer",
    }.get(item_type, "")
    for tag, creator in (("A2", secondary), ("A3", tertiary)):
        if creator in columns:
            roles[tag] = columns[creator]
    roles["A4"] = "Col·laboradors de l’obra" if item_type in {"conferencePaper", "film", "dataset"} else "Traductors"
    if item_type == "case":
        roles.pop("A4")  # Legal counsel is retained as an unsupported creator tag.
    if item_type == "bookSection":
        roles["C2"] = "Autors del llibre"
    if item_type in {"tvBroadcast", "radioBroadcast", "videoRecording"}:
        roles["C1"] = "Intèrprets"
    return roles


def import_ris_details(out: dict[str, Any], tags: dict[str, list[str]]) -> dict[str, Any]:
    for tag, column in RIS_FIELDS.items():
        if tags.get(tag):
            out[column] = tags[tag][0]
    for tag, column in ris_roles(str(out.get("Item Type") or "")).items():
        if tags.get(tag):
            people = [person for value in tags[tag] for person in parse_names(value)]
            out.setdefault(column, []).extend(people)
            if column != "Autoría" and tag in {"AU", "A1"}:
                out.pop("Authors", None)
    raw = next((tags[t][0] for t in ("PY", "Y1", "DA") if tags.get(t)), "")
    parts = import_date(raw)
    if parts:
        out.update(parts)
    elif raw:
        out["Data de publicació"] = raw
    if out.get("Item Type") in {"report", "thesis"} and out.get("Editorial"):
        out["Institució"] = out.pop("Editorial")
    if out.get("Item Type") == "conferencePaper":
        if tags.get("T2"):
            out["Congrés"] = tags["T2"][0]
        if tags.get("C3"):
            out["Llibre/Revista"] = tags["C3"][0]
        if tags.get("C1"):
            out["Lloc"] = tags["C1"][0]
    known = set(RIS_FIELDS) | set(ris_roles(str(out.get("Item Type") or ""))) | {"TY", "ER", "ID", "TI", "T1", "PY", "Y1", "DA", "JO", "JF", "T2", "PB", "CY", "PP", "VL", "IS", "SP", "EP", "DO", "SN", "UR", "LA", "GN"}
    roles = ris_roles(str(out.get("Item Type") or ""))
    extras = {k: v for k, v in tags.items() if k not in known or (len(v) > 1 and k not in roles)}
    if extras:
        out["RIS Extras"] = extras
    standard = {k: v for k, v in tags.items() if k not in {"GN", "ER"}}
    encoded = (tags.get("GN") or [""])[0]
    restored = restore_metadata(out, encoded, standard)
    if encoded and restored is out:
        out.setdefault("RIS Extras", {})["GN"] = [encoded]
    return restored


def export_ris_details(metadata: dict[str, Any], lines: list[str], item_type: str) -> list[str]:
    values = canonical_metadata(metadata)
    lines = [line for line in lines if not line.startswith(("AU  -", "PY  -", "ER  -"))]
    for tag, column in RIS_FIELDS.items():
        if values.get(column):
            lines.append(f"{tag}  - {values[column]}")
    roles = ris_roles(item_type)
    for tag, column in roles.items():
        if tag == "A1":
            continue
        for person in text_names(values.get(column)):
            lines.append(f"{tag}  - {person}")
    # Legacy textual author records still export without structured columns.
    if not values.get(roles["AU"]) and values.get("Authors"):
        lines.extend(f"AU  - {person}" for person in text_names(values["Authors"]))
    date = date_text(issued_date(values))
    if date:
        lines.append(f"PY  - {date.replace('-', '/') if re.fullmatch(r'[0-9-]+', date) else date}")
    if values.get("Institució"):
        lines = [line for line in lines if not line.startswith("PB  -")]
        lines.append(f"PB  - {values['Institució']}")
    if item_type == "conferencePaper":
        for tag, column in (("T2", "Congrés"), ("C3", "Llibre/Revista"), ("C1", "Lloc")):
            if values.get(column):
                lines.append(f"{tag}  - {values[column]}")
    existing = {line[:2] for line in lines}
    extras = values.get("RIS Extras")
    if isinstance(extras, dict):
        for tag, items in extras.items():
            if re.fullmatch(r"[A-Z][A-Z0-9]", tag) and tag not in {"GN", "ER"} and isinstance(items, list):
                remaining = items[1:] if tag in existing else items
                lines.extend(f"{tag}  - {value}" for value in remaining)
    # Preserve logical multiline fields as RIS continuations, not injected tags.
    lines = [line.replace('\r', '').replace('\n', '\n      ') for line in lines]
    return lines
