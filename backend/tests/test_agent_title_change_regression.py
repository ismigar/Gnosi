"""Title edits must reach the guarded action workflow, never inventory."""

from types import SimpleNamespace

import pytest

from backend.domains.agent.intent import _request_mode
from backend.domains.agent.write_intent import _explicit_brain_write_tool_names
from backend.domains.agent.workflow import _runtime_unavailable_tool_ids
from backend.domains.agent.workflow_setup import _brain_tool_list
from backend.domains.agent.context import build_agent_turn_plan


@pytest.mark.parametrize("message", [
    'A tots els registres de la vista activa, al títol canvia "TFM · " per TFM — "',
    'A todos los registros de la vista activa, en el título cambia "TFM · " por "TFM — "',
    'For all records in the active view, change the title from "TFM · " to "TFM — "',
    'Pour toutes les lignes de la vue active, modifie le titre de "TFM · " à "TFM — "',
])
def test_title_replacement_is_an_authorized_bulk_action(message):
    assert _explicit_brain_write_tool_names(message) == {"bulk_update_rows"}
    assert _request_mode(message) == "action"
    plan = build_agent_turn_plan(
        message,
        context_refs=[{"id": "active-table", "type": "table", "ref": "tasks"}],
        authorized_tool_names={"bulk_update_rows"},
        tool_metadata=[
            {"name": "inventory_context", "effects": ["read"], "dynamic_context": True},
            {"name": "bulk_update_rows", "effects": ["bulk_write"], "confirmation": "always"},
            {"name": "delete_table", "effects": ["destructive"], "confirmation": "always"},
        ],
    )
    assert plan["mode"] == "action"
    assert plan["required_tool"] is None
    assert "bulk_update_rows" in plan["allowed_tool_names"]
    assert "delete_table" not in plan["allowed_tool_names"]
    assert plan["budgets"]["max_model_calls"] > 0


@pytest.mark.parametrize("message", [
    'No canviïs el títol de tots els registres.',
    'Explica com canvia el títol de tots els registres.',
    'Com puc canviar el títol de tots els registres?',
    'Llista els registres amb títol "canvia el camp estat".',
    'Do not change the title of all records.',
    'Explain how to change the title of all records.',
    'No cambies el título de todos los registros.',
    'Explique comment modifier le titre de toutes les lignes.',
])
def test_quoted_denied_and_explanatory_title_edits_grant_nothing(message):
    assert _explicit_brain_write_tool_names(message) == set()


def test_capacity_omissions_do_not_hide_real_runtime_failures():
    profile = SimpleNamespace(resolved_runtime=SimpleNamespace(
        unavailable_tool_ids=("missing.handler",),
    ))
    tools = SimpleNamespace(
        notebook_context_only=False,
        omitted_runtime_tool_ids=["healthy.overflow", "quarantined.tool", "context.missing"],
        runtime_tool_metadata=[
            {"id": "healthy.overflow", "health": {"status": "healthy"}},
            {"id": "quarantined.tool", "health": {"status": "quarantined"}},
            {"id": "context.missing", "dynamic_context": True},
        ],
    )
    assert _runtime_unavailable_tool_ids(profile, tools) == [
        "context.missing", "missing.handler", "quarantined.tool",
    ]


def test_fourteen_healthy_overflow_tools_do_not_warn_about_configuration():
    tools = [SimpleNamespace(name=f"tool_{index}") for index in range(78)]
    bound = _brain_tool_list(
        supports_tools=True, notebook_context_only=False,
        context_tools=tools[:12], runtime_tools=tools[12:],
        legacy_bundle_active=False, mcp_tools=[],
    )
    assert len(bound) == 64
    omitted = [tool.name for tool in tools if tool not in bound]
    assert len(omitted) == 14
    assert _runtime_unavailable_tool_ids(
        SimpleNamespace(resolved_runtime=SimpleNamespace(unavailable_tool_ids=())),
        SimpleNamespace(
            notebook_context_only=False, omitted_runtime_tool_ids=omitted,
            runtime_tool_metadata=[
                {"id": tool.name, "name": tool.name, "health": {"status": "healthy"}}
                for tool in tools
            ],
        ),
    ) == []
