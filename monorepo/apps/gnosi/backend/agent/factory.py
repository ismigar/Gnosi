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
    """Auto-selecció de model: delega al router data-driven conscient de pressupost.

    Camí modern: `model_router.route_model` (registry editable + capacitat + disponibilitat
    + tokens/cost). Si el router no resol, manté el fallback de l'agent. Substitueix els
    antics stacks hardcoded (cf. directiva `vault_knowledge_agents.md`).
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


# --- 1. Definir l'Estat ---
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next: str


# --- 2. Prompts dels Agents (Base) ---
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

# --- 3. Gestió de Proveïdors de LLM ---


def get_llm(
    provider: str,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
):
    """
    Instancia un LLM segons el proveïdor i la configuració.
    """
    # Tractar cadenes buides com a None per forçar el fallback a env vars
    if not api_key:
        api_key = None
    if not base_url:
        base_url = None

    try:
        if provider == "ollama":
            from langchain_ollama import ChatOllama
            log.debug(f"Instantiating ChatOllama with model {model or 'llama3.2'}")
            return ChatOllama(
                model=model or "llama3.2",
                base_url=base_url or "http://host.docker.internal:11434",
                timeout=60,
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
            )

        # Generic OpenAI compatible (Local, LM Studio, etc.) or unknown provider with base_url
        if provider in {"local", "generic", "lmstudio", "llama-cpp"} or base_url:
            from langchain_openai import ChatOpenAI
            log.debug(f"Instantiating Generic/Universal ChatOpenAI (Provider: {provider})")
            return ChatOpenAI(
                model=model or "local-model",
                api_key=api_key or "no-key",
                base_url=base_url or "http://localhost:8000/v1",
            )

    except Exception as e:
        log.error(f"❌ Error instantiating LLM for provider '{provider}': {e}")
        return None

    # Fallback si no es reconeix el proveïdor i no hi ha URL
    return None


def _get_hybrid_llm():
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
                base_url=p_cfg.get(p_name, {}).get("base_url")
            )

    return None


def get_default_llm(user_message: str = ""):
    """Retorna un LLM llest per a crides one-shot (generació de contingut,
    resums, ordre del dia de reunions…).

    Resol el proveïdor/model com ho fa l'agent: agent actiu → selecció `auto`
    segons el missatge → fallback híbrid (qualsevol proveïdor amb clau). Usa la
    config FRESCA de params.yaml (no la cachejada a import) perquè reculli
    proveïdors afegits en calent. Torna None si no n'hi ha cap de disponible.

    NOTA: és el camí MODERN (get_llm + resolve_provider_api_key), a diferència
    del client legacy `pipeline/ai_client.py` que espera `model_url`/`model_name`
    per proveïdor (incompatible amb l'esquema de proveïdors actual).
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

    # Sense agent definit (o sense proveïdor), tria automàticament segons el text.
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
        )

    if not llm:
        llm = _get_hybrid_llm()
    return llm


def generate_text(prompt: str, user_message: str = "", timeout: int = 60) -> tuple[str, str]:
    """Crida one-shot a l'LLM per defecte. Retorna (text, etiqueta_model).

    Llança RuntimeError si no hi ha cap proveïdor d'IA disponible, perquè el
    caller pugui degradar amb elegància (HTTP 503 / recordatori sense agenda).
    """
    from langchain_core.messages import HumanMessage

    llm = get_default_llm(user_message=user_message or prompt[:200])
    if not llm:
        raise RuntimeError("No AI provider available")
    resp = llm.invoke([HumanMessage(content=prompt)], config={"timeout": timeout})
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
    Crea el workflow (graf) Multi-Agent basat en un perfil d'agent específic.
    Retorna el graf sense compilar per permetre afegir checkpointers externament.
    """
    # 1. Obtenir configuració de l'agent des de params.yaml
    ai_cfg = cfg.get("ai", {})
    agents = ai_cfg.get("agents", [])
    providers = ai_cfg.get("providers", {})
    
    # Prioritat: agent_id passat -> active_agent_id -> primer agent habilitat
    target_id = agent_id or ai_cfg.get("active_agent_id")
    
    agent_data = next((a for a in agents if a.get("id") == target_id), None)
    
    if not agent_data and agents:
        # Trobar el primer habilitat o el primer de la llista
        agent_data = next((a for a in agents if a.get("enabled", True)), agents[0])

    if not agent_data:

        return None, {}

    # 2. Configurar LLM per l'agent
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

    # --- Nodes del Graf ---

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
            "- read_page(id_o_títol) / read_pdf(ruta): llegeix una nota o un PDF d'Assets/Biblioteca.\n"
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

    # --- Construcció del Graf ---
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

    # 6. Retornar el workflow sense compilar + metadata del model escollit
    return workflow, {
        "mode": llm_mode,
        "provider": provider_name,
        "model": model_name,
    }
