import os
import operator
from typing import Annotated, TypedDict, List, Sequence, Optional
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

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from pydantic import BaseModel
import sqlite3
from pathlib import Path

# Import eines
from backend.agent.system_tools import SYSTEM_TOOLS
from backend.agent.tools import get_mcp_tools
from backend.agent.generated_tools.creator import TOOL_CREATOR_TOOLS
from backend.agent.generated_tools.loader import loader as tool_loader
from backend.config.app_config import load_params

cfg = load_params(strict_env=False)
BASE_DIR = Path(__file__).resolve().parent.parent.parent


# --- 1. Definir l'Estat ---
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next: str


# --- 2. Prompts dels Agents (Base) ---
DEFAULT_SUPERVISOR_PROMPT = """Ets el Supervisor del "Digital Brain".
La teva feina és coordinar l'equip d'experts per resoldre la petició de l'usuari.

MEMBRES DE L'EQUIP:
1. **Coder**: Enginyer de Software Sènior. Expert en Python, Git, Tests i Sistema de Fitxers. 
2. **Brain**: Gestor de Coneixement i Automatització. Expert en Notion, n8n i Memòria a Llarg Termini.

INSTRUCCIONS DE ROUTING:
- Si l'usuari demana canvis de codi -> `Coder`.
- Si l'usuari demana informació personal, Notion, n8n o gestionar **Directives/Procediments** -> `Brain`.
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
            return ChatOllama(
                model=model or "llama3.2",
                base_url=base_url or "http://localhost:11434",
                timeout=60,
            )

        if provider == "openai":
            key = api_key or os.environ.get("OPENAI_API_KEY")
            if not key:
                print(f"❌ Error: OpenAI API Key missing for provider '{provider}'")
                return None
            return ChatOpenAI(
                model=model or "gpt-4o",
                api_key=key,
                base_url=base_url or "https://api.openai.com/v1",
            )

        if provider == "groq":
            key = api_key if api_key and api_key.strip() else os.environ.get("GROQ_API_KEY")
            if not key:
                log.warning(f"⚠️ Groq API Key missing. Provided in config: '{api_key}', Env: '{os.environ.get('GROQ_API_KEY') is not None}'")
                return None
            return ChatOpenAI(
                model=model or "llama-3.3-70b-versatile",
                api_key=key,
                base_url=base_url or "https://api.groq.com/openai/v1",
            )

        if provider == "anthropic":
            key = api_key if api_key and api_key.strip() else os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                log.warning(f"⚠️ Anthropic API Key missing. Provider: '{provider}'")
                return None
            return ChatAnthropic(
                model=model or "claude-3-5-sonnet-latest",
                api_key=key,
            )

        # Generic OpenAI compatible (e.g. Local LLM via LM Studio / vLLM)
        if provider == "local" or provider == "generic":
            return ChatOpenAI(
                model=model or "local-model",
                api_key=api_key or "no-key",
                base_url=base_url or "http://localhost:8000/v1",
            )

    except Exception as e:
        print(f"❌ Exception initializing LLM provider '{provider}': {e}")
        return None

    # Fallback si no es reconeix el proveïdor
    print(f"⚠️ Provider '{provider}' not explicitly handled, falling back to hybrid.")
    return None


def _get_hybrid_llm():
    """Fallback logic for legacy support or missing config."""
    groq_key = os.environ.get("HF_API_KEY") or os.environ.get("GROQ_API_KEY")
    if OPENAI_COMPATIBLE_AVAILABLE and groq_key:
        return ChatOpenAI(
            model="llama-3.3-70b-versatile",
            api_key=groq_key,
            base_url="https://api.groq.com/openai/v1",
        )
    return None


# --- 4. Definir Factory ---


async def create_agent_workflow(mcp_tools_list: List[dict], mcp_client, agent_id: str = "gnosy") -> StateGraph:
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
        print(f"❌ Error: Agent '{target_id}' not found and no defaults available.")
        return None

    # 2. Configurar LLM per l'agent
    provider_name = agent_data.get("provider", "groq")
    p_cfg = providers.get(provider_name, {})

    llm = get_llm(
        provider=provider_name,
        model=agent_data.get("model"),
        api_key=p_cfg.get("api_key"),
        base_url=p_cfg.get("base_url"),
    )

    if not llm:
        llm = _get_hybrid_llm()

    if not llm:
        print(f"❌ CRITICAL: No LLM provider available for agent '{agent_data.get('name')}'.")
        return None

    # 3. Preparar Prompts (Persona)
    persona = agent_data.get("persona", "")
    agent_name = agent_data.get("name", "Gnosy")
    
    supervisor_prompt = (
        f"Ets {agent_name}.\n{persona}\n\n{DEFAULT_SUPERVISOR_PROMPT}"
        if persona
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
    brain_tools = mcp_langchain_tools + memory_tools
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
        response = brain_llm.invoke(
            [SystemMessage(content="Ets el Brain Agent (Notion, Vault).")] + messages
        )
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

    # 6. Retornar el workflow sense compilar
    return workflow
