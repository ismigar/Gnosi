"""Regression tests for the phase-three universal agent hardening."""
from __future__ import annotations

from types import SimpleNamespace

import pytest


def test_durable_worker_dispatches_ready_reader_job(monkeypatch, tmp_path):
    from backend.services import durable_job_queue as queue
    from backend.services import durable_job_worker as worker_module

    monkeypatch.setattr(queue, "queue_path", lambda: tmp_path / "jobs.sqlite3")
    job = queue.enqueue(
        "reader_analysis",
        {"vault_path": str(tmp_path / "vault"), "job_id": "analysis-1"},
        idempotency_key="analysis-1",
    )
    calls = []

    def launch(vault_path, job_id, *, model_call):
        calls.append((str(vault_path), job_id, model_call))

    monkeypatch.setattr(
        "backend.services.reader_analysis.get_status",
        lambda _vault_path, _job_id: {"state": "queued"},
    )
    monkeypatch.setattr("backend.services.reader_analysis._launch", launch)
    dispatched = worker_module.DurableJobWorker(poll_seconds=0.1).run_once()

    assert dispatched == 1
    assert calls[0][0].endswith("vault")
    assert calls[0][1] == "analysis-1"


def test_incremental_fts_upsert_and_stale_metadata(monkeypatch, tmp_path):
    from backend.services import llm_wiki_indices as indices

    fts_path = tmp_path / "search.sqlite3"
    monkeypatch.setattr(indices, "_fts_path", lambda _table: fts_path)
    first = {"id": "n1", "title": "Coaching", "excerpt": "A note", "note_type": "note"}
    assert indices.upsert_search_records("brain", [first]) == 1
    assert indices.upsert_search_records("brain", [first]) == 0
    changed = {**first, "excerpt": "An updated note"}
    assert indices.upsert_search_records("brain", [changed]) == 1
    indices.mark_search_index_stale("brain")
    assert indices.search_index_status("brain")["stale"] is True
    assert indices.upsert_search_records("brain", [changed]) == 0
    assert indices.search_index_status("brain")["stale"] is False
    assert indices.search_index_candidates("brain", "updated")[0]["id"] == "n1"


def test_generated_tool_runs_in_child_process():
    from backend.agent.generated_tools.sandbox_runner import run_process

    code = (
        "from langchain_core.tools import tool\n"
        "@tool\n"
        "def echo(value: str) -> str:\n"
        "    \"\"\"Echo a value.\"\"\"\n"
        "    print('diagnostic output')\n"
        "    return value\n"
    )
    # Exercise the production default, including cold dependency imports.
    described = run_process(code, action="describe")
    invoked = run_process(code, action="invoke", arguments={"value": "ok"})
    assert described["name"] == "echo"
    assert invoked["result"] == "ok"


def test_generated_tool_preserves_requested_timeout(monkeypatch):
    import subprocess
    from backend.agent.generated_tools import sandbox_runner

    def expired(command, **kwargs):
        assert kwargs["timeout"] == 7
        raise subprocess.TimeoutExpired(command, 7)

    monkeypatch.setattr(sandbox_runner.subprocess, "run", expired)
    with pytest.raises(TimeoutError, match="7s sandbox timeout"):
        sandbox_runner.run_process("", action="describe", timeout_seconds=7)


def test_tool_contract_validates_schema_and_compensates():
    from backend.services.tool_runtime import execute_contract, register_compensator

    descriptor = {
        "input_schema": {
            "type": "object",
            "required": ["value"],
            "properties": {"value": {"type": "string", "minLength": 2}},
            "additionalProperties": False,
        },
        "output_schema": {"type": "string"},
    }
    request = SimpleNamespace(tool_call={"name": "phase_three_test", "args": {"value": "ok"}})
    assert execute_contract(request, lambda _request: "done", descriptor=descriptor) == "done"
    with pytest.raises(ValueError):
        execute_contract(
            SimpleNamespace(tool_call={"name": "phase_three_test", "args": {"other": "x"}}),
            lambda _request: "done",
            descriptor=descriptor,
        )
    compensated = []
    register_compensator("phase_three_failure", lambda args, error: compensated.append((args, str(error))))
    with pytest.raises(RuntimeError):
        execute_contract(
            SimpleNamespace(tool_call={"name": "phase_three_failure", "args": {}}),
            lambda _request: (_ for _ in ()).throw(RuntimeError("boom")),
        )
    assert compensated and compensated[0][0] == {}


def test_replay_is_metadata_only(monkeypatch, tmp_path):
    from backend.services import agent_replay

    monkeypatch.setattr(agent_replay, "_path", lambda: tmp_path / "replay.sqlite3")
    agent_replay.record_event(
        "trace-1",
        "plan",
        {"mode": "lookup", "prompt": "private text", "confidence": 0.8},
    )
    events = agent_replay.read_replay("trace-1")
    assert events[0]["attributes"] == {"mode": "lookup", "confidence": 0.8}


def test_interpreter_abstains_with_a_clear_clarification():
    from backend.agent.semantic_interpreter import clarification_message, interpret_request

    intent = interpret_request("Busca")
    assert intent["clarification_required"] is True
    assert "tema" in clarification_message({"ambiguities": ["missing_subject"]}, "ca")
