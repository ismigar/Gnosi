"""Adaptive retrieval, persistent health, deadlines, and response-quality tests."""

from __future__ import annotations

from types import SimpleNamespace

from backend.agent.agent_context import _inventory_match, _inventory_query_terms
from backend.agent.evals.response_runner import (
    load_response_cases,
    run_response_evaluations,
)
from backend.agent.turn_contract import build_turn_plan
from backend.services import agent_capability_health as capability_health
from backend.services import agent_semantic_memory as semantic_memory


def _local_config(tmp_path):
    return SimpleNamespace(paths={"LOCAL_DATA": tmp_path / "local-data"})


def test_capability_health_persists_latency_and_quarantine(tmp_path, monkeypatch):
    monkeypatch.setattr(
        capability_health,
        "load_params",
        lambda strict_env=False: _local_config(tmp_path),
    )
    descriptor = SimpleNamespace(id="tool.persistent", name="persistent")

    capability_health.record_capability_failure(
        descriptor, lambda: None, error_code="timeout", duration_ms=120
    )
    capability_health.record_capability_failure(
        descriptor, lambda: None, error_code="timeout", duration_ms=280
    )
    snapshot = capability_health.health_snapshot(descriptor)

    assert snapshot["status"] == "quarantined"
    assert snapshot["failures"] == 2
    assert snapshot["average_latency_ms"] == 200

    capability_health.record_capability_success(
        descriptor, lambda: None, duration_ms=50
    )
    recovered = capability_health.health_snapshot(descriptor)
    assert recovered["status"] == "healthy"
    assert recovered["successes"] == 1
    assert recovered["average_latency_ms"] == 150


def test_reviewed_vocabulary_is_reversible_and_expands_inventory(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(
        semantic_memory,
        "load_params",
        lambda strict_env=False: _local_config(tmp_path),
    )
    vault = tmp_path / "vault"

    rows = semantic_memory.add_association(
        vault,
        "bibliographic quality",
        ["information retrieval"],
        created_by="user-1",
    )
    literal, expanded = _inventory_query_terms(
        "bibliographic quality",
        vault_path=vault,
    )
    assert literal == ["bibliographic", "quality"]
    assert {"information", "retrieval"}.issubset(expanded)
    assert rows and semantic_memory.delete_association(vault, rows[0]["id"])
    assert semantic_memory.expand_terms(vault, literal) == []


def test_semantic_inventory_matches_close_inflections_without_top_k():
    score, basis, match_kind = _inventory_match(
        "recuperacions",
        "Cerca i recuperació d'informació",
        "",
        {},
    )
    assert score > 0
    assert basis == ["title"]
    assert match_kind == "direct"


def test_plan_exposes_deadline_and_missing_capability_without_granting_it():
    plan = build_turn_plan(
        "Busca els esdeveniments del calendari",
        mode="lookup",
        tool_metadata=[],
        provider="ollama",
    )

    assert plan["deadline"]["soft_seconds"] < plan["deadline"]["hard_seconds"]
    discovery = plan["capability_broker"]["discovery"]
    assert discovery["status"] == "attention_required"
    assert discovery["domains"][0]["status"] == "missing_capability"
    assert discovery["automatic_install"] is False
    assert plan["allowed_tool_names"] == []


def test_final_response_evaluation_corpus_passes():
    report = run_response_evaluations(load_response_cases())

    assert report["total"] >= 4
    assert report["score"] == 1.0, report["results"]
