import os
import operator
from typing import Annotated, TypedDict, List, Sequence
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import StateGraph, END, START
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.sqlite import SqliteSaver

# Import LLM providers - Hybrid system: Ollama (primary) + Groq (fallback)
try:
    from langchain_ollama import ChatOllama

    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False

try:
    from langchain_openai import ChatOpenAI  # Also works for Groq

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
from config.app_config import load_params

cfg = load_params(strict_env=False)
BASE_DIR = Path(__file__).resolve().parent.parent.parent


# --- 1. Definir l'Estat ---
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next: str


# --- 2. Prompts dels Agents ---
SUPERVISOR_PROMPT = """Ets el Supervisor del "Digital Brain".
La teva feina és coordinar l'equip d'experts per resoldre la petició de l'usuari.

MEMBRES DE L'EQUIP:
1. **Coder**: Enginyer de Software Sènior. Expert en Python, Git, Tests i Sistema de Fitxers. 
   - Usa'l per: Crear codi, aplicar patchs, fer tests, gestionar git, llegir fitxers locals.
2. **Brain**: Gestor de Coneixement i Automatització. Expert en Notion, n8n i Memòria a Llarg Termini.
   - Usa'l per: Consultar/guardar a Notion, executar workflows n8n, guardar/recuperar records (RAG).

INSTRUCCIONS DE ROUTING:
- Si l'usuari demana canvis de codi -> `Coder`.
- Si l'usuari demana informació personal, Notion, n8n o gestionar **Directives/Procediments** -> `Brain`.
- Si és una xerrada general ("Hola", "Gràcies") o una pregunta simple -> `General` (Tu mateix respons).
- Si un agent ha acabat la feina i cal informar l'usuari -> `FINISH`.

NOTA: Anima als agents a consultar les Directives existents abans d'inventar-se solucions.

Retorna EXCLUSIVAMENT el nom del següent worker: 'Coder', 'Brain', 'General' o 'FINISH'.
"""

CODER_PROMPT = """Ets el **Coder Agent** (Enginyer Sènior).
Tens accés al sistema de fitxers i Git.
PROTOCOL:
1. Inspect -> Branch -> Patch -> Test -> Commit.
2. No inventis fitxers que no has llegit.
3. Si trobes un error, fes servir `grep` o `search_code_symbols` per ubicar-te.
"""

BRAIN_PROMPT = """Ets el **Brain Agent** (Gestor de Coneixement i Procediments).
Tens accés a:
- Notion (Llegir/Escriure pàgines).
- n8n (Executar workflows).
- Memòria Vectorial (RAG).
- **Directives (SOPs)**: Fitxers Markdown amb instruccions procedurals (`list_directives`, `read_directive`, `update_directive`).

PROTOCOL DE MEMÒRIA PROCEDURAL:
1. **Llegir**: Abans de fer una tasca complexa, comprova si existeix una directiva (`list_directives` -> `read_directive`).
2. **Executar**: Segueix les instruccions.
3. **Actualitzar**: Si aprens alguna cosa nova o corregeixes un error, ACTUALITZA la directiva (`update_directive`).
   - Això és crucial: La teva feina no és només fer la tasca, sinó documentar COM fer-la millor per la pròxima vegada.
"""


def _get_hybrid_llm():
    """
    Get LLM with hybrid provider support:
    1. Ollama (local, primary) - if available
    2. Groq (cloud, fallback) - free tier
    3. OpenAI (fallback) - if API key exists
    """
    groq_key = os.environ.get("HF_API_KEY") or os.environ.get("GROQ_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")

    llms = []

    # 1. Try Ollama (local, free, no limits)
    if OLLAMA_AVAILABLE:
        try:
            ollama_llm = ChatOllama(
                model="llama3.2",
                base_url="http://localhost:11434",
                timeout=30,  # Reduït per evitar penjaments llargs
            )
            # No provem l'invoke aquí, ja que és síncron i bloqueja el lifespan.
            # Confiem en que si Ollama està configurat com a primari, s'usarà quan calgui.
            print("✅ Agent configured with Ollama (local)")
            return ollama_llm
        except Exception as e:
            print(f"⚠️ Ollama not available: {e}")

    # 2. Try Groq (free tier, fast)
    if OPENAI_COMPATIBLE_AVAILABLE and groq_key:
        try:
            groq_llm = ChatOpenAI(
                model="llama-3.3-70b-versatile",
                api_key=groq_key,
                base_url="https://api.groq.com/openai/v1",
            )
            print("✅ Agent using Groq (cloud)")
            return groq_llm
        except Exception as e:
            print(f"⚠️ Groq not available: {e}")

    # 3. Fallback to OpenAI
    if OPENAI_COMPATIBLE_AVAILABLE and openai_key:
        print("✅ Agent using OpenAI (cloud)")
        return ChatOpenAI(model="gpt-4o", api_key=openai_key)

    print("❌ CRITICAL: No LLM provider available.")
    return None


# --- 3. Definir Factory ---
def build_graph(mcp_tools_list: List[dict], mcp_client):
    """
    Construeix un graf Multi-Agent: Supervisor -> [Coder, Brain, General].
    Uses hybrid LLM: Ollama (local) / Groq (cloud) / OpenAI (fallback)
    """

    # Configurar LLM Base amb sistema híbrid
    llm = _get_hybrid_llm()
    if not llm:
        return None

    # 1. Convertir eines MCP a LangChain Tools
    mcp_langchain_tools = get_mcp_tools(mcp_tools_list, mcp_client)

    # --- Configurar Agents Especialistes ---

    # Load any approved generated tools
    generated_tools = tool_loader.load_all_approved()

    # Coder: Eines de sistema + Eines de creació d'eines + Eines generades
    coder_tools = SYSTEM_TOOLS + TOOL_CREATOR_TOOLS + generated_tools
    coder_llm = llm.bind_tools(coder_tools)

    # Brain: Eines MCP + Memory tools
    memory_tools = [
        t for t in SYSTEM_TOOLS if t.name in ["save_memory", "query_memory"]
    ]
    brain_tools = mcp_langchain_tools + memory_tools
    brain_llm = llm.bind_tools(brain_tools)

    # --- Nodes del Graf ---

    def supervisor_node(state: AgentState):
        messages = state["messages"]
        prompt = [SystemMessage(content=SUPERVISOR_PROMPT)] + messages
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
        response = coder_llm.invoke([SystemMessage(content=CODER_PROMPT)] + messages)
        return {"messages": [response], "next": "supervisor"}

    def brain_node(state: AgentState):
        messages = state["messages"]
        response = brain_llm.invoke([SystemMessage(content=BRAIN_PROMPT)] + messages)
        return {"messages": [response], "next": "supervisor"}

    def general_node(state: AgentState):
        messages = state["messages"]
        response = llm.invoke(
            [SystemMessage(content="Ets un assistent útil.")] + messages
        )
        return {"messages": [response], "next": "FINISH"}

    # --- Construcció del Graf ---
    workflow = StateGraph(AgentState)

    # 3. Define Nodes
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("coder", coder_node)
    workflow.add_node("brain", brain_node)
    workflow.add_node("general", general_node)

    # Tool Nodes
    workflow.add_node("coder_tools", ToolNode(coder_tools))
    workflow.add_node("brain_tools", ToolNode(brain_tools))

    # 4. Define Edges
    workflow.add_edge(START, "supervisor")

    workflow.add_conditional_edges(
        "supervisor",
        lambda x: x["next"],
        {"Coder": "coder", "Brain": "brain", "General": "general", "FINISH": END},
    )

    # Tool Logic for Workers
    def coder_router(state):
        messages = state["messages"]
        last_message = messages[-1]
        if last_message.tool_calls:
            return "coder_tools"
        return "supervisor"

    workflow.add_conditional_edges(
        "coder",
        coder_router,
        {"coder_tools": "coder_tools", "supervisor": "supervisor"},
    )
    workflow.add_edge("coder_tools", "coder")

    def brain_router(state):
        messages = state["messages"]
        last_message = messages[-1]
        if last_message.tool_calls:
            return "brain_tools"
        return "supervisor"

    workflow.add_conditional_edges(
        "brain",
        brain_router,
        {"brain_tools": "brain_tools", "supervisor": "supervisor"},
    )
    workflow.add_edge("brain_tools", "brain")

    workflow.add_edge("general", END)

    # 6. Compilar amb Checkpointer (SQLite)
    db_path = cfg.paths["CHECKPOINTS"] / "checkpoints.sqlite"
    os.makedirs(db_path.parent, exist_ok=True)

    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    memory = SqliteSaver(conn)

    return workflow.compile(checkpointer=memory)
