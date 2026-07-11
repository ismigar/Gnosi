import os
import operator
from typing import Annotated, TypedDict, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END

# Configurar model
# We use 'gpt-3.5-turbo' or whatever is defined in the config, 
# but by default we try to read from the environment.
# If there is no API Key, we'll use "mock" behavior to avoid errors on startup.

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]

def chatbot_node(state: AgentState):
    """
        Main node that processes the input.
    
    """
    messages = state["messages"]
    last_message = messages[-1]
    
    # The real LLM logic would go here.
    # For Phase 1, we do a simple check to see if we have an API KEY.
    api_key = os.environ.get("HF_API_KEY") or os.environ.get("OPENAI_API_KEY")
    
    if not api_key:
        return {"messages": [AIMessage(content=f"No tinc API Key configurada, però t'he sentit: {last_message.content}")]}
        
    try:
        # We try to use the existing AI client or LangChain directly
        # For simplicity in Phase 1, we instantiate here (ideally move to config)
        llm = ChatOpenAI(model="gpt-3.5-turbo", api_key=api_key)
        response = llm.invoke(messages)
        return {"messages": [response]}
    except Exception as e:
        return {"messages": [AIMessage(content=f"Error cridant LLM: {str(e)}. (Missatge original: {last_message.content})")]}

# Graph construction
workflow = StateGraph(AgentState)
workflow.add_node("chatbot", chatbot_node)
workflow.set_entry_point("chatbot")
workflow.add_edge("chatbot", END)

# Compilar
app = workflow.compile()
