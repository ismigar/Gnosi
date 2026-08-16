"""Universal planning, verification, privacy, jobs, and evaluation tests."""

from __future__ import annotations

import json
import time

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from backend.agent import factory
from backend.agent.evals.runner import load_cases, run_evaluations
from backend.agent.turn_contract import build_turn_plan, verify_response
from backend.api import vault_routes


def test_continuous_evaluation_corpus_passes_every_case():
    report = run_evaluations(load_cases())

    assert report["total"] >= 16
    assert report["score"] == 1.0, report["results"]


def test_plan_is_enforced_as_a_narrow_request_scoped_tool_surface():
    tools = [
        {"name": "search_contacts", "effects": ["read", "personal_data"], "confirmation": "none"},
        {"name": "send_mail", "effects": ["external_write"], "confirmation": "always"},
        {"name": "delete_page", "effects": ["destructive"], "confirmation": "always"},
    ]

    plan = build_turn_plan(
        "Busca el contacte de Marta",
        mode="lookup",
        tool_metadata=tools,
        provider="mistral",
    )

    assert plan["domains"] == ["contacts"]
    assert plan["allowed_tool_names"] == ["search_contacts"]
    assert plan["privacy"]["cross_domain_reads_blocked"] is True


def test_turn_plan_exposes_bounded_mode_budget():
    conversation = build_turn_plan("Hola", mode="conversation")
    inventory = build_turn_plan(
        "Troba totes les notes sobre coaching",
        mode="inventory",
        required_tool_name="inventory_context",
    )

    assert conversation["budgets"] == {
        "timeout_seconds": 60,
        "max_model_calls": 2,
        "max_tool_calls": 0,
        "max_read_tool_results": 0,
    }
    assert inventory["budgets"]["max_tool_calls"] > 0
    assert inventory["budgets"]["max_read_tool_results"] <= inventory["budgets"]["max_tool_calls"]


def test_remote_and_local_private_processing_are_distinguished():
    refs = [{"id": "page", "type": "page", "ref": "page-1"}]
    tools = [{
        "name": "read_context_source",
        "effects": ["read"],
        "confirmation": "none",
        "dynamic_context": True,
    }]

    remote = build_turn_plan(
        "Què diu aquesta nota?",
        mode="lookup",
        context_refs=refs,
        tool_metadata=tools,
        provider="mistral",
        required_tool_name="read_context_source",
    )
    local = build_turn_plan(
        "Què diu aquesta nota?",
        mode="lookup",
        context_refs=refs,
        tool_metadata=tools,
        provider="ollama",
        required_tool_name="read_context_source",
    )

    assert remote["privacy"]["classification"] == "private_remote_processing"
    assert remote["privacy"]["private_evidence_to_remote_model"] is True
    assert local["privacy"]["classification"] == "private_local_processing"
    assert local["privacy"]["private_evidence_to_remote_model"] is False


def test_deterministic_inventory_keeps_private_evidence_local_and_binds_one_tool():
    plan = build_turn_plan(
        "Busca quines notes tinc relacionades amb coaching",
        mode="inventory",
        context_refs=[{"id": "vault", "type": "vault", "ref": "active-vault"}],
        tool_metadata=[
            {"name": "inventory_context", "effects": ["read"], "dynamic_context": True},
            {"name": "read_context_source", "effects": ["read"], "dynamic_context": True},
            {"name": "search_context", "effects": ["read"], "dynamic_context": True},
        ],
        provider="mistral",
        required_tool_name="inventory_context",
    )

    assert plan["output_strategy"] == "deterministic"
    assert plan["allowed_tool_names"] == ["inventory_context"]
    assert plan["privacy"]["classification"] == "private_local_processing"
    assert plan["privacy"]["private_evidence_to_remote_model"] is False


def test_verifier_blocks_source_dependent_answer_without_evidence():
    plan = build_turn_plan(
        "Què diu aquesta nota?",
        mode="analysis",
        context_refs=[{"id": "page", "type": "page", "ref": "page-1"}],
        provider="mistral",
        required_tool_name="read_context_source",
    )

    verified = verify_response(
        AIMessage(content="La nota defensa l'autonomia."),
        messages=[HumanMessage(content="Què diu aquesta nota?")],
        plan=plan,
    )

    assert "No puc verificar" in verified.content
    assert verified.additional_kwargs["gnosi_verification"]["status"] == "blocked"
    assert verified.additional_kwargs["gnosi_verification"]["checks"]["required_source_inspected"] is False


def test_verifier_blocks_unsupported_action_completion_claim():
    plan = build_turn_plan(
        "Envia aquest correu",
        mode="action",
        provider="mistral",
        authorized_tool_names=["send_mail"],
    )

    verified = verify_response(
        AIMessage(content="Done, the email was sent."),
        messages=[HumanMessage(content="Send this email")],
        plan=plan,
    )

    assert "No puc confirmar" in verified.content
    assert verified.additional_kwargs["gnosi_verification"]["status"] == "blocked"


def test_verifier_exposes_freshness_and_namespaced_background_job():
    freshness = {
        "status": "stale_while_revalidate",
        "age_seconds": 2_000,
        "coverage_ratio": 0.9,
        "direct_reads": 2,
        "refresh_scheduled": True,
    }
    plan = build_turn_plan(
        "Analyze all Reader articles",
        mode="analysis",
        context_refs=[{"id": "reader", "type": "internal", "ref": "reader"}],
        provider="mistral",
        required_tool_name="start_reader_context_analysis",
        authorized_tool_names=["start_reader_context_analysis"],
    )
    messages = [
        HumanMessage(content="Analyze all Reader articles"),
        ToolMessage(
            content=json.dumps({
                "job_id": "abcdef0123456789abcdef0123456789",
                "status": "running",
                "freshness": freshness,
            }),
            tool_call_id="call-1",
            name="start_reader_context_analysis",
        ),
    ]

    verified = verify_response(
        AIMessage(content="The durable analysis is running."),
        messages=messages,
        plan=plan,
    )

    metadata = verified.additional_kwargs
    assert metadata["gnosi_job"]["job_id"] == "reader:abcdef0123456789abcdef0123456789"
    assert metadata["gnosi_job"]["capabilities"]["cancel"] is True
    assert metadata["gnosi_freshness"] == freshness
    assert metadata["gnosi_explanation"]["execution"] == "background"
    assert metadata["gnosi_explanation"]["budgets"]["max_model_calls"] > 0


def test_deterministic_inventory_maps_each_claim_to_current_turn_sources():
    plan = build_turn_plan(
        "Troba totes les notes sobre coaching",
        mode="inventory",
        context_refs=[{"id": "vault", "type": "vault", "ref": "active-vault"}],
        provider="mistral",
        required_tool_name="inventory_context",
    )
    messages = [
        HumanMessage(content="Troba totes les notes sobre coaching"),
        ToolMessage(
            content=json.dumps({
                "matching_count": 2,
                "records": [
                    {"id": "note-1", "title": "Coaching values"},
                    {"id": "note-2", "title": "Executive coaching"},
                ],
            }),
            tool_call_id="call-inventory",
            name="inventory_context",
        ),
    ]

    verified = verify_response(
        AIMessage(content="He trobat 2 registres.\n1. Coaching values\n2. Executive coaching"),
        messages=messages,
        plan=plan,
    )

    citations = verified.additional_kwargs["gnosi_citations"]
    assert citations["status"] == "complete"
    assert citations["claim_count"] == 3
    assert citations["source_count"] == 3
    assert {source["href"] for source in citations["sources"]} >= {
        "/vault/page/note-1",
        "/vault/page/note-2",
    }
    assert verified.additional_kwargs["gnosi_verification"]["status"] == "passed"


def test_model_citation_markers_are_validated_and_removed_from_visible_text():
    plan = build_turn_plan(
        "Resumeix aquestes notes",
        mode="analysis",
        context_refs=[{"id": "vault", "type": "vault", "ref": "active-vault"}],
        provider="mistral",
        required_tool_name="search_context",
    )
    messages = [
        HumanMessage(content="Resumeix aquestes notes"),
        ToolMessage(
            content=json.dumps({
                "records": [{"id": "note-1", "title": "Coaching values"}],
            }),
            tool_call_id="call-search",
            name="search_context",
        ),
    ]

    verified = verify_response(
        AIMessage(content="La nota prioritza els valors [[cite:note-1]]."),
        messages=messages,
        plan=plan,
    )

    assert "[[cite:" not in verified.content
    assert verified.additional_kwargs["gnosi_citations"]["status"] == "complete"
    assert verified.additional_kwargs["gnosi_verification"]["checks"]["claim_citations_complete"] is True


def test_reader_durable_operations_have_deterministic_server_calls():
    start = factory._deterministic_reader_context_call(
        "start_reader_context_analysis",
        "Analitza totes les notícies per temes",
    )
    status = factory._deterministic_reader_context_call(
        "reader_context_analysis_status",
        "Com va reader:abcdef0123456789abcdef0123456789?",
    )

    assert start["args"]["language"] == "Catalan"
    assert start["args"]["request"] == "Analitza totes les notícies per temes"
    assert status["args"] == {"job_id": "abcdef0123456789abcdef0123456789"}
    receipt = factory._reader_job_response(
        json.dumps({
            "job_id": "abcdef0123456789abcdef0123456789",
            "status": "running",
        }),
        "Analitza totes les notícies per temes",
    )
    assert "reader:abcdef0123456789abcdef0123456789" in receipt
    assert "segon pla" in receipt
    failed_receipt = factory._reader_job_response(
        json.dumps({
            "job_id": "abcdef0123456789abcdef0123456789",
            "status": "failed",
        }),
        "Analitza totes les notícies per temes",
    )
    assert "no s'ha pogut iniciar" in failed_receipt
    assert "s'ha iniciat en segon pla" not in failed_receipt


def test_index_freshness_reports_age_coverage_and_nonblocking_policy(monkeypatch):
    monkeypatch.setattr(vault_routes, "_link_index_built", True)
    monkeypatch.setattr(vault_routes, "_link_index_build_ts", time.time() - 2_000)
    monkeypatch.setattr(vault_routes, "_current_vault_key", lambda: "")

    freshness = vault_routes.get_agent_index_freshness(
        requested_count=10,
        covered_count=8,
        direct_reads=2,
    )

    assert freshness["status"] == "stale_while_revalidate"
    assert freshness["age_seconds"] >= 1_999
    assert freshness["coverage_ratio"] == 0.8
    assert freshness["direct_reads"] == 2
    assert freshness["refresh_scheduled"] is False
