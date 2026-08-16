import asyncio
import json
import os
import time
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.base import empty_checkpoint
from pydantic import ValidationError

from backend.agent import gnosi_tools, system_tools
from backend.agent.factory import (
    _authorized_brain_write_tools,
    _bounded_model_messages,
    _coder_read_only_tools,
    _explicit_brain_write_tool_names,
    _model_supports_tools,
    _model_context_window,
    _obvious_route,
    _rejected_mcp_names,
    _safe_mcp_definitions,
    _tool_results_since_latest_user,
)
from backend.api import agent_routes


def test_identifiers_reject_path_components():
    with pytest.raises(Exception) as exc:
        agent_routes._validated_identifier("foo/../../escape", "agent_id")
    assert getattr(exc.value, "status_code", None) == 422


def test_checkpoint_scope_is_deterministic_and_identity_specific():
    common = {
        "vault_scope": "vault-a",
        "workspace_id": "workspace-a",
        "agent_id": "agent",
    }
    first = agent_routes._checkpoint_key(user_id="user-a", **common)
    repeated = agent_routes._checkpoint_key(user_id="user-a", **common)
    another_user = agent_routes._checkpoint_key(user_id="user-b", **common)
    another_workspace = agent_routes._checkpoint_key(
        vault_scope="vault-a",
        workspace_id="workspace-b",
        user_id="user-a",
        agent_id="agent",
    )

    assert first == repeated
    assert first != another_user
    assert first != another_workspace
    assert "/" not in first

    thread = agent_routes._chat_thread_id(
        session_id="session",
        user_id="user-a",
        **common,
    )
    other_thread = agent_routes._chat_thread_id(
        session_id="session",
        user_id="user-b",
        **common,
    )
    assert thread != other_thread


def test_attachment_context_rejects_files_outside_chat_directory(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    outside = vault / "secret.txt"
    outside.write_text("secret", encoding="utf-8")
    ref = agent_routes.AttachmentRef(
        name="secret.txt",
        size=6,
        type="text/plain",
        path="secret.txt",
    )
    with pytest.raises(Exception) as exc:
        agent_routes._attachment_context(vault, [ref], "scope")
    assert getattr(exc.value, "status_code", None) == 422


def test_attachment_context_extracts_bounded_text(tmp_path):
    vault = tmp_path / "vault"
    root = vault / ".gnosi" / "chat-attachments" / "scope"
    root.mkdir(parents=True)
    attachment = root / "safe.txt"
    attachment.write_text("verified text", encoding="utf-8")
    ref = agent_routes.AttachmentRef(
        name="notes.txt",
        size=13,
        type="text/plain",
        path=".gnosi/chat-attachments/scope/safe.txt",
    )
    assert "verified text" in agent_routes._attachment_context(vault, [ref], "scope")


def test_obvious_general_route_avoids_supervisor_call():
    assert _obvious_route("hola") == "General"
    assert _obvious_route("Explain this concept briefly") == "General"


def test_obvious_specialist_routes():
    assert _obvious_route("Fix this Python bug") == "Coder"
    assert _obvious_route("Read this PDF", has_context=True) == "Brain"


@pytest.mark.parametrize(
    "message",
    [
        "Quines reunions tinc demà?",
        "Busca els correus pendents",
        "Resumeix @[Pla](page:abc-123)",
        "Quin temps farà demà?",
    ],
)
def test_integration_and_mention_intents_route_to_brain(message):
    assert _obvious_route(message) == "Brain"


def test_ambiguous_short_request_keeps_supervisor():
    assert _obvious_route("Organitza això per demà") is None


def test_mcp_read_only_policy_uses_annotations_not_name_prefix():
    definitions = [
        {"name": "get_and_delete", "annotations": {"destructiveHint": True}},
        {"name": "fetch_notes", "annotations": {"readOnlyHint": True}},
        {"name": "trusted_custom"},
    ]
    assert [item["name"] for item in _safe_mcp_definitions(definitions)] == ["fetch_notes"]
    assert [
        item["name"]
        for item in _safe_mcp_definitions(definitions, ["trusted_custom"])
    ] == ["fetch_notes", "trusted_custom"]


def test_rejected_mcp_tools_are_reportable():
    definitions = [
        {"name": "calendar_lookup"},
        {"name": "mail_search", "annotations": {"readOnlyHint": True}},
    ]
    safe = _safe_mcp_definitions(definitions)
    assert _rejected_mcp_names(definitions, safe) == ["calendar_lookup"]


def test_agent_can_explicitly_disable_tool_binding():
    assert not _model_supports_tools(
        "custom",
        "text-only",
        {"capabilities": {"tools": False}},
    )


def test_unknown_model_does_not_assume_tool_support():
    assert not _model_supports_tools("custom", "unknown-model", {})
    assert _model_supports_tools(
        "custom",
        "verified-model",
        {"capabilities": {"tools": True}},
    )


def test_coder_tools_exclude_personal_data_sources():
    tools = [
        SimpleNamespace(name="inspect_codebase"),
        SimpleNamespace(name="search_code_symbols"),
        SimpleNamespace(name="query_memory"),
        SimpleNamespace(name="search_vault"),
    ]
    assert [tool.name for tool in _coder_read_only_tools(tools)] == [
        "inspect_codebase",
        "search_code_symbols",
    ]


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Crea una pàgina amb aquest contingut", {"create_page"}),
        ("Prepare a Cornell summary of this PDF", {"summarize_to_cornell"}),
        ("Crea una nota Cornell d'aquest document", {"summarize_to_cornell"}),
        ("Recorda que prefereixo respostes breus", {"save_memory"}),
        (
            "Crea una nota i guarda això a la memòria",
            {"create_page", "save_memory"},
        ),
        ("Afegeix una fila a la taula Projectes", {"create_table_row"}),
        ("Actualitza la pàgina Pla anual", {"update_page"}),
        ("Desa un esborrany de correu per a Anna", {"save_mail_draft"}),
        ("Crea un esdeveniment demà al calendari", {"create_calendar_event"}),
        (
            "Confirmo: envia aquest correu a Anna",
            {"send_mail"},
        ),
        (
            "Confirmo: elimina la pàgina Esborrany",
            {"delete_page"},
        ),
        ("Elimina la pàgina Esborrany", {"delete_page"}),
        ("Envia aquest correu a Anna", {"send_mail"}),
        ("Buida la paperera", {"empty_trash"}),
        ("Elimina la taula Projectes", {"delete_table"}),
        (
            "Substitueix els ids dels títols de la taula Cervell digital",
            {"replace_reference_ids_in_titles"},
        ),
    ],
)
def test_explicit_user_intent_authorizes_individual_write_tools(message, expected):
    assert _explicit_brain_write_tool_names(message) == expected
    assert {
        tool.name for tool in _authorized_brain_write_tools(expected)
    } == expected


@pytest.mark.parametrize(
    "message",
    [
        "Organitza millor el meu Vault",
        "Quines pàgines tinc?",
        "Recordes què vam parlar ahir?",
    ],
)
def test_vague_or_quoted_content_does_not_authorize_writes(message):
    assert _explicit_brain_write_tool_names(message) == set()


@pytest.mark.parametrize(
    "message",
    [
        "Do not send this email",
        "Never delete the table Projectes",
        "No envía el correo",
        "Do not empty the trash",
        "Do not create an event tomorrow",
        "Explain why the phrase send this email is unsafe",
        "Can this agent delete the table?",
        '"send this email"',
        "`delete the table`",
        "Could you explain how to delete the table?",
        "The documentation says 'send the email' but do nothing.",
        "Before you send the email, explain what will happen.",
        "La frase 'elimina la pàgina' és perillosa.",
        "Explica com puc buidar la paperera",
        "Explique comment supprimer la table",
        "Update the page, but do not actually change anything",
        "Envia el correu, però no l’enviïs realment",
        "Actualiza la página, pero no cambies nada",
        "Modifie la page, mais ne la change pas",
        "Sí, fes-la",
        "OK",
    ],
)
def test_negated_meta_or_quoted_intent_never_authorizes_writes(message):
    assert _explicit_brain_write_tool_names(message) == set()


def test_structured_mentions_require_an_affirmative_current_turn_verb():
    mention = [{"type": "table", "id": "projects", "label": "Projectes"}]

    assert _explicit_brain_write_tool_names(
        "Elimina @[Projectes](table:projects)",
        mention,
    ) == {"delete_table"}
    assert _explicit_brain_write_tool_names(
        "No eliminis @[Projectes](table:projects)",
        mention,
    ) == set()


def test_sensitive_project_paths_are_not_readable():
    assert system_tools._is_sensitive_path(system_tools.BASE_DIR / ".env_shared")
    assert system_tools._is_sensitive_path(
        system_tools.BASE_DIR / "local_data" / "system" / "secrets.json"
    )
    result = system_tools.inspect_codebase.invoke({"path": ".env_shared"})
    assert result.startswith("Error: Access denied")


def test_chat_request_limits_attachment_count():
    refs = [
        agent_routes.AttachmentRef(
            name=f"notes-{index}.txt",
            path=f".gnosi/chat-attachments/{index}.txt",
        )
        for index in range(9)
    ]
    with pytest.raises(ValidationError):
        agent_routes.ChatRequest(message="Summarize", attachments=refs)


def test_chat_request_rejects_client_side_tool_confirmation_grants():
    with pytest.raises(ValidationError, match="not accepted"):
        agent_routes.ChatRequest(
            message="Hello",
            confirmed_tool_ids=["plugin.example.external-write"],
        )


def test_structured_model_content_is_normalized():
    content = [
        {"type": "reasoning", "content": "Internal"},
        {"type": "text", "text": "Visible answer"},
        "Final line",
    ]
    assert agent_routes._message_text(content) == "Visible answer\nFinal line"


def test_attachment_delete_is_contained(tmp_path):
    vault = tmp_path / "vault"
    root = vault / ".gnosi" / "chat-attachments" / "scope"
    root.mkdir(parents=True)
    attachment = root / "safe.txt"
    attachment.write_text("temporary", encoding="utf-8")
    agent_routes._delete_attachment(
        vault,
        ".gnosi/chat-attachments/scope/safe.txt",
        "scope",
    )
    assert not attachment.exists()


def test_attachment_consumer_cleans_up_when_extraction_fails(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    root = vault / ".gnosi" / "chat-attachments" / "scope"
    root.mkdir(parents=True)
    attachment = root / "broken.pdf"
    attachment.write_bytes(b"broken")
    ref = agent_routes.AttachmentRef(
        name="broken.pdf",
        size=6,
        type="application/pdf",
        path=".gnosi/chat-attachments/scope/broken.pdf",
    )

    def fail_extraction(_vault, _refs, _scope_key):
        raise RuntimeError("extraction failed")

    monkeypatch.setattr(agent_routes, "_attachment_context", fail_extraction)
    with pytest.raises(RuntimeError, match="extraction failed"):
        agent_routes._consume_attachment_context(vault, [ref], "scope")
    assert not attachment.exists()


def test_tool_stream_events_do_not_expose_arguments_or_output():
    event = json.loads(
        agent_routes._tool_stream_event("tool_end", "search_vault", "Brain")
    )
    assert event == {
        "type": "tool_end",
        "tool": "search_vault",
        "node": "Brain",
    }

    pending = json.loads(
        agent_routes._tool_stream_event(
            "tool_end",
            "bulk_update_rows",
            "Brain",
            {"awaiting_confirmation": True},
        )
    )
    assert pending["awaiting_confirmation"] is True


def test_deterministic_bulk_prepare_never_returns_a_blank_error(monkeypatch):
    monkeypatch.setattr(
        agent_routes,
        "replace_reference_ids_in_titles",
        SimpleNamespace(invoke=lambda _arguments: '{"error": "   "}'),
    )

    event = agent_routes._prepare_index_title_replacements(
        'La taula "Cervell digital" té índexs de Projectes i Àrees; '
        "substitueix els ids."
    )

    assert event == {
        "type": "error",
        "content": "The bulk title update could not be prepared.",
    }


def test_deterministic_bulk_prepare_respects_negation(monkeypatch):
    invoked = []
    monkeypatch.setattr(
        agent_routes,
        "replace_reference_ids_in_titles",
        SimpleNamespace(invoke=lambda arguments: invoked.append(arguments)),
    )

    event = agent_routes._prepare_index_title_replacements(
        "No substitueixis els ids dels índexs de Projectes i Àrees."
    )

    assert event is None
    assert invoked == []


def test_session_delete_removes_checkpoint_thread(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    checkpoints = tmp_path / "checkpoints"
    checkpoints.mkdir()
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (vault, "vault-scope"),
    )
    monkeypatch.setitem(agent_routes.cfg.paths, "CHECKPOINTS", checkpoints)
    checkpoint_key = agent_routes._checkpoint_key(
        vault_scope="vault-scope",
        workspace_id="personal",
        user_id="user-a",
        agent_id="agent",
    )
    db_path = checkpoints / f"agent_{checkpoint_key}.sqlite"
    workspace_context = agent_routes.WorkspaceContext(
        workspace_id="personal",
        user_id="user-a",
        role="owner",
        vault_path=vault,
    )
    async def exercise():
        async with agent_routes.AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
            await saver.setup()
        return await agent_routes.delete_chat_session(
            "agent",
            "session",
            workspace_context,
        )

    assert asyncio.run(exercise()) == {"deleted": True}


def test_rewound_checkpoint_messages_removes_complete_turn_suffix():
    stored = [
        HumanMessage(
            content="First",
            additional_kwargs={"gnosi_turn_id": "turn-1"},
        ),
        AIMessage(content="Answer one"),
        HumanMessage(
            content="Second",
            additional_kwargs={"gnosi_turn_id": "turn-2"},
        ),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "read_page",
                "args": {},
                "id": "call-2",
                "type": "tool_call",
            }],
        ),
        ToolMessage(content="private result", tool_call_id="call-2"),
        AIMessage(content="Answer two"),
    ]

    retained = agent_routes._rewound_checkpoint_messages(
        stored,
        before_turn_id="turn-2",
        keep_messages=4,
    )

    assert retained == stored[:2]
    assert agent_routes._public_checkpoint_messages(retained) == [
        {"role": "user", "content": "First", "turn_id": "turn-1"},
        {"role": "assistant", "content": "Answer one", "turn_id": "turn-1"},
    ]


def test_legacy_rewind_count_ends_at_assistant_boundary():
    stored = [
        HumanMessage(content="First"),
        AIMessage(content="Answer one"),
        HumanMessage(content="Second"),
    ]

    retained = agent_routes._rewound_checkpoint_messages(
        stored,
        before_turn_id=None,
        keep_messages=3,
    )

    assert retained == stored[:2]


def test_rewind_rejects_an_unknown_client_turn_id():
    with pytest.raises(ValueError):
        agent_routes._rewound_checkpoint_messages(
            [HumanMessage(content="First"), AIMessage(content="Answer")],
            before_turn_id="unknown-turn",
            keep_messages=0,
        )


def test_session_rewind_replaces_canonical_checkpoint(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    checkpoints = tmp_path / "checkpoints"
    checkpoints.mkdir()
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (vault, "vault-scope"),
    )
    monkeypatch.setattr(
        agent_routes,
        "cancel_scope_confirmations",
        lambda _scope: 0,
    )
    monkeypatch.setitem(agent_routes.cfg.paths, "CHECKPOINTS", checkpoints)
    checkpoint_key = agent_routes._checkpoint_key(
        vault_scope="vault-scope",
        workspace_id="personal",
        user_id="user-a",
        agent_id="agent",
    )
    thread_id = agent_routes._chat_thread_id(
        vault_scope="vault-scope",
        workspace_id="personal",
        user_id="user-a",
        agent_id="agent",
        session_id="session",
    )
    db_path = checkpoints / f"agent_{checkpoint_key}.sqlite"
    workspace_context = agent_routes.WorkspaceContext(
        workspace_id="personal",
        user_id="user-a",
        role="owner",
        vault_path=vault,
    )
    messages = [
        HumanMessage(
            content="First",
            additional_kwargs={"gnosi_turn_id": "turn-1"},
        ),
        AIMessage(content="Answer one"),
        HumanMessage(
            content="Second",
            additional_kwargs={"gnosi_turn_id": "turn-2"},
        ),
        AIMessage(content="Answer two"),
    ]

    async def exercise():
        checkpoint = empty_checkpoint()
        checkpoint["channel_values"] = {"messages": messages}
        config = {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": "",
            },
        }
        async with agent_routes.AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
            await saver.aput(config, checkpoint, {"step": 1}, {})
        result = await agent_routes.rewind_chat_session(
            "agent",
            "session",
            agent_routes.ChatRewindRequest(before_turn_id="turn-2"),
            workspace_context,
        )
        canonical = await agent_routes.get_chat_session(
            "agent",
            "session",
            workspace_context,
        )
        return result, canonical

    result, canonical = asyncio.run(exercise())
    expected = {
        "messages": [
            {"role": "user", "content": "First", "turn_id": "turn-1"},
            {"role": "assistant", "content": "Answer one", "turn_id": "turn-1"},
        ],
    }
    assert result == expected
    assert canonical == expected


def test_context_compaction_preserves_tool_protocol_groups():
    messages = [
        HumanMessage(content="x" * 70_000),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "read_page",
                "args": {"page_id_or_title": "page"},
                "id": "call-1",
                "type": "tool_call",
            }],
        ),
        ToolMessage(content="result", tool_call_id="call-1"),
    ]

    bounded = _bounded_model_messages(messages)

    assert any(getattr(message, "tool_calls", None) for message in bounded)
    assert any(isinstance(message, ToolMessage) for message in bounded)
    assert sum(len(str(message.content)) for message in bounded) <= 60_000


def test_context_compaction_discards_incomplete_tool_protocol_groups():
    messages = [
        HumanMessage(content="First request"),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "bulk_update_rows",
                "args": {"rows": []},
                "id": "call-pending",
                "type": "tool_call",
            }],
        ),
        HumanMessage(content="Second request"),
    ]

    bounded = _bounded_model_messages(messages)

    assert [message.content for message in bounded] == [
        "First request",
        "Second request",
    ]
    assert not any(getattr(message, "tool_calls", None) for message in bounded)


def test_checkpoint_history_hides_attachment_enrichment_and_tool_calls():
    stored = [
        HumanMessage(
            content="Visible\n\nAttachment: secret.txt\nprivate text",
            additional_kwargs={"gnosi_visible_content": "Visible"},
        ),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "read_page",
                "args": {},
                "id": "call-1",
                "type": "tool_call",
            }],
        ),
        ToolMessage(content="private result", tool_call_id="call-1"),
        AIMessage(content="Public answer"),
    ]

    assert agent_routes._public_checkpoint_messages(stored) == [
        {"role": "user", "content": "Visible"},
        {"role": "assistant", "content": "Public answer"},
    ]


def test_checkpoint_history_includes_turn_timings():
    stored = [
        HumanMessage(
            content="Pregunta visible",
            additional_kwargs={
                "gnosi_visible_content": "Pregunta",
                "gnosi_turn_id": "turn-1",
            },
        ),
        AIMessage(
            content="Resposta 1",
            additional_kwargs={
                "gnosi_timings": {
                    "total_ms": 1_250,
                    "setup_ms": 20,
                    "tool_calls": 1,
                    "input_tokens": 12,
                },
            },
        ),
        HumanMessage(
            content="Segona visible",
            additional_kwargs={
                "gnosi_visible_content": "Segona visible",
                "gnosi_turn_id": "turn-2",
            },
        ),
        AIMessage(
            content="Resposta 2",
            additional_kwargs={
                "gnosi_timings": {
                    "total_ms": 900,
                    "model_calls": 1,
                },
            },
        ),
    ]

    assert agent_routes._public_checkpoint_messages(stored) == [
        {
            "role": "user",
            "content": "Pregunta",
            "turn_id": "turn-1",
        },
        {
            "role": "assistant",
            "content": "Resposta 1",
            "timings": {
                "total_ms": 1_250,
                "setup_ms": 20,
                "tool_calls": 1,
                "input_tokens": 12,
            },
            "turn_id": "turn-1",
        },
        {
            "role": "user",
            "content": "Segona visible",
            "turn_id": "turn-2",
        },
        {
            "role": "assistant",
            "content": "Resposta 2",
            "timings": {
                "total_ms": 900,
                "model_calls": 1,
            },
            "turn_id": "turn-2",
        },
    ]


def test_checkpoint_history_uses_ai_turn_id_when_human_id_is_missing():
    stored = [
        AIMessage(
            content="Resposta única",
            additional_kwargs={"gnosi_turn_id": "turn-legacy"},
        ),
    ]

    assert agent_routes._public_checkpoint_messages(stored) == [
        {
            "role": "assistant",
            "content": "Resposta única",
            "turn_id": "turn-legacy",
        },
    ]


def test_checkpoint_history_uses_turn_id_aliases():
    stored = [
        HumanMessage(
            content="Pregunta visible",
            additional_kwargs={
                "gnosi_visible_content": "Pregunta",
                "turn_id": "turn-alias",
            },
        ),
        AIMessage(
            content="Resposta visible",
            additional_kwargs={"turnId": "turn-alias"},
        ),
    ]

    assert agent_routes._public_checkpoint_messages(stored) == [
        {
            "role": "user",
            "content": "Pregunta",
            "turn_id": "turn-alias",
        },
        {
            "role": "assistant",
            "content": "Resposta visible",
            "turn_id": "turn-alias",
        },
    ]


def test_checkpoint_history_uses_metadata_turn_id_when_no_prior_turn_id():
    stored = [
        AIMessage(
            content="Resposta amb metadata",
            metadata={"gnosi_turn_id": "turn-metadata"},
        ),
    ]

    assert agent_routes._public_checkpoint_messages(stored) == [{
        "role": "assistant",
        "content": "Resposta amb metadata",
        "turn_id": "turn-metadata",
    }]


def test_legacy_checkpoint_history_strips_internal_enrichment():
    stored = [
        HumanMessage(
            content=(
                "Visible request\n\nAttachment: private.txt\nsecret"
                "\n\nSelected mentions context:\n- page: Hidden"
            ),
        ),
    ]

    assert agent_routes._public_checkpoint_messages(stored) == [
        {"role": "user", "content": "Visible request"},
    ]


def test_read_tool_round_budget_counts_only_the_current_turn():
    messages = [
        HumanMessage(content="Earlier"),
        ToolMessage(content="old", tool_call_id="old"),
        AIMessage(content="Earlier answer"),
        HumanMessage(content="Current"),
        AIMessage(content="", tool_calls=[{
            "name": "query_vault_table",
            "args": {},
            "id": "call-1",
            "type": "tool_call",
        }]),
        ToolMessage(content="first", tool_call_id="call-1"),
        AIMessage(content="", tool_calls=[{
            "name": "query_vault_table",
            "args": {},
            "id": "call-2",
            "type": "tool_call",
        }]),
        ToolMessage(content="second", tool_call_id="call-2"),
        AIMessage(content="", tool_calls=[{
            "name": "query_vault_table",
            "args": {},
            "id": "call-3",
            "type": "tool_call",
        }]),
        ToolMessage(content="third", tool_call_id="call-3"),
    ]

    assert _tool_results_since_latest_user(messages) == 3


def test_agent_turn_timeout_has_a_stable_client_error_code():
    assert agent_routes._agent_stream_error_code(TimeoutError()) == (
        "agent_turn_timeout"
    )
    assert agent_routes._agent_stream_error_code(RuntimeError("failed")) is None


def test_graph_recursion_has_a_stable_client_error_code():
    from langgraph.errors import GraphRecursionError

    error = GraphRecursionError("repeated graph operation")

    assert agent_routes._agent_stream_error_code(error) == (
        "agent_loop_exhausted"
    )


def test_unknown_model_uses_small_context_fallback(monkeypatch):
    monkeypatch.setattr(
        "backend.agent.model_router.load_registry",
        lambda **_kwargs: [],
    )

    assert _model_context_window("openrouter", "unknown/model") == 8_192


def test_attachment_cleanup_is_scoped_and_removes_only_expired_files(tmp_path):
    vault = tmp_path / "vault"
    current = vault / ".gnosi" / "chat-attachments" / "current"
    other = vault / ".gnosi" / "chat-attachments" / "other"
    current.mkdir(parents=True)
    other.mkdir(parents=True)
    expired = current / "expired.txt"
    fresh = current / "fresh.txt"
    unrelated = other / "expired.txt"
    for path in (expired, fresh, unrelated):
        path.write_text("content", encoding="utf-8")
    old_time = time.time() - agent_routes.ATTACHMENT_MAX_AGE_SECONDS - 60
    os.utime(expired, (old_time, old_time))
    os.utime(unrelated, (old_time, old_time))

    agent_routes._cleanup_expired_attachments(vault, "current")

    assert not expired.exists()
    assert fresh.exists()
    assert unrelated.exists()


def test_page_locks_use_a_bounded_stripe_pool(tmp_path, monkeypatch):
    lock_directory = tmp_path / "locks"
    lock_directory.mkdir()
    monkeypatch.setattr(gnosi_tools.tempfile, "gettempdir", lambda: str(lock_directory))
    gnosi_tools._PAGE_LOCKS.clear()

    for index in range(600):
        with gnosi_tools._page_lock(tmp_path / f"page-{index}.md"):
            pass

    assert len(gnosi_tools._PAGE_LOCKS) <= 256
    assert len(list(lock_directory.glob("gnosi-page-lock-*.lock"))) <= 256
