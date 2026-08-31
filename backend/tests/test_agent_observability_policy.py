"""Exercise real model-policy diagnostics without any provider invocation."""

from __future__ import annotations

from collections import deque
from pathlib import Path

import pytest

from backend.domains.agent.policy import _invoke_agent_model
from backend.services import agent_observability as telemetry


class SyntheticModel:
    model_name = "synthetic-local-model"

    def __init__(self, response: object) -> None:
        self.response = response
        self.prompts: list[object] = []

    def invoke(self, prompt: object) -> object:
        self.prompts.append(prompt)
        return self.response


class FailingModel(SyntheticModel):
    def __init__(self, error: RuntimeError) -> None:
        super().__init__(None)
        self.error = error

    def invoke(self, prompt: object) -> object:
        self.prompts.append(prompt)
        raise self.error


@pytest.fixture
def log_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "synthetic-policy-spans.jsonl"
    monkeypatch.setattr(telemetry, "_storage_path", lambda: target)
    monkeypatch.setattr(telemetry, "_SPANS", deque(maxlen=telemetry.MAX_SPANS))
    return target


def test_real_policy_preserves_response_identity_and_records_only_model_metadata(
    log_path: Path,
) -> None:
    response = object()
    prompt = ["Synthetic prompt content must not enter telemetry"]
    model = SyntheticModel(response)
    result = _invoke_agent_model(model, prompt, {"trace_id": "synthetic-policy"})
    assert result is response
    assert model.prompts == [prompt]
    entries = telemetry.recent_spans("synthetic-policy")
    assert len(entries) == 1
    assert entries[0]["name"] == "agent.model"
    assert entries[0]["status"] == "ok"
    assert entries[0]["model"] == model.model_name
    assert "error_code" not in entries[0]
    assert prompt[0] not in log_path.read_text(encoding="utf-8")


def test_real_policy_preserves_exception_identity_without_logging_its_content(
    log_path: Path,
) -> None:
    error = RuntimeError("Synthetic provider error content must remain private")
    model = FailingModel(error)
    with pytest.raises(RuntimeError) as raised:
        _invoke_agent_model(model, "synthetic input", {"trace_id": "failed-policy"})
    assert raised.value is error
    entries = telemetry.recent_spans("failed-policy")
    assert len(entries) == 1
    assert entries[0]["status"] == "error"
    assert entries[0]["error_code"] == "RuntimeError"
    assert str(error) not in log_path.read_text(encoding="utf-8")
