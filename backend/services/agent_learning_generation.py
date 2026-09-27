"""Bounded, tool-free learning drafts and second-case trials on the configured model."""

from __future__ import annotations

from backend.services.agent_behavior import task_input

import json
from collections.abc import Callable, Mapping, Sequence
from typing import Any, TypeVar

from pydantic import BaseModel

from backend.services.agent_learning_models import (
    CriterionResult, LearnedSkill, LearnRequest, SkillTrialRequest, SkillTrialResult,
)

ModelInvoker = Callable[[str, str], str]
T = TypeVar("T", bound=BaseModel)


def configured_invoker(agent: Mapping[str, object], ai: Mapping[str, object]) -> ModelInvoker:
    from backend.services.agent_execution import prepare_snapshot, run_sync
    from backend.services.agent_execution_models import AgentOperation
    from backend.services.agent_operation_catalog import skill_id

    snapshot = prepare_snapshot(skill_id("learning"))
    calls = 0

    class Invoker:
        def __call__(self, instruction: str, data: str) -> str:
            return self.structured(instruction, data, None)

        def structured(self, instruction: str, data: str, schema: dict[str, Any] | None) -> str:
            nonlocal calls
            if calls >= 3:
                raise ValueError("The model call budget has been reached.")
            allowance = min(2 if schema is not None else 1, 3 - calls)
            calls += allowance
            result = run_sync(AgentOperation(
                skill_id=skill_id("learning"), operation="learning.text-trial",
                input=instruction + "\n\n" + data, timeout_seconds=45,
                output_schema=schema, max_model_calls=allowance,
            ), snapshot=snapshot)
            calls -= allowance - result.model_calls
            if len(result.result) > 60_000:
                raise ValueError("The model returned an oversized answer.")
            return result.result

    return Invoker()


def invoke_contract(invoke: ModelInvoker, instruction: str, data: str, schema: type[T]) -> T:
    structured = getattr(invoke, "structured", None)
    text = structured(instruction, data, schema.model_json_schema()) if callable(structured) else invoke(instruction, data)
    return parse_answer(text, schema)


def parse_answer(text: str, schema: type[T]) -> T:
    value = text.strip()
    if value.startswith("```"):
        value = value.partition("\n")[2].rsplit("```", 1)[0].strip()
    return schema.model_validate_json(value)


def draft_skill(
    request: LearnRequest, messages: Sequence[Mapping[str, object]],
    available_tools: Sequence[str], invoke: ModelInvoker,
) -> LearnedSkill:
    selected: list[dict[str, str]] = []
    remaining = 32_000
    for message in reversed(messages[-40:]):
        role, content = message.get("role"), message.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        if len(content) > remaining:
            break
        selected.insert(0, {"role": str(role), "content": content})
        remaining -= len(content)
    if not any(item["role"] == "user" for item in selected):
        raise ValueError("No saved conversation is available to learn from.")
    prompt = task_input("learning.draft", output_schema=LearnedSkill.model_json_schema())
    result = invoke_contract(invoke, prompt, json.dumps({
        "language": request.language, "goal": request.goal,
        "conversation": selected, "available_tool_ids": list(available_tools),
    }, ensure_ascii=False), LearnedSkill)
    if not set(result.tool_ids).issubset(available_tools):
        raise ValueError("The draft requested tools outside the assistant's capabilities.")
    return result


class TrialChecks(BaseModel):
    checks: list[CriterionResult]


def trial_skill(request: SkillTrialRequest, invoke: ModelInvoker) -> SkillTrialResult:
    instruction = task_input("learning.trial", skill=request.skill.model_dump())
    output = invoke(instruction, request.input)
    rubric = task_input("learning.review", output_schema=TrialChecks.model_json_schema())
    checks = invoke_contract(invoke, rubric, json.dumps({
        "criteria": request.skill.criteria, "input": request.input, "output": output,
    }, ensure_ascii=False), TrialChecks).checks
    if len(checks) != len(request.skill.criteria):
        raise ValueError("The trial did not evaluate every acceptance criterion.")
    checks = [
        check.model_copy(update={"criterion": criterion})
        for criterion, check in zip(request.skill.criteria, checks, strict=True)
    ]
    return SkillTrialResult(output=output, checks=checks)
