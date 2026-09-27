"""Validated tool transport for models without native function calling."""
from __future__ import annotations

import json
import uuid
from typing import Any

import jsonschema  # type: ignore[import-untyped]
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.utils.function_calling import convert_to_openai_tool

from backend.services.agent_behavior import resource
from backend.services.agent_execution_trace import record


class JsonToolModel:
    def __init__(self, model: Any, tools: list[Any] | None = None) -> None:
        self.model = model
        self.model_name = str(getattr(model, "model_name", "") or getattr(model, "model", ""))
        self.schemas = [convert_to_openai_tool(tool)["function"] for tool in tools or []]
        self.kwargs = {"tools": self.schemas, "transport": "validated-json"}

    def bind_tools(self, tools: Any, **kwargs: Any) -> JsonToolModel:
        return JsonToolModel(self.model, list(tools))

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        messages = input.to_messages() if hasattr(input, "to_messages") else input
        if not self.schemas:
            return self.model.invoke(messages, config=config, **kwargs)
        transported: list[Any] = [SystemMessage(content=resource("system/json-tools.md") + "\n" + json.dumps(self.schemas, ensure_ascii=False))]
        for message in messages:
            if isinstance(message, ToolMessage):
                transported.append(HumanMessage(content=json.dumps({"tool_result": message.content, "tool_call_id": message.tool_call_id}, ensure_ascii=False)))
            elif isinstance(message, AIMessage) and message.tool_calls:
                transported.append(AIMessage(content=json.dumps({"tool_calls": message.tool_calls}, ensure_ascii=False)))
            else:
                transported.append(message)
        from backend.services.agent_execution import _snapshot
        snapshot = _snapshot.get()
        if snapshot is not None:
            from backend.services.agent_context_budget import messages_budget
            from backend.domains.agent.runtime_tools import _model_context_window
            budget = messages_budget(transported, self.model_name, _model_context_window(str(snapshot.profile.get("provider") or ""), self.model_name))
            record("context.json_transport_budget", budget)
            if not budget["fits"]:
                raise RuntimeError("agent_model_context_exceeded")
        record("model.json_transport.request", {"messages": transported, "tools": self.schemas})
        response = self.model.invoke(transported, config=config, **kwargs)
        record("model.json_transport.response", response)
        try:
            answer = json.loads(response.content)
            if not isinstance(answer, dict):
                raise ValueError("object_required")
            if answer.get("action") == "finish" and isinstance(answer.get("text"), str):
                return response.model_copy(update={"content": answer["text"], "tool_calls": []})
            if answer.get("action") != "tool":
                raise ValueError("action_required")
            schema = next((item for item in self.schemas if item["name"] == answer.get("name")), None)
            if schema is None or not isinstance(answer.get("arguments"), dict):
                raise ValueError("authorized_tool_required")
            jsonschema.validate(answer["arguments"], schema["parameters"])
            return response.model_copy(update={"content": "", "tool_calls": [{"name": schema["name"], "args": answer["arguments"], "id": uuid.uuid4().hex, "type": "tool_call"}]})
        except (ValueError, TypeError, jsonschema.ValidationError) as error:
            raise RuntimeError("agent_model_json_tool_contract_unsupported") from error
