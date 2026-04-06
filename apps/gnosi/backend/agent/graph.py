import os
import operator
from typing import Annotated, TypedDict, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END

# Configurar model
# Utilitzem 'gpt-3.5-turbo' o el que estigui definit a la config, 
# però per defecte intentem llegir de l'entorn.
# Si no hi ha API Key, utilitzarem un comportament "mock" per evitar errors en arrencada.

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]

def chatbot_node(state: AgentState):
    """
    Node principal que processa l'entrada.
    """
    messages = state["messages"]
    last_message = messages[-1]
    
    # Aquí aniria la lògica real amb LLM.
    # Per a la Fase 1, fem una comprovació simple per veure si tenim API KEY.
    api_key = os.environ.get("HF_API_KEY") or os.environ.get("OPENAI_API_KEY")
    
    if not api_key:
        return {"messages": [AIMessage(content=f"No tinc API Key configurada, però t'he sentit: {last_message.content}")]}
        
    try:
        # Intentem usar el client AI existent o LangChain directament
        # Per simplicitat en Fase 1, instanciem aquí (idealment moure a config)
        llm = ChatOpenAI(model="gpt-3.5-turbo", api_key=api_key)
        response = llm.invoke(messages)
        return {"messages": [response]}
    except Exception as e:
        return {"messages": [AIMessage(content=f"Error cridant LLM: {str(e)}. (Missatge original: {last_message.content})")]}

# Construcció del Graf
workflow = StateGraph(AgentState)
workflow.add_node("chatbot", chatbot_node)
workflow.set_entry_point("chatbot")
workflow.add_edge("chatbot", END)

# Compilar
app = workflow.compile()
