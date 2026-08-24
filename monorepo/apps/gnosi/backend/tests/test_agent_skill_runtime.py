"""Runtime integration tests for governed agent skills and tools."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
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
    missing=(),
    unavailable=(),
    revision="runtime-revision",
):
    return SimpleNamespace(
        assigned_skill_ids=tuple(assigned),
        active_skill_ids=tuple(active),
        instructions=tuple(instructions),
        tools=tuple(tools),
        tool_descriptors=tuple(descriptors),
        skills=tuple(skills),
        missing_skill_ids=tuple(missing),
        unavailable_tool_ids=tuple(unavailable),
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


def test_notebook_policy_omissions_are_not_reported_as_unavailable_tools():
    metadata = [
        {"id": "core.global.search", "name": "search_vault"},
        {
            "id": "context.notebook.search",
            "name": "search_notebook_context",
            "dynamic_context": True,
        },
    ]

    assert factory._omitted_runtime_tool_ids(
        metadata,
        {"search_notebook_context"},
        notebook_context_only=True,
    ) == []
    assert factory._omitted_runtime_tool_ids(
        metadata,
        set(),
        notebook_context_only=True,
    ) == ["context.notebook.search"]
    assert factory._omitted_runtime_tool_ids(
        metadata,
        set(),
        notebook_context_only=False,
    ) == ["core.global.search", "context.notebook.search"]


def test_notebook_runtime_status_reports_only_context_tools(monkeypatch):
    @tool
    def search_vault(query: str) -> str:
        """Search the ordinary Vault."""
        return query

    @tool
    def search_notebook_context(query: str) -> str:
        """Search the attached notebook."""
        return query

    descriptor = SimpleNamespace(
        id="core.global.search",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="core.gnosi-vault",
        tool_ids=[descriptor.id],
    )
    runtime = _runtime(
        assigned=("core.gnosi-vault", "plugin.missing"),
        active=("core.gnosi-vault",),
        tools=(search_vault,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
        missing=("plugin.missing",),
        unavailable=("core.global.search",),
    )
    monkeypatch.setattr(
        factory,
        "build_context_tools",
        lambda _refs: [search_notebook_context],
    )

    _workflow_graph, selection = _workflow(
        monkeypatch,
        _agent(
            skill_ids=["core.gnosi-vault", "plugin.missing"],
            context_refs=[{
                "id": "notebook:notebook-1",
                "type": "notebook",
                "ref": "notebook-1",
                "label": "Research",
                "scope": {"revision": 2, "selection": "all"},
            }],
        ),
        runtime,
        RecordingLlm(),
    )

    assert selection["assigned_skill_ids"] == []
    assert selection["active_skill_ids"] == []
    assert selection["missing_skill_ids"] == []
    assert selection["unavailable_tool_ids"] == []
    assert selection["tool_count"] == 1


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
    ) == "inventory_context"
    assert factory._required_vault_context_tool(
        "Cerca recursos sobre accessibilitat",
        table_ref,
    ) == "inventory_context"
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

    inventory_call = factory._deterministic_vault_context_call(
        "inventory_context",
        [{"id": "active-vault", "type": "vault", "ref": "active-vault"}],
        "Busca quines fonts i notes tinc relacionades amb coaching",
    )
    assert inventory_call["name"] == "inventory_context"
    assert inventory_call["args"] == {
        "query": "coaching",
        "record_types": ["source", "note"],
        "include_relations": True,
        "offset": 0,
        "limit": 100,
    }


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


def test_provider_prompt_omits_historical_tool_payloads_only():
    messages = [
        HumanMessage(content="Earlier question"),
        AIMessage(content="", tool_calls=[{
            "name": "search_vault",
            "args": {"query": "earlier"},
            "id": "old-call",
            "type": "tool_call",
        }]),
        ToolMessage(
            content="HISTORICAL_RAW_PAYLOAD" * 1_000,
            name="search_vault",
            tool_call_id="old-call",
        ),
        AIMessage(content="Earlier final answer"),
        HumanMessage(content="Current question"),
        AIMessage(content="", tool_calls=[{
            "name": "query_vault_table",
            "args": {"table_id_or_name": "Resources"},
            "id": "current-call",
            "type": "tool_call",
        }]),
        ToolMessage(
            content="CURRENT_EXACT_PAYLOAD",
            name="query_vault_table",
            tool_call_id="current-call",
        ),
    ]

    bounded = factory._bounded_model_messages(messages, max_chars=500_000)
    contents = [str(message.content) for message in bounded]

    assert "Earlier final answer" in contents
    assert "CURRENT_EXACT_PAYLOAD" in contents
    assert not any("HISTORICAL_RAW_PAYLOAD" in content for content in contents)
    assert sum(len(content) for content in contents) <= factory.MAX_MODEL_MESSAGE_CHARS


def test_provider_prompt_never_evicts_current_request_for_large_tool_results():
    messages = [HumanMessage(content="CURRENT_REQUEST")]
    for index in range(4):
        call_id = f"current-call-{index}"
        messages.extend([
            AIMessage(content="", tool_calls=[{
                "name": "query_vault_table",
                "args": {"offset": index},
                "id": call_id,
                "type": "tool_call",
            }]),
            ToolMessage(
                content=f"RESULT_{index}_" + ("x" * 20_000),
                name="query_vault_table",
                tool_call_id=call_id,
            ),
        ])

    bounded = factory._bounded_model_messages(messages, max_chars=24_000)

    assert any(message.content == "CURRENT_REQUEST" for message in bounded)
    assert sum(len(str(message.content)) for message in bounded) <= 24_000
    tool_call_ids = {
        str(call.get("id") or "")
        for message in bounded
        for call in (getattr(message, "tool_calls", None) or [])
    }
    assert {
        str(getattr(message, "tool_call_id", "") or "")
        for message in bounded
        if isinstance(message, ToolMessage)
    } == tool_call_ids


def test_turn_model_tools_bind_reads_and_exact_guarded_grants_only():
    @tool
    def read_tool() -> str:
        """Read test state."""
        return "read"

    @tool
    def write_tool() -> str:
        """Write test state."""
        return "write"

    @tool
    def search_mail() -> str:
        """Search the mailbox."""
        return "mail"

    @tool
    def list_table_rows() -> str:
        """List table rows."""
        return "rows"

    metadata = [
        {
            "name": "read_tool",
            "effects": ["read", "personal_data"],
            "confirmation": "none",
        },
        {
            "name": "write_tool",
            "effects": ["local_write"],
            "confirmation": "explicit_request",
        },
        {
            "name": "search_mail",
            "effects": ["read", "personal_data"],
            "confirmation": "none",
        },
        {
            "name": "list_table_rows",
            "effects": ["read", "personal_data"],
            "confirmation": "none",
        },
    ]

    passive = factory._turn_model_tools(
        [read_tool, write_tool, search_mail, list_table_rows], metadata, [],
    )
    authorized = factory._turn_model_tools(
        [read_tool, write_tool, search_mail, list_table_rows],
        metadata,
        ["write_tool"],
        user_message="Busca els correus pendents",
        narrow_passive_reads=True,
    )

    assert [item.name for item in passive] == [
        "read_tool", "search_mail", "list_table_rows",
    ]
    assert [item.name for item in authorized] == ["write_tool", "search_mail"]


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Troba tots els recursos dels quals soc autor", "authored"),
        ("List all rows in this table", "inventory_context"),
        ("Summarize this page", "read_context_source"),
        ("Quantes notícies pendents tinc?", "inspect_reader_context"),
        ("Busca notícies sobre accessibilitat", "search_reader_context"),
        ("Analitza totes les notícies per temes", "start_reader_context_analysis"),
        (
            "Com va l'anàlisi? abcdef0123456789abcdef0123456789",
            "reader_context_analysis_status",
        ),
    ],
)
def test_representative_read_request_matrix(message, expected):
    if expected == "authored":
        assert factory._personal_resource_authorship_requested(message)
    elif "reader" in expected:
        assert factory._required_reader_context_tool(message) == expected
    else:
        ref_type = "table" if expected == "inventory_context" else "page"
        assert factory._required_vault_context_tool(
            message,
            [{"type": ref_type, "ref": "example"}],
        ) == expected


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Hola, com estàs?", "conversation"),
        ("Qui és l'autor d'aquesta nota?", "lookup"),
        ("Busca quines fonts i notes tinc relacionades amb coaching", "inventory"),
        ("Quants projectes tinc?", "inventory"),
        ("Quines titulacions tinc?", "inventory"),
        ("Mostra'm els llibres", "inventory"),
        ("Show my books", "inventory"),
        ("Show me how to archive email", "lookup"),
        ("Llista les notes que contenen coaching", "inventory"),
        ("Quines notes parlen de coaching?", "inventory"),
        ("How many qualifications do I have?", "inventory"),
        ("Quants anys té aquesta persona?", "lookup"),
        ("Com puc arxivar els correus?", "lookup"),
        ("Quines notes contenen literalment coaching?", "inventory"),
        ("Què diuen les meves notes sobre coaching?", "analysis"),
        ("Compare all notes about coaching", "analysis"),
        ("Crea una nota sobre coaching", "action"),
    ],
)
def test_universal_request_mode_is_independent_from_the_topic(message, expected):
    assert factory._request_mode(message) == expected


def test_inventory_argument_extraction_removes_request_scaffolding():
    assert factory._inventory_request_arguments(
        "Llista tots els projectes de salut mental"
    ) == {
        "query": "salut mental",
        "record_types": ["project"],
        "include_relations": True,
        "offset": 0,
        "limit": 100,
    }
    assert factory._inventory_request_arguments(
        "Quants recursos tinc?"
    )["query"] == ""
    assert factory._inventory_request_arguments(
        "Mostra'm les titulacions"
    )["query"] == ""
    assert factory._inventory_request_arguments(
        "¿Qué titulaciones tengo?"
    )["query"] == ""
    assert factory._inventory_request_arguments(
        "Quelles qualifications ai-je ?"
    )["query"] == ""
    assert factory._inventory_request_arguments(
        "List all rows in this table"
    )["query"] == ""
    literal = factory._inventory_request_arguments(
        "Quines notes contenen literalment coaching?"
    )
    assert literal["query"] == "coaching"
    assert literal["include_relations"] is False
    assert factory._inventory_request_arguments(
        "Llista els registres des de l'índex 200"
    )["offset"] == 200
    bibliographic = factory._inventory_request_arguments(
        "Buscame que notas tengo en relación a como encontrar fuentes bibliográficas de calidad"
    )
    assert bibliographic["record_types"] == ["source", "note"]
    assert bibliographic["query"] == "bibliograficas calidad"
    assert factory._response_language("Mostra'm les titulacions") == "ca"


def test_inventory_continuation_reuses_the_exact_previous_cursor():
    payload = {
        "query": "coaching",
        "record_types_requested": ["source", "note"],
        "matching_count": 140,
        "offset": 0,
        "limit": 100,
        "has_more": True,
        "next_offset": 100,
        "records": [],
    }
    messages = [
        HumanMessage(content="Busca fonts i notes sobre coaching"),
        AIMessage(content="", tool_calls=[{
            "name": "inventory_context",
            "args": {},
            "id": "inventory-call",
            "type": "tool_call",
        }]),
        ToolMessage(
            content=json.dumps(payload),
            name="inventory_context",
            tool_call_id="inventory-call",
        ),
        AIMessage(content="Showing the first page"),
        HumanMessage(content="Continua amb els següents"),
    ]

    assert factory._inventory_continuation_requested(messages[-1].content)
    assert factory._previous_inventory_arguments(messages) == {
        "query": "coaching",
        "record_types": ["source", "note"],
        "include_relations": True,
        "offset": 100,
        "limit": 100,
    }
    assert factory._required_vault_context_tool(
        messages[-1].content,
        [{"type": "vault", "ref": "active-vault"}],
        inventory_continuation=True,
    ) == "inventory_context"


def test_inventory_response_is_localized_grouped_and_explicitly_paginated():
    response = factory._inventory_context_response(json.dumps({
        "query": "coaching",
        "matching_count": 3,
        "counts_by_type": {"Recursos": 2, "Cervell digital": 1},
        "counts_by_match_kind": {"direct": 2, "relation": 1},
        "offset": 0,
        "has_more": True,
        "next_offset": 2,
        "records": [
            {
                "id": "resource-1",
                "title": "Coaching x valores",
                "record_type": {"id": "resources", "name": "Recursos"},
                "metadata": {"year": 2015, "item_type": "Formació"},
            },
            {
                "id": "note-1",
                "title": "*Unsafe* note",
                "record_type": {"id": "brain", "name": "Cervell digital"},
                "match_basis": ["relations"],
                "metadata": {"verification_status": "Provisional"},
            },
        ],
    }), "Busca quines fonts i notes tinc relacionades amb coaching")

    assert "He trobat 3 registres" in response
    assert "Per tipus: Cervell digital (1), Recursos (2)." in response
    assert "Coincidències: 2 directes · 1 per relació." in response
    assert "Recursos (2)" in response and "Cervell digital (1)" in response
    assert "\\*Unsafe\\* note" in response
    assert "Es mostren 2 de 3; continua des de l’índex 2." in response
    assert "cerca exhaustiva de text, metadades i relacions" in response


@pytest.mark.parametrize(
    ("message", "expected_fragment"),
    [
        ("Troba els recursos dels quals soc autor", "S'ha trobat 1 recurs"),
        ("Encuentra los recursos de los que soy autor", "Se ha encontrado 1 recurso"),
        ("Find resources authored by me", "Found 1 resource"),
        ("Trouve mes ressources dont je suis auteur", "1 ressource a été trouvée"),
    ],
)
def test_authored_resource_response_is_localized_and_escaped(
    message,
    expected_fragment,
):
    content = factory._authored_resources_response(
        '{"active_view":{"name":"Mine"},"matching_count":1,'
        '"records":[{"id":"one","title":"*Unsafe* title"}]}',
        message,
    )

    assert expected_fragment in content
    assert "\\*Unsafe\\* title" in content


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


def test_authored_resources_route_once_then_formats_without_model(monkeypatch):
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
    assert result["messages"][-1].content == (
        "S'ha trobat 1 recurs a la vista «Resources»:\n1. Mine"
    )
    assert llm.system_prompts == []


def test_generic_inventory_routes_once_then_formats_without_model(monkeypatch):
    calls = []

    @tool
    def inventory_context(
        query: str = "",
        record_types: list[str] | None = None,
        include_relations: bool = True,
        offset: int = 0,
        limit: int = 100,
    ) -> str:
        """Enumerate exact matching records from the attached test Vault."""
        calls.append((query, record_types, include_relations, offset, limit))
        return json.dumps({
            "query": query,
            "matching_count": 1,
            "counts_by_type": {"Cervell digital": 1},
            "offset": offset,
            "has_more": False,
            "records": [{
                "id": "note-1",
                "title": "Coaching practice",
                "record_type": {"id": "brain", "name": "Cervell digital"},
                "metadata": {},
            }],
        })

    monkeypatch.setattr(factory, "build_context_tools", lambda _refs: [inventory_context])
    llm = RecordingLlm()
    workflow, _selection = _workflow(
        monkeypatch,
        _agent(context_refs=[{
            "id": "active-vault",
            "type": "vault",
            "ref": "active-vault",
            "label": "Knowledge",
        }]),
        _runtime(),
        llm,
    )

    result = workflow.compile().invoke({
        "messages": [HumanMessage(content=(
            "Busca quines fonts i notes tinc relacionades amb coaching"
        ))],
        "turn_authorized_tool_names": [],
        "active_skill_ids": [],
        "current_user_role": "owner",
    })

    assert calls == [("coaching", ["source", "note"], True, 0, 100)]
    assert "He trobat 1 registre" in result["messages"][-1].content
    assert "Coaching practice" in result["messages"][-1].content
    assert llm.system_prompts == []


def test_conversation_with_vault_context_does_not_force_a_read(monkeypatch):
    calls = []

    @tool
    def search_context(query: str) -> str:
        """Search attached test context."""
        calls.append(query)
        return "unexpected"

    monkeypatch.setattr(factory, "build_context_tools", lambda _refs: [search_context])
    llm = RecordingLlm()
    workflow, _selection = _workflow(
        monkeypatch,
        _agent(context_refs=[{
            "id": "active-vault",
            "type": "vault",
            "ref": "active-vault",
            "label": "Knowledge",
        }]),
        _runtime(),
        llm,
    )

    result = workflow.compile().invoke({
        "messages": [HumanMessage(content="Hola, com estàs?")],
        "turn_authorized_tool_names": [],
        "active_skill_ids": [],
        "current_user_role": "owner",
    })

    assert calls == []
    assert result["messages"][-1].content == "done"
    assert len(llm.system_prompts) == 1


def test_conversation_with_assigned_runtime_does_not_bind_passive_tools(
    monkeypatch,
):
    context_calls = []

    @tool
    def search_context(query: str) -> str:
        """Search attached test context."""
        context_calls.append(query)
        return "unexpected"

    @tool
    def inspect_assigned_source() -> str:
        """Inspect an assigned source."""
        return "unexpected"

    descriptor = SimpleNamespace(
        id="custom.inspect-source",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="custom.runtime",
        tool_ids=[descriptor.id],
    )
    runtime = _runtime(
        assigned=("custom.runtime",),
        active=("custom.runtime",),
        tools=(inspect_assigned_source,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
    )
    monkeypatch.setattr(factory, "build_context_tools", lambda _refs: [search_context])
    llm = RecordingLlm()
    workflow, _selection = _workflow(
        monkeypatch,
        _agent(
            skill_ids=["custom.runtime"],
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

    result = workflow.compile().invoke({
        "messages": [HumanMessage(content="Hola, com estàs?")],
        "turn_authorized_tool_names": [],
        "active_skill_ids": ["custom.runtime"],
        "current_user_role": "owner",
    })

    assert result["messages"][-1].content == "done"
    assert context_calls == []
    assert llm.bound_tool_names == [["search_context"]]
    assert "classified this turn as conversation" in llm.system_prompts[0]
    assert "MUST call" not in llm.system_prompts[0]


def test_explicit_non_vault_domain_does_not_force_default_vault_context():
    assert factory._vault_context_is_relevant("Quines titulacions tinc?")
    assert not factory._vault_context_is_relevant("Quin temps farà demà?")
    assert not factory._vault_context_is_relevant("Busca al meu correu")
    assert factory._vault_context_is_relevant(
        "Busca notes relacionades amb el correu"
    )


def test_non_vault_runtime_request_does_not_expose_default_vault_tools(
    monkeypatch,
):
    context_calls = []

    @tool
    def search_context(query: str) -> str:
        """Search attached test context."""
        context_calls.append(query)
        return "unexpected"

    @tool
    def inspect_weather(location: str) -> str:
        """Read a weather forecast."""
        return location

    descriptor = SimpleNamespace(
        id="custom.inspect-weather",
        effects=["read"],
        confirmation="none",
    )
    skill_descriptor = SimpleNamespace(
        id="custom.weather",
        tool_ids=[descriptor.id],
    )
    runtime = _runtime(
        assigned=("custom.weather",),
        active=("custom.weather",),
        tools=(inspect_weather,),
        descriptors=(descriptor,),
        skills=(SimpleNamespace(descriptor=skill_descriptor),),
    )
    monkeypatch.setattr(factory, "build_context_tools", lambda _refs: [search_context])
    llm = RecordingLlm()
    workflow, _selection = _workflow(
        monkeypatch,
        _agent(
            skill_ids=["custom.weather"],
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

    result = workflow.compile().invoke({
        "messages": [HumanMessage(content="Quin temps farà demà?")],
        "turn_authorized_tool_names": [],
        "active_skill_ids": ["custom.weather"],
        "current_user_role": "owner",
    })

    assert result["messages"][-1].content == "done"
    assert context_calls == []
    assert llm.bound_tool_names[-1] == ["inspect_weather"]
    assert "MUST call search_context" not in llm.system_prompts[0]


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

    workflow, selection = _workflow(monkeypatch, agent, runtime, llm)

    assert workflow is not None
    brain_tool_names = {
        item["name"] for item in selection["tools"]
    }
    assert "query_wiki" not in brain_tool_names
    assert {
        "list_table_rows",
        "create_table_row",
        "send_mail",
    } <= brain_tool_names


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

    workflow, _selection = _workflow(
        monkeypatch,
        _agent(skill_ids=["plugin.example.query"]),
        runtime,
        llm,
    )
    workflow.compile().invoke({
        "messages": [HumanMessage(content="Search the assigned source")],
        "turn_authorized_tool_names": [],
        "active_skill_ids": ["plugin.example.query"],
        "current_user_role": "owner",
    })

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

    workflow, _selection = _workflow(
        monkeypatch,
        _agent(skill_ids=["plugin.example.callable"]),
        runtime,
        llm,
    )
    workflow.compile().invoke({
        "messages": [HumanMessage(content="Search the assigned source")],
        "turn_authorized_tool_names": [],
        "active_skill_ids": ["plugin.example.callable"],
        "current_user_role": "owner",
    })

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
