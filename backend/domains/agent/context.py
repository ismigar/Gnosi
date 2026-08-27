"""Deterministic context planning and server-owned tool calls."""

from __future__ import annotations

import json
import re
import time
import unicodedata
from typing import Any, Iterable, Optional

from backend.agent.turn_contract import build_turn_plan
from backend.domains.agent.intent import (
    _normalized_request_text,
    _obvious_route,
    _request_mode,
)
from backend.domains.agent.responses import _response_language
from backend.domains.agent.write_intent import _reader_context_analysis_requested


def _latest_context_tool_since_latest_user(
    messages: Iterable[Any],
    context_tool_names: set[str],
) -> str:
    """Return the newest context tool used during the current human turn."""
    for message in reversed(list(messages)):
        message_type = str(getattr(message, "type", "") or "")
        if message_type == "human":
            return ""
        tool_name = str(getattr(message, "name", "") or "")
        if message_type == "tool" and tool_name in context_tool_names:
            return tool_name
    return ""


def _context_tool_used_since_latest_user(
    messages: Iterable[Any],
    context_tool_names: set[str],
) -> bool:
    """Return whether the current human turn already inspected attached context."""
    return bool(_latest_context_tool_since_latest_user(messages, context_tool_names))


def _tool_results_since_latest_user(messages: Iterable[Any]) -> int:
    """Count completed tool calls in the current human turn."""
    count = 0
    for message in reversed(list(messages)):
        message_type = str(getattr(message, "type", "") or "")
        if message_type == "human":
            break
        if message_type == "tool":
            count += 1
    return count


def _model_messages_since_latest_user(messages: Iterable[Any]) -> int:
    """Count assistant model turns in the current human turn."""
    count = 0
    for message in reversed(list(messages)):
        message_type = str(getattr(message, "type", "") or "")
        if message_type == "human":
            break
        if message_type == "ai":
            count += 1
    return count


def _latest_reader_analysis_job_id(messages: Iterable[Any]) -> str:
    """Return the newest durable Reader job id visible in conversation history."""
    for message in reversed(list(messages)):
        matches = re.findall(
            r"\b[a-f0-9]{32}\b",
            str(getattr(message, "content", "") or "").lower(),
        )
        if matches:
            return str(matches[-1])
    return ""


def _required_reader_context_tool(message: str) -> str:
    """Choose the first mandatory Reader operation for the current request."""
    text = " ".join((message or "").strip().lower().split())
    job_id_present = bool(re.search(r"\b[a-f0-9]{32}\b", text))
    if job_id_present and re.search(
        r"\b(?:resultat|resultado|result|rapport|report|informe)\b",
        text,
    ):
        return "read_reader_context_analysis"
    if job_id_present and re.search(
        r"\b(?:estat|estado|status|progr[eé]s|progreso|progress)\b"
        r"|\b(?:com|c[oó]mo|how)\s+va\b|\bhow\s+is\s+it\s+going\b",
        text,
    ):
        return "reader_context_analysis_status"
    if _reader_context_analysis_requested(text):
        return "start_reader_context_analysis"
    if re.search(
        r"\b(?:article|article|art[ií]culo|not[ií]cia|noticia|reader)\s*"
        r"(?:#|n[uú]m(?:ero)?\.?\s*)?\d+\b",
        text,
    ):
        return "read_reader_context_article"
    if re.search(
        r"\b(?:busca|cerca|troba|search|find|chercher|cherche|sobre|about|"
        r"cont(?:é|iene|ains)|que\s+parlen|que\s+hablan)\b",
        text,
    ):
        return "search_reader_context"
    if re.search(
        r"\b(?:quants?|quantes?|cu[aá]nt[oa]s?|how\s+many|combien|count|total|"
        r"categories|categor[ií]as|fonts|fuentes|feeds|llegides|le[ií]das|read|"
        r"pendents|pendientes|unread)\b",
        text,
    ):
        return "inspect_reader_context"
    return "search_reader_context"


def build_agent_turn_plan(
    message: str,
    *,
    context_refs: Iterable[dict[str, Any]] = (),
    tool_metadata: Iterable[dict[str, Any]] = (),
    authorized_tool_names: Iterable[str] = (),
    provider: str = "",
    required_tool_name: str = "",
    route: str = "",
) -> dict[str, Any]:
    """Build the effective universal plan from current request and runtime."""
    refs = list(context_refs or ())
    mode = _request_mode(message)
    required = str(required_tool_name or "")
    has_reader_context = any(
        ref.get("type") == "internal" and ref.get("ref") == "reader" for ref in refs
    )
    has_notebook_context = any(ref.get("type") == "notebook" for ref in refs)
    has_vault_context = any(
        ref.get("type") in {"page", "table", "database", "vault"} for ref in refs
    )
    has_other_context = any(ref.get("type") in {"file", "url", "source"} for ref in refs)
    if not required and has_notebook_context and mode != "action":
        required = "search_notebook_context"
    elif not required and mode in {"lookup", "inventory", "analysis"}:
        if has_reader_context and (_reader_context_requested(message) or not has_vault_context):
            required = _required_reader_context_tool(message)
        elif has_vault_context and _vault_context_is_relevant(message):
            required = _required_vault_context_tool(message, refs)
        elif has_other_context:
            required = _required_generic_context_tool(refs)
    effective_route = route or _obvious_route(message, has_context=bool(refs))
    if not effective_route and not refs and mode != "action":
        effective_route = "General"
    return dict(
        build_turn_plan(
            message,
            mode=mode,
            context_refs=refs,
            tool_metadata=tool_metadata,
            authorized_tool_names=authorized_tool_names,
            provider=provider,
            required_tool_name=required,
            route=effective_route or "",
        )
    )


INVENTORY_REQUEST_TYPE_PATTERNS = {
    "source": (
        r"\b(?:recurs(?:os)?|resource(?:s)?|ressource(?:s)?|font(?:s)?|"
        r"fuente(?:s)?|source(?:s)?)\b"
    ),
    "note": r"\b(?:nota(?:s)?|note(?:s)?)\b",
    "article": r"\b(?:article(?:s)?|articulo(?:s)?)\b",
    "task": r"\b(?:tasca(?:s)?|tarea(?:s)?|task(?:s)?)\b",
    "project": r"\b(?:projecte(?:s)?|proyecto(?:s)?|project(?:s)?|projet(?:s)?)\b",
    "qualification": (
        r"\b(?:titulacio(?:ns)?|titulacion(?:es)?|qualification(?:s)?|"
        r"degree(?:s)?|diploma(?:s)?)\b"
    ),
    "area": r"\b(?:area(?:s)?|arees)\b",
}


INVENTORY_QUERY_STOPWORDS = {
    "a",
    "ai",
    "aquesta",
    "aquest",
    "al",
    "all",
    "amb",
    "and",
    "author",
    "autor",
    "auteur",
    "avons",
    "busca",
    "buscame",
    "buscar",
    "cerca",
    "cherche",
    "com",
    "con",
    "contain",
    "contains",
    "contenen",
    "contienen",
    "count",
    "cuantas",
    "cuantos",
    "de",
    "del",
    "dels",
    "dont",
    "do",
    "el",
    "els",
    "en",
    "encuentra",
    "encuentrame",
    "encontrar",
    "encuentres",
    "enumerate",
    "es",
    "every",
    "find",
    "have",
    "in",
    "he",
    "hi",
    "how",
    "i",
    "jo",
    "la",
    "las",
    "le",
    "les",
    "list",
    "affiche",
    "dame",
    "display",
    "dona",
    "ensenya",
    "give",
    "lista",
    "j",
    "je",
    "llista",
    "m",
    "ma",
    "matching",
    "me",
    "mes",
    "meus",
    "meves",
    "mi",
    "mia",
    "mias",
    "mio",
    "mios",
    "mis",
    "moi",
    "mon",
    "como",
    "comment",
    "mostra",
    "muestra",
    "show",
    "literal",
    "literalment",
    "mencionan",
    "mencionen",
    "mention",
    "my",
    "of",
    "per",
    "que",
    "quantes",
    "quants",
    "quelles",
    "quels",
    "quines",
    "quins",
    "quina",
    "quin",
    "related",
    "relacion",
    "relacionada",
    "relacionadas",
    "relacionades",
    "relacionado",
    "relacionados",
    "relatives",
    "acerca",
    "una",
    "un",
    "search",
    "soc",
    "sobre",
    "soy",
    "te",
    "tenemos",
    "tenim",
    "tengo",
    "tienes",
    "the",
    "this",
    "tinc",
    "todas",
    "todo",
    "todos",
    "totes",
    "tots",
    "troba",
    "trouve",
    "which",
    "with",
    "written",
    "escrites",
    "escritos",
    "escriure",
    "wrote",
    "vaig",
    "y",
}


def _inventory_request_arguments(message: str) -> dict[str, Any]:
    """Extract generic record types and subject terms from an inventory request."""
    text = _normalized_request_text(message)
    include_relations = not bool(
        re.search(
            r"\b(?:literal|literalment|exact text|text exacte|texto exacto|"
            r"contenen|contienen|contain|contains|mencionen|mencionan|mention)\b",
            text,
        )
    )
    offset_match = re.search(r"\b(?:index|offset)\s+(\d{1,9})\b", text)
    requested_offset = int(offset_match.group(1)) if offset_match else 0
    text = re.sub(r"\b(?:index|offset)\s+\d{1,9}\b", " ", text)
    record_types = [
        record_type
        for record_type, pattern in INVENTORY_REQUEST_TYPE_PATTERNS.items()
        if re.search(pattern, text)
    ]
    # Remove actual type spans, then filter multilingual intent scaffolding.
    subject = text
    for pattern in INVENTORY_REQUEST_TYPE_PATTERNS.values():
        subject = re.sub(pattern, " ", subject)
    subject = re.sub(
        r"\b(?:registre|registres|registro|registros|record|records|"
        r"taula|taules|tabla|tablas|table|tables|fila|files|row|rows|"
        r"pagina|pagines|paginas|page|pages)\b",
        " ",
        subject,
    )
    query_tokens = [token for token in subject.split() if token not in INVENTORY_QUERY_STOPWORDS]
    return {
        "query": " ".join(query_tokens)[:500],
        "record_types": record_types,
        "include_relations": include_relations,
        "offset": requested_offset,
        "limit": 100,
    }


def _inventory_continuation_requested(message: str) -> bool:
    """Recognize a request for the next page of the previous inventory."""
    text = _normalized_request_text(message)
    return bool(
        re.search(
            r"\b(?:continua|continuar|seguents|seguent|next|more|siguientes|"
            r"siguiente|continue|suite|encore)\b",
            text,
        )
    )


def _reader_context_requested(message: str) -> bool:
    """Return whether the turn explicitly targets an attached Reader source."""
    text = _normalized_request_text(message)
    return bool(
        re.search(
            r"\b(?:reader|news|noticia|noticias|noticies|rss|feed|feeds|"
            r"llegida|llegides|leida|leidas|unread)\b",
            text,
        )
    )


def _vault_context_is_relevant(message: str) -> bool:
    """Avoid forcing the default Vault onto an explicit non-Vault request."""
    text = _normalized_request_text(message)
    non_vault_signal = re.search(
        r"\b(?:mail|email|correu|correus|correo|inbox|calendar|calendari|"
        r"calendario|event|esdeveniment|evento|contact|contacte|contacto|"
        r"weather|forecast|temps|tiempo|meteo|notion|zotero|internet|"
        r"browser|navegador|reader|news|noticia|noticias|noticies|rss|"
        r"feed|feeds)\b",
        text,
    )
    explicit_vault_container = re.search(
        r"\b(?:vault|wiki|taula|taules|tabla|tablas|table|tables|database|"
        r"registre|registres|registro|registros|record|records|recurs|"
        r"recursos|resource|resources|pagina|pagines|page|pages|nota|notes|"
        r"notas|document|documents|pdf)\b",
        text,
    )
    if non_vault_signal and not explicit_vault_container:
        return False
    vault_signal = re.search(
        r"\b(?:vault|wiki|pagina|pagines|page|pages|nota|notes|notas|"
        r"document|documents|pdf|taula|taules|tabla|tablas|table|tables|"
        r"database|registre|registres|registro|registros|record|records|"
        r"recurs|recursos|resource|resources|font|fonts|fuente|fuentes|"
        r"source|sources|projecte|projectes|proyecto|proyectos|project|"
        r"projects|tasca|tasques|tarea|tareas|task|tasks|titulacio|"
        r"titulacions|titulacion|titulaciones|qualification|qualifications)\b",
        text,
    )
    if vault_signal:
        return True
    return not bool(non_vault_signal)


def _required_vault_context_tool(
    message: str,
    context_refs: Iterable[dict[str, Any]],
    inventory_continuation: bool = False,
) -> str:
    """Choose the first deterministic operation for attached Vault context."""
    refs = list(context_refs or [])
    has_inventory_source = any(ref.get("type") in {"table", "database", "vault"} for ref in refs)
    if has_inventory_source and (inventory_continuation or _request_mode(message) == "inventory"):
        return "inventory_context"
    if len(refs) == 1 and refs[0].get("type") == "page":
        return "read_context_source"
    return "search_context"


def _required_generic_context_tool(
    context_refs: Iterable[dict[str, Any]],
) -> str:
    """Choose first evidence access for file, URL, or searchable source refs."""
    refs = [ref for ref in (context_refs or []) if ref.get("type") in {"file", "url", "source"}]
    if len(refs) == 1 and refs[0].get("type") in {"file", "url"}:
        return "read_context_source"
    if len(refs) == 1 and refs[0].get("type") == "source":
        return "search_context_source"
    return "search_context"


def _deterministic_vault_context_call(
    tool_name: str,
    context_refs: Iterable[dict[str, Any]],
    message: str = "",
    inventory_arguments: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Build an exact initial Vault read without relying on model tool choice."""
    if tool_name == "inventory_context" and any(
        ref.get("type") in {"table", "database", "vault"} for ref in (context_refs or [])
    ):
        return {
            "name": tool_name,
            "args": dict(inventory_arguments or _inventory_request_arguments(message)),
            "id": f"gnosi-context-inventory-{time.time_ns()}",
            "type": "tool_call",
        }
    source_type = {
        "query_context_table": "table",
        "read_context_source": "page",
    }.get(tool_name)
    if not source_type:
        return None
    source_ref = next(
        (
            str(ref.get("id") or ref.get("ref") or "").strip()
            for ref in (context_refs or [])
            if ref.get("type") == source_type and ref.get("ref")
        ),
        "",
    )
    if not source_ref:
        return None
    arguments: dict[str, Any] = {"source_id": source_ref}
    if tool_name == "query_context_table":
        arguments.update({"offset": 0, "limit": 100})
    return {
        "name": tool_name,
        "args": arguments,
        "id": f"gnosi-context-{time.time_ns()}",
        "type": "tool_call",
    }


def _deterministic_reader_context_call(
    tool_name: str,
    message: str,
) -> dict[str, Any] | None:
    """Build safe server-owned Reader calls that need no model extraction."""
    arguments: dict[str, Any]
    if tool_name == "inspect_reader_context":
        arguments = {}
    elif tool_name == "start_reader_context_analysis":
        languages = {
            "ca": "Catalan",
            "es": "Spanish",
            "fr": "French",
            "en": "English",
        }
        arguments = {
            "request": str(message or "").strip()[:12_000],
            "language": languages.get(_response_language(message), "English"),
        }
    elif tool_name in {
        "reader_context_analysis_status",
        "read_reader_context_analysis",
    }:
        match = re.search(r"(?:reader:)?([a-f0-9]{32})", str(message or "").lower())
        if not match:
            return None
        arguments = {"job_id": match.group(1)}
    else:
        return None
    return {
        "name": tool_name,
        "args": arguments,
        "id": f"gnosi-reader-{time.time_ns()}",
        "type": "tool_call",
    }


def _personal_resource_authorship_requested(message: str) -> bool:
    """Recognize a first-person authored-resources request across UI locales."""
    decomposed = unicodedata.normalize("NFKD", str(message or "").casefold())
    text = "".join(character for character in decomposed if not unicodedata.combining(character))
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if not re.search(r"\b(?:recurs\w*|resource\w*|ressource\w*)\b", text):
        return False
    return bool(
        re.search(
            r"\b(?:soc|soy|jo|meus|meves|mis|mios|mias|my|mine|i am|"
            r"authored by me|mes|je suis)\b.{0,48}\b(?:autor\w*|author\w*|auteur\w*)\b"
            r"|\b(?:autor\w*|author\w*|auteur\w*)\b.{0,48}\b(?:me|my|mine|mes)\b",
            text,
        )
    )


def _deterministic_personal_resources_call() -> dict[str, Any]:
    """Build the server-owned self-authorship operation for the current turn."""
    return {
        "name": "list_authored_vault_resources",
        "args": {"offset": 0, "limit": 100},
        "id": f"gnosi-authored-resources-{time.time_ns()}",
        "type": "tool_call",
    }


def _latest_tool_message_since_latest_user(
    messages: Iterable[Any],
    tool_name: str,
) -> Optional[Any]:
    """Return one exact current-turn tool result without scanning old turns."""
    for message in reversed(list(messages)):
        message_type = str(getattr(message, "type", "") or "")
        if message_type == "human":
            return None
        if message_type == "tool" and str(getattr(message, "name", "") or "") == tool_name:
            return message
    return None


def _previous_inventory_arguments(
    messages: Iterable[Any],
) -> dict[str, Any] | None:
    """Recover the next exact page from the immediately preceding turn."""
    passed_current_user = False
    for message in reversed(list(messages)):
        message_type = str(getattr(message, "type", "") or "")
        if message_type == "human":
            if not passed_current_user:
                passed_current_user = True
                continue
            return None
        if not passed_current_user or message_type != "tool":
            continue
        if str(getattr(message, "name", "") or "") != "inventory_context":
            continue
        try:
            payload = json.loads(str(getattr(message, "content", "") or ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict) or not payload.get("has_more"):
            return None
        try:
            raw_offset = payload.get("next_offset")
            raw_limit = payload.get("limit", 100)
            if not isinstance(raw_offset, (str, bytes, int, float)) or not isinstance(
                raw_limit, (str, bytes, int, float)
            ):
                return None
            offset = max(0, int(raw_offset))
            limit = max(1, min(100, int(raw_limit)))
        except (TypeError, ValueError):
            return None
        return {
            "query": str(payload.get("query") or "")[:500],
            "record_types": [
                str(value)[:128]
                for value in (payload.get("record_types_requested") or [])[:12]
                if str(value or "").strip()
            ],
            "include_relations": bool(payload.get("include_relations", True)),
            "offset": offset,
            "limit": limit,
        }
    return None


def _repeated_tool_call_since_latest_user(
    messages: Iterable[Any],
    minimum_repetitions: int = 2,
) -> str:
    """Return a tool whose exact arguments repeat during the current turn."""
    current_turn = []
    for message in reversed(list(messages)):
        if str(getattr(message, "type", "") or "") == "human":
            break
        current_turn.append(message)
    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    for message in reversed(current_turn):
        if str(getattr(message, "type", "") or "") != "ai":
            continue
        for tool_call in getattr(message, "tool_calls", None) or []:
            name = str(tool_call.get("name") or "").strip()
            if not name:
                continue
            signature = json.dumps(
                {"name": name, "args": tool_call.get("args") or {}},
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            counts[signature] = counts.get(signature, 0) + 1
            names[signature] = name
            if counts[signature] >= max(2, int(minimum_repetitions)):
                return names[signature]
    return ""
