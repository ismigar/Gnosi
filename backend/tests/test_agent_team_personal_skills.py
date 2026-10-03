"""Personal team procedures retain canonical permissions and runtime identity."""
from types import SimpleNamespace

import pytest

from backend.models.agent_skills import CatalogOrigin, OriginType, SkillDescriptor
from backend.services.agent_skill_catalog import SkillCatalog, ToolCatalog, resolve_agent_runtime
from backend.services.agent_team_models import TEAM_SKILL
from backend.services.user_skill_store import UserSkillStore


@pytest.fixture
def personal_catalog(monkeypatch, tmp_path):
    from backend.services import agent_skill_catalog, context_vars

    tools = ToolCatalog()
    skills = SkillCatalog(tools)
    for identifier in (TEAM_SKILL, "core.writing"):
        skills.register_core(SkillDescriptor(
            id=identifier, name=identifier,
            origin=CatalogOrigin(type=OriginType.CORE, id="gnosi"),
            instructions="Original English procedure.",
        ))
    store = UserSkillStore(tmp_path)
    for identifier, source in (("user.coordination-ca", TEAM_SKILL), ("user.writing-ca", "core.writing")):
        store.create({"name": identifier, "metadata": {"derived_from": {"id": source}}},
                     "Procediment personal en català.", requested_id=identifier)
    monkeypatch.setattr(agent_skill_catalog, "get_skill_catalog", lambda: skills)
    monkeypatch.setattr(agent_skill_catalog, "get_tool_catalog", lambda: tools)
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    return tmp_path


def test_team_settings_accept_personal_director_and_reject_missing_or_nested_skill(personal_catalog):
    from backend.services.agent_team_policy import validate_teams

    director = {"id": "director", "skill_ids": ["user.coordination-ca"],
                "team": {"enabled": True, "director_id": "director"}}
    validate_teams({"agents": [director]}, [])
    director["team"]["temporary"] = {"skill_ids": ["user.coordination-ca"]}
    with pytest.raises(ValueError, match="agent_team_nested_coordination_forbidden"):
        validate_teams({"agents": [director]}, [])
    director["team"].pop("temporary")
    director["skill_ids"] = ["user.writing-ca"]
    with pytest.raises(ValueError, match="agent_team_director_skill_required"):
        validate_teams({"agents": [director]}, [])


def test_personal_task_selects_executor_and_freezes_catalan_procedure(personal_catalog, monkeypatch):
    from backend.agent import model_router
    from backend.domains.agent import llm
    from backend.services import agent_execution, agent_team_runtime as teams
    from backend.services.agent_execution_models import ExecutionScope

    scope = ExecutionScope(user_id="u", workspace_id="w", role="owner", vault_path=str(personal_catalog))
    owner = {"id": "director", "provider": "test", "model": "director"}
    worker = {"id": "writer", "provider": "test", "model": "writer", "skill_ids": ["user.writing-ca"]}
    monkeypatch.setattr(teams, "_config", lambda: {"agents": [owner, worker], "providers": {"test": {}}})
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap": False})
    monkeypatch.setattr(model_router, "load_registry", lambda: [dict(provider="test", model_id="writer", enabled=True,
                                                                    context_window=8000, cost_in=1, cost_out=1)])
    monkeypatch.setattr(llm, "_provider_is_available", lambda *_: True)
    selected, _, _ = teams._candidate(owner, scope, ["writer"], ["user.writing-ca"], "Correct the text")
    assert selected == worker
    missing, _, _ = teams._candidate(owner, scope, ["writer"], ["user.someone-elses-copy"], "Correct the text")
    assert missing is None
    monkeypatch.setattr(agent_execution, "snapshot_from_runtime",
                        lambda scope, profile, runtime: SimpleNamespace(model_copy=lambda **_: runtime))
    _, runtime = teams._snapshot(worker, owner, "root", scope, ["user.writing-ca"], [])
    assert runtime.active_skill_ids == ("core.writing",)
    assert runtime.instructions == ("Procediment personal en català.",)
    assert runtime.tool_descriptors == ()
    with pytest.raises(PermissionError, match="agent_team_skill_unavailable"):
        teams._snapshot(worker, owner, "root", scope, ["user.someone-elses-copy"], [])


def test_runtime_alias_does_not_grant_unassigned_coordination(personal_catalog):
    from backend.services.agent_behavior_bindings import runtime_skill_ids

    runtime = resolve_agent_runtime({"skill_ids": ["user.writing-ca"]}, vault_path=personal_catalog,
                                    active_skill_ids=["user.writing-ca"])
    assert runtime_skill_ids(runtime, ["user.writing-ca"]) == {"core.writing"}
    assert runtime_skill_ids(runtime, ["user.coordination-ca"]) == {"user.coordination-ca"}
    assert TEAM_SKILL not in runtime.active_skill_ids
