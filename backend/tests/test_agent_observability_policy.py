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
    def __init__(self, error: Exception) -> None:
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


@pytest.mark.parametrize('metadata_only', [False, True])
def test_length_failure_preserves_unaccepted_partial_in_private_trace_only(
    log_path: Path, monkeypatch: pytest.MonkeyPatch, metadata_only: bool,
) -> None:
    from openai import LengthFinishReasonError
    from openai.types.chat import ChatCompletion
    from backend.services import agent_execution as execution
    from backend.services import agent_execution_trace as trace
    from backend.services.agent_execution_models import ExecutionScope
    from backend.services.agent_execution_scope import execution_scope

    secret = 'sk-' + 'x' * 24
    partial = '{"tokens":["unfinished ' + secret
    completion = ChatCompletion.model_validate({
        'id': 'synthetic-truncated', 'object': 'chat.completion', 'created': 0,
        'model': 'synthetic-local-model', 'choices': [{'index': 0, 'finish_reason': 'length',
            'message': {'role': 'assistant', 'content': partial}}],
        'usage': {'prompt_tokens': 16298, 'completion_tokens': 16384, 'total_tokens': 32682},
    })
    error = LengthFinishReasonError(completion=completion)
    model = FailingModel(error)
    captured: list[tuple[str, object]] = []
    calls: list[str] = []
    def append(scope: object, run_id: str, kind: str, value: object) -> None:
        clean, _ = trace.sanitize(value)
        captured.append((kind, clean))
    monkeypatch.setattr(trace, 'append', append)
    monkeypatch.setattr(execution, 'before_model_call', lambda: calls.append('before'))
    monkeypatch.setattr(execution, 'after_model_call', lambda _: calls.append('after'))
    scope = ExecutionScope(user_id='alice', workspace_id='team', role='owner', vault_path=str(log_path.parent))
    run_token = execution._run.set('synthetic-length-failure')
    metadata_token = trace.metadata_only_trace.set(metadata_only)
    try:
        with execution_scope(scope), pytest.raises(LengthFinishReasonError) as raised:
            _invoke_agent_model(model, 'synthetic input', {'trace_id': 'length-failure'})
    finally:
        trace.metadata_only_trace.reset(metadata_token)
        execution._run.reset(run_token)
    assert raised.value is error and model.prompts == ['synthetic input'] and calls == ['before']
    assert [kind for kind, _ in captured] == ['model.request', 'model.error']
    details = captured[-1][1]
    assert isinstance(details, dict)
    if metadata_only:
        assert details == {'metadata_only': True}
    else:
        assert details['type'] == 'LengthFinishReasonError'
        rejected = details['partial_response']
        assert rejected['accepted'] is False
        assert rejected['completion']['choices'][0]['message']['content'] == partial.replace(secret, '[redacted]')
        assert rejected['completion']['usage']['completion_tokens'] == 16384
    assert secret not in str(captured)
    assert 'unfinished' not in log_path.read_text(encoding='utf-8')
