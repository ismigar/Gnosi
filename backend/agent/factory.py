import os
import operator
from typing import Annotated, TypedDict, List, Sequence, Optional
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

# Import eines
from backend.agent.system_tools import SYSTEM_TOOLS
from backend.agent.vault_tools import VAULT_KNOWLEDGE_TOOLS
from backend.agent.tools import get_mcp_tools
from backend.agent.generated_tools.creator import TOOL_CREATOR_TOOLS
from backend.agent.generated_tools.loader import loader as tool_loader
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

    decision = route_model(message, registry, is_available=_avail, usage=usage, budget=budget)
    if decision.get("provider") and decision.get("model_id"):
        return decision["provider"], decision["model_id"]
    return fallback_provider, fallback_model


# --- 1. Define the State ---
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next: str


# --- 2. Agent Prompts (Base) ---
DEFAULT_SUPERVISOR_PROMPT = """Ets el Supervisor del "Gnosi".
La teva feina és coordinar l'equip d'experts per resoldre la petició de l'usuari.

MEMBRES DE L'EQUIP:
1. **Coder**: Enginyer de Software Sènior. Expert en Python, Git, Tests i Sistema de Fitxers. 
2. **Brain**: Gestor de Coneixement i Automatització Sobirà. Expert en Gnosi Vault i Memòria a Llarg Termini.

INSTRUCCIONS DE ROUTING:
- Si l'usuari demana canvis de codi -> `Coder`.
- Si l'usuari demana informació personal, gestionar el Vault de **Gnosi** o gestionar **Directives/Procediments** -> `Brain`.
- Si és una xerrada general o una pregunta simple -> `General` (Tu mateix respons).
- Si un agent ha acabat la feina -> `FINISH`.

Retorna EXCLUSIVAMENT el nom del següent worker: 'Coder', 'Brain', 'General' o 'FINISH'.
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
            return ChatOllama(
                model=model or "llama3.2",
                base_url=base_url or "http://host.docker.internal:11434",
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
            log.debug(f"Instantiating ChatAnthropic with model {model or 'claude-3-5-sonnet-latest'}")
            return ChatAnthropic(
                model=model or "claude-3-5-sonnet-latest",
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

    except Exception as e:
        log.error(f"❌ Error instantiating LLM for provider '{provider}': {e}")
        return None

    # Fallback if the provider isn't recognized and there's no URL
    return None


def _get_hybrid_llm(timeout: Optional[float] = None):
    """Fallback logic looking for any available provider beyond the primary choice."""
    # List of fallback providers to check in order of quality/availability
    fallbacks = [
        ("openai", "gpt-4o-mini"),
        ("anthropic", "claude-3-5-haiku-latest"),
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
            return get_llm(
                provider=p_name,
                model=m_name,
                api_key=key,
                base_url=p_cfg.get(p_name, {}).get("base_url"),
                timeout=timeout,
            )

    return None


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
        llm = _get_hybrid_llm(timeout=timeout)
    return llm


def generate_text(prompt: str, user_message: str = "", timeout: int = 60) -> tuple[str, str]:
    """One-shot call to the default LLM. Returns (text, model_label).

    Raises RuntimeError if no AI provider is available, so that the
    caller can gracefully degrade (HTTP 503 / reminder without an agenda).
    
    """
    from langchain_core.messages import HumanMessage

    llm = get_default_llm(user_message=user_message or prompt[:200], timeout=timeout)
    if not llm:
        raise RuntimeError("No AI provider available")
    # The timeout already lives in the client (get_default_llm→get_llm). Do NOT pass
    # config={"timeout": ...}: langchain ignores it (it's not a RunnableConfig key).
    resp = llm.invoke([HumanMessage(content=prompt)])
    text = getattr(resp, "content", "") or ""
    if not isinstance(text, str):
        text = str(text)
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
) -> tuple[StateGraph, dict]:
    """
        Creates the Multi-Agent workflow (graph) based on a specific agent profile.
    Returns the uncompiled graph to allow adding checkpointers externally.
    
    """
    # 1. Get agent configuration from params.yaml
    ai_cfg = cfg.get("ai", {})
    agents = ai_cfg.get("agents", [])
    providers = ai_cfg.get("providers", {})
    
    # Prioritat: agent_id passat -> active_agent_id -> primer agent habilitat
    target_id = agent_id or ai_cfg.get("active_agent_id")
    
    agent_data = next((a for a in agents if a.get("id") == target_id), None)
    
    if not agent_data and agents:
        # Find the first enabled one, or the first in the list
        agent_data = next((a for a in agents if a.get("enabled", True)), agents[0])

    if not agent_data:

        return None, {}

    # 2. Configure LLM for the agent
    provider_name = agent_data.get("provider", "groq")
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

    p_cfg = providers.get(provider_name, {})
    resolved_api_key = resolve_provider_api_key(provider_name, p_cfg)

    llm = get_llm(
        provider=provider_name,
        model=model_name,
        api_key=resolved_api_key,
        base_url=p_cfg.get("base_url"),
    )

    if not llm:
        llm = _get_hybrid_llm()
        if llm:
            provider_name = "groq"
            model_name = "llama-3.3-70b-versatile"

    if not llm:

        return None, {}

    # 3. Preparar Prompts (Persona)
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

    supervisor_prompt = (
        f"Ets {agent_name}.\n{combined_persona}\n\n{DEFAULT_SUPERVISOR_PROMPT}"
        if combined_persona
        else f"Ets {agent_name}.\n{DEFAULT_SUPERVISOR_PROMPT}"
    )

    # 4. Convertir eines MCP
    mcp_langchain_tools = get_mcp_tools(mcp_tools_list, mcp_client)
    generated_tools = tool_loader.load_all_approved()

    # Coder & Brain specialists
    coder_tools = SYSTEM_TOOLS + TOOL_CREATOR_TOOLS + generated_tools
    coder_llm = llm.bind_tools(coder_tools)

    memory_tools = [
        t
        for t in SYSTEM_TOOLS
        if t.name
        in ["save_memory", "query_memory", "get_vault_registry", "search_vault"]
    ]
    brain_tools = mcp_langchain_tools + memory_tools + VAULT_KNOWLEDGE_TOOLS
    brain_llm = llm.bind_tools(brain_tools)

    # --- Graph Nodes ---

    def supervisor_node(state: AgentState):
        messages = state["messages"]
        prompt = [SystemMessage(content=supervisor_prompt)] + messages
        response = llm.invoke(prompt)

        decision = response.content.strip().replace("'", "").replace('"', "")
        if "Coder" in decision:
            return {"next": "Coder"}
        if "Brain" in decision:
            return {"next": "Brain"}
        if "General" in decision:
            return {"next": "General"}
        return {"next": "FINISH"}

    def coder_node(state: AgentState):
        messages = state["messages"]
        # Inject persona preference for coding style if defined? Optional for now.
        response = coder_llm.invoke(
            [SystemMessage(content="Ets el Coder Agent.")] + messages
        )
        return {"messages": [response], "next": "supervisor"}

    def brain_node(state: AgentState):
        messages = state["messages"]
        brain_system = (
            "Ets el Brain Agent (Gnosi Vault, Memòria Sobirana). Tens EINES per treballar amb "
            "les dades de l'usuari, no només cercar-les:\n"
            "- search_vault: cerca semàntica al vault.\n"
            "- read_page(id_o_títol) / read_pdf(ruta): llegeix una nota o un PDF d'Assets/Library.\n"
            "- create_page(title, content, folder): crea una nota nova.\n"
            "- propose_links(id_o_títol): proposa connexions [[...]] per a una pàgina.\n"
            "- summarize_to_cornell(source): resumeix una nota o PDF en una fitxa Cornell i la desa.\n"
            "Usa les eines quan l'usuari demani crear, resumir, connectar o organitzar coneixement. "
            "Confirma sempre el resultat (id/títol de la pàgina creada)."
        )
        response = brain_llm.invoke([SystemMessage(content=brain_system)] + messages)
        return {"messages": [response], "next": "supervisor"}

    def general_node(state: AgentState):
        messages = state["messages"]
        # Use explicit persona for general conversation
        response = llm.invoke(
            [SystemMessage(content=persona or "Ets un assistent útil.")] + messages
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
        return "coder_tools" if last_message.tool_calls else "supervisor"

    workflow.add_conditional_edges(
        "coder",
        coder_router,
        {"coder_tools": "coder_tools", "supervisor": "supervisor"},
    )
    workflow.add_edge("coder_tools", "coder")

    def brain_router(state):
        last_message = state["messages"][-1]
        return "brain_tools" if last_message.tool_calls else "supervisor"

    workflow.add_conditional_edges(
        "brain",
        brain_router,
        {"brain_tools": "brain_tools", "supervisor": "supervisor"},
    )
    workflow.add_edge("brain_tools", "brain")
    workflow.add_edge("general", END)

    # 6. Return the uncompiled workflow + metadata of the chosen model
    return workflow, {
        "mode": llm_mode,
        "provider": provider_name,
        "model": model_name,
    }
