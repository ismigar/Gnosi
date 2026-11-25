"""Routing context, verified continuations and actual per-phase accounting."""
import json
from copy import deepcopy

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from backend.services.agent_team_context import planning_input
from backend.services.agent_team_continuation import clear_text_revision
from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401
from backend.tests.test_principal_agent_routing import plan_for, run_chat


def test_standalone_greeting_uses_director_then_reopens_specialists_when_requested(optional_runtime, monkeypatch):
    from backend.services import agent_team_planning
    fixture, _ = optional_runtime
    config = fixture[3]
    refs = [{"type": "internal", "ref": "reader", "name": "Profile sources"}]
    marked = {"gnosi_plain_greeting": True}
    planned = []
    original = agent_team_planning.planning_catalog

    def observe(*args, **kwargs):
        planned.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(agent_team_planning, "planning_catalog", observe)
    config["_phase_responses"] = {"team.greeting": [AIMessage(content='{"response":"My personal welcome."}')]}
    responses, metadata = run_chat(fixture, "Hola!", refs=refs, message_metadata=marked)
    answer = responses[-1]
    assert answer.content == "My personal welcome."
    assert metadata["context_refs"] == refs
    assert answer.additional_kwargs["gnosi_greeting_reply"] is True
    assert fixture[2] == ["director"] and not planned
    assert answer.additional_kwargs["gnosi_team_usage"]["routing"]["reason"] == "standalone_greeting"
    prompts = config["_model_messages"][0][1]
    assert "Profile sources" in prompts[-1].text
    request = json.loads(json.loads(prompts[-1].text)["input"])
    assert "members" not in request and "capabilities" not in request
    assert request["team_discovery"]["status"] == "deferred"
    configured = {row["id"]: row["assigned_skill_ids"] for row in request["team_discovery"]["configured_members"]}
    assert configured["worker"] == fixture[3]["agents"][1]["skill_ids"]

    config["_phase_responses"] = {"team.greeting": [AIMessage(content='{"response":null}')],
        "team.plan": [AIMessage(content=plan_for().model_dump_json())]}
    config["_responses"] = {"worker": [AIMessage(content="Specialist result")]}
    history = [HumanMessage(content="Hola!", additional_kwargs=marked), answer]
    messages, _ = run_chat(fixture, "Bon dia", refs=refs, history=history, message_metadata=marked)
    assert messages[-1].content == "Specialist result"
    assert fixture[2] == ["director", "director", "director", "worker"] and planned == [1]


def test_greeting_requires_a_plain_request_and_verified_history():
    from backend.services.agent_team_greeting import greeting_exchange
    hello = HumanMessage(content="Hola", additional_kwargs={"gnosi_plain_greeting": True})
    answer = AIMessage(content="Bonjour", additional_kwargs={"gnosi_greeting_reply": True})
    assert greeting_exchange("Hola", {"messages": [hello, answer, hello]})
    for state in ({"messages": [HumanMessage(content="Hola")]},
                  {"messages": [hello], "title_edit": {"scope": "view"}},
                  {"messages": [hello], "turn_authorized_tool_names": ["update"]},
                  {"messages": [hello, AIMessage(content="Which file?"), hello]},
                  {"messages": [HumanMessage(content="Translate this"), answer, hello]},
                  {"messages": [hello.model_copy(update={"content": "Hola\nAttached document"})]}):
        assert not greeting_exchange("Hola", state)
    assert not greeting_exchange("Hola, tradueix això", {"messages": [hello]})


def test_director_can_defer_the_first_greeting_in_an_empty_chat(optional_runtime):
    fixture, _ = optional_runtime
    fixture[3]["agents"][0]["persona"] = "Ask the writing specialist to compose my welcome."
    fixture[3]["_phase_responses"] = {"team.greeting": [AIMessage(content='{"response":null}')],
        "team.plan": [AIMessage(content=plan_for().model_dump_json())]}
    fixture[3]["_responses"] = {"worker": [AIMessage(content="A welcome from the writer")]}
    messages, _ = run_chat(fixture, "Hola", message_metadata={"gnosi_plain_greeting": True})
    assert fixture[2] == ["director", "director", "worker"]
    assert messages[-1].content == "A welcome from the writer"


def test_explicit_skill_in_director_instructions_starts_with_full_discovery(optional_runtime):
    fixture, _ = optional_runtime
    fixture[3]["agents"][0]["persona"] = "Have the core.gnosi-operation-writing specialist greet me."
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan_for().model_dump_json())]}
    fixture[3]["_responses"] = {"worker": [AIMessage(content="The assigned welcome")]}
    messages, _ = run_chat(fixture, "Hola", message_metadata={"gnosi_plain_greeting": True})
    assert fixture[2] == ["director", "worker"] and messages[-1].content == "The assigned welcome"


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


@pytest.mark.parametrize("change", ["scope", "profile", "procedure", "answer", "prior_user", "marker", "legacy_quality", "attachment", "grants", "new_goal"])
def test_changed_context_and_unverified_markers_replan(optional_runtime, change, monkeypatch):
    fixture, _ = optional_runtime
    history = seed(fixture)
    request, kwargs = "Ara fes-ho més formal.", {}
    if change == "scope":
        kwargs["refs"] = [{"id": "another-document", "type": "note"}]
    elif change == "profile":
        fixture[3]["agents"][1]["persona"] = "A changed procedure"
    elif change == "procedure":
        from dataclasses import replace
        from backend.services import agent_team_runtime
        resolve = agent_team_runtime._runtime
        monkeypatch.setattr(agent_team_runtime, "_runtime", lambda *args, **kwargs:
                            replace(resolve(*args, **kwargs), catalog_revision="updated-skill-catalog"))
    elif change == "answer":
        history[-1] = history[-1].model_copy(update={"content": "An unrelated answer"})
    elif change == "prior_user":
        history[0] = HumanMessage(content="An unrelated request")
    elif change == "marker":
        history[-1].additional_kwargs["gnosi_team_route"] = {"run_id": "invented"}
    elif change == "legacy_quality":
        from backend.services import agent_team_store as artifacts
        run_id = history[-1].additional_kwargs["gnosi_team_route"]["run_id"]
        saved = artifacts.get(fixture[0], run_id, "continuation")
        saved.pop("quality_mode")
        artifacts.put(fixture[0], run_id, "continuation", "continuation", saved)
    elif change == "attachment":
        kwargs["raw_request"] = request
        request += "\nVerified attachment context: another source"
    elif change == "grants":
        kwargs["grants"] = ["bulk_update_rows"]
    else:
        request = "Ara fes-ho més formal i envia-ho."
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for().model_dump_json())]}
    if change == "grants":
        from backend.services.agent_team_models import TeamPlan
        fixture[3]["_responses"] = {"director": [AIMessage(content=TeamPlan(
            response="Quins registres vols modificar?", response_kind="clarification").model_dump_json())]}
    messages, _ = run_chat(fixture, request, history=history, **kwargs)
    assert fixture[2] == (["director", "worker", "director"] if change == "grants" else
                          ["director", "worker", "director", "worker"])
    assert messages[-1].additional_kwargs["gnosi_team_usage"]["routing"]["mode"] == "director"


def test_write_assignments_do_not_install_a_continuation(optional_runtime):
    fixture, _ = optional_runtime
    fixture[1].profile["team"]["direct_routes"] = []
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for(read_only=False).model_dump_json())]}
    messages, _ = run_chat(fixture, "Actualitza el document.")
    assert "gnosi_team_route" not in messages[-1].additional_kwargs


def test_completed_specialist_answer_does_not_reopen_cloud_skills(optional_runtime, monkeypatch):
    from backend.platform.files.availability import MetadataUnavailable
    from backend.services import agent_team_runtime, agent_team_store

    fixture, _ = optional_runtime
    stored = agent_team_store.put
    runtime = agent_team_runtime._runtime
    completed = False

    def store_result(scope, run_id, identifier, kind, value, **kwargs):
        nonlocal completed
        stored(scope, run_id, identifier, kind, value, **kwargs)
        if kind == "task" and value["status"] == "completed":
            completed = True

    def read_skills(*args, **kwargs):
        if completed:
            raise MetadataUnavailable(reason="pending")
        return runtime(*args, **kwargs)

    monkeypatch.setattr(agent_team_store, "put", store_result)
    monkeypatch.setattr(agent_team_runtime, "_runtime", read_skills)
    reply = seed(fixture)[-1]
    assert completed and reply.content == "La gent que treballa plegada fa les coses millor."
    assert reply.additional_kwargs["gnosi_team_route"]["run_id"]


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


def test_selection_uses_the_token_totals_of_its_current_budget_read(monkeypatch):
    from backend.agent import model_router
    from backend.services.agent_team_runtime import candidate_inputs

    reports = iter([
        {"period": "2026-11", "per_model": [{"provider": "local", "model_id": "chat:v2", "in": 8, "out": 3}]},
        {"period": "2026-11", "over_cap": True, "budget": {"enforce_block": True}},
    ])
    monkeypatch.setattr(model_router, "budget_status", lambda: next(reports))
    monkeypatch.setattr(model_router, "UsageStore", lambda: pytest.fail("Budget already read the usage ledger"))
    monkeypatch.setattr(model_router, "load_registry", lambda: [{"model_id": "chat:v2"}])
    selection = candidate_inputs({})
    assert selection.usage == {"local:chat:v2": 11} and not selection.blocked
    dispatch = candidate_inputs({})
    assert dispatch.blocked and not dispatch.registry
