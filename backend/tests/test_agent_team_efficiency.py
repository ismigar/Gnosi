"""Routing context, verified continuations and actual per-phase accounting."""
import json
from copy import deepcopy

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from backend.services.agent_team_context import planning_input
from backend.services.agent_team_continuation import clear_text_revision
from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401
from backend.tests.test_principal_agent_routing import plan_for, run_chat


def seed(fixture):
    fixture[1].profile["team"]["direct_routes"] = []
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for().model_dump_json())],
                               "worker": [AIMessage(content="La gent que treballa plegada fa les coses millor.")]}
    original = "Revisa la frase: La gent que treballa plegada fa coses millor."
    messages, _ = run_chat(fixture, original)
    return [HumanMessage(content=original), messages[-1]]


@pytest.mark.parametrize("followup", [
    "Ara fes-ho més formal.", "Ara fes la mateixa frase més formal, mantenint-ne el sentit. Retorna només la frase.",
    "Fes-la més breu.", "Ahora hazlo más formal.", "Hazla más breve.",
    "Now make it shorter.", "Please make it more formal, preserving the meaning.",
    "Maintenant, rends-la plus formelle.", "Rends-le plus court.",
])
def test_clear_revisions_reuse_a_verified_specialist(optional_runtime, followup):
    fixture, _ = optional_runtime
    history = seed(fixture)
    fixture[3]["_responses"] = {"worker": [AIMessage(content="Revised text")]}
    messages, _ = run_chat(fixture, followup, history=history)
    assert fixture[2] == ["director", "worker", "worker"]
    usage = messages[-1].additional_kwargs["gnosi_team_usage"]
    assert usage["routing"]["mode"] == "continuation"
    assert usage["routing"]["planning_calls_avoided"] == 1
    assert usage["phases"]["planning"]["model_calls"] == 0
    assert usage["phases"]["execution"]["model_calls"] == 1
    sent = fixture[3]["_model_messages"][-1][1]
    assert any(m.content == history[1].content for m in sent)
    assert [m.content for m in sent if m.type == "human"] == [history[0].content, followup]


@pytest.mark.parametrize("followup", [
    "Fes-ho", "Continua", "Ara envia-la al meu equip", "Fes-ho més formal i publica-ho",
    "Fes-ho més formal: un altre text", "No facis res. Ara fes-ho més formal.",
    "Tradueix-ho a l'anglès", "Make it shorter and delete the original", "Make this script shorter",
    "Rends-la plus formelle puis envoie-la", "Canvia el títol a 'Fes-ho més formal'",
])
def test_new_or_ambiguous_goals_are_not_continuations(followup):
    assert not clear_text_revision(followup)


@pytest.mark.parametrize("change", ["scope", "profile", "answer", "prior_user", "marker", "attachment", "grants", "new_goal"])
def test_changed_context_and_unverified_markers_replan(optional_runtime, change):
    fixture, _ = optional_runtime
    history = seed(fixture)
    request, kwargs = "Ara fes-ho més formal.", {}
    if change == "scope":
        kwargs["refs"] = [{"id": "another-document", "type": "note"}]
    elif change == "profile":
        fixture[3]["agents"][1]["persona"] = "A changed procedure"
    elif change == "answer":
        history[-1] = history[-1].model_copy(update={"content": "An unrelated answer"})
    elif change == "prior_user":
        history[0] = HumanMessage(content="An unrelated request")
    elif change == "marker":
        history[-1].additional_kwargs["gnosi_team_route"] = {"run_id": "invented"}
    elif change == "attachment":
        kwargs["raw_request"] = request
        request += "\nVerified attachment context: another source"
    elif change == "grants":
        kwargs["grants"] = ["bulk_update_rows"]
    else:
        request = "Ara fes-ho més formal i envia-ho."
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for().model_dump_json())]}
    messages, _ = run_chat(fixture, request, history=history, **kwargs)
    assert fixture[2] == ["director", "worker", "director", "worker"]
    assert messages[-1].additional_kwargs["gnosi_team_usage"]["routing"]["mode"] == "director"


def test_write_assignments_do_not_install_a_continuation(optional_runtime):
    fixture, _ = optional_runtime
    fixture[1].profile["team"]["direct_routes"] = []
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for(read_only=False).model_dump_json())]}
    messages, _ = run_chat(fixture, "Actualitza el document.")
    assert "gnosi_team_route" not in messages[-1].additional_kwargs


def test_registered_translation_specialist_is_reused_for_a_style_revision(optional_runtime):
    from backend.services.agent_operation_catalog import skill_id
    fixture, _ = optional_runtime
    fixture[1].profile["team"]["direct_routes"] = []
    translation = skill_id("translation")
    fixture[3]["agents"][1]["skill_ids"] = [translation]
    plan = plan_for()
    plan.tasks[0].skill_ids = [translation]
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan.model_dump_json())],
                               "worker": [AIMessage(content="Veuillez confirmer la réservation R-204.")]}
    original = "Tradueix al francès: Cal confirmar la reserva R-204."
    messages, _ = run_chat(fixture, original)
    assert "gnosi_team_route" in messages[-1].additional_kwargs
    fixture[3]["_responses"] = {"worker": [AIMessage(content="Confirmez la réservation R-204.")]}
    messages, _ = run_chat(fixture, "Maintenant, rends-la plus courte.",
                           history=[HumanMessage(content=original), messages[-1]])
    assert fixture[2] == ["director", "worker", "worker"]
    assert messages[-1].additional_kwargs["gnosi_team_usage"]["routing"]["mode"] == "continuation"
    assert messages[-1].content == "Confirmez la réservation R-204."


def test_context_is_small_role_preserving_and_does_not_change_executor_sources(optional_runtime):
    from backend.services.agent_team_routing import planning_catalog
    fixture, _ = optional_runtime
    owner, scope = fixture[1].profile, fixture[0]
    catalog = planning_catalog(owner, scope, "request")
    request = "Fes el mateix amb la vista seleccionada."
    messages = [HumanMessage(content="old source " * 2000), AIMessage(content="old result " * 2000)] * 20
    messages += [HumanMessage(content="Change titles"), AIMessage(content="Previous reply", additional_kwargs={"private_provider_state": "NEVER SEND"}),
                 ToolMessage(content="TOOL SECRET " * 2000, tool_call_id="old-call"),
                 HumanMessage(content=request + "\nATTACHMENT SECRET " * 1000, additional_kwargs={"gnosi_visible_content": request})]
    refs = [{"type": "table", "id": "active", "content": "SOURCE BODY", "scope": {
        "view_id": "view", "row_ids": [str(i) for i in range(1000)], "filters": [{"value": "FILTER SECRET"}]}}]
    state = {"messages": messages, "turn_authorized_tool_names": ["bulk_update_rows"]}
    before = deepcopy((messages, refs, catalog))
    payload, sizes = planning_input(owner, state, request, catalog, refs, operation_mode=False)
    encoded = json.dumps(payload)
    assert len(encoded) < 9000
    assert sizes["sent_context_chars"] < sizes["full_context_chars"] / 10
    assert all(secret not in encoded for secret in ("TOOL SECRET", "ATTACHMENT SECRET", "NEVER SEND", "SOURCE BODY", "FILTER SECRET"))
    assert len(payload["recent_conversation"]) == 4
    assert payload["recent_conversation"][-1] == {"role": "ai", "text": "Previous reply"}
    assert payload["context_refs"]["selections"][0]["selection"]["row_ids_count"] == 1000
    assert payload["request"] == request and payload["current_message_has_source_context"]
    assert (messages, refs, catalog) == before


def test_large_requests_mark_omissions_and_preserve_both_ends(optional_runtime):
    fixture, _ = optional_runtime
    original = "Summarize the supplied text: " + "data " * 10000 + " Return three bullet points."
    payload, _ = planning_input(fixture[1].profile, {"messages": [HumanMessage(content=original)]}, original, [], [], operation_mode=False)
    assert payload["request_truncated"] and len(payload["request"]) == 6000
    assert payload["request"].startswith("Summarize") and payload["request"].endswith("Return three bullet points.")
    assert payload["recent_conversation"] == []


def test_accounting_separates_phases_retries_and_missing_costs(team_runtime, monkeypatch):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts, ai_usage_ledger as ledger
    from backend.services.agent_execution_models import AgentRun
    from backend.services.agent_execution_trace import append
    from backend.services.agent_team_usage import team_usage
    scope = team_runtime[0]
    monkeypatch.setattr(ledger, "resolve_data_dir", store.resolve_data_dir)
    for identifier, operation, calls, parent, mode in [
        ("root", "conversation", 0, "", "conversation"), ("plan", "team.plan", 2, "root", ""),
        ("worker", "conversation", 1, "root", "conversation"), ("job", "job", 3, "root", "job"),
    ]:
        store.create(AgentRun(run_id=identifier, parent_run_id=parent, agent_id=identifier, skill_id="", operation=operation,
                             origin="chat", status="completed", model_calls=calls, created_at=0, updated_at=0),
                     scope, {"mode": mode}, {})
    artifacts.put(scope, "root", "routing", "routing", {"mode": "director"})
    append(scope, "root", "team.route", {})
    for identifier, tokens, cost, source in [("plan", 100, "0.003", "reported"), ("plan", 120, "0.004", "reported"),
                                             ("worker", 300, "0.001", "reported"), ("job", 99999, "10", "reported")]:
        ledger.write_call(provider="p", model_id="m", input_tokens=tokens, output_tokens=10,
                          cost_usd=cost, cost_source=source,
                          metadata={"run_id": identifier, "workspace_id": scope.workspace_id, "user_id": scope.user_id})
    usage = team_usage(scope, "root")
    assert usage["model_calls"] == 3 and usage["input_tokens"] == 520 and usage["output_tokens"] == 30
    assert usage["usage_complete"] and usage["reported_cost_usd"] == 0.008
    assert usage["phases"]["planning"]["input_tokens"] == 220 and usage["phases"]["execution"]["input_tokens"] == 300
    with ledger.connect() as db:
        db.execute("UPDATE usage_calls SET cost_usd=NULL,cost_source='unknown' WHERE run_id='worker'")
    usage = team_usage(scope, "root")
    assert usage["estimated_cost_usd"] is None and usage["reported_cost_usd"] is None
    assert usage["known_cost_usd"] == 0.007 and usage["phases"]["planning"]["reported_cost_usd"] == 0.007
    with pytest.raises(LookupError):
        team_usage(scope.model_copy(update={"user_id": "someone-else"}), "root")


def test_unknown_team_cost_stays_unknown_in_chat_metrics():
    import time
    from backend.domains.agent.routes.chat_stream_state import AgentStreamState
    state = AgentStreamState(time.monotonic(), time.monotonic(), {}, {}, "trace")
    state.team_usage = {"estimated_cost_usd": None, "cost_source": "unknown"}
    assert state.metrics_payload()["estimated_cost_usd"] is None
