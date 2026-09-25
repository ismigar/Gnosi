"""Plugin profiles retain user choices and route each operation to its owner."""
from copy import deepcopy

import pytest

from backend.services import plugin_agent_profiles as profiles
from backend.services.agent_operation_catalog import skill_id


def config():
    return {"active_agent_id": "personal", "agents": [{"id": "personal", "provider": "test", "model": "small", "persona": "Private", "skill_ids": ["private"]}]}


def state(*enabled):
    return {"schema_version": 2, "enabled_builtin": list(enabled), "enabled_third_party": []}


def test_seed_has_one_model_and_only_declared_skills():
    ai = config()
    assert profiles.reconcile(ai, state("mail", "feeds-reader"))
    mail = profiles.select_profile(ai, skill_id("mail"))
    assert (mail["provider"], mail["model"]) == ("test", "small")
    assert mail["persona"] == ""
    assert mail["skill_ids"] == [skill_id("mail")]
    assert mail["model_strategy"]["mode"] == "pinned"
    assert profiles.select_profile(ai, skill_id("reader"))["id"] == profiles.select_profile(ai, skill_id("podcast"))["id"]
    assert ai["active_agent_id"] == "personal"


def test_user_edits_survive_default_changes_updates_and_lifecycle():
    ai = config()
    profiles.reconcile(ai, state("mail"))
    mail = ai["agents"][-1]
    mail.update(model="large", persona="Use my tone", context="My context", skill_ids=[skill_id("mail"), "user.extra"])
    ai["agents"][0]["model"] = "another-default"
    before = deepcopy(ai)
    assert not profiles.reconcile(ai, state("mail"))
    assert ai == before
    profiles.reconcile(ai, state())
    with pytest.raises(RuntimeError, match="plugin_profile_unavailable"):
        profiles.select_profile(ai, skill_id("mail"))
    profiles.reconcile(ai, state("mail"))
    assert profiles.select_profile(ai, skill_id("mail"))["model"] == "large"
    assert mail["persona"] == "Use my tone"


def test_missing_skill_never_falls_back_to_personal():
    ai = config()
    profiles.reconcile(ai, state("mail"))
    ai["agents"][-1]["skill_ids"] = []
    with pytest.raises(RuntimeError, match="plugin_profile_unavailable"):
        profiles.select_profile(ai, skill_id("mail"))
    assert profiles.select_profile(ai, "user.personal")["id"] == "personal"


def test_owned_identity_protected_but_configuration_editable():
    ai = config()
    profiles.reconcile(ai, state("mail"))
    requested = deepcopy(ai)
    requested["agents"][-1].update(model="large", persona="My instructions")
    profiles.validate_preserved(ai, requested)
    requested["agents"].pop()
    with pytest.raises(ValueError, match="must_be_preserved"):
        profiles.validate_preserved(ai, requested)


def test_execution_freezes_the_plugin_profile_not_the_chat_default(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from backend.services import agent_execution, agent_skill_catalog, principal_agent_migration, plugin_ai_contributions
    from backend.services.agent_execution_models import ExecutionScope
    from backend.services.agent_execution_scope import execution_scope
    ai = config()
    profiles.reconcile(ai, state("mail"))
    ai["agents"][-1].update(model="mail-model", persona="My mail instructions")
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: ai)
    monkeypatch.setattr(plugin_ai_contributions, "reconcile_plugin_ai_contributions", lambda: {})
    runtime = SimpleNamespace(active_skill_ids=[skill_id("mail")], instructions=["Mail procedure"], skills=[], catalog_revision="test")
    monkeypatch.setattr(agent_skill_catalog, "resolve_agent_runtime", lambda *args, **kwargs: runtime)
    with execution_scope(ExecutionScope(user_id="user", workspace_id="workspace", vault_path=str(tmp_path), role="owner")):
        snapshot = agent_execution.prepare_snapshot(skill_id("mail"))
    assert snapshot.agent_id == "builtin.mail.default"
    assert snapshot.profile["model"] == "mail-model"
    assert snapshot.profile["persona"] == "My mail instructions"
    ai["agents"][-1]["model"] = "edited-later"
    assert snapshot.profile["model"] == "mail-model"
