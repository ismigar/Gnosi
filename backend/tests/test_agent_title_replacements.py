"""Saved-title actions must produce scoped changes, not unexecuted prose."""
import asyncio
import json
from pathlib import Path
import time
import os
from types import SimpleNamespace

import pytest
from langchain_core.messages import HumanMessage, AIMessage

from backend.domains.agent.title_replacements import (
    active_title_scope, replace_title, title_replacements, title_update_call, title_view_revisions,
)
from backend.domains.agent.write_intent import _explicit_brain_write_tool_names
from backend.services.agent_team_actions import action_candidates, validate_action_plan
from backend.services.agent_team_models import TeamPlan, TeamTask
from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401
from backend.tests.test_principal_agent_routing import run_chat

REQUEST = 'Als títols modIfica "FASE" i "F" per "Fase" i "—" per "-"'
REFS = [{"id": "selected", "type": "table", "ref": "projects", "scope": {"view_id": "filtered"}}]


@pytest.fixture
def view(monkeypatch):
    from backend.domains.agent import context_storage
    registry = {"tables": [{"id": "projects", "name": "Projects", "properties": []}],
                "views": [{"id": "filtered", "table_id": "projects", "filters": [
                    {"field": "project", "operator": "equals", "value": "selected"}]}]}
    monkeypatch.setattr(context_storage, "_registry", lambda: registry)
    return registry


@pytest.mark.parametrize("prompt", [
    REQUEST,
    'En los títulos modifica "FASE" y "F" por "Fase" y "—" por "-"',
    'In the titles replace "FASE" and "F" with "Fase" and "—" with "-"',
    'Dans les titres remplace «FASE» et «F» par «Fase» et «—» par «-».',
])
def test_complete_substitution_authorizes_bulk_even_without_a_table_word(prompt):
    assert title_replacements(prompt) == [("FASE", "Fase"), ("F", "Fase"), ("—", "-")]
    assert _explicit_brain_write_tool_names(prompt) == {"bulk_update_rows"}


@pytest.mark.parametrize("prompt", [
    'Explica com ' + REQUEST, 'No ' + REQUEST, '«' + REQUEST + '»',
    'Revisa aquesta frase: ' + REQUEST, REQUEST + ', però no ho executis',
    REQUEST + ' i envia els resultats per correu', REQUEST + ' i elimina la taula',
    'Als títols modifica "" per "Fase"', 'Als títols modifica "F" per "Fase" i "F" per "X"',
])
def test_partial_compound_copied_and_denied_instructions_cannot_take_the_fast_path(prompt):
    assert title_replacements(prompt) is None


def test_simultaneous_replacement_preserves_words_existing_phase_and_identifiers():
    pairs = title_replacements(REQUEST)
    assert replace_title('TFM · F1 — Filosofia; FASE 3; Fase 4; R-204; F', pairs) == (
        'TFM · Fase1 - Filosofia; Fase 3; Fase 4; R-204; Fase')
    assert replace_title("abc", [("a", "b"), ("b", "c")]) == "abc"  # letters inside words
    assert replace_title("ab", [("ab", "bc"), ("bc", "de")]) == "bc"  # no cascading


def inventory(**changes):
    return {"query": "", "property_filters": {}, "snapshot_revision": "complete",
            "matching_count": 31, "has_more": False, "offset": 0,
            "view_revisions": title_view_revisions(REFS),
            "records": [{"id": f"row-{i}", "title": f"TFM · F1 — Filosofia {i}",
                         "source_id": "selected", "record_type": {"id": "projects"}} for i in range(31)], **changes}


def test_every_changed_title_is_prepared_from_the_complete_view(view):
    call = title_update_call(REQUEST, json.dumps(inventory()), REFS)
    assert len(call["args"]["updates"]) == 31
    assert call["args"]["view_scope"] == title_view_revisions(REFS)[0]
    assert call["args"]["updates"][0] == {
        "id": "row-0", "expected_title": "TFM · F1 — Filosofia 0",
        "properties": {"title": "TFM · Fase1 - Filosofia 0"}}


@pytest.mark.parametrize("changes", [
    {"has_more": True}, {"matching_count": 748}, {"offset": 10}, {"query": "F1"},
    {"property_filters": {"status": "open"}}, {"snapshot_revision": ""},
    {"view_revisions": []}, {"error": "inventory_changed_restart_pagination"},
    {"records": [{"id": "outside", "title": "F1", "record_type": {"id": "another"}}], "matching_count": 1},
    {"records": [{"id": "outside", "title": "F1", "source_id": "whole-vault", "record_type": {"id": "projects"}}], "matching_count": 1},
])
def test_partial_failed_wrong_table_or_wrong_scope_inventory_cannot_prepare_changes(view, changes):
    with pytest.raises(ValueError):
        title_update_call(REQUEST, json.dumps(inventory(**changes)), REFS)


def test_changed_or_deleted_view_never_falls_back_to_the_whole_table(view):
    from backend.domains.agent.context_storage import _searchable_page_records
    data = inventory()
    view["views"][0]["filters"] = []
    with pytest.raises(ValueError, match="view_changed"):
        title_update_call(REQUEST, json.dumps(data), REFS)
    view["views"] = []
    with pytest.raises(ValueError, match="view_unavailable"):
        _searchable_page_records(REFS)
    assert active_title_scope([*REFS, {"type": "vault", "ref": "active"}]) == REFS
    assert active_title_scope([*REFS, {"type": "table", "ref": "projects", "scope": {"view_id": "other"}}]) == []


def members():
    return [{"id": identifier, "available": True, "skills": ["user.writing", "user.vault"],
             "capabilities": [
                 {"id": "user.writing", "canonical_id": "core.writing", "available": True, "tool_ids": []},
                 {"id": "user.vault", "canonical_id": "core.vault", "available": True, "tool_ids": ["gnosi.bulk"]}],
             "tools": [{"id": "gnosi.bulk", "name": "Localized display name", "call_name": "bulk_update_rows"}]}
            for identifier in ["director", "executor"]]


@pytest.mark.parametrize("skill,read_only", [("user.writing", False), ("user.vault", True)])
def test_a_writer_or_readonly_task_cannot_execute_a_saved_title_action(skill, read_only):
    plan = TeamPlan(tasks=[TeamTask(id="titles", agent_id="executor", objective="Change saved titles",
                                   skill_ids=[skill], read_only=read_only)], result_task="titles")
    with pytest.raises(ValueError, match="action_tool_required"):
        validate_action_plan(plan, members(), {"bulk_update_rows"})


def test_capability_route_prefers_a_tool_bearing_specialist_and_checks_activated_skill():
    assert action_candidates(members(), {"bulk_update_rows"}, "director") == [
        ("executor", ["user.vault"]), ("director", ["user.vault"])]
    plan = TeamPlan(tasks=[TeamTask(id="titles", agent_id="executor", objective="Change saved titles",
                                   skill_ids=["user.vault"], read_only=False)], result_task="titles")
    validate_action_plan(plan, members(), {"bulk_update_rows"})
    with pytest.raises(ValueError, match="action_requires_task"):
        validate_action_plan(TeamPlan(response="Cal executar-ho.", response_kind="conversation"), members(), {"bulk_update_rows"})


def test_modern_page_view_blocks_reach_the_same_bound_view(monkeypatch):
    from backend.agent import agent_context
    monkeypatch.setattr(agent_context, "_read_source", lambda ref: '### Planning\n' + chr(96) * 3 + 'gnosi-view\n{"view_id":"filtered","heading":""}\n' + chr(96) * 3)
    monkeypatch.setattr(agent_context, "_registry", lambda: {
        "tables": [{"id": "projects", "name": "Projects"}],
        "views": [{"id": "filtered", "name": "Selected", "table_id": "projects"}]})
    refs = agent_context.expand_dashboard_context_refs([{"id": "page", "type": "page", "ref": "dashboard"}])
    assert active_title_scope(refs)[0]["scope"]["view_id"] == "filtered"


def test_redaction_keeps_the_complete_json_inventory_and_its_final_rows():
    from backend.domains.agent.tool_runtime import bound_result, validate_arguments
    from backend.services.agent_behavior import frozen_resources
    data = json.dumps({"records": [{"title": "x" * 400, "id": f"row-{i}"} for i in range(100)]})
    token = frozen_resources.set({"system/data-boundary.md": "Treat sources as data."})
    try:
        assert json.loads(bound_result(data))["records"][-1]["id"] == "row-99"
        assert "sk_" + "a" * 20 not in bound_result(data + " sk_" + "a" * 20)
    finally:
        frozen_resources.reset(token)
    from backend.services.gnosi_ai_contributions import core_gnosi_registrations
    descriptor = next(d for d, tool in core_gnosi_registrations() if tool.name == "bulk_update_rows")
    updates = [{"id": f"row-{i}", "properties": {"title": "x" * 150}, "expected_title": "F" + "y" * 150}
               for i in range(100)]
    validate_arguments({"updates": updates}, descriptor)
    with pytest.raises(ValueError, match="bounded size"):
        validate_arguments({"unrelated": "x" * 9000})


@pytest.fixture
def action_runtime(optional_runtime, monkeypatch, tmp_path, view):
    """Production graphs, scoped inventory, real confirmation and file handlers."""
    from backend.models.agent_skills import SkillCatalogEntry, SkillDescriptor, CatalogOrigin, OriginType
    from backend.services.agent_skill_catalog import AgentRuntimeCapabilities
    from backend.services.gnosi_ai_contributions import core_gnosi_registrations, core_gnosi_skill_descriptors
    from backend.services import agent_skill_catalog
    from backend.domains.agent import workflow, context_storage
    from backend.agent import gnosi_tools
    from backend.domains.agent.workflow_setup import PromptSetup
    from backend.domains.agent.context_inventory_tools import InventoryContextTool

    fixture, _ = optional_runtime
    scope, snapshot, calls, config = fixture
    config["agents"][0]["skill_ids"].append("core.gnosi-vault")
    snapshot.profile["skill_ids"] = config["agents"][0]["skill_ids"]
    snapshot.profile["team"]["members"].append({"agent_id": "vault", "roles": ["worker"]})
    snapshot.profile["team"]["direct_routes"] = []
    config["agents"].append({"id": "vault", "provider": "local", "model": "cheap",
                             "enabled": True, "skill_ids": ["core.gnosi-vault"]})
    registrations = core_gnosi_registrations()
    descriptors = {item.id: item for item in core_gnosi_skill_descriptors(registrations)}
    descriptors["core.gnosi-coordination"] = SkillDescriptor(
        id="core.gnosi-coordination", name="Coordination", origin=CatalogOrigin(type=OriginType.CORE, id="gnosi"),
        instructions="Coordinate.")

    def runtime(profile, vault_path=None, active_skill_ids=None):
        assigned = tuple(profile["skill_ids"])
        active = tuple(active_skill_ids if active_skill_ids is not None else assigned)
        entries = tuple(SkillCatalogEntry(descriptor=descriptors[s], available=True, revision="test")
                        for s in active if s in descriptors)
        tool_ids = {identifier for entry in entries for identifier in entry.descriptor.tool_ids}
        selected = [(descriptor, tool) for descriptor, tool in registrations if descriptor.id in tool_ids]
        return AgentRuntimeCapabilities(assigned, active, ("Follow the current request.",),
            tuple(tool for _, tool in selected), tuple(d for d, _ in selected), entries, (), (), "test")
    monkeypatch.setattr(agent_skill_catalog, "resolve_agent_runtime", runtime)
    monkeypatch.setattr(workflow, "build_prompts", lambda profile, model, **kwargs: PromptSetup(
        "Complete the request", "Complete the request", "General", profile.agent_data.get("context_refs", []),
        32000, 24000, tuple(profile.resolved_runtime.active_skill_ids),
        tuple(profile.resolved_runtime.assigned_skill_ids), False))

    paths, pages = {}, []
    for i in range(748):
        identifier = f"row-{i}"
        title = f"TFM · F1 — Filosofia {i}"
        path = tmp_path / (identifier + ".md")
        metadata = {"id": identifier, "title": title, "table_id": "projects",
                    "project": "selected" if i < 31 else "other", "unrelated": f"keep-{i}"}
        path.write_text("---\n" + json.dumps(metadata) + "\n---\n\nOriginal body\n")
        paths[identifier] = path
        pages.append(SimpleNamespace(id=identifier, title=title, metadata=metadata, path=path))
    monkeypatch.setattr(context_storage, "_table_pages", lambda table: pages)
    monkeypatch.setattr(InventoryContextTool, "_refresh_index", staticmethod(lambda root: False))
    monkeypatch.setattr(InventoryContextTool, "_cached_indexes", staticmethod(lambda records: ({}, {}, 0)))
    monkeypatch.setattr(gnosi_tools, "_resolve_page", lambda identifier: paths.get(identifier))
    return fixture, paths, view


@pytest.mark.parametrize("prompt", [
    REQUEST,
    'En los títulos modifica "FASE" y "F" por "Fase" y "—" por "-"',
    'In the titles replace "FASE" and "F" with "Fase" and "—" with "-"',
    'Dans les titres remplace «FASE» et «F» par «Fase» et «—» par «-».',
])
def test_real_team_action_previews_and_writes_only_31_of_748_without_a_model_call(action_runtime, prompt):
    from backend.services import agent_team_store as artifacts
    from backend.agent import gnosi_tools
    from backend.services.context_vars import active_vault_path
    fixture, paths, registry = action_runtime
    before = {identifier: path.read_bytes() for identifier, path in paths.items()}
    token = active_vault_path.set(Path(fixture[0].vault_path))
    try:
        started = time.monotonic()
        messages, _ = run_chat(fixture, prompt, refs=[*REFS, {"type": "vault", "ref": "active", "id": "unrelated"}],
                               grants=["bulk_update_rows"], history=[HumanMessage(content="Corregeix el text anterior."),
                                                                    AIMessage(content="Text corregit.")])
        preview_seconds = time.monotonic() - started
        assert fixture[2] == []
        task = artifacts.list_artifacts(fixture[0], "task")[0]
        assert task["agent_id"] == "vault" and task["status"] == "awaiting_confirmation", task["result"]
        assert task["snapshot"]["skill_ids"] == ["core.gnosi-vault"]
        assert task["snapshot"]["profile"]["context_refs"] == REFS
        assert len(task["confirmations"]) == 1
        assert messages[-1].additional_kwargs["gnosi_team_usage"]["model_calls"] == 0
        assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
        from backend.agent.action_confirmations import claim_confirmation
        confirmation = claim_confirmation(task["confirmations"][0]["confirmation_id"], task["confirmation_scope"])
        arguments = confirmation["arguments"]
        assert len(arguments["updates"]) == 31
        assert {row["id"] for row in arguments["updates"]} == {f"row-{i}" for i in range(31)}
        result = asyncio.run(gnosi_tools.execute_confirmed_action("bulk_update_rows", arguments, workspace_id="test"))
        assert result["updated_count"] == 31
        for i in range(748):
            path = paths[f"row-{i}"]
            if i < 31:
                assert gnosi_tools._parse(path)[0]["title"] == f"TFM · Fase1 - Filosofia {i}"
                assert gnosi_tools._parse(path)[0]["unrelated"] == f"keep-{i}"
                assert "Original body" in path.read_text()
            else:
                assert path.read_bytes() == before[f"row-{i}"]
        if report_path := os.environ.get("GNOSI_TITLE_ACTION_REPORT"):
            path = Path(report_path)
            report = json.loads(path.read_text()) if path.exists() else []
            report.append({"prompt": prompt, "preview_seconds": preview_seconds, "selected_rows": 31,
                           "total_rows": 748, "updated_rows": result["updated_count"],
                           "other_rows_unchanged": 717, "usage": messages[-1].additional_kwargs["gnosi_team_usage"]})
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        active_vault_path.reset(token)


@pytest.mark.parametrize("refs", [[], [{"type": "table", "ref": "projects", "id": "unscoped"}],
                                 [*REFS, {"type": "table", "ref": "projects", "id": "second", "scope": {"view_id": "other"}}]])
def test_missing_or_ambiguous_view_clarifies_without_a_model_or_changes(action_runtime, refs):
    fixture, paths, _ = action_runtime
    messages, _ = run_chat(fixture, REQUEST, refs=refs, grants=["bulk_update_rows"])
    assert fixture[2] == []
    assert "Selecciona una vista" in messages[-1].content


def test_direct_agent_uses_only_the_active_view_even_with_broad_permanent_sources(action_runtime):
    from backend.agent.action_confirmations import confirmation_event, confirmation_context
    import hashlib
    from backend.services.context_vars import active_vault_path
    fixture, paths, _ = action_runtime
    profile = {**fixture[1].profile, "team": {"enabled": False}}
    fixture[1].skill_ids = profile["skill_ids"]
    token = active_vault_path.set(Path(fixture[0].vault_path))
    try:
        with confirmation_context(vault_scope=hashlib.sha256(fixture[0].vault_path.encode()).hexdigest()[:20],
                                  workspace_id=fixture[0].workspace_id, user_id=fixture[0].user_id,
                                  role=fixture[0].role, agent_id=profile["id"], session_id="direct-test"):
            messages, _ = run_chat(fixture, REQUEST, profile=profile,
                refs=[*REFS, {"type": "vault", "ref": "active", "id": "unrelated"}], grants=["bulk_update_rows"])
        assert fixture[2] == []
        marker = confirmation_event(messages[-1].content)
        assert marker["details"]["count"] == 31
    finally:
        active_vault_path.reset(token)


def test_failed_preparation_stops_without_repeating_the_bulk_write(action_runtime, monkeypatch):
    from backend.agent import gnosi_tools
    from backend.services import agent_team_store as artifacts
    fixture, paths, _ = action_runtime
    monkeypatch.setattr(gnosi_tools, "_resolve_page", lambda identifier: None)
    messages, _ = run_chat(fixture, REQUEST, refs=REFS, grants=["bulk_update_rows"])
    assert fixture[2] == []
    assert "l’eina d’edició ha retornat un error" in messages[-1].content
    task = artifacts.list_artifacts(fixture[0], "task")[0]
    assert not task["confirmations"]
    assert messages[-1].additional_kwargs["gnosi_team_usage"]["tool_calls"] == 2


def test_a_tool_bearing_executor_cannot_complete_an_action_with_only_prose(action_runtime):
    fixture, paths, _ = action_runtime
    before = {identifier: path.read_bytes() for identifier, path in paths.items()}
    plan = TeamPlan(tasks=[TeamTask(id="action", agent_id="vault", objective="Execute the original action",
                                   skill_ids=["core.gnosi-vault"], read_only=False)], result_task="action")
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan.model_dump_json())],
                               "vault": [AIMessage(content="No he modificat cap títol. Cal executar-ho.")]}
    with pytest.raises(RuntimeError, match="action_not_executed"):
        run_chat(fixture, "Actualitza el títol del registre seleccionat.", refs=REFS, grants=["bulk_update_rows"])
    assert fixture[2] == ["director", "vault"]
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())


def test_changed_view_or_title_cancels_preparation_and_confirmed_execution(action_runtime):
    from backend.agent import gnosi_tools
    from backend.agent.action_confirmations import claim_confirmation
    from backend.services import agent_team_store as artifacts
    from backend.services.context_vars import active_vault_path
    fixture, paths, registry = action_runtime
    before = {identifier: path.read_bytes() for identifier, path in paths.items()}
    token = active_vault_path.set(Path(fixture[0].vault_path))
    try:
        run_chat(fixture, REQUEST, refs=REFS, grants=["bulk_update_rows"])
        task = artifacts.list_artifacts(fixture[0], "task")[0]
        prepared = claim_confirmation(task["confirmations"][0]["confirmation_id"], task["confirmation_scope"])
        registry["views"][0]["filters"] = []
        with pytest.raises(ValueError, match="view changed"):
            asyncio.run(gnosi_tools.execute_confirmed_action("bulk_update_rows", prepared["arguments"], workspace_id="test"))
        assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
        invalid = gnosi_tools.bulk_update_rows.invoke({"updates": [{"id": "row-0", "expected_title": "stale", "properties": {"title": "overwrite"}}]})
        assert "changed after the inventory" in json.loads(invalid)["error"]
    finally:
        active_vault_path.reset(token)
