"""Runtime integration tests for governed agent skills and tools."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool

from backend.agent import factory
from backend.api import agent_routes


class RecordingLlm:
    """Minimal model double that records bindings and system prompts."""

    def __init__(self):
        self.bound_tool_names = []
        self.binding_options = []
        self.system_prompts = []

    def bind_tools(self, tools, **kwargs):
        self.bound_tool_names.append([
            getattr(item, "name", "") or getattr(item, "__name__", "")
            for item in tools
        ])
        self.binding_options.append(dict(kwargs))
        return self

    def invoke(self, messages):
        self.system_prompts.append(str(messages[0].content))
        return AIMessage(content="done")


def _agent(**overrides):
    return {
        "id": "agent",
        "name": "Configured agent",
        "provider": "test",
        "model": "test-model",
        "enabled": True,
        "persona": "Follow this configured persona.",
        "capabilities": {"tools": True},
        **overrides,
    }


def _runtime(
    *,
    assigned=(),
    active=(),
    instructions=(),
    tools=(),
    descriptors=(),
    skills=(),
    revision="runtime-revision",
):
    return SimpleNamespace(
        assigned_skill_ids=tuple(assigned),
        active_skill_ids=tuple(active),
        instructions=tuple(instructions),
        tools=tuple(tools),
        tool_descriptors=tuple(descriptors),
        skills=tuple(skills),
        missing_skill_ids=(),
        unavailable_tool_ids=(),
        catalog_revision=revision,
    )


def _workflow(monkeypatch, agent, runtime, llm):
    ai_cfg = {"agents": [agent], "providers": {"test": {}}}
    monkeypatch.setattr(factory, "get_llm", lambda **_kwargs: llm)
    monkeypatch.setattr(
        factory,
        "resolve_provider_api_key",
        lambda *_args, **_kwargs: None,
    )
    return asyncio.run(
        factory.create_agent_workflow(
            [],
            object(),
            agent_id=agent["id"],
            prepared_ai_cfg=ai_cfg,
            prepared_agent_data=agent,
            runtime_capabilities=runtime,
        )
    )


def test_tool_policy_reads_authorization_from_each_current_state():
    calls = []
    wrapper = factory._tool_policy_wrapper({"write_tool"})

    def execute(request):
        calls.append(request.tool_call["name"])
        return "executed"

    request = SimpleNamespace(
        tool_call={"name": "write_tool", "id": "call-1"},
        state={
            "turn_authorized_tool_names": ["write_tool"],
            "current_user_role": "editor",
        },
    )
    assert wrapper(request, execute) == "executed"

    # The same cached wrapper receives a fresh turn with no grant. The earlier
    # authorization must not survive in its closure or checkpoint state.
    request.state = {
        "turn_authorized_tool_names": [],
        "current_user_role": "editor",
    }
    denied = wrapper(request, execute)
    assert isinstance(denied, ToolMessage)
    assert denied.status == "error"
    assert calls == ["write_tool"]


def test_table_title_replacement_request_routes_to_brain():
    request = (
        'A la taula "Cervell digital" hi ha notes amb títol '
        '"Índex - Projecte: "+id i "Índex - Àrea: "+id. '
        "Busca els titols corresponent a les taules Àrees i Projectes i "
        "substitueix els ids."
    )

    assert factory._obvious_route(request) == "Brain"


def test_reader_requests_select_the_required_first_context_operation():
    assert factory._required_reader_context_tool(
        "Quantes notícies llegides i pendents tinc per font?"
    ) == "inspect_reader_context"
    assert factory._required_reader_context_tool(
        "Busca notícies sobre incendis"
    ) == "search_reader_context"
    assert factory._required_reader_context_tool(
        "Quantes notícies hi ha sobre incendis?"
    ) == "search_reader_context"
    assert factory._required_reader_context_tool(
        "Analitza totes les notícies per temes"
    ) == "start_reader_context_analysis"
    assert factory._required_reader_context_tool(
        "Mostra el resultat abcdef0123456789abcdef0123456789"
    ) == "read_reader_context_analysis"
    assert factory._reader_context_analysis_requested(
        "Compara totes les notícies del Reader per font"
    )
    assert not factory._reader_context_analysis_requested(
        "Quantes notícies hi ha?"
    )
    job_id = "abcdef0123456789abcdef0123456789"
    assert factory._latest_reader_analysis_job_id([
        HumanMessage(content="Analitza totes les notícies"),
        AIMessage(content=f"Anàlisi iniciada: {job_id}"),
        HumanMessage(content="Com va l'anàlisi?"),
    ]) == job_id
    assert factory._required_reader_context_tool(
        f"Com va l'anàlisi? {job_id}"
    ) == "reader_context_analysis_status"


def test_vault_requests_select_deterministic_first_context_operation():
    table_ref = [{"type": "table", "ref": "resources"}]
    assert factory._required_vault_context_tool(
        "Troba tots els recursos dels quals soc autor",
        table_ref,
    ) == "query_context_table"
    assert factory._required_vault_context_tool(
        "Cerca recursos sobre accessibilitat",
        table_ref,
    ) == "search_context"
    assert factory._required_vault_context_tool(
        "Resumeix aquesta pàgina",
        [{"type": "page", "ref": "page-1"}],
    ) == "read_context_source"


def test_latest_context_tool_is_scoped_to_current_human_turn():
    names = {"search_context", "query_context_table"}
    messages = [
        HumanMessage(content="Earlier request"),
        ToolMessage(
            content="earlier result",
            tool_call_id="earlier-call",
            name="search_context",
        ),
        HumanMessage(content="Current request"),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "query_context_table",
                "args": {"source_id": "resources"},
                "id": "current-call",
                "type": "tool_call",
            }],
        ),
        ToolMessage(
            content="current result",
            tool_call_id="current-call",
            name="query_context_table",
        ),
    ]

    assert factory._latest_context_tool_since_latest_user(
        messages,
        names,
    ) == "query_context_table"
    assert factory._latest_context_tool_since_latest_user(
        messages + [HumanMessage(content="Next request")],
        names,
    ) == ""


def test_exact_vault_reads_build_deterministic_tool_calls():
    table_call = factory._deterministic_vault_context_call(
        "query_context_table",
        [{
            "id": "vault-table:resources",
            "type": "table",
            "ref": "resources",
        }],
    )
    assert table_call["name"] == "query_context_table"
    assert table_call["args"] == {
        "source_id": "vault-table:resources",
        "offset": 0,
        "limit": 100,
    }

    page_call = factory._deterministic_vault_context_call(
        "read_context_source",
        [{
            "id": "vault-page:resource-dashboard",
            "type": "page",
            "ref": "resource-dashboard",
        }],
    )
    assert page_call["name"] == "read_context_source"
    assert page_call["args"] == {
        "source_id": "vault-page:resource-dashboard",
    }
    assert factory._deterministic_vault_context_call(
        "search_context",
        [{"type": "vault", "ref": "active-vault"}],
    ) is None


def test_personal_resource_authorship_builds_one_exact_server_call():
    assert factory._personal_resource_authorship_requested(
        "Troba tots els recursos dels quals soc autor"
    )
    assert factory._personal_resource_authorship_requested(
        "List all resources authored by me"
    )
    assert not factory._personal_resource_authorship_requested(
        "Qui és l'autor d'aquest recurs?"
    )
    call = factory._deterministic_personal_resources_call()
    assert call["name"] == "list_authored_vault_resources"
    assert call["args"] == {"offset": 0, "limit": 100}


def test_identical_tool_calls_are_detected_only_in_the_current_turn():
    repeated_call = {
        "name": "query_vault_table",
        "args": {"table_id_or_name": "Recursos", "limit": 100},
        "type": "tool_call",
    }
    messages = [
        HumanMessage(content="Earlier"),
        AIMessage(content="", tool_calls=[{**repeated_call, "id": "old"}]),
        ToolMessage(content="[]", tool_call_id="old"),
        HumanMessage(content="Current"),
        AIMessage(content="", tool_calls=[{**repeated_call, "id": "one"}]),
        ToolMessage(content="[]", tool_call_id="one"),
        AIMessage(content="", tool_calls=[{**repeated_call, "id": "two"}]),
        ToolMessage(content="[]", tool_call_id="two"),
    ]

    assert factory._repeated_tool_call_since_latest_user(messages) == (
        "query_vault_table"
    )
    assert factory._repeated_tool_call_since_latest_user(
        messages + [HumanMessage(content="Next")]
    ) == ""


def test_authored_resources_route_once_then_synthesize_without_tools(monkeypatch):
    calls = []

    @tool
    def list_authored_vault_resources(offset: int = 0, limit: int = 100) -> str:
        """List resources from the saved self-authorship view."""
        calls.append((offset, limit))
        return '{"matching_count":1,"records":[{"id":"one","title":"Mine"}]}'

    descriptor = SimpleNamespace(
        id="core.gnosi.list-authored-vault-resources",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="core.gnosi-vault",
        tool_ids=[descriptor.id],
    )
    runtime = _runtime(
        assigned=("core.gnosi-vault",),
        active=("core.gnosi-vault",),
        instructions=("Use the saved authorship view.",),
        tools=(list_authored_vault_resources,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
    )
    llm = RecordingLlm()
    workflow, _selection = _workflow(
        monkeypatch,
        _agent(skill_ids=["core.gnosi-vault"]),
        runtime,
        llm,
    )

    result = workflow.compile().invoke({
        "messages": [HumanMessage(
            content="Troba tots els recursos dels quals soc autor",
        )],
        "turn_authorized_tool_names": [],
        "active_skill_ids": ["core.gnosi-vault"],
        "current_user_role": "owner",
    })

    assert calls == [(0, 100)]
    assert result["messages"][-1].content == "done"
    assert "exact saved self-authorship view result" in llm.system_prompts[-1]


def test_repeat_guard_precedes_missing_context_forcing(monkeypatch):
    @tool
    def query_vault_table(table_id_or_name: str) -> str:
        """Query an exact test Vault table."""
        return "[]"

    descriptor = SimpleNamespace(
        id="core.gnosi.query-vault-table",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="core.gnosi-vault",
        tool_ids=[descriptor.id],
    )
    runtime = _runtime(
        assigned=("core.gnosi-vault",),
        active=("core.gnosi-vault",),
        tools=(query_vault_table,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
    )
    llm = RecordingLlm()
    workflow, _selection = _workflow(
        monkeypatch,
        _agent(
            skill_ids=["core.gnosi-vault"],
            context_refs=[{
                "id": "active-vault",
                "type": "vault",
                "ref": "active-vault",
                "label": "Knowledge",
            }],
        ),
        runtime,
        llm,
    )
    arguments = {"table_id_or_name": "Recursos"}
    messages = [HumanMessage(content="Troba els meus recursos")]
    for call_id in ("one", "two"):
        messages.extend([
            AIMessage(content="", tool_calls=[{
                "name": "query_vault_table",
                "args": arguments,
                "id": call_id,
                "type": "tool_call",
            }]),
            ToolMessage(content="[]", tool_call_id=call_id),
        ])

    result = workflow.compile().invoke({
        "messages": messages,
        "turn_authorized_tool_names": [],
        "active_skill_ids": ["core.gnosi-vault"],
        "current_user_role": "owner",
    })

    assert result["messages"][-1].content == "done"
    assert "same tool call and arguments were already repeated" in (
        llm.system_prompts[-1]
    )


def test_reader_context_builds_required_single_tool_bindings(monkeypatch):
    llm = RecordingLlm()
    _workflow(
        monkeypatch,
        _agent(context_refs=[{
            "id": "route-reader",
            "type": "internal",
            "ref": "reader",
            "label": "Reader",
            "scope": {"read_status": "all", "unread_only": False},
        }]),
        _runtime(),
        llm,
    )

    bindings = list(zip(llm.bound_tool_names, llm.binding_options))
    required_singletons = {
        names[0]
        for names, options in bindings
        if len(names) == 1 and options.get("tool_choice") == "required"
    }
    assert {
        "inspect_reader_context",
        "search_reader_context",
        "read_reader_context_article",
        "start_reader_context_analysis",
        "reader_context_analysis_status",
        "read_reader_context_analysis",
    } <= required_singletons


def test_tool_policy_enforces_role_and_always_confirmation():
    from backend.models.agent_skills import (
        CatalogOrigin,
        ConfirmationPolicy,
        OriginType,
        ToolDescriptor,
        ToolEffect,
    )

    calls = []
    descriptor = ToolDescriptor(
        id="plugin.example.external-write",
        name="External write",
        origin=CatalogOrigin(type=OriginType.PLUGIN, id="example"),
        effects=[ToolEffect.EXTERNAL_WRITE],
        confirmation=ConfirmationPolicy.ALWAYS,
    )
    wrapper = factory._tool_policy_wrapper({
        "external_write": {
            "minimum_role": "admin",
            "confirmation": "always",
            "_descriptor": descriptor,
        }
    })

    def execute(_request):
        calls.append("executed")
        return "executed"

    request = SimpleNamespace(
        tool_call={"name": "external_write", "id": "call-2"},
        state={
            "turn_authorized_tool_names": ["external_write"],
            "current_user_role": "editor",
        },
    )
    assert wrapper(request, execute).status == "error"

    request.tool_call["args"] = {"target": "exact"}
    request.state = {
        "turn_authorized_tool_names": [],
        "current_user_role": "admin",
        "active_skill_ids": ["plugin.example.external"],
    }
    from backend.agent.action_confirmations import confirmation_context

    with confirmation_context(
        vault_scope="vault",
        workspace_id="personal",
        user_id="user",
        role="admin",
        agent_id="agent",
        session_id="session",
    ):
        prepared = wrapper(request, execute)
    assert prepared.status == "success"
    assert '"action":"governed_tool"' in prepared.content
    assert calls == []


def test_model_tool_support_falls_back_to_global_catalog(monkeypatch):
    from backend.agent import model_catalog, model_router

    monkeypatch.setattr(
        model_router,
        "load_registry",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        model_catalog,
        "catalog_provider",
        lambda provider_id: {
            "id": provider_id,
            "models": [{
                "id": "catalog-tool-model",
                "tags": ["long", "tools"],
            }],
        },
    )

    assert factory._model_supports_tools(
        "test-provider",
        "catalog-tool-model",
        {},
    )


def test_legacy_bundle_exposes_core_gnosi_tools_without_query_wiki(
    monkeypatch,
    tmp_path,
):
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    from backend.services.context_vars import active_vault_path

    llm = RecordingLlm()
    agent = _agent()
    token = active_vault_path.set(tmp_path)
    try:
        runtime = resolve_agent_runtime(agent, vault_path=tmp_path)
    finally:
        active_vault_path.reset(token)

    workflow, _selection = _workflow(monkeypatch, agent, runtime, llm)

    assert workflow is not None
    assert llm.bound_tool_names
    assert all(
        "query_wiki" not in tool_names
        for tool_names in llm.bound_tool_names
    )
    brain_tool_names = max(llm.bound_tool_names, key=len)
    assert {
        "list_table_rows",
        "create_table_row",
        "send_mail",
    } <= set(brain_tool_names)


def test_assigned_skill_does_not_inherit_unrelated_core_gnosi_tools(monkeypatch):
    @tool
    def skill_query(query: str) -> str:
        """Search the test knowledge source."""
        return query

    descriptor = SimpleNamespace(
        id="plugin.example.query-tool",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="plugin.example.query",
        tool_ids=["plugin.example.query-tool"],
    )
    runtime = _runtime(
        assigned=("plugin.example.query",),
        active=("plugin.example.query",),
        instructions=("Use the registered knowledge search.",),
        tools=(skill_query,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
    )
    llm = RecordingLlm()

    _workflow(
        monkeypatch,
        _agent(skill_ids=["plugin.example.query"]),
        runtime,
        llm,
    )

    assert len(llm.bound_tool_names) == 1
    bound_names = set(llm.bound_tool_names[0])
    assert "skill_query" in bound_names
    assert not ({
        "list_table_rows",
        "create_page",
        "create_table_row",
        "empty_trash",
    } & bound_names)


def test_core_domain_skill_exposes_only_its_assigned_tools(tmp_path):
    from backend.services.agent_skill_catalog import resolve_agent_runtime

    runtime = resolve_agent_runtime(
        _agent(skill_ids=["core.gnosi-mail"]),
        vault_path=tmp_path,
    )
    names = {
        getattr(handler, "name", "")
        for handler in runtime.tools
    }

    assert {
        "search_mail",
        "send_mail",
        "save_mail_draft",
        "archive_mail",
        "move_mail",
    } <= names
    assert not ({
        "create_page",
        "delete_page",
        "list_table_rows",
        "create_calendar_event",
        "list_contacts",
    } & names)


def test_tool_backed_skill_routes_directly_to_tool_enabled_specialist(monkeypatch):
    @tool
    def skill_query(query: str) -> str:
        """Search the test knowledge source."""
        return query

    descriptor = SimpleNamespace(
        id="plugin.example.query-tool",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="plugin.example.query",
        tool_ids=["plugin.example.query-tool"],
    )
    runtime = _runtime(
        assigned=("plugin.example.query",),
        active=("plugin.example.query",),
        instructions=("Use the registered knowledge search.",),
        tools=(skill_query,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
    )
    llm = RecordingLlm()

    workflow, _selection = _workflow(
        monkeypatch,
        _agent(skill_ids=["plugin.example.query"]),
        runtime,
        llm,
    )
    workflow.compile().invoke({
        "messages": [HumanMessage(content="What is already known?")],
        "turn_authorized_tool_names": [],
        "active_skill_ids": ["plugin.example.query"],
        "current_user_role": "viewer",
    })

    assert llm.system_prompts
    assert "Brain specialist" in llm.system_prompts[-1]


def test_plain_callable_tool_handler_is_not_dropped(monkeypatch):
    def callable_query(query: str) -> str:
        """Search through a plain callable adapter."""
        return query

    descriptor = SimpleNamespace(
        id="plugin.example.callable-tool",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="plugin.example.callable",
        tool_ids=["plugin.example.callable-tool"],
    )
    runtime = _runtime(
        assigned=("plugin.example.callable",),
        active=("plugin.example.callable",),
        tools=(callable_query,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
    )
    llm = RecordingLlm()

    _workflow(
        monkeypatch,
        _agent(skill_ids=["plugin.example.callable"]),
        runtime,
        llm,
    )

    assert len(llm.bound_tool_names) == 1
    assert "callable_query" in llm.bound_tool_names[0]


def test_configured_persona_applies_to_brain_specialist(monkeypatch):
    llm = RecordingLlm()
    workflow, _selection = _workflow(
        monkeypatch,
        _agent(skill_ids=[]),
        _runtime(),
        llm,
    )
    app = workflow.compile()

    app.invoke({
        "messages": [
            # This deterministic intent goes straight to Brain.
            HumanMessage(content="Busca els correus pendents")
        ],
        "turn_authorized_tool_names": [],
        "active_skill_ids": [],
        "current_user_role": "editor",
    })

    assert any(
        "Follow this configured persona." in prompt
        and "Brain specialist" in prompt
        for prompt in llm.system_prompts
    )


def test_workflow_cache_key_includes_catalog_revision(monkeypatch, tmp_path):
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                agent_cache={},
                mcp_client=SimpleNamespace(
                    get_all_tools=lambda: [],
                ),
                tools_list=[{"name": "ready"}],
            )
        )
    )
    revisions = iter(("revision-a", "revision-b"))
    builds = []

    def prepare(*_args, **_kwargs):
        return (
            {"providers": {}},
            _agent(skill_ids=[]),
            _runtime(revision=next(revisions)),
        )

    async def create(*_args, **_kwargs):
        builds.append(1)
        return object(), {"provider": "test", "model": "model"}

    monkeypatch.setattr(agent_routes, "prepare_agent_runtime", prepare)
    monkeypatch.setattr(agent_routes, "create_agent_workflow", create)

    async def scenario():
        await agent_routes.get_agent_workflow(
            request,
            "agent",
            vault_scope="vault",
            vault_path=tmp_path,
        )
        await agent_routes.get_agent_workflow(
            request,
            "agent",
            vault_scope="vault",
            vault_path=tmp_path,
        )

    asyncio.run(scenario())
    assert len(builds) == 2


def test_workflow_cache_key_includes_model_runtime_revision(monkeypatch, tmp_path):
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                agent_cache={},
                mcp_client=SimpleNamespace(get_all_tools=lambda: []),
                tools_list=[{"name": "ready"}],
            )
        )
    )
    model_rows = iter((
        [{"provider": "mistral", "model_id": "devstral-latest", "tags": []}],
        [{"provider": "mistral", "model_id": "devstral-latest", "tags": ["tools"]}],
    ))
    builds = []

    def prepare(*_args, **_kwargs):
        return (
            {"providers": {}, "models": next(model_rows)},
            _agent(skill_ids=[]),
            _runtime(revision="same-catalog"),
        )

    async def create(*_args, **_kwargs):
        builds.append(1)
        return object(), {"provider": "mistral", "model": "devstral-latest"}

    monkeypatch.setattr(agent_routes, "prepare_agent_runtime", prepare)
    monkeypatch.setattr(agent_routes, "create_agent_workflow", create)

    async def scenario():
        await agent_routes.get_agent_workflow(
            request,
            "agent",
            vault_scope="vault",
            vault_path=tmp_path,
        )
        await agent_routes.get_agent_workflow(
            request,
            "agent",
            vault_scope="vault",
            vault_path=tmp_path,
        )

    asyncio.run(scenario())
    assert len(builds) == 2


def test_tool_stream_event_exposes_only_governance_metadata():
    event = agent_routes.json.loads(
        agent_routes._tool_stream_event(
            "tool_start",
            "skill_query",
            "brain_tools",
            {
                "id": "plugin.example.query-tool",
                "skill_ids": ["plugin.example.query"],
                "effects": ["read"],
                "secret": "must-not-leak",
            },
        )
    )

    assert event == {
        "type": "tool_start",
        "tool": "skill_query",
        "node": "brain_tools",
        "tool_id": "plugin.example.query-tool",
        "skill_ids": ["plugin.example.query"],
        "effects": ["read"],
    }
