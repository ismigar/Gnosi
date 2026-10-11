"""Check explicit references locally; repair once with the same frozen executor."""
from __future__ import annotations

from typing import Any, AsyncIterator

from langchain_core.messages import AIMessage

from backend.services.agent_correction_contracts import CorrectionContract, correction_contract
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation


class CheckedCorrectionOutput:
    def __init__(self, application: Any, contract: CorrectionContract, snapshot: AgentExecutionSnapshot,
                 run_id: str, original: str) -> None:
        self.application, self.contract, self.snapshot = application, contract, snapshot
        self.run_id, self.original = run_id, original

    async def astream(self, inputs: Any, *, config: Any, stream_mode: str) -> AsyncIterator[Any]:
        from backend.agent.action_confirmations import confirmation_event
        from backend.services.agent_execution import execute_operation, _operation_timeout
        from backend.services.agent_execution_trace import record
        buffered, previous, pending = [], None, False
        async for event in self.application.astream(inputs, config=config, stream_mode=stream_mode):
            visible = False
            for update in event.values():
                for message in update.get("messages", []):
                    pending |= (bool(confirmation_event(getattr(message, "content", None)))
                                or getattr(message, "type", "") == "tool" or bool(getattr(message, "tool_calls", None)))
                    if getattr(message, "type", "") == "ai" and not getattr(message, "tool_calls", None):
                        previous, visible = message, True
            if visible:
                buffered.append(event)
            else:
                yield event
        if pending:
            for event in buffered:
                yield event
            return
        text = str(previous.text) if previous is not None else ""
        try:
            self.contract.validate(text)
        except ValueError as error:
            record("writing.correction_validation", {"status": "repair_required", "error": str(error)})
            repaired = await execute_operation(AgentOperation(
                skill_id="core.gnosi-operation-writing", operation="writing.correct.repair", input=self.contract.source,
                data={"task": "writing.correct", "original_request": self.original, "previous_attempt": text,
                      "validation_error": str(error), "instruction": "Correct the original source grammar, keeping its explicit reference, quantities, identifiers and negation. The previous attempt is erroneous evidence. Return only the corrected text. Do not perform or repeat actions."},
                max_model_calls=1, tool_mode="none", timeout_seconds=_operation_timeout.get(),
                origin=self.snapshot.origin, parent_run_id=self.run_id, resume_requires_parent=True),
                snapshot=self.snapshot, output_validator=self.contract.validate)
            metadata = dict(getattr(previous, "additional_kwargs", {}) or {})
            if "gnosi_visible_content" in metadata:
                metadata["gnosi_visible_content"] = repaired.result
            metadata["gnosi_correction_output"] = {"status": "repaired", "checks": "explicit_references"}
            record("writing.correction_validation", {"status": "repaired"})
            yield {"correction_validation": {"messages": [AIMessage(content=repaired.result, additional_kwargs=metadata)]}}
        else:
            record("writing.correction_validation", {"status": "validated"})
            for event in buffered:
                yield event


def checked_correction_workflow(application: Any, inputs: Any, snapshot: AgentExecutionSnapshot,
                                run_id: str) -> Any:
    from backend.services.agent_behavior import resource
    if ((snapshot.profile.get("team") or {}).get("enabled") or "core.gnosi-operation-writing" not in snapshot.skill_ids
            or resource("operations/writing/SKILL.md") not in snapshot.instructions or inputs.get("turn_authorized_tool_names")):
        return application
    original = str(inputs.get("user_request") or "")
    if not original:
        original = next((str(message.text) for message in reversed(inputs.get("messages", []))
                         if getattr(message, "type", "") == "human"), "")
    contract = correction_contract(original)
    return CheckedCorrectionOutput(application, contract, snapshot, run_id, original) if contract else application
