"""Deterministic, localized rendering of trusted agent tool results."""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any


def _response_language(message: str) -> str:
    """Resolve a deterministic response language from strong request markers."""
    decomposed = unicodedata.normalize("NFKD", str(message or "").casefold())
    text = " ".join(
        re.sub(
            r"[^a-z0-9]+",
            " ",
            "".join(character for character in decomposed if not unicodedata.combining(character)),
        ).split()
    )
    if re.search(
        r"\b(?:soc|troba|cerca|llista|mostra|ensenya|dona|dels|quals|meus|"
        r"meves|quin|quins|quina|quines|quant|quants|quantes|tinc|amb|"
        r"analitza|noticies|totes|temes|relacionades|continua|seguents|titulacio|titulacions|tasca|tasques|"
        r"projecte|projectes|font|fonts|pagina|pagines|registre|registres)\b",
        text,
    ):
        return "ca"
    if re.search(
        r"\b(?:je|mes|ressources|trouve|cherche|affiche|auteur|combien|"
        r"quels|quelles|projets)\b",
        text,
    ):
        return "fr"
    if re.search(
        r"\b(?:soy|mis|recursos|encuentra|busca|lista|muestra|dame|autor|"
        r"cuanto|cuantos|cuantas|tengo|relacionadas|titulacion|titulaciones|"
        r"tarea|tareas|proyecto|proyectos|fuente|fuentes|pagina|paginas|"
        r"registro|registros)\b",
        text,
    ):
        return "es"
    return "en"


def _escaped_markdown_text(value: Any, fallback: str) -> str:
    """Render an untrusted record label as one inert Markdown line."""
    text = " ".join(str(value or "").split())[:500] or fallback
    return re.sub(r"([\\`*_[\]<>])", r"\\\1", text)


def _authored_resources_response(tool_content: Any, user_message: str) -> str:
    """Format the exact self-authorship payload without another model call."""
    language = _response_language(user_message)
    strings = {
        "ca": {
            "found_one": "S'ha trobat {count} recurs a la vista «{view}»:",
            "found_many": "S'han trobat {count} recursos a la vista «{view}»:",
            "empty": "No s'ha trobat cap recurs a la vista «{view}».",
            "error": "No he pogut consultar la vista de recursos d'autoria pròpia.",
            "untitled": "Sense títol",
            "more": "Es mostren {shown} de {count} recursos; encara n'hi ha més.",
        },
        "es": {
            "found_one": "Se ha encontrado {count} recurso en la vista «{view}»:",
            "found_many": "Se han encontrado {count} recursos en la vista «{view}»:",
            "empty": "No se ha encontrado ningún recurso en la vista «{view}».",
            "error": "No he podido consultar la vista de recursos de autoría propia.",
            "untitled": "Sin título",
            "more": "Se muestran {shown} de {count} recursos; todavía hay más.",
        },
        "fr": {
            "found_one": "{count} ressource a été trouvée dans la vue «{view}» :",
            "found_many": "{count} ressources ont été trouvées dans la vue «{view}» :",
            "empty": "Aucune ressource n'a été trouvée dans la vue «{view}».",
            "error": "Je n'ai pas pu consulter la vue des ressources dont vous êtes l'auteur.",
            "untitled": "Sans titre",
            "more": "{shown} ressources sur {count} sont affichées ; il en reste d'autres.",
        },
        "en": {
            "found_one": "Found {count} resource in the “{view}” view:",
            "found_many": "Found {count} resources in the “{view}” view:",
            "empty": "No resources were found in the “{view}” view.",
            "error": "I could not query the self-authored Resources view.",
            "untitled": "Untitled",
            "more": "Showing {shown} of {count} resources; more remain.",
        },
    }[language]
    try:
        payload = json.loads(str(tool_content or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return strings["error"]
    if not isinstance(payload, dict) or payload.get("error"):
        return strings["error"]
    records = payload.get("records") or []
    if not isinstance(records, list):
        return strings["error"]
    try:
        count = max(0, int(payload.get("matching_count", len(records))))
    except (TypeError, ValueError):
        count = len(records)
    active_view = payload.get("active_view") or {}
    view_name = _escaped_markdown_text(
        active_view.get("name") if isinstance(active_view, dict) else "",
        "Resources",
    )
    if count == 0:
        return strings["empty"].format(view=view_name)
    found_key = "found_one" if count == 1 else "found_many"
    lines = [strings[found_key].format(count=count, view=view_name)]
    for index, record in enumerate(records, start=1):
        row = record if isinstance(record, dict) else {}
        title = _escaped_markdown_text(row.get("title"), strings["untitled"])
        lines.append(f"{index}. {title}")
    if payload.get("has_more"):
        lines.extend(
            [
                "",
                strings["more"].format(shown=len(records), count=count),
            ]
        )
    return "\n".join(lines)


def _inventory_numbers(payload: dict[str, Any], records: list[Any]) -> tuple[int, int]:
    """Read non-negative inventory count and offset with legacy fallbacks."""
    try:
        return (
            max(0, int(payload.get("matching_count", len(records)))),
            max(0, int(payload.get("offset", 0))),
        )
    except (TypeError, ValueError):
        return len(records), 0


def _inventory_unresolved(payload: dict[str, Any]) -> list[str]:
    """Normalize unresolved record type labels for inert Markdown output."""
    return [
        _escaped_markdown_text(value, "")
        for value in (payload.get("record_types_unresolved") or [])
        if str(value or "").strip()
    ]


def _empty_inventory_lines(
    strings: dict[str, str], subject: str, unresolved: list[str]
) -> list[str]:
    """Render an empty inventory while preserving scope and unresolved types."""
    lines = [strings["empty"].format(subject=subject)]
    if unresolved:
        lines.append(strings["unresolved"].format(types=", ".join(unresolved)))
    lines.append(strings["method"])
    return lines


def _inventory_header_lines(
    strings: dict[str, str],
    count: int,
    subject: str,
    counts: dict[str, Any],
    match_counts: dict[str, Any],
) -> list[str]:
    """Render inventory totals and evidence summary."""
    found_key = "found_one" if count == 1 else "found_many"
    lines = [strings[found_key].format(count=count, subject=subject)]
    if counts:
        type_counts = ", ".join(
            f"{_escaped_markdown_text(name, 'Unknown')} ({value})"
            for name, value in sorted(counts.items(), key=lambda item: item[0].casefold())
        )
        lines.append(f"{strings['types']}: {type_counts}.")
    relation_count = int(match_counts.get("relation", 0) or 0)
    if relation_count > 0:
        lines.append(
            strings["evidence"].format(
                direct=int(match_counts.get("direct", 0) or 0),
                relation=relation_count,
            )
        )
    return lines


def _group_inventory_records(records: list[Any]) -> dict[str, list[dict[str, Any]]]:
    """Group normalized records by their escaped display type."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for raw_record in records:
        record = raw_record if isinstance(raw_record, dict) else {}
        record_type = record.get("record_type") or {}
        type_name = _escaped_markdown_text(
            record_type.get("name") if isinstance(record_type, dict) else "",
            "Unknown",
        )
        grouped.setdefault(type_name, []).append(record)
    return grouped


def _inventory_metadata_value(raw_value: Any) -> str:
    """Flatten one metadata value into the historical compact display form."""
    if isinstance(raw_value, list):
        display_items: list[str] = []
        for item in raw_value[:20]:
            if isinstance(item, dict):
                person_name = " ".join(
                    str(item.get(field) or "").strip()
                    for field in ("nom", "cognom1", "cognom2")
                    if str(item.get(field) or "").strip()
                )
                display_items.append(
                    person_name or json.dumps(item, ensure_ascii=False, default=str)
                )
            else:
                display_items.append(str(item))
        raw_value = "; ".join(display_items)
    elif isinstance(raw_value, dict):
        raw_value = json.dumps(raw_value, ensure_ascii=False, default=str)
    return _escaped_markdown_text(raw_value, "")


def _inventory_record_details(record: dict[str, Any], strings: dict[str, str]) -> list[str]:
    """Render stable identity, match kind and selected metadata fields."""
    record_id = _escaped_markdown_text(record.get("id"), "—")
    details = [f"{strings['id']}: {record_id}"]
    if record.get("match_kind") == "relation" or set(record.get("match_basis") or []) == {
        "relations"
    }:
        details.append(strings["relation"])
    raw_metadata = record.get("metadata")
    metadata: dict[str, Any] = raw_metadata if isinstance(raw_metadata, dict) else {}
    for key in ("year", "item_type", "verification_status", "author"):
        if metadata.get(key) in (None, "", [], {}):
            continue
        details.append(f"{strings[key]}: {_inventory_metadata_value(metadata[key])}")
    return details


def _inventory_record_lines(
    records: list[Any],
    counts: dict[str, Any],
    strings: dict[str, str],
    offset: int,
) -> list[str]:
    """Render grouped, consecutively numbered inventory records."""
    lines: list[str] = []
    record_number = offset + 1
    for type_name, type_records in _group_inventory_records(records).items():
        lines.extend(["", f"{type_name} ({counts.get(type_name, len(type_records))})"])
        for record in type_records:
            title = _escaped_markdown_text(record.get("title"), strings["untitled"])
            details = _inventory_record_details(record, strings)
            lines.append(f"{record_number}. {title} — " + " · ".join(details))
            record_number += 1
    return lines


def _inventory_footer_lines(
    payload: dict[str, Any],
    records: list[Any],
    count: int,
    unresolved: list[str],
    strings: dict[str, str],
) -> list[str]:
    """Render pagination, unresolved types and the exhaustive-scope note."""
    lines: list[str] = []
    if payload.get("has_more"):
        lines.extend(
            [
                "",
                strings["more"].format(
                    shown=len(records),
                    count=count,
                    offset=payload.get("next_offset"),
                ),
            ]
        )
    if unresolved:
        lines.append(strings["unresolved"].format(types=", ".join(unresolved)))
    lines.extend(["", strings["method"]])
    return lines


def _inventory_context_response(tool_content: Any, user_message: str) -> str:
    """Format one exact, paginated Vault inventory without an LLM call."""
    language = _response_language(user_message)
    strings = {
        "ca": {
            "found_one": "He trobat {count} registre que coincideix amb {subject}.",
            "found_many": "He trobat {count} registres que coincideixen amb {subject}.",
            "empty": "No he trobat cap registre que coincideixi amb {subject}.",
            "all_subject": "la petició",
            "types": "Per tipus",
            "evidence": "Coincidències: {direct} directes · {relation} per relació.",
            "relation": "relació",
            "unresolved": "No hi ha cap tipus adjunt que correspongui a: {types}.",
            "more": "Es mostren {shown} de {count}; continua des de l’índex {offset}.",
            "method": (
                "Abast: cerca exhaustiva de text, metadades i relacions " + "dins el Vault adjunt."
            ),
            "error": "No he pogut consultar l’inventari del Vault adjunt.",
            "untitled": "Sense títol",
            "id": "ID",
            "year": "any",
            "item_type": "tipus",
            "verification_status": "verificació",
            "author": "autoria",
        },
        "es": {
            "found_one": "He encontrado {count} registro que coincide con {subject}.",
            "found_many": "He encontrado {count} registros que coinciden con {subject}.",
            "empty": "No he encontrado ningún registro que coincida con {subject}.",
            "all_subject": "la petición",
            "types": "Por tipo",
            "evidence": "Coincidencias: {direct} directas · {relation} por relación.",
            "relation": "relación",
            "unresolved": "No hay ningún tipo adjunto que corresponda a: {types}.",
            "more": "Se muestran {shown} de {count}; continúa desde el índice {offset}.",
            "method": (
                "Alcance: búsqueda exhaustiva de texto, metadatos y relaciones "
                + "dentro del Vault adjunto."
            ),
            "error": "No he podido consultar el inventario del Vault adjunto.",
            "untitled": "Sin título",
            "id": "ID",
            "year": "año",
            "item_type": "tipo",
            "verification_status": "verificación",
            "author": "autoría",
        },
        "fr": {
            "found_one": "J’ai trouvé {count} enregistrement correspondant à {subject}.",
            "found_many": "J’ai trouvé {count} enregistrements correspondant à {subject}.",
            "empty": "Je n’ai trouvé aucun enregistrement correspondant à {subject}.",
            "all_subject": "la demande",
            "types": "Par type",
            "evidence": "Correspondances : {direct} directes · {relation} par relation.",
            "relation": "relation",
            "unresolved": "Aucun type joint ne correspond à : {types}.",
            "more": "{shown} résultats sur {count} sont affichés ; continuez à l’index {offset}.",
            "method": (
                "Portée : recherche exhaustive du texte, des métadonnées et des "
                + "relations du Vault joint."
            ),
            "error": "Je n’ai pas pu consulter l’inventaire du Vault joint.",
            "untitled": "Sans titre",
            "id": "ID",
            "year": "année",
            "item_type": "type",
            "verification_status": "vérification",
            "author": "auteur",
        },
        "en": {
            "found_one": "I found {count} record matching {subject}.",
            "found_many": "I found {count} records matching {subject}.",
            "empty": "I found no records matching {subject}.",
            "all_subject": "the request",
            "types": "By type",
            "evidence": "Matches: {direct} direct · {relation} through relations.",
            "relation": "relation",
            "unresolved": "No attached record type corresponds to: {types}.",
            "more": "Showing {shown} of {count}; continue from index {offset}.",
            "method": (
                "Scope: exhaustive text, metadata, and relation search within "
                + "the attached Vault data."
            ),
            "error": "I could not query the attached Vault inventory.",
            "untitled": "Untitled",
            "id": "ID",
            "year": "year",
            "item_type": "type",
            "verification_status": "verification",
            "author": "author",
        },
    }[language]
    try:
        payload = json.loads(str(tool_content or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return strings["error"]
    if not isinstance(payload, dict) or payload.get("error"):
        return strings["error"]
    records: list[Any] = payload.get("records") or []
    counts: dict[str, Any] = payload.get("counts_by_type") or {}
    match_counts: dict[str, Any] = payload.get("counts_by_match_kind") or {}
    if not isinstance(records, list) or not isinstance(counts, dict):
        return strings["error"]
    count, offset = _inventory_numbers(payload, records)
    query = _escaped_markdown_text(payload.get("query"), "")
    subject = f"«{query}»" if query else strings["all_subject"]
    unresolved = _inventory_unresolved(payload)
    if count == 0:
        return "\n".join(_empty_inventory_lines(strings, subject, unresolved))

    lines = _inventory_header_lines(strings, count, subject, counts, match_counts)
    lines.extend(_inventory_record_lines(records, counts, strings, offset))
    lines.extend(_inventory_footer_lines(payload, records, count, unresolved, strings))
    return "\n".join(lines)


def _reader_job_response(tool_content: Any, user_message: str) -> str:
    """Format a durable Reader job receipt without another model call."""
    language = _response_language(user_message)
    strings = {
        "ca": {
            "started": "L'anàlisi s'ha iniciat en segon pla.",
            "not_started": "L'anàlisi no s'ha pogut iniciar.",
            "status": "Estat de l'anàlisi: {status}.",
            "job": "ID de la feina: `{job_id}`.",
            "progress": "Progrés: {progress}%.",
            "error": "No he pogut consultar la feina d'anàlisi del Reader.",
        },
        "es": {
            "started": "El análisis se ha iniciado en segundo plano.",
            "not_started": "El análisis no se ha podido iniciar.",
            "status": "Estado del análisis: {status}.",
            "job": "ID del trabajo: `{job_id}`.",
            "progress": "Progreso: {progress}%.",
            "error": "No he podido consultar el trabajo de análisis de Reader.",
        },
        "fr": {
            "started": "L'analyse a démarré en arrière-plan.",
            "not_started": "L'analyse n'a pas pu démarrer.",
            "status": "État de l'analyse : {status}.",
            "job": "ID de la tâche : `{job_id}`.",
            "progress": "Progression : {progress} %.",
            "error": "Je n'ai pas pu consulter la tâche d'analyse de Reader.",
        },
        "en": {
            "started": "The analysis started in the background.",
            "not_started": "The analysis could not be started.",
            "status": "Analysis status: {status}.",
            "job": "Job id: `{job_id}`.",
            "progress": "Progress: {progress}%.",
            "error": "I could not inspect the Reader analysis job.",
        },
    }[language]
    try:
        payload = json.loads(str(tool_content or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return strings["error"]
    if not isinstance(payload, dict) or payload.get("error"):
        return strings["error"]
    local_id = _escaped_markdown_text(
        payload.get("job_id") or payload.get("id"),
        "",
    )
    if not local_id:
        return strings["error"]
    job_id = local_id if ":" in local_id else f"reader:{local_id}"
    status = _escaped_markdown_text(
        payload.get("status") or payload.get("state"),
        "queued",
    )
    opening = (
        strings["not_started"]
        if status.casefold() in {"cancelled", "canceled", "failed", "error"}
        else strings["started"]
    )
    lines = [opening, strings["job"].format(job_id=job_id)]
    lines.append(strings["status"].format(status=status))
    progress = payload.get("progress")
    if isinstance(progress, (int, float)):
        lines.append(strings["progress"].format(progress=max(0, min(100, int(progress)))))
    return " ".join(lines)
