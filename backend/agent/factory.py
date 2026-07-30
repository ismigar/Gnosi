import os
import operator
from typing import Annotated, Any, TypedDict, List, Sequence, Optional
import logging
from langchain_core.messages import BaseMessage, SystemMessage
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
from backend.agent.agent_context import build_context_tools, describe_context_refs
from backend.agent.tools import get_mcp_tools
from backend.config.app_config import load_params
from backend.security.ai_credentials import resolve_provider_api_key

cfg = load_params(strict_env=False)
BASE_DIR = cfg.paths.get("PROJECT_DIR") or Path(__file__).resolve().parent.parent.parent
INSTRUCTIONS_DIR = cfg.paths.get("AGENT_INSTRUCTIONS") or (Path(__file__).resolve().parent / "instructions")
log = logging.getLogger(__name__)


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
    tool_intent = any(word in text for word in (
        "calendar", "calendari", "calendario", "meeting", "reunió", "reunion",
        "reuniones", "mail", "email", "correu", "correo", "notion", "zotero",
        "weather", "temps", "tiempo", "search", "cerca", "busca", "find",
    ))
    if has_mention or tool_intent or (has_context and any(word in text for word in (
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


def _explicit_brain_write_tool_names(message: str) -> set[str]:
    """Authorize individual Brain mutations from explicit current-turn wording."""
    text = " ".join((message or "").strip().lower().split())
    if not text:
        return set()

    authorized: set[str] = set()
    cornell_actions = (
        "crea", "crear", "fes", "prepara", "genera",
        "create", "make", "prepare", "generate", "summarize",
        "resume", "haz", "prepara", "genera", "résume", "crée", "prépare",
    )
    if "cornell" in text and any(action in text for action in cornell_actions):
        authorized.add("summarize_to_cornell")

    page_patterns = (
        "crea una pàgina", "crea una pagina", "crea una nota",
        "crear una pàgina", "crear una pagina", "crear una nota",
        "create a page", "create a note", "make a page", "make a note",
        "crea una página", "crear una página", "haz una página", "haz una nota",
        "crée une page", "crée une note", "créer une page", "créer une note",
    )
    if "cornell" not in text and any(pattern in text for pattern in page_patterns):
        authorized.add("create_page")

    memory_patterns = (
        "guarda-ho a la memòria", "guarda això a la memòria",
        "desa-ho a la memòria", "desa això a la memòria",
        "recorda que ", "recorda això",
        "save this to memory", "store this in memory", "remember that ",
        "guárdalo en la memoria", "guarda esto en la memoria",
        "recuerda que ", "mémorise ", "enregistre ceci en mémoire",
    )
    if any(pattern in text for pattern in memory_patterns):
        authorized.add("save_memory")

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
        if any(pattern in text for pattern in patterns):
            authorized.add(name)

    confirmation_words = (
        "confirmo", "confirma", "confirmat", "confirmed", "i confirm",
        "confirm deletion", "confirmo la eliminación", "je confirme",
    )
    delete_patterns = (
        "elimina la pàgina", "esborra la pàgina", "delete the page",
        "remove the page", "elimina la página", "supprime la page",
    )
    if (
        any(word in text for word in confirmation_words)
        and any(pattern in text for pattern in delete_patterns)
    ):
        authorized.add("delete_page")

    confirmed_patterns = {
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
    }
    if any(word in text for word in confirmation_words):
        for name, patterns in confirmed_patterns.items():
            if any(pattern in text for pattern in patterns):
                authorized.add(name)

    return authorized


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
    """Respect an explicit agent override, then the editable model registry."""
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
    # Unknown/custom models fail closed. Agent profiles can explicitly opt in
    # through `capabilities.tools: true` after compatibility is verified.
    return False


# --- 1. Define the State ---
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next: str


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
    ai_cfg = load_params(strict_env=False).get("ai", {}) or {}
    agents = ai_cfg.get("agents", [])
    providers = ai_cfg.get("providers", {})
    
        # Priority: supplied agent_id -> active_agent_id -> first enabled agent.
    target_id = agent_id or ai_cfg.get("active_agent_id")
    
    agent_data = next((a for a in agents if a.get("id") == target_id), None)
    
    if not agent_data and agents:
        # Find the first enabled one, or the first in the list
        agent_data = next((a for a in agents if a.get("enabled", True)), agents[0])

    if not agent_data:

        return None, {}

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

        # 3. Prepare prompts (persona).
    persona = agent_data.get("persona", "")
    agent_name = agent_data.get("name", "Gnosy")
    
    # Load detailed persona from markdown if exists
    persona_file = INSTRUCTIONS_DIR / f"{target_id}.md"
    detailed_persona = ""
    if persona_file.exists():
        try:
            detailed_persona = persona_file.read_text(encoding="utf-8")
        except Exception as e:
            log.warning(f"Could not read persona file {persona_file}: {e}")
    
    combined_persona = f"{persona}\n\n{detailed_persona}" if detailed_persona else persona

    # Free-text notes go into the prompt verbatim (short and always relevant);
    # attached sources contribute only their INVENTORY — the agent reads them
    # on demand through the context tools (directive `agent_context_sources.md`).
    context_notes = (agent_data.get("context") or "").strip()
    context_refs = agent_data.get("context_refs") or []
    context_block = "\n\n".join(
        part for part in (
            f"Working context provided by the user:\n{context_notes}" if context_notes else "",
            describe_context_refs(context_refs),
        ) if part
    )
    if context_block:
        combined_persona = f"{combined_persona}\n\n{context_block}" if combined_persona else context_block

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
    authorized_write_names = _explicit_brain_write_tool_names(user_message)
    # Coder & Brain specialists
    coder_tools = (
        _coder_read_only_tools(READ_ONLY_SYSTEM_TOOLS)
        if supports_tools
        else []
    )
    coder_llm = llm.bind_tools(coder_tools) if coder_tools else llm

    memory_tools = [
        t
        for t in READ_ONLY_SYSTEM_TOOLS
        if t.name
        in ["save_memory", "query_memory", "get_vault_registry", "search_vault"]
    ]
    # Tools scoped to the sources the user attached to THIS agent. They close over
    # its refs, so an agent can never read another agent's context.
    context_tools = build_context_tools(context_refs)
    read_only_vault_tools = [
        item for item in VAULT_KNOWLEDGE_TOOLS
        if item.name in {"read_page", "read_pdf", "propose_links", "query_wiki"}
    ]
    read_only_vault_tools += GNOSI_READ_TOOLS
    authorized_write_tools = _authorized_brain_write_tools(authorized_write_names)
    brain_tools = (
        mcp_langchain_tools
        + memory_tools
        + read_only_vault_tools
        + context_tools
        + authorized_write_tools
        if supports_tools
        else []
    )
    brain_llm = llm.bind_tools(brain_tools) if brain_tools else llm

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
        obvious = (
            "Brain"
            if authorized_write_names
            else _obvious_route(latest_user, has_context=bool(context_refs))
        )
        if obvious:
            return {"next": obvious}
        prompt = [SystemMessage(content=supervisor_prompt)] + messages
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
        # Inject persona preference for coding style if defined? Optional for now.
        response = coder_llm.invoke(
            [SystemMessage(content="You are the Coder Agent.")] + messages
        )
        return {"messages": [response], "next": "supervisor"}

    def brain_node(state: AgentState):
        messages = state["messages"]
        brain_system = "You are the Brain Agent (Gnosi Vault, Sovereign Memory)."
        if brain_tools:
            tool_names = ", ".join(sorted({item.name for item in brain_tools}))
            brain_system += (
                "\nYou may use only these tools: "
                f"{tool_names}."
            )
            if authorized_write_names:
                brain_system += (
                    "\nThe current user message explicitly authorizes only these "
                    "write tools for this turn: "
                    + ", ".join(sorted(authorized_write_names))
                    + ". Use them only to fulfill that explicit request. All other "
                    "writes remain prohibited. Confirm the actual tool result."
                )
            else:
                brain_system += (
                    "\nAll available tools are read-only. Never claim to have "
                    "created, edited, or stored data."
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
        if context_tools:
            # The Brain node is the one holding the context tools, so it needs the
            # INVENTORY too: without it the model does not know which source ids
            # exist and starts inventing references (observed with llama-3.3-70b,
            # which answered from memory after three fabricated BOE ids 404'd).
            brain_system += "\n\n" + describe_context_refs(context_refs)
        response = brain_llm.invoke([SystemMessage(content=brain_system)] + messages)
        return {"messages": [response], "next": "supervisor"}

    def general_node(state: AgentState):
        messages = state["messages"]
        # Use explicit persona for general conversation
        response = llm.invoke(
            [SystemMessage(content=general_prompt)] + messages
        )
        return {"messages": [response], "next": "FINISH"}

    # --- Graph construction ---
    workflow = StateGraph(AgentState)
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("coder", coder_node)
    workflow.add_node("brain", brain_node)
    workflow.add_node("general", general_node)
    workflow.add_node("coder_tools", ToolNode(coder_tools))
    workflow.add_node("brain_tools", ToolNode(brain_tools))

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
    workflow.add_edge("brain_tools", "brain")
    workflow.add_edge("general", END)

    # 6. Return the uncompiled workflow + metadata of the chosen model
    return workflow, {
        "mode": llm_mode,
        "provider": provider_name,
        "model": model_name,
    }
