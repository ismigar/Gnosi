"""Validate a delegated result before its run completes; repair without actions."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator

from jsonschema import ValidationError
from langchain_core.messages import AIMessage

from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation

class TeamOutputContractError(ValueError):
    """A bounded repair failed; do not rerun the task graph or its actions."""


class CheckedTeamOutput:
    def __init__(self, application: Any, schema: dict[str, Any], snapshot: AgentExecutionSnapshot,
                 root_id: str, assignment: str) -> None:
        self.application, self.schema, self.snapshot = application, schema, snapshot
        self.root_id, self.assignment = root_id, assignment

    async def astream(self, inputs: Any, *, config: Any, stream_mode: str) -> AsyncIterator[Any]:
        from backend.agent.action_confirmations import confirmation_event
        from backend.services.agent_execution import _validate_output, execute_operation, _operation_timeout
        from backend.services.agent_execution_trace import record
        previous = None
        pending_confirmation = False
        async for event in self.application.astream(inputs, config=config, stream_mode=stream_mode):
            for update in event.values():
                for message in update.get("messages", []):
                    pending_confirmation |= bool(confirmation_event(getattr(message, "content", None)))
                    if getattr(message, "type", "") == "ai" and not getattr(message, "tool_calls", None):
                        previous = message
            yield event
        if pending_confirmation:
            return
        text = str(previous.text) if previous is not None else ""
        repaired = False
        try:
            checked = _validate_output(text, self.schema)
        except (ValueError, ValidationError) as error:
            record("team.output_validation", {"status": "repair_required", "error": str(error)[:500]})
            original = json.loads(self.assignment)
            try:
                result = await execute_operation(AgentOperation(
                    skill_id=self.snapshot.skill_ids[0], operation="team.repair", input=text,
                    data={"original_assignment": self.assignment, "validation_error": str(error)[:500],
                          "original_input": original.get("original_input", original.get("original_request", "")),
                          "original_data": original.get("original_data", {}),
                          "instruction": "Repair only the requested JSON format and types. Preserve supported values. Do not repeat actions."},
                    output_schema=self.schema, max_model_calls=1, tool_mode="none",
                    origin=self.snapshot.origin, timeout_seconds=_operation_timeout.get(),
                    parent_run_id=self.root_id, resume_requires_parent=True), snapshot=self.snapshot)
            except (ValueError, ValidationError) as repair_error:
                raise TeamOutputContractError("agent_team_invalid_output_after_repair") from repair_error
            checked, repaired = result.result, True
        record("team.output_validation", {"status": "repaired" if repaired else "validated"})
        metadata = dict(getattr(previous, "additional_kwargs", {}) or {})
        if "gnosi_visible_content" in metadata:
            metadata["gnosi_visible_content"] = checked
        metadata["gnosi_team_output"] = {"format": "json", "status": "repaired" if repaired else "validated"}
        yield {"team_output_validation": {"messages": [AIMessage(content=checked, additional_kwargs=metadata)]}}
