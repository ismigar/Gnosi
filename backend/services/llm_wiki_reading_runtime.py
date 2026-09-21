"""Freeze one governed profile, model and skill for an entire source job."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable

from langchain_core.language_models import BaseChatModel

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
    client_for_timeout: Callable[[int], BaseChatModel]

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
        from langchain_core.messages import HumanMessage, SystemMessage
        from backend.agent.model_router import record_llm_usage, usage_from_message

        if token_bound(prompt) > self.input_budget:
            raise RuntimeError("The reading input exceeds the selected model's context budget")
        response = self.client_for_timeout(timeout).invoke(
            [
                SystemMessage(content=self.instructions),
                HumanMessage(content=prompt),
            ]
        )
        usage = usage_from_message(response)
        if usage:
            record_llm_usage(self.provider, self.model, usage[0], usage[1])
        content = response.content
        if isinstance(content, list):
            content = "".join(
                str(part.get("text", "")) for part in content if isinstance(part, dict)
            )
        return str(content or ""), self.model


def prepare_reading_runtime(vault_root: str | Path) -> ReadingRuntime:
    from backend.agent.factory import get_llm
    from backend.config.app_config import load_params
    from backend.domains.agent.runtime_tools import _model_context_window
    from backend.security.ai_credentials import resolve_provider_api_key
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    from backend.services.llm_wiki_agent import default_plugin_agent_id

    ai = dict(load_params(strict_env=False).ai or {})
    agent_id = default_plugin_agent_id(ai)
    profile = next(
        (
            item
            for item in ai.get("agents", [])
            if isinstance(item, dict) and item.get("id") == agent_id
        ),
        None,
    )
    if not profile or not profile.get("enabled", True):
        raise RuntimeError(
            "Enable the Brain processing agent in AI settings before processing a source"
        )
    runtime = resolve_agent_runtime(
        profile, vault_path=Path(vault_root), active_skill_ids=[SKILL_ID]
    )
    if SKILL_ID not in runtime.active_skill_ids:
        raise RuntimeError(
            f"Assign the Process Brain source skill to agent '{agent_id}' in AI settings"
        )
    provider, model = str(profile.get("provider") or ""), str(profile.get("model") or "")
    if not provider or not model:
        raise RuntimeError(
            "Select a provider and model for the Brain processing agent in AI settings"
        )
    settings = (ai.get("providers") or {}).get(provider, {})
    if not settings.get("enabled", True):
        raise RuntimeError("The processing agent's AI provider is disabled")
    instructions = "\n\n".join(
        filter(
            None,
            [
                str(profile.get("persona") or ""),
                str(profile.get("context") or ""),
                *runtime.instructions,
            ],
        )
    )
    window = _model_context_window(provider, model)
    # Reserve output, message framing, and the complete (never truncated) skill.
    budget = min(96_000, window - max(2_048, window // 4) - token_bound(instructions) - 512)
    if budget < 4_000:
        raise RuntimeError("Choose a model with a larger context window for source reading")
    api_key = resolve_provider_api_key(provider, settings)
    base_url = settings.get("base_url")
    clients: dict[int, BaseChatModel] = {}

    def client_for_timeout(timeout: int) -> BaseChatModel:
        if timeout not in clients:
            llm = get_llm(
                provider=provider, model=model, api_key=api_key, base_url=base_url, timeout=timeout
            )
            if llm is None:
                raise RuntimeError("The selected processing model is unavailable")
            clients[timeout] = llm
        return clients[timeout]

    client_for_timeout(120)
    return ReadingRuntime(agent_id, provider, model, instructions, budget, client_for_timeout)
