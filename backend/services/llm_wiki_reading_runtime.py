"""Freeze one governed profile, model and skill for an entire source job."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable

from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation

from backend.domains.llm_wiki.reading_skill import SKILL_ID, SKILL_VERSION


def token_bound(text: str) -> int:
    """Conservative byte-token bound; no tokenizer downloads or hidden I/O."""
    return len(text.encode("utf-8"))


@dataclass
class ReadingRuntime:
    agent_id: str
    provider: str
    model: str
    instructions: str
    input_budget: int
    snapshot: AgentExecutionSnapshot

    def count_tokens(self, text: str) -> int:
        from backend.services.agent_context_budget import count_tokens
        return count_tokens(text, self.model if self.snapshot.behavior_resources else "").tokens

    @property
    def identity(self) -> str:
        payload = [
            SKILL_VERSION,
            self.agent_id,
            self.provider,
            self.model,
            self.instructions,
            self.input_budget,
        ]
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()

    @property
    def metadata(self) -> dict[str, object]:
        return {
            "agent_id": self.agent_id,
            "provider": self.provider,
            "model": self.model,
            "skill_id": SKILL_ID,
            "skill_version": SKILL_VERSION,
            "execution_revision": self.identity,
        }

    def generate(
        self, prompt: str, *, user_message: str = "", timeout: int = 120
    ) -> tuple[str, str]:
        from backend.services.agent_execution import run_sync

        if self.count_tokens(prompt) > self.input_budget:
            raise RuntimeError("The reading input exceeds the selected model's context budget")
        result = run_sync(AgentOperation(
            skill_id=SKILL_ID, operation="knowledge.process-source.phase",
            input=prompt, timeout_seconds=timeout, origin="worker",
        ), snapshot=self.snapshot)
        return result.result, result.model

    def generate_structured(self, prompt: str, validate: Callable[[dict[str, object]], None], timeout: int) -> tuple[str, str]:
        from backend.services.agent_execution import run_sync
        def checked(text: str) -> str:
            answer = json.loads(text)
            if not isinstance(answer, dict):
                raise ValueError("Return a JSON object")
            try:
                validate(answer)
            except (TypeError, KeyError) as error:
                raise ValueError(str(error)) from error
            return text
        result = run_sync(AgentOperation(skill_id=SKILL_ID, operation="knowledge.process-source.phase",
            input=prompt, timeout_seconds=timeout, origin="worker", resume_requires_parent=True,
            output_schema={"type": "object"}), snapshot=self.snapshot, output_validator=checked)
        return result.result, result.model


def prepare_reading_runtime(vault_root: str | Path) -> ReadingRuntime:
    from backend.services.agent_execution import prepare_snapshot, _snapshot
    from backend.domains.agent.runtime_tools import _model_context_window

    snapshot = prepare_snapshot(SKILL_ID)
    if SKILL_ID not in snapshot.skill_ids:
        raise PermissionError("agent_execution_skill_unavailable")
    if Path(snapshot.scope.vault_path).resolve() != Path(vault_root).resolve():
        raise PermissionError("agent_execution_vault_mismatch")
    profile = snapshot.profile
    provider, model = str(profile.get("provider") or ""), str(profile.get("model") or "")
    from backend.services.agent_behavior import snapshot_instruction_text
    instructions = snapshot_instruction_text(snapshot)
    window = _model_context_window(provider, model)
    from backend.services.agent_context_budget import count_tokens
    budget = window - max(2_048, window // 4) - count_tokens(instructions, model if snapshot.behavior_resources else "").tokens - 512
    if budget < 4_000:
        raise RuntimeError("Choose a model with a larger context window for source reading")
    return ReadingRuntime(snapshot.agent_id, provider, model, instructions, budget, snapshot)
