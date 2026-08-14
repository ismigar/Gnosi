import os
import operator
import re
import json
from typing import Annotated, Any, Iterable, TypedDict, List, Sequence, Optional
import logging
import time
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langgraph.graph import StateGraph, END, START
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

# Import LLM providers
try:
    from langchain_ollama import ChatOllama

    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False

try:
    from langchain_openai import ChatOpenAI
    from langchain_anthropic import ChatAnthropic

    OPENAI_COMPATIBLE_AVAILABLE = True
except ImportError:
    OPENAI_COMPATIBLE_AVAILABLE = False

try:
    from langchain_groq import ChatGroq
    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from pydantic import BaseModel
import sqlite3
from pathlib import Path

# Import tools
from backend.agent.system_tools import READ_ONLY_SYSTEM_TOOLS, save_memory
from backend.agent.vault_tools import (
    VAULT_KNOWLEDGE_TOOLS,
    create_page,
    summarize_to_cornell,
)
from backend.agent.gnosi_tools import (
    CONFIRMED_WRITE_TOOLS,
    EXPLICIT_WRITE_TOOLS,
    READ_TOOLS as GNOSI_READ_TOOLS,
)
from backend.agent.action_confirmations import (
    confirmation_event,
    current_confirmation_scope,
    request_governed_tool_confirmation,
)
from backend.agent.agent_context import (
    build_context_tool_descriptors,
    build_context_tools,
    describe_context_refs,
)
from backend.agent.tools import get_mcp_tools
from backend.config.app_config import load_params
from backend.security.ai_credentials import resolve_provider_api_key
from backend.services.capability_audit import record_capability_event

cfg = load_params(strict_env=False)
BASE_DIR = cfg.paths.get("PROJECT_DIR") or Path(__file__).resolve().parent.parent.parent
INSTRUCTIONS_DIR = cfg.paths.get("AGENT_INSTRUCTIONS") or (Path(__file__).resolve().parent / "instructions")
log = logging.getLogger(__name__)

MAX_MODEL_MESSAGE_CHARS = 60_000
MAX_MODEL_MESSAGE_COUNT = 32
MAX_SINGLE_MESSAGE_CHARS = 16_000
MAX_SKILL_INSTRUCTION_CHARS = 24_000
MAX_SYSTEM_PROMPT_CHARS = 32_000
MAX_BOUND_TOOLS = 64
DEFAULT_CONTEXT_WINDOW_TOKENS = 8_192


def _bounded_model_messages(
    messages: Sequence[BaseMessage],
    max_chars: int = MAX_MODEL_MESSAGE_CHARS,
) -> List[BaseMessage]:
    """Keep newest complete assistant/tool protocol groups within the budget."""
    source = list(messages)[-MAX_MODEL_MESSAGE_COUNT:]
    units: List[List[BaseMessage]] = []
    index = 0
    while index < len(source):
        message = source[index]
        # A provider only accepts a tool result immediately after the assistant
        # message which created that exact tool call. Drop orphan results rather
        # than passing an invalid checkpoint through to the next invocation.
        if isinstance(message, ToolMessage):
            index += 1
            continue
        unit = [message]
        tool_call_ids = {
            str(call.get("id") or "")
            for call in (getattr(message, "tool_calls", None) or [])
            if isinstance(call, dict)
        }
        if tool_call_ids:
            cursor = index + 1
            completed_call_ids = set()
            while cursor < len(source):
                candidate = source[cursor]
                if not isinstance(candidate, ToolMessage):
                    break
                tool_call_id = str(getattr(candidate, "tool_call_id", "") or "")
                if tool_call_id not in tool_call_ids:
                    break
                unit.append(candidate)
                completed_call_ids.add(tool_call_id)
                cursor += 1
            index = cursor
            # A cancelled or disconnected tool turn can persist the assistant
            # call without every corresponding ToolMessage. Strict providers
            # reject that history, so omit the incomplete protocol group.
            if completed_call_ids != tool_call_ids:
                continue
        else:
            index += 1
        units.append(unit)

    bounded_units: List[List[BaseMessage]] = []
    remaining = max(1, int(max_chars))
    for unit in reversed(units):
        prepared = []
        unit_chars = 0
        for message in unit:
            content = message.content
            text = content if isinstance(content, str) else json.dumps(
                content, ensure_ascii=False, default=str,
            )
            if len(text) > MAX_SINGLE_MESSAGE_CHARS:
                text = text[:MAX_SINGLE_MESSAGE_CHARS]
                message = message.model_copy(update={"content": text})
            unit_chars += len(text)
            prepared.append(message)
        if unit_chars > remaining and bounded_units:
            continue
        if unit_chars > remaining:
            available = max(0, remaining)
            truncated = []
            for message in prepared:
                content = message.content
                text = content if isinstance(content, str) else json.dumps(
                    content, ensure_ascii=False, default=str,
                )
                kept = text[:available]
                truncated.append(
                    message
                    if kept == text
                    else message.model_copy(update={"content": kept})
                )
                available -= len(kept)
            prepared = truncated
            unit_chars = remaining
        bounded_units.append(prepared)
        remaining -= unit_chars
        if remaining <= 0:
            break
    return [
        message
        for unit in reversed(bounded_units)
        for message in unit
    ]


AUTO_SIMPLE_KEYWORDS = {
    "resumen", "resume", "traduce", "translate", "corrige", "fix", "explica", "explain",
    "titulo", "title", "idea", "ideas", "email", "tweet",
}
AUTO_COMPLEX_KEYWORDS = {
    "arquitectura", "architecture", "refactor", "debug", "analiza", "analyze", "investiga",
    "plan", "diseña", "design", "migración", "migration", "seguridad", "security",
    "sql", "backend", "frontend", "api", "performance", "rendimiento",
}
LOCAL_PROVIDERS = {"ollama", "llama-cpp", "lmstudio", "local", "generic"}


def _provider_is_available(provider_name: str, provider_cfg: Optional[dict]) -> bool:
    normalized = (provider_name or "").strip().lower()
    cfg = provider_cfg or {}
    
    # Check if disabled by user
    if not cfg.get("enabled", True):
        return False

    if normalized in LOCAL_PROVIDERS:
        return True
    return bool(resolve_provider_api_key(normalized, cfg))


def _resolve_auto_llm(message: str, providers_cfg: dict, fallback_provider: str, fallback_model: Optional[str]) -> tuple[str, Optional[str]]:
    """Automatic model selection: delegates to the budget-aware, data-driven router.

    Modern path: `model_router.route_model` (editable registry + capability + availability
    + tokens/cost). If the router doesn't resolve, keeps the agent's fallback. Replaces the
    old hardcoded stacks (cf. directive `vault_knowledge_agents.md`).
    
    """
    try:
        from backend.agent.model_router import route_model, load_registry, UsageStore
    except Exception:
        return fallback_provider, fallback_model

    registry = load_registry()

    def _avail(provider_name: str) -> bool:
        return _provider_is_available(provider_name, (providers_cfg or {}).get(provider_name) or {})

    usage: dict = {}
    budget: dict = {}
    try:
        from datetime import datetime
        period = datetime.now().strftime("%Y-%m")
        usage = UsageStore().usage_for(period)
        budget = dict((cfg.get("ai", {}) or {}).get("budget", {}) or {})
    except Exception:
        pass
    try:
        # Money cap: convert the Settings-currency cap to USD and inject the
        # period spend so route_model can hard-stop at the ceiling.
        from backend.agent.model_router import budget_status
        status = budget_status()
        if status.get("cap_usd"):
            budget["cost_cap_usd"] = status["cap_usd"]
            budget["spent_usd"] = status["spent_usd"]
    except Exception:
        pass

    decision = route_model(message, registry, is_available=_avail, usage=usage, budget=budget)
    if decision.get("provider") and decision.get("model_id"):
        return decision["provider"], decision["model_id"]
    return fallback_provider, fallback_model


def _obvious_route(message: str, has_context: bool = False) -> Optional[str]:
    """Route obvious requests without paying for a supervisor model call."""
    text = (message or "").strip().lower()
    if not text:
        return "General"
    has_mention = "@[" in text or "selected mentions context:" in text
    table_action = any(word in text for word in (
        "table", "tables", "taula", "taules", "tabla", "tablas",
    )) and any(word in text for word in (
        "replace", "replaces", "reemplaza", "reemplazar", "substitueix",
        "substituir", "actualitza", "actualizar", "update", "actualitza",
        "títol", "títols", "titulo", "títulos", "title", "titles",
        "fila", "files", "row", "rows", "registre", "registres",
    ))
    tool_intent = any(word in text for word in (
        "calendar", "calendari", "calendario", "meeting", "reunió", "reunion",
        "reuniones", "mail", "email", "correu", "correo", "notion", "zotero",
        "weather", "temps", "tiempo", "search", "cerca", "busca", "find",
    ))
    if has_mention or table_action or tool_intent or (has_context and any(word in text for word in (
        "document", "documento", "documentació", "nota", "pdf", "vault",
        "font", "source", "dades", "datos",
    ))):
        return "Brain"
    if any(word in text for word in (
        "code", "codi", "código", "python", "typescript", "javascript",
        "bug", "error", "test", "api", "backend", "frontend",
    )):
        return "Coder"
    if text.startswith((
        "hola", "hello", "hi", "bon dia", "gràcies", "gracias", "merci",
        "explica", "explain", "resume", "resum", "traduce", "tradueix",
    )):
        return "General"
    return None


def _safe_mcp_definitions(
    definitions: List[dict],
    explicit_allowlist: Optional[Sequence[str]] = None,
) -> List[dict]:
    """Keep MCP tools explicitly declared read-only or exactly allowlisted."""
    allowed_names = {str(name) for name in (explicit_allowlist or [])}
    safe = []
    for definition in definitions or []:
        if not isinstance(definition, dict) or not definition.get("name"):
            continue
        annotations = definition.get("annotations") or {}
        declared_read_only = (
            annotations.get("readOnlyHint") is True
            and annotations.get("destructiveHint") is not True
        )
        if declared_read_only or definition["name"] in allowed_names:
            safe.append(definition)
    return safe


def _rejected_mcp_names(
    definitions: List[dict],
    safe_definitions: List[dict],
) -> List[str]:
    """Return tool names withheld because read-only safety was not established."""
    safe_names = {item.get("name") for item in safe_definitions}
    return sorted({
        str(item.get("name"))
        for item in definitions or []
        if isinstance(item, dict)
        and item.get("name")
        and item.get("name") not in safe_names
    })


def _coder_read_only_tools(tools: Sequence[Any]) -> List[Any]:
    """Limit the coding specialist to code and directive inspection."""
    allowed_names = {
        "inspect_codebase",
        "search_code_symbols",
        "list_directives",
        "read_directive",
    }
    return [tool for tool in tools if tool.name in allowed_names]


def _mask_quoted_text(text: str) -> str:
    """Mask quoted/code spans so examples and copied instructions grant nothing."""
    patterns = (
        r"```.*?```",
        r"`[^`]*`",
        r'"[^"]*"',
        r"“[^”]*”",
        r"«[^»]*»",
        # Pair-delimited single quotes are examples/quotations too. The
        # surrounding-boundary checks preserve apostrophes inside words such
        # as Catalan ``l'esquema`` and French ``l'agent``.
        r"(?<![\wÀ-ÿ])'[^'\n]+'(?![\wÀ-ÿ])",
    )
    masked = text
    for pattern in patterns:
        masked = re.sub(
            pattern,
            lambda match: " " * len(match.group(0)),
            masked,
            flags=re.DOTALL,
        )
    return masked


def _affirmative_pattern_present(text: str, patterns: Sequence[str]) -> bool:
    """Match an action phrase only outside negation and meta capability queries."""
    meta_prefixes = (
        "analitza ", "analyse ", "analyze ", "explica ", "explain ",
        "explique ", "per què ", "por qué ", "why ", "què significa ",
        "qué significa ", "what does ",
    )
    third_person_queries = (
        "can this agent ", "can the agent ", "could this agent ",
        "pot aquest agent ", "pot l'agent ", "puede este agente ",
        "puede el agente ", "est-ce que cet agent ", "l'agent peut-il ",
    )
    masked = _mask_quoted_text(text)
    stripped = masked.strip()
    if stripped.startswith(meta_prefixes):
        return False
    if any(query in stripped for query in third_person_queries):
        return False

    negations = re.compile(
        r"\b(?:do not|don't|never|not|no|mai|nunca|jamais|sans|sense)\b"
        r"|\bne\b.*\bpas\b",
        re.IGNORECASE,
    )
    meta_context = re.compile(
        r"\b(?:"
        r"explain|describe|analy[sz]e|tell me|"
        r"how\s+(?:to|do|can|could|would|should)|"
        r"what\s+(?:happens|would happen)|whether|"
        r"can i|could i|may i|before\s+you|if\s+(?:you|i|we)|"
        r"documentation|docs?|phrase|example|"
        r"explica|analitza|com\s+(?:puc|podria|es pot|cal)|"
        r"què\s+passaria|abans\s+(?:que|de)|si\s+(?:tu|jo|et)|"
        r"documentació|frase|exemple|"
        r"analiza|cómo\s+(?:puedo|podría|se puede)|qué\s+pasaría|"
        r"puedo|podría|antes\s+de|si\s+(?:tú|yo|te)|"
        r"documentación|ejemplo|"
        r"explique|analyse|comment\s+(?:puis-je|peut-on|faire)|"
        r"que\s+se\s+passerait|puis-je|avant\s+de|"
        r"si\s+(?:tu|je|vous)|documentation|phrase|exemple"
        r")\b",
        re.IGNORECASE,
    )
    for pattern in patterns:
        start = 0
        while True:
            index = masked.find(pattern, start)
            if index < 0:
                break
            clause_start = max(
                masked.rfind(separator, 0, index)
                for separator in (".", "!", "?", ";", "\n")
            ) + 1
            clause_end_candidates = [
                position
                for separator in (".", "!", "?", ";", "\n")
                if (position := masked.find(separator, index + len(pattern))) >= 0
            ]
            clause_end = min(clause_end_candidates, default=len(masked))
            clause = masked[clause_start:clause_end]
            prefix = masked[clause_start:index][-80:]
            # A denial anywhere in the same clause overrides an affirmative
            # phrase, including suffixes such as "but do not actually do it".
            if not negations.search(clause) and not meta_context.search(prefix):
                return True
            start = index + len(pattern)
    return False


def _explicit_brain_write_tool_names(
    message: str,
    mentions: Optional[Sequence[Any]] = None,
) -> set[str]:
    """Authorize fail-closed Brain mutations from the current human wording."""
    text = " ".join((message or "").strip().lower().split())
    if not text:
        return set()

    authorized: set[str] = set()
    cornell_actions = (
        "crea", "crear", "fes", "prepara", "genera",
        "create", "make", "prepare", "generate", "summarize",
        "resume", "haz", "prepara", "genera", "résume", "crée", "prépare",
    )
    if (
        "cornell" in text
        and _affirmative_pattern_present(text, cornell_actions)
    ):
        authorized.add("summarize_to_cornell")

    page_patterns = (
        "crea una pàgina", "crea una pagina", "crea una nota",
        "crear una pàgina", "crear una pagina", "crear una nota",
        "create a page", "create a note", "make a page", "make a note",
        "crea una página", "crear una página", "haz una página", "haz una nota",
        "crée une page", "crée une note", "créer une page", "créer une note",
    )
    if (
        "cornell" not in text
        and _affirmative_pattern_present(text, page_patterns)
    ):
        authorized.add("create_page")

    memory_patterns = (
        "guarda-ho a la memòria", "guarda això a la memòria",
        "desa-ho a la memòria", "desa això a la memòria",
        "recorda que ", "recorda això",
        "save this to memory", "store this in memory", "remember that ",
        "guárdalo en la memoria", "guarda esto en la memoria",
        "recuerda que ", "mémorise ", "enregistre ceci en mémoire",
    )
    if _affirmative_pattern_present(text, memory_patterns):
        authorized.add("save_memory")

    if _reader_context_analysis_requested(text):
        authorized.add("start_reader_context_analysis")

    intent_patterns = {
        "create_table_row": (
            "crea una fila", "afegeix una fila", "create a row", "add a row",
            "crea una fila", "añade una fila", "crée une ligne",
        ),
        "update_page": (
            "actualitza la pàgina", "edita la pàgina", "update the page",
            "edit the page", "actualiza la página", "modifie la page",
        ),
        "append_to_page": (
            "afegeix a la pàgina", "append to the page", "añade a la página",
            "ajoute à la page",
        ),
        "update_table_row": (
            "actualitza la fila", "edita la fila", "update the row",
            "edit the row", "actualiza la fila", "modifie la ligne",
        ),
        "add_tags": (
            "afegeix etiquetes", "afegeix l'etiqueta", "add tags", "add the tag",
            "añade etiquetas", "ajoute des étiquettes",
        ),
        "add_page_comment": (
            "afegeix un comentari", "add a comment", "añade un comentario",
            "ajoute un commentaire",
        ),
        "mark_task_complete": (
            "marca la tasca com", "completa la tasca", "mark the task complete",
            "complete the task", "marca la tarea como", "termine la tâche",
        ),
        "create_calendar_event": (
            "crea un esdeveniment", "afegeix al calendari", "create an event",
            "add to the calendar", "crea un evento", "crée un événement",
        ),
        "create_contact": (
            "crea un contacte", "afegeix un contacte", "create a contact",
            "add a contact", "crea un contacto", "crée un contact",
        ),
        "save_mail_draft": (
            "desa un esborrany", "guarda un esborrany", "save a draft",
            "draft an email", "guarda un borrador", "enregistre un brouillon",
        ),
    }
    for name, patterns in intent_patterns.items():
        if _affirmative_pattern_present(text, patterns):
            authorized.add(name)

    delete_patterns = (
        "elimina la pàgina", "esborra la pàgina", "delete the page",
        "remove the page", "elimina la página", "supprime la page",
    )
    if _affirmative_pattern_present(text, delete_patterns):
        authorized.add("delete_page")

    confirmation_request_patterns = {
        "delete_contact": (
            "elimina el contacte", "esborra el contacte", "delete the contact",
            "elimina el contacto", "supprime le contact",
        ),
        "send_mail": (
            "envia el correu", "envia aquest correu", "send the email",
            "send this email", "envía el correo", "envoie le courriel",
        ),
        "archive_mail": (
            "arxiva el correu", "archive the email", "archiva el correo",
            "archive le courriel",
        ),
        "move_mail": (
            "mou el correu", "move the email", "mueve el correo",
            "déplace le courriel",
        ),
        "invite_attendees": (
            "convida els assistents", "envia les invitacions", "invite attendees",
            "send the invitations", "invita a los asistentes", "invite les participants",
        ),
        "delete_table": (
            "elimina la taula", "esborra la taula", "delete the table",
            "elimina la tabla", "supprime la table",
        ),
        "restore_page_version": (
            "restaura la versió", "restore the version", "restaura la versión",
            "restaure la version",
        ),
        "empty_trash": (
            "buida la paperera", "empty the trash", "vacía la papelera",
            "vide la corbeille",
        ),
        "change_schema": (
            "canvia l'esquema", "substitueix l'esquema", "change the schema",
            "replace the schema", "cambia el esquema", "modifie le schéma",
        ),
        "bulk_update_rows": (
            "actualitza massivament", "actualitza totes les files",
            "bulk update", "update all rows", "actualiza masivamente",
            "mise à jour en masse",
        ),
        "replace_reference_ids_in_titles": (
            "substitueix els ids", "substitueix els identificadors",
            "replace the ids",
            "replace the identifiers", "reemplaza los ids",
            "reemplaza los identificadores", "remplace les identifiants",
        ),
    }
    for name, patterns in confirmation_request_patterns.items():
        if _affirmative_pattern_present(text, patterns):
            authorized.add(name)

    mention_types = {
        str(
            mention.get("type", "")
            if isinstance(mention, dict)
            else getattr(mention, "type", "")
        ).strip().lower()
        for mention in (mentions or ())
    }
    delete_verbs = (
        "elimina ", "esborra ", "delete ", "remove ",
        "supprime ", "borra ",
    )
    update_verbs = (
        "actualitza ", "edita ", "update ", "edit ", "modifie ",
    )
    if {"table", "database"}.intersection(mention_types):
        if _affirmative_pattern_present(text, delete_verbs):
            authorized.add("delete_table")
    if "page" in mention_types:
        if _affirmative_pattern_present(text, delete_verbs):
            authorized.add("delete_page")
        if _affirmative_pattern_present(text, update_verbs):
            authorized.add("update_page")

    return authorized


def _reader_context_analysis_requested(message: str) -> bool:
    """Recognize explicit whole-Reader analysis requests in supported languages."""
    text = " ".join((message or "").strip().lower().split())
    if not text:
        return False
    reader_terms = re.compile(
        r"\b(?:lector|reader|not[ií]cies|noticias|news|articles?|art[ií]culos?|"
        r"actualitat|actualidad|actualit[eé])\b",
        re.IGNORECASE,
    )
    broad_terms = re.compile(
        r"\b(?:tot(?:es|s)?|toda?s?|all|whole|entire|moltes?|much[oa]s?|many|"
        r"pendents?|pendientes?|unread|per\s+temes?|por\s+temas?|by\s+topic|"
        r"evoluci[oó]|evolution|[eé]volution|tend[eè]ncies|tendencias|trends?)\b",
        re.IGNORECASE,
    )
    actions = (
        "analitza", "analitza'm", "analitzar", "fes-me un resum", "resumeix",
        "compara", "classifica", "troba tendències", "detecta tendències",
        "analyze", "analyse", "summarize", "summarise", "compare", "classify",
        "find trends", "analiza", "analizar", "resume", "resúmeme", "compara",
        "clasifica", "encuentra tendencias", "analyse", "résume", "compare",
        "classe", "trouve les tendances",
    )
    negated_or_meta = re.search(
        r"\b(?:no|mai|nunca|never|not|don't|sense|sin|sans)\b"
        r"|\b(?:com|cómo|how)\s+(?:puc|puedo|to|do|can)\b"
        r"|^(?:explica|describe|tell me)\b",
        text,
        re.IGNORECASE,
    )
    return bool(
        reader_terms.search(text)
        and broad_terms.search(text)
        and not negated_or_meta
        and any(action in text for action in actions)
    )


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
    return bool(
        _latest_context_tool_since_latest_user(messages, context_tool_names)
    )


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


def _latest_reader_analysis_job_id(messages: Iterable[Any]) -> str:
    """Return the newest durable Reader job id visible in conversation history."""
    for message in reversed(list(messages)):
        matches = re.findall(
            r"\b[a-f0-9]{32}\b",
            str(getattr(message, "content", "") or "").lower(),
        )
        if matches:
            return matches[-1]
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


def _required_vault_context_tool(
    message: str,
    context_refs: Iterable[dict],
) -> str:
    """Choose the first deterministic operation for attached Vault context."""
    refs = list(context_refs or [])
    text = " ".join((message or "").strip().lower().split())
    has_table = any(ref.get("type") == "table" for ref in refs)
    exhaustive = re.search(
        r"\b(?:tot(?:s|es)?|all|every|entire|llista|llistar|list|"
        r"quants?|quantes?|cu[aá]nt[oa]s?|combien|count|registres?|"
        r"registros?|records?|rows?)\b",
        text,
        re.IGNORECASE,
    )
    if has_table and exhaustive:
        return "query_context_table"
    if len(refs) == 1 and refs[0].get("type") == "page":
        return "read_context_source"
    return "search_context"


def _deterministic_vault_context_call(
    tool_name: str,
    context_refs: Iterable[dict],
) -> Optional[dict]:
    """Build an exact initial Vault read without relying on model tool choice."""
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
    arguments = {"source_id": source_ref}
    if tool_name == "query_context_table":
        arguments.update({"offset": 0, "limit": 100})
    return {
        "name": tool_name,
        "args": arguments,
        "id": f"gnosi-context-{time.time_ns()}",
        "type": "tool_call",
    }


def _authorized_brain_write_tools(names: set[str]) -> List[Any]:
    """Resolve only the explicitly authorized write-tool names."""
    tools_by_name = {
        "create_page": create_page,
        "summarize_to_cornell": summarize_to_cornell,
        "save_memory": save_memory,
        **{tool.name: tool for tool in EXPLICIT_WRITE_TOOLS},
        **{tool.name: tool for tool in CONFIRMED_WRITE_TOOLS},
    }
    return [
        tool
        for name, tool in tools_by_name.items()
        if name in names
    ]


def _model_supports_tools(
    provider_name: str,
    model_name: Optional[str],
    agent_data: dict,
) -> bool:
    """Resolve tool support from profile override, registry, then catalog."""
    capabilities = agent_data.get("capabilities")
    if isinstance(capabilities, list):
        return "tools" in capabilities
    if isinstance(capabilities, dict) and "tools" in capabilities:
        return bool(capabilities["tools"])
    try:
        from backend.agent.model_router import load_registry

        match = next(
            (
                row
                for row in load_registry(with_catalog_prices=False)
                if row.get("provider") == provider_name
                and row.get("model_id") == model_name
            ),
            None,
        )
        if match is not None:
            return "tools" in set(match.get("tags") or [])
    except Exception:
        pass
    try:
        from backend.agent.model_catalog import catalog_provider

        provider = catalog_provider(provider_name)
        match = next(
            (
                row
                for row in (provider or {}).get("models", [])
                if row.get("id") == model_name
            ),
            None,
        )
        if match is not None:
            return "tools" in set(match.get("tags") or [])
    except Exception:
        pass
    # Unknown/custom models fail closed. Agent profiles can explicitly opt in
    # through `capabilities.tools: true` after compatibility is verified.
    return False


def _model_context_window(provider_name: str, model_name: Optional[str]) -> int:
    """Resolve the selected model context window with a fail-small fallback."""
    try:
        from backend.agent.model_router import load_registry
        match = next(
            (
                row for row in load_registry(with_catalog_prices=False)
                if row.get("provider") == provider_name
                and row.get("model_id") == model_name
            ),
            None,
        )
        if match:
            return max(2_048, int(match.get("context_window") or 0))
    except Exception:
        pass
    return DEFAULT_CONTEXT_WINDOW_TOKENS


def _tool_schema_chars(tools: Sequence[Any]) -> int:
    """Estimate serialized tool-schema input charged by providers."""
    total = 0
    for item in tools:
        schema = getattr(item, "args_schema", None)
        try:
            payload = schema.model_json_schema() if schema else {}
        except Exception:
            payload = {}
        total += len(str(getattr(item, "name", "")))
        total += len(str(getattr(item, "description", "")))
        total += len(json.dumps(payload, ensure_ascii=False, default=str))
    return total


def _select_agent_profile(ai_cfg: dict, agent_id: str) -> Optional[dict]:
    """Select one enabled-compatible profile using the historical fallback."""
    agents = ai_cfg.get("agents", []) or []
    target_id = agent_id or ai_cfg.get("active_agent_id")
    agent_data = next(
        (agent for agent in agents if agent.get("id") == target_id),
        None,
    )
    if not agent_data and agents:
        agent_data = next(
            (agent for agent in agents if agent.get("enabled", True)),
            agents[0],
        )
    return agent_data


def _resolve_runtime_capabilities(
    agent_data: dict,
    *,
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[Iterable[str]] = None,
):
    """Resolve assigned skills through the governed catalog.

    The import remains local while the catalog is introduced so older installs
    can still start during the compatibility release. Once the catalog exists,
    validation or resolution errors are deliberately propagated: silently
    falling back to a broader legacy tool belt would be a privilege escalation.
    """
    try:
        from backend.services.agent_skill_catalog import resolve_agent_runtime
    except ImportError:
        return None
    return resolve_agent_runtime(
        agent_data,
        vault_path=vault_path,
        active_skill_ids=active_skill_ids,
    )


def prepare_agent_runtime(
    agent_id: str,
    *,
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[Iterable[str]] = None,
) -> tuple[dict, Optional[dict], Any]:
    """Load current AI config, selected profile, and resolved capabilities."""
    ai_cfg = load_params(strict_env=False).get("ai", {}) or {}
    agent_data = _select_agent_profile(ai_cfg, agent_id)
    runtime = (
        _resolve_runtime_capabilities(
            agent_data,
            vault_path=vault_path,
            active_skill_ids=active_skill_ids,
        )
        if agent_data
        else None
    )
    return ai_cfg, agent_data, runtime


def _tool_name(item: Any) -> str:
    """Return the model-visible name of a BaseTool or plain callable."""
    return str(
        getattr(item, "name", "")
        or getattr(item, "__name__", "")
        or ""
    )


def _deduplicate_tools(tools: Iterable[Any]) -> List[Any]:
    """Deduplicate LangChain tools and callables by model-visible name."""
    result = []
    names: set[str] = set()
    for item in tools:
        name = _tool_name(item)
        if not name or name in names:
            continue
        names.add(name)
        result.append(item)
    return result


def _latest_tool_batch_requires_confirmation(messages: Iterable[Any]) -> bool:
    """Stops the model loop once a consequential action preview is ready."""
    for message in reversed(list(messages)):
        message_type = str(getattr(message, "type", "") or "")
        if message_type == "ai":
            break
        if message_type == "tool" and confirmation_event(
            getattr(message, "content", ""),
        ):
            return True
    return False


def _descriptor_value(descriptor: Any, field: str, default: Any = None) -> Any:
    if isinstance(descriptor, dict):
        return descriptor.get(field, default)
    return getattr(descriptor, field, default)


def _descriptor_effects(descriptor: Any) -> tuple[str, ...]:
    """Normalize descriptor effects without depending on its concrete model."""
    values = _descriptor_value(descriptor, "effects", ()) or ()
    result = []
    for value in values:
        raw = getattr(value, "value", value)
        if raw:
            result.append(str(raw))
    return tuple(result)


def _runtime_tool_metadata(runtime: Any) -> tuple[list[dict], set[str]]:
    """Build public metadata and guarded names for resolved runtime tools."""
    tools = list(getattr(runtime, "tools", ()) or ())
    descriptors = list(getattr(runtime, "tool_descriptors", ()) or ())
    skills = list(getattr(runtime, "skills", ()) or ())
    active_skill_ids = {
        str(skill_id)
        for skill_id in (getattr(runtime, "active_skill_ids", ()) or ())
    }
    tool_skill_ids: dict[str, list[str]] = {}
    for skill in skills:
        skill_descriptor = _descriptor_value(skill, "descriptor", skill)
        skill_id = str(_descriptor_value(skill_descriptor, "id", "") or "")
        if skill_id not in active_skill_ids:
            continue
        for tool_id in _descriptor_value(skill_descriptor, "tool_ids", ()) or ():
            tool_skill_ids.setdefault(str(tool_id), []).append(skill_id)

    metadata = []
    guarded_names: set[str] = set()
    for index, tool in enumerate(tools):
        descriptor = descriptors[index] if index < len(descriptors) else None
        tool_id = str(_descriptor_value(descriptor, "id", "") or "")
        tool_name = _tool_name(tool) or tool_id
        effects = _descriptor_effects(descriptor)
        confirmation = str(
            getattr(
                _descriptor_value(descriptor, "confirmation", ""),
                "value",
                _descriptor_value(descriptor, "confirmation", ""),
            )
            or ""
        )
        minimum_role = str(
            _descriptor_value(descriptor, "minimum_role", "viewer")
            or "viewer"
        )
        if any(effect != "read" for effect in effects) or confirmation not in {
            "",
            "never",
            "none",
        }:
            guarded_names.add(tool_name)
        metadata.append({
            "id": tool_id or tool_name,
            "name": tool_name,
            "effects": list(effects),
            "skill_ids": tool_skill_ids.get(tool_id, []),
            "minimum_role": minimum_role,
            "confirmation": confirmation or "none",
            "prepares_confirmation": bool(
                (
                    _descriptor_value(descriptor, "metadata", {}) or {}
                ).get("prepares_confirmation")
            ),
            "_descriptor": descriptor,
        })
    return metadata, guarded_names


# --- 1. Define the State ---
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next: str
    turn_authorized_tool_names: Sequence[str]
    active_skill_ids: Sequence[str]
    current_user_role: str


def _turn_authorized_tool_names(state: Any) -> set[str]:
    """Read current-turn tool grants from graph state.

    This state field is overwritten on every invocation. It must never be
    sourced from a workflow-construction closure because workflows are cached
    across turns.
    """
    if isinstance(state, dict):
        values = state.get("turn_authorized_tool_names") or []
    else:
        values = getattr(state, "turn_authorized_tool_names", []) or []
    return {str(value) for value in values if value}


def _tool_policy_wrapper(tool_policies: Any):
    """Build a just-in-time execution gate for tool role and turn grants."""
    if isinstance(tool_policies, dict):
        policies = {
            str(name): dict(policy or {})
            for name, policy in tool_policies.items()
            if name
        }
    else:
        policies = {
            str(name): {
                "minimum_role": "editor",
                "confirmation": "explicit_request",
            }
            for name in tool_policies
            if name
        }

    def enforce_policy(request, execute):
        tool_call = request.tool_call
        tool_name = str(tool_call.get("name") or "")
        policy = policies.get(tool_name, {})
        state = request.state if isinstance(request.state, dict) else {}
        current_role = str(state.get("current_user_role") or "viewer").lower()
        required_role = str(policy.get("minimum_role") or "viewer").lower()
        role_weights = {"viewer": 0, "editor": 1, "admin": 2, "owner": 3}
        def audit(status: str, *, result_kind: str = "none", error_code: str = "", duration_ms: int = 0) -> None:
            try:
                scope = current_confirmation_scope()
                record_capability_event(
                    scope,
                    tool_id=str(policy.get("id") or tool_name),
                    tool_name=tool_name,
                    effects=list(policy.get("effects") or []),
                    status=status,
                    argument_keys=list((tool_call.get("args") or {}).keys()),
                    result_kind=result_kind,
                    error_code=error_code,
                    duration_ms=duration_ms,
                )
            except Exception:
                log.exception("Failed to write capability audit metadata.")
        if role_weights.get(current_role, -1) < role_weights.get(required_role, 0):
            audit("denied", error_code="insufficient_role")
            return ToolMessage(
                content=(
                    "Tool execution denied: "
                    f"`{tool_name}` requires role `{required_role}`."
                ),
                name=tool_name,
                tool_call_id=str(tool_call.get("id") or ""),
                status="error",
            )
        confirmation = str(policy.get("confirmation") or "none")
        if confirmation == "always":
            if policy.get("prepares_confirmation"):
                if tool_name not in _turn_authorized_tool_names(request.state):
                    audit("denied", error_code="explicit_authorization_required")
                    return ToolMessage(
                        content=(
                            "Tool execution denied: the current user turn did not "
                            f"explicitly authorize `{tool_name}`."
                        ),
                        name=tool_name,
                        tool_call_id=str(tool_call.get("id") or ""),
                        status="error",
                    )
                started = time.monotonic()
                result = execute(request)
                audit(
                    "completed" if getattr(result, "status", "success") != "error" else "failed",
                    result_kind=type(result).__name__,
                    duration_ms=int((time.monotonic() - started) * 1000),
                )
                return result
            try:
                content = request_governed_tool_confirmation(
                    descriptor=policy.get("_descriptor"),
                    tool_name=tool_name,
                    tool_arguments=dict(tool_call.get("args") or {}),
                    active_skill_ids=(
                        state.get("active_skill_ids") or ()
                    ),
                )
            except Exception as error:
                audit("failed", error_code=type(error).__name__)
                return ToolMessage(
                    content=f"Tool confirmation preparation failed: {error}",
                    name=tool_name,
                    tool_call_id=str(tool_call.get("id") or ""),
                    status="error",
                )
            audit("approval_required", result_kind="confirmation")
            return ToolMessage(
                content=content,
                name=tool_name,
                tool_call_id=str(tool_call.get("id") or ""),
                status="success",
            )
        if confirmation not in {"", "never", "none"} and (
            tool_name not in _turn_authorized_tool_names(request.state)
        ):
            audit("denied", error_code="explicit_authorization_required")
            return ToolMessage(
                content=(
                    "Tool execution denied: the current user turn did not "
                    f"explicitly authorize `{tool_name}`."
                ),
                name=tool_name,
                tool_call_id=str(tool_call.get("id") or ""),
                status="error",
            )
        started = time.monotonic()
        try:
            result = execute(request)
        except Exception as error:
            audit(
                "failed",
                error_code=type(error).__name__,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            raise
        audit(
            "completed" if getattr(result, "status", "success") != "error" else "failed",
            result_kind=type(result).__name__,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return result

    return enforce_policy


# --- 2. Agent Prompts (Base) ---
DEFAULT_SUPERVISOR_PROMPT = """You are the Gnosi Supervisor.
Your job is to coordinate the expert team and resolve the user's request.

TEAM MEMBERS:
1. **Coder**: Senior software engineer specializing in Python, Git, testing, and file systems.
2. **Brain**: Sovereign knowledge and automation manager specializing in the Gnosi Vault and long-term memory.

ROUTING INSTRUCTIONS:
- Route code-change requests to `Coder`.
- Route personal-information, Gnosi Vault, directive, and procedure requests to `Brain`.
- Handle general conversation and simple questions through `General`.
- Return `FINISH` when an agent has completed the work.

Return ONLY the next worker's name: 'Coder', 'Brain', 'General', or 'FINISH'.
"""

# --- 3. LLM Provider handling ---


def get_llm(
    provider: str,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: Optional[float] = None,
):
    """
        Instantiate an LLM according to the provider and configuration.

    `timeout` (seconds): REAL network limit applied when building the client. langchain
    IGNORES `config={"timeout": ...}` in `.invoke()` (it's not a RunnableConfig key), so
    the limit MUST go here. For OpenAI-compatible providers it translates to
    `request_timeout` (httpx client timeout) and we disable the SDK's retries
    (`max_retries=0`) so that `timeout` is a real ceiling and not per-attempt. `timeout=None`
    keeps the classic behavior (agent path: no hard limit, default retries).
    See directive `ai_error_handling.md`.
    
    """
    # Treat empty strings as None to force the fallback to env vars
    if not api_key:
        api_key = None
    if not base_url:
        base_url = None

    # timeout kwargs for the OpenAI/Anthropic-compatible wrappers (aliases of
    # request_timeout / default_request_timeout). Ollama does NOT accept them → client_kwargs.
    req_timeout_kwargs = (
        {"timeout": timeout, "max_retries": 0} if timeout is not None else {}
    )

    try:
        if provider == "ollama":
            from langchain_ollama import ChatOllama
            log.debug(f"Instantiating ChatOllama with model {model or 'llama3.2'}")
            # ChatOllama IGNORES `timeout=` directly (model_config extra="ignore"); the
            # network timeout must be passed via client_kwargs → ollama's httpx client.
            # Autodetected default: host.docker.internal only inside Docker, loopback
            # native — a fixed Docker hostname silently broke native installs
            # (same family as default_host_helper_url, PR #838).
            from backend.config.env_config import default_ollama_base_url
            return ChatOllama(
                model=model or "llama3.2",
                base_url=base_url or default_ollama_base_url(),
                client_kwargs={"timeout": timeout if timeout is not None else 60},
            )

        if provider in {"openai", "deepseek", "mistral", "openrouter"}:
            from langchain_openai import ChatOpenAI
            key = api_key or os.environ.get(f"{provider.upper()}_API_KEY")
            if not key and provider == "openai":
                log.debug("OpenAI API Key missing")
                return None

            default_urls = {
                "openai": "https://api.openai.com/v1",
                "deepseek": "https://api.deepseek.com",
                "mistral": "https://api.mistral.ai/v1",
                "openrouter": "https://openrouter.ai/api/v1"
            }

            log.debug(f"Instantiating {provider} via OpenAI interface with model {model}")
            return ChatOpenAI(
                model=model or (
                    "gpt-4o" if provider == "openai" else
                    "deepseek-chat" if provider == "deepseek" else
                    "mistral-large-latest" if provider == "mistral" else
                    "openai/gpt-4o-mini"
                ),
                api_key=key or "no-key",
                base_url=base_url or default_urls.get(provider),
                **req_timeout_kwargs,
            )

        if provider == "groq":
            key = api_key if api_key and api_key.strip() else os.environ.get("GROQ_API_KEY")
            if not key:
                log.debug("Groq API Key missing.")
                return None

            from langchain_openai import ChatOpenAI
            log.debug(f"Instantiating Groq via OpenAI shim with model {model or 'llama-3.3-70b-versatile'}")
            return ChatOpenAI(
                model=model or "llama-3.3-70b-versatile",
                api_key=key,
                base_url=base_url or "https://api.groq.com/openai/v1",
                **req_timeout_kwargs,
            )

        if provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            key = api_key if api_key and api_key.strip() else os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                log.debug("Anthropic API Key missing.")
                return None
            # Canonical id, not a "-latest" alias: models.dev does not publish
            # the aliases, so usage recorded under one resolves to no catalog
            # price and would be billed as free (slipping past the spend cap).
            log.debug(f"Instantiating ChatAnthropic with model {model or 'claude-sonnet-4-5'}")
            return ChatAnthropic(
                model=model or "claude-sonnet-4-5",
                api_key=key,
                **req_timeout_kwargs,
            )

        # Generic OpenAI compatible (Local, LM Studio, etc.) or unknown provider with base_url
        if provider in {"local", "generic", "lmstudio", "llama-cpp"} or base_url:
            from langchain_openai import ChatOpenAI
            log.debug(f"Instantiating Generic/Universal ChatOpenAI (Provider: {provider})")
            return ChatOpenAI(
                model=model or "local-model",
                api_key=api_key or "no-key",
                base_url=base_url or "http://localhost:8000/v1",
                **req_timeout_kwargs,
            )

        # Any other catalog provider: OpenAI-compatible path with a known base
        # URL (curated compat map, or the `api` field models.dev publishes —
        # 132/167 providers are @ai-sdk/openai-compatible). Makes the whole
        # catalog usable without adding per-provider SDK dependencies.
        from backend.agent.model_catalog import catalog_base_url
        compat_url = catalog_base_url(provider)
        if compat_url and model:
            from langchain_openai import ChatOpenAI
            log.debug(
                f"Instantiating catalog provider '{provider}' via OpenAI-compatible URL {compat_url}")
            return ChatOpenAI(
                model=model,
                api_key=api_key or "no-key",
                base_url=compat_url,
                **req_timeout_kwargs,
            )

    except Exception as e:
        log.error(f"❌ Error instantiating LLM for provider '{provider}': {e}")
        return None

    # Fallback if the provider isn't recognized and there's no URL
    return None


def _get_hybrid_llm(timeout: Optional[float] = None):
    """Fallback logic looking for any available provider beyond the primary choice.

    Returns (llm, provider, model) so callers can attribute usage; (None, None,
    None) when no fallback provider has a key."""
    # List of fallback providers to check in order of quality/availability
    fallbacks = [
        ("openai", "gpt-4o-mini"),
        ("anthropic", "claude-haiku-4-5"),
        ("openrouter", "openai/gpt-4o-mini"),
        ("groq", "llama-3.1-8b-instant"),
        ("ollama", "llama3.2:latest"),
    ]

    from backend.security.ai_credentials import resolve_provider_api_key
    from backend.config.app_config import load_params

    # We need a fresh check of providers from config
    p_cfg = load_params(strict_env=False).ai.get("providers", {})

    for p_name, m_name in fallbacks:
        key = resolve_provider_api_key(p_name, p_cfg.get(p_name))
        if key:
            log.info(f"Using emergency fallback LLM: {p_name} / {m_name}")
            llm = get_llm(
                provider=p_name,
                model=m_name,
                api_key=key,
                base_url=p_cfg.get(p_name, {}).get("base_url"),
                timeout=timeout,
            )
            if llm:
                return llm, p_name, m_name

    return None, None, None


def get_default_llm(user_message: str = "", timeout: Optional[float] = None):
    """Returns an LLM ready for one-shot calls (content generation,
    summaries, meeting agendas…).

    `timeout` (seconds) is propagated to the client constructor (REAL network timeout,
    cf. `get_llm`). None → no hard limit.

    Resolves the provider/model the same way the agent does: active agent → `auto`
    selection based on the message → hybrid fallback (any provider with a key). Uses the
    FRESH config from params.yaml (not the one cached at import time) so it picks up
    providers added on the fly. Returns None if none is available.

    NOTE: this is the MODERN path (get_llm + resolve_provider_api_key), unlike
    the legacy client `pipeline/ai_client.py` which expects `model_url`/`model_name`
    per provider (incompatible with the current provider schema).
    
    """
    llm, _, _ = get_default_llm_with_meta(user_message=user_message, timeout=timeout)
    return llm


def get_default_llm_with_meta(
    user_message: str = "", timeout: Optional[float] = None,
) -> tuple:
    """Like `get_default_llm` but returns (llm, provider, model) so callers can
    attribute token usage to the model that actually answered."""
    ai_cfg = load_params(strict_env=False).get("ai", {}) or {}
    providers = ai_cfg.get("providers", {}) or {}
    agents = ai_cfg.get("agents", []) or []

    target_id = ai_cfg.get("active_agent_id")
    agent_data = next((a for a in agents if a.get("id") == target_id), None)
    if not agent_data and agents:
        agent_data = next((a for a in agents if a.get("enabled", True)), agents[0])

    provider_name = (agent_data or {}).get("provider")
    model_name = (agent_data or {}).get("model")

    # With no agent defined (or no provider), pick automatically based on the text.
    if not provider_name:
        provider_name, model_name = _resolve_auto_llm(
            message=user_message,
            providers_cfg=providers,
            fallback_provider="groq",
            fallback_model=model_name,
        )

    llm = None
    if provider_name:
        p_cfg = providers.get(provider_name, {})
        key = resolve_provider_api_key(provider_name, p_cfg)
        llm = get_llm(
            provider=provider_name,
            model=model_name,
            api_key=key,
            base_url=p_cfg.get("base_url"),
            timeout=timeout,
        )

    if not llm:
        llm, provider_name, model_name = _get_hybrid_llm(timeout=timeout)
    if not llm:
        return None, None, None
    # The model actually instantiated (get_llm applies its own defaults when
    # model_name is None) — read it back so the usage ledger stays truthful.
    actual_model = getattr(llm, "model_name", None) or getattr(llm, "model", None) or model_name
    return llm, provider_name, str(actual_model) if actual_model else None


def generate_text(prompt: str, user_message: str = "", timeout: int = 60) -> tuple[str, str]:
    """One-shot call to the default LLM. Returns (text, model_label).

    Raises RuntimeError if no AI provider is available, so that the
    caller can gracefully degrade (HTTP 503 / reminder without an agenda).

    """
    from langchain_core.messages import HumanMessage

    llm, provider_name, model_name = get_default_llm_with_meta(
        user_message=user_message or prompt[:200], timeout=timeout)
    if not llm:
        raise RuntimeError("No AI provider available")
    # The timeout already lives in the client (get_default_llm→get_llm). Do NOT pass
    # config={"timeout": ...}: langchain ignores it (it's not a RunnableConfig key).
    resp = llm.invoke([HumanMessage(content=prompt)])
    text = getattr(resp, "content", "") or ""
    if not isinstance(text, str):
        text = str(text)

    # Feed the spend ledger (best-effort, never breaks the response)
    from backend.agent.model_router import record_llm_usage, usage_from_message
    usage = usage_from_message(resp)
    if usage:
        record_llm_usage(provider_name, model_name, usage[0], usage[1])

    label = getattr(llm, "model_name", None) or getattr(llm, "model", None) or "ai"
    return text, str(label)


# --- 4. Definir Factory ---


async def create_agent_workflow(
    mcp_tools_list: List[dict],
    mcp_client,
    agent_id: str = "gnosy",
    llm_mode: str = "agent_default",
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    user_message: str = "",
    timeout: int = 60,
    active_skill_ids: Optional[Iterable[str]] = None,
    vault_path: Optional[Path] = None,
    prepared_ai_cfg: Optional[dict] = None,
    prepared_agent_data: Optional[dict] = None,
    runtime_capabilities: Any = None,
) -> tuple[StateGraph, dict]:
    """
        Creates the Multi-Agent workflow (graph) based on a specific agent profile.
    Returns the uncompiled graph to allow adding checkpointers externally.
    
    """
    # 1. Get agent configuration from params.yaml.
    # Re-read: the module-level `cfg` is a snapshot from import time, so an agent
    # created (or edited) from Settings afterwards would be invisible here and the
    # chat would answer "No LLM provider available" until the process restarted.
    # `get_default_llm_with_meta` already re-reads for the same reason.
    if prepared_ai_cfg is None:
        ai_cfg, selected_agent, resolved_runtime = prepare_agent_runtime(
            agent_id,
            vault_path=vault_path,
            active_skill_ids=active_skill_ids,
        )
    else:
        ai_cfg = prepared_ai_cfg
        selected_agent = prepared_agent_data
        resolved_runtime = runtime_capabilities

    providers = ai_cfg.get("providers", {})

    # Priority: supplied agent_id -> active_agent_id -> first enabled agent.
    target_id = agent_id or ai_cfg.get("active_agent_id")
    agent_data = selected_agent or _select_agent_profile(ai_cfg, target_id)

    if not agent_data:

        return None, {}
    target_id = str(agent_data.get("id") or target_id)
    if resolved_runtime is None:
        resolved_runtime = _resolve_runtime_capabilities(
            agent_data,
            vault_path=vault_path,
            active_skill_ids=active_skill_ids,
        )

    # 2. Configure LLM for the agent
    provider_name = agent_data.get("provider") or ""
    model_name = agent_data.get("model")

    if llm_mode == "manual":
        if llm_provider:
            provider_name = llm_provider
        if llm_model:
            model_name = llm_model
    elif llm_mode == "auto":
        provider_name, model_name = _resolve_auto_llm(
            message=user_message,
            providers_cfg=providers,
            fallback_provider=provider_name,
            fallback_model=model_name,
        )

    # The normal conversation path is agent_default: an agent is an atomic
    # profile of model, instructions, and context. Do not let an incomplete
    # profile implicitly reach an unrelated provider default.
    if llm_mode == "agent_default" and (not provider_name or not model_name):
        return None, {
            "mode": llm_mode,
            "provider": provider_name,
            "model": model_name,
        }

    p_cfg = providers.get(provider_name, {})
    resolved_api_key = resolve_provider_api_key(provider_name, p_cfg)

    llm = get_llm(
        provider=provider_name,
        model=model_name,
        api_key=resolved_api_key,
        base_url=p_cfg.get("base_url"),
        timeout=timeout,
    )

    if not llm and llm_mode == "agent_default":
        # A configured agent must either run with its own model or fail
        # transparently. Hybrid fallback is retained only for explicit router
        # and compatibility modes.
        return None, {
            "mode": llm_mode,
            "provider": provider_name,
            "model": model_name,
        }

    if not llm:
        llm, fallback_provider, fallback_model = _get_hybrid_llm(timeout=timeout)
        if llm:
            provider_name = fallback_provider
            model_name = fallback_model

    if not llm:

        return None, {}

    # 3. Prepare prompts (persona and active skill instructions).
    context_window_tokens = _model_context_window(provider_name, model_name)
    model_input_chars = max(
        8_000,
        min(240_000, int(context_window_tokens * 0.75 * 3)),
    )
    persona = str(agent_data.get("persona", ""))[:8_000]
    agent_name = agent_data.get("name", "Gnosy")
    
    # Load detailed persona from markdown if exists
    persona_file = INSTRUCTIONS_DIR / f"{target_id}.md"
    detailed_persona = ""
    if persona_file.exists():
        try:
            with persona_file.open("r", encoding="utf-8", errors="replace") as handle:
                detailed_persona = handle.read(16_000)
        except Exception as e:
            log.warning(f"Could not read persona file {persona_file}: {e}")
    
    combined_persona = f"{persona}\n\n{detailed_persona}" if detailed_persona else persona
    active_runtime_skill_ids = tuple(
        str(skill_id)
        for skill_id in (
            getattr(resolved_runtime, "active_skill_ids", ()) or ()
        )
    )
    assigned_runtime_skill_ids = tuple(
        str(skill_id)
        for skill_id in (
            getattr(resolved_runtime, "assigned_skill_ids", ()) or ()
        )
    )
    skill_instructions = tuple(
        str(instruction).strip()
        for instruction in (
            getattr(resolved_runtime, "instructions", ()) or ()
        )
        if str(instruction).strip()
    )
    legacy_bundle_active = (
        "core.legacy-default-v1" in active_runtime_skill_ids
        or (
            not assigned_runtime_skill_ids
            and "skill_ids" not in agent_data
            and active_skill_ids is None
        )
    )

    if skill_instructions:
        bounded_skill_instructions = []
        remaining_skill_chars = MAX_SKILL_INSTRUCTION_CHARS
        for instruction in skill_instructions:
            if remaining_skill_chars <= 0:
                break
            bounded = instruction[:remaining_skill_chars]
            bounded_skill_instructions.append(bounded)
            remaining_skill_chars -= len(bounded)
        skill_block = (
            "Active skill instructions (subordinate to system safety and tool "
            "policy):\n\n"
            + "\n\n---\n\n".join(bounded_skill_instructions)
        )
        combined_persona = (
            f"{combined_persona}\n\n{skill_block}"
            if combined_persona
            else skill_block
        )

    # Free-text notes go into the prompt verbatim (short and always relevant);
    # attached sources contribute only their INVENTORY — the agent reads them
    # on demand through the context tools (directive `agent_context_sources.md`).
    context_notes = str(agent_data.get("context") or "").strip()[:8_000]
    context_refs = agent_data.get("context_refs") or []
    context_inventory = describe_context_refs(context_refs)[:4_000]
    context_notes_limit = max(0, 8_000 - len(context_inventory))
    bounded_context_notes = context_notes[:context_notes_limit]
    context_block = "\n\n".join(
        part for part in (
            context_inventory,
            (
                f"Working context provided by the user:\n{bounded_context_notes}"
                if bounded_context_notes
                else ""
            ),
        ) if part
    )
    if context_block:
        bounded_context = context_block[:8_000]
        persona_budget = max(
            0,
            min(MAX_SYSTEM_PROMPT_CHARS, model_input_chars // 3)
            - len(bounded_context)
            - 2,
        )
        combined_persona = (
            f"{combined_persona[:persona_budget]}\n\n{bounded_context}"
            if combined_persona
            else bounded_context
        )
    combined_persona = combined_persona[:min(
        MAX_SYSTEM_PROMPT_CHARS,
        model_input_chars // 3,
    )]

    general_prompt = combined_persona or "You are a helpful assistant."
    if context_refs:
        # This node has no tools bound: saying so stops it from narrating a
        # tool call it cannot make and inventing the result.
        general_prompt += (
            "\n\nIMPORTANT: no tools are available for this response. Do not "
            "simulate tool calls or invent their results. If the attached sources "
            "must be consulted, state clearly that you need to consult them."
        )

    supervisor_prompt = (
        f"You are {agent_name}.\n{combined_persona}\n\n{DEFAULT_SUPERVISOR_PROMPT}"
        if combined_persona
        else f"You are {agent_name}.\n{DEFAULT_SUPERVISOR_PROMPT}"
    )
    if context_refs:
        # Only Brain holds the context tools. Without this rule the supervisor
        # sends the question to General, which has no tools and then invents a
        # tool result rather than admitting it cannot look anything up.
        # It goes BEFORE the base prompt on purpose: the format instruction
        # ("return ONLY the worker's name") has to stay the last thing read, or
        # the supervisor answers with a sentence and the graph finishes empty.
        supervisor_prompt = (
            f"You are {agent_name}.\n{combined_persona}\n\n"
            "This agent has attached context sources, and only `Brain` has the "
            "tools to inspect them. Route every question about documents, data, "
            "or regulations to `Brain`.\n\n"
            f"{DEFAULT_SUPERVISOR_PROMPT}"
        )

    # 4. Convert MCP tools
    safe_mcp_definitions = _safe_mcp_definitions(
        mcp_tools_list,
        explicit_allowlist=agent_data.get("read_only_mcp_tools") or [],
    )
    rejected_mcp_names = _rejected_mcp_names(
        mcp_tools_list,
        safe_mcp_definitions,
    )
    mcp_langchain_tools = get_mcp_tools(safe_mcp_definitions, mcp_client)
    supports_tools = _model_supports_tools(provider_name, model_name, agent_data)
    runtime_tools = list(
        getattr(resolved_runtime, "tools", ()) or ()
    )
    runtime_tool_metadata, runtime_guarded_names = _runtime_tool_metadata(
        resolved_runtime,
    )

    # First-party and third-party operations now arrive through the exact
    # assigned-skill runtime. Explicitly scoped profiles never inherit an
    # unrelated global Gnosi tool belt.
    guarded_tool_names = set(runtime_guarded_names)
    tool_policies = {
        item["name"]: dict(item)
        for item in runtime_tool_metadata
    }

    # Coder & Brain specialists.
    coder_tools = (
        _coder_read_only_tools(READ_ONLY_SYSTEM_TOOLS)
        if supports_tools and legacy_bundle_active
        else []
    )
    coder_llm = llm.bind_tools(coder_tools) if coder_tools else llm

    memory_tools = [
        t
        for t in READ_ONLY_SYSTEM_TOOLS
        if t.name
        in ["query_memory", "get_vault_registry", "search_vault"]
    ] if legacy_bundle_active else []
    # Tools scoped to the sources the user attached to THIS agent. They close over
    # its refs, so an agent can never read another agent's context.
    context_tools = build_context_tools(context_refs)
    context_descriptors = build_context_tool_descriptors(
        context_refs,
        context_tools,
    )
    for context_tool, descriptor in zip(context_tools, context_descriptors):
        effects = _descriptor_effects(descriptor)
        context_tool_metadata = {
            "id": descriptor.id,
            "name": _tool_name(context_tool),
            "effects": list(effects),
            "skill_ids": [],
            "minimum_role": descriptor.minimum_role,
            "confirmation": descriptor.confirmation.value,
            "prepares_confirmation": False,
            "dynamic_context": True,
            "_descriptor": descriptor,
        }
        runtime_tool_metadata.append(context_tool_metadata)
        tool_policies[context_tool_metadata["name"]] = dict(context_tool_metadata)
        if (
            any(effect in {
                "local_write", "external_write", "destructive",
                "code_execution", "ai_cost", "bulk_write",
                "financial_cost", "data_egress",
            } for effect in effects)
            or context_tool_metadata["confirmation"] not in {"", "never", "none"}
        ):
            guarded_tool_names.add(context_tool_metadata["name"])
    legacy_vault_tools = (
        [
            item
            for item in VAULT_KNOWLEDGE_TOOLS
            if item.name in {"read_page", "read_pdf", "propose_links"}
        ]
        if legacy_bundle_active
        else []
    )
    brain_tools = (
        context_tools
        + runtime_tools
        + legacy_vault_tools
        + memory_tools
        + (mcp_langchain_tools if legacy_bundle_active else [])
        if supports_tools
        else []
    )
    brain_tools = _deduplicate_tools(brain_tools)
    brain_tools = brain_tools[:MAX_BOUND_TOOLS]
    bound_tool_names = {
        str(getattr(item, "name", "") or getattr(item, "__name__", ""))
        for item in brain_tools
    }
    omitted_runtime_tool_ids = [
        str(item.get("id") or "")
        for item in runtime_tool_metadata
        if item.get("name") not in bound_tool_names and item.get("id")
    ]
    schema_chars = _tool_schema_chars(brain_tools)
    reserved_output_chars = max(2_000, int(context_window_tokens * 0.15 * 3))
    message_budget_chars = max(
        4_000,
        min(
            180_000,
            model_input_chars
            - len(supervisor_prompt)
            - schema_chars
            - reserved_output_chars,
        ),
    )
    brain_llm = llm.bind_tools(brain_tools) if brain_tools else llm
    context_tool_names = {_tool_name(item) for item in context_tools}
    forced_context_llms = {
        _tool_name(item): llm.bind_tools([item], tool_choice="required")
        for item in context_tools
        if _tool_name(item) in bound_tool_names
    } if supports_tools else {}

    requested_active_skill_ids = {
        str(skill_id) for skill_id in (active_skill_ids or ()) if skill_id
    }
    explicitly_activated_tool_names = {
        item["name"]
        for item in runtime_tool_metadata
        if requested_active_skill_ids.intersection(item.get("skill_ids") or ())
        and item["name"] in guarded_tool_names
        and item["name"] in bound_tool_names
        and item.get("confirmation") == "explicit_request"
    }

    # --- Graph Nodes ---

    def supervisor_node(state: AgentState):
        messages = state["messages"]
        latest_user = next(
            (
                str(message.content)
                for message in reversed(messages)
                if getattr(message, "type", "") == "human"
            ),
            "",
        )
        # Explicit skill assignments define the effective agent runtime. A
        # governed, tool-backed profile must therefore enter the tool-enabled
        # specialist directly; delegating that decision to a model can route
        # the turn to General, where the assigned tools are unavailable.
        if runtime_tools and not legacy_bundle_active:
            return {"next": "Brain"}
        obvious = (
            "Brain"
            if _turn_authorized_tool_names(state)
            else _obvious_route(latest_user, has_context=bool(context_refs))
        )
        if obvious:
            return {"next": obvious}
        prompt = [SystemMessage(content=supervisor_prompt)] + _bounded_model_messages(messages, message_budget_chars)
        response = llm.invoke(prompt)

        decision = response.content.strip().replace("'", "").replace('"', "")
        if "Coder" in decision:
            return {"next": "Coder"}
        if "Brain" in decision:
            return {"next": "Brain"}
        if "General" in decision:
            return {"next": "General"}
        # The supervisor has not produced a specialist response itself. An
        # unrecognized decision must therefore fall back to General, rather
        # than ending the user's turn with no visible assistant message.
        return {"next": "General"}

    def coder_node(state: AgentState):
        messages = state["messages"]
        coder_system = (
            f"You are the Coder specialist for {agent_name}."
            + (
                "\n\nConfigured agent persona and instructions:\n"
                + combined_persona
                if combined_persona
                else ""
            )
        )
        response = coder_llm.invoke(
            [SystemMessage(content=coder_system)] + _bounded_model_messages(messages, message_budget_chars)
        )
        return {"messages": [response], "next": "supervisor"}

    def brain_node(state: AgentState):
        messages = state["messages"]
        latest_user = next(
            (
                str(message.content)
                for message in reversed(messages)
                if getattr(message, "type", "") == "human"
            ),
            "",
        )
        current_authorized_names = _turn_authorized_tool_names(state)
        brain_system = (
            f"You are the Brain specialist for {agent_name} "
            "(Gnosi Vault and sovereign memory)."
        )
        if combined_persona:
            brain_system += (
                "\n\nConfigured agent persona and instructions:\n"
                + combined_persona
            )
        if brain_tools:
            tool_names = ", ".join(
                sorted({_tool_name(item) for item in brain_tools})
            )
            brain_system += (
                "\nYou may use only these tools: "
                f"{tool_names}."
            )
            brain_system += (
                "\nFor requests to inspect or replace table-row titles or "
                "properties that contain reference ids, use "
                "replace_reference_ids_in_titles with the source table and a "
                "label-to-reference-table mapping. Gnosi scans every row and "
                "calculates the complete plan on the server. Never enumerate or "
                "submit a partial model-authored sample. Do not claim "
                "that the Vault is inaccessible when these tools are available. "
                "When the current turn authorizes a bulk replacement, you MUST "
                "call replace_reference_ids_in_titles. Do not merely describe a "
                "planned update, say that you are awaiting confirmation, or send "
                "a final text response instead: only the tool call creates the "
                "required Gnosi review card."
            )
            always_confirmed_names = {
                item["name"]
                for item in runtime_tool_metadata
                if item.get("confirmation") == "always"
            }
            if always_confirmed_names:
                brain_system += (
                    "\nThese tools only prepare a pending review and never "
                    "perform their consequential action inside the model loop: "
                    + ", ".join(sorted(always_confirmed_names))
                    + ". Never claim they completed until Gnosi reports the "
                    "post-confirmation result."
                )
            authorized_guarded_names = (
                current_authorized_names.intersection(guarded_tool_names)
            )
            if authorized_guarded_names:
                confirmation_only_names = {
                    item["name"]
                    for item in runtime_tool_metadata
                    if item["name"] in authorized_guarded_names
                    and item.get("confirmation") == "always"
                }
                brain_system += (
                    "\nThe current user message explicitly authorizes only these "
                    "guarded tools for this turn: "
                    + ", ".join(sorted(authorized_guarded_names))
                    + ". Use them only to fulfill that explicit request. All other "
                    "writes remain prohibited. Confirm the actual tool result."
                )
                if confirmation_only_names:
                    brain_system += (
                        "\nThese consequential tools only prepare a pending action: "
                        + ", ".join(sorted(confirmation_only_names))
                        + ". Never claim the action has happened. It executes only "
                        "after the user confirms the exact preview in Gnosi."
                    )
            if guarded_tool_names and not authorized_guarded_names:
                brain_system += (
                    "\nNo guarded tool is authorized for this turn. Calls to write, "
                    "destructive, external, code-execution, or cost-bearing tools "
                    "will be denied by policy."
                )
        else:
            brain_system += (
                "\nNo tools are available for this model. Answer only from the "
                "conversation context and state clearly when external data cannot be checked."
            )
        if rejected_mcp_names:
            brain_system += (
                "\nThese integration tools are unavailable because their connector "
                "did not declare read-only safety metadata: "
                + ", ".join(rejected_mcp_names)
                + ". Explain this limitation if the request depends on one of them."
            )
        selected_brain_llm = brain_llm
        latest_context_tool = _latest_context_tool_since_latest_user(
            messages,
            context_tool_names,
        )
        read_tool_results = _tool_results_since_latest_user(messages)
        if context_tools and not latest_context_tool:
            if any(
                ref.get("type") == "internal" and ref.get("ref") == "reader"
                for ref in context_refs
            ):
                reader_job_id = _latest_reader_analysis_job_id(messages)
                routing_message = (
                    f"{latest_user} {reader_job_id}"
                    if reader_job_id and reader_job_id not in latest_user.lower()
                    else latest_user
                )
                required_context_tool = _required_reader_context_tool(
                    routing_message,
                )
            else:
                required_context_tool = _required_vault_context_tool(
                    latest_user,
                    context_refs,
                )
                deterministic_call = _deterministic_vault_context_call(
                    required_context_tool,
                    context_refs,
                )
                if deterministic_call:
                    return {
                        "messages": [AIMessage(
                            content="",
                            tool_calls=[deterministic_call],
                        )],
                        "next": "supervisor",
                    }
            selected_brain_llm = forced_context_llms.get(
                required_context_tool,
                next(iter(forced_context_llms.values()), brain_llm),
            )
            brain_system += (
                "\nThis answer depends on attached context. Your first response "
                f"MUST call {required_context_tool} as an actual tool. Do not "
                "answer, ask the user to attach data, or claim the source is "
                "unavailable before that tool result is returned."
            )
        elif (
            latest_context_tool in {"query_context_table", "read_context_source"}
            and not current_authorized_names
        ):
            # A table query already returns an exact, bounded page plus total and
            # pagination metadata. Removing tool bindings for the synthesis call
            # guarantees termination even with models that compulsively repeat
            # the same successful tool call.
            selected_brain_llm = llm
            brain_system += (
                "\nThe exact table-query result is already present in this turn. "
                "Answer directly from it now. Do not call another tool, repeat "
                "the query, or claim that the attached table is unavailable."
            )
        elif read_tool_results >= 3 and not current_authorized_names:
            # Some tool-eager models repeat broad successful reads instead of
            # synthesizing their evidence. The recursion limit is only a final
            # safety net; removing tool bindings here guarantees a user-visible
            # response before the graph reaches it.
            selected_brain_llm = llm
            brain_system += (
                "\nThe bounded read-tool budget for this turn is complete. "
                "Answer directly from the tool evidence already present now. "
                "Do not call another tool, repeat a query, or ask to continue."
            )
        response = selected_brain_llm.invoke(
            [SystemMessage(content=brain_system)] + _bounded_model_messages(messages, message_budget_chars),
        )
        return {"messages": [response], "next": "supervisor"}

    def general_node(state: AgentState):
        messages = state["messages"]
        # Use explicit persona for general conversation
        response = llm.invoke(
            [SystemMessage(content=general_prompt)] + _bounded_model_messages(messages, message_budget_chars)
        )
        return {"messages": [response], "next": "FINISH"}

    # --- Graph construction ---
    workflow = StateGraph(AgentState)
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("coder", coder_node)
    workflow.add_node("brain", brain_node)
    workflow.add_node("general", general_node)
    workflow.add_node("coder_tools", ToolNode(coder_tools))
    workflow.add_node(
        "brain_tools",
        ToolNode(
            brain_tools,
            wrap_tool_call=_tool_policy_wrapper(tool_policies),
        ),
    )

    workflow.add_edge(START, "supervisor")
    workflow.add_conditional_edges(
        "supervisor",
        lambda x: x["next"],
        {"Coder": "coder", "Brain": "brain", "General": "general", "FINISH": END},
    )

    def coder_router(state):
        last_message = state["messages"][-1]
        # A completed specialist reply must finish this graph. Sending it back
        # to the supervisor invokes strict providers with an assistant message
        # as the final conversational turn.
        return "coder_tools" if last_message.tool_calls else "END"

    workflow.add_conditional_edges(
        "coder",
        coder_router,
        {"coder_tools": "coder_tools", "END": END},
    )
    workflow.add_edge("coder_tools", "coder")

    def brain_router(state):
        last_message = state["messages"][-1]
        return "brain_tools" if last_message.tool_calls else "END"

    workflow.add_conditional_edges(
        "brain",
        brain_router,
        {"brain_tools": "brain_tools", "END": END},
    )

    def brain_tools_router(state):
        return (
            "END"
            if _latest_tool_batch_requires_confirmation(state["messages"])
            else "brain"
        )

    workflow.add_conditional_edges(
        "brain_tools",
        brain_tools_router,
        {"brain": "brain", "END": END},
    )
    workflow.add_edge("general", END)

    # 6. Return the uncompiled workflow + metadata of the chosen model
    return workflow, {
        "mode": llm_mode,
        "provider": provider_name,
        "model": model_name,
        "assigned_skill_ids": list(assigned_runtime_skill_ids),
        "active_skill_ids": list(active_runtime_skill_ids),
        "missing_skill_ids": list(
            getattr(resolved_runtime, "missing_skill_ids", ()) or ()
        ),
        "unavailable_tool_ids": sorted(
            set(
                list(getattr(resolved_runtime, "unavailable_tool_ids", ()) or ())
                + omitted_runtime_tool_ids
            )
        ),
        "catalog_revision": str(
            getattr(resolved_runtime, "catalog_revision", "") or ""
        ),
        "supports_tools": supports_tools,
        "tool_count": len(bound_tool_names),
        "context_window_tokens": context_window_tokens,
        "message_budget_chars": message_budget_chars,
        "tools": [
            {
                key: value
                for key, value in item.items()
                if not key.startswith("_")
            }
            for item in runtime_tool_metadata
        ],
        "turn_grant_tool_names": sorted(explicitly_activated_tool_names),
    }
