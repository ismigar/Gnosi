"""Plugin activation contributes capabilities with independent editable profiles."""
from types import SimpleNamespace
import pytest
from backend.services import llm_wiki_agent as profiles
from backend.services import plugin_agent_profiles


def test_activation_does_not_create_or_assign_profiles(tmp_path, monkeypatch):
    ai = {"active_agent_id": "main", "agents": [{"id": "main", "skill_ids": []}]}
    path = tmp_path / "params.yaml"
    monkeypatch.setattr(profiles, "load_params", lambda **_: SimpleNamespace(ai=ai, params_source=path))
    monkeypatch.setattr("backend.services.principal_agent_migration.ensure_migrated", lambda: ai)
    result = profiles.transition_agent(True)
    assert result == {"agent_id": "builtin.llm-wiki.default", "agent_changed": False}
    assert not path.exists()
    assert ai["agents"][0]["skill_ids"] == []


def test_activation_restores_legacy_profiles_without_creating_more():
    original, _ = profiles.ensure_agent({"agents": [{"id": "main"}]})
    suspended, _ = profiles.suspend_agent(original)
    restored, _ = profiles.ensure_agent(suspended, create=False)
    assert len(restored["agents"]) == 2
    with pytest.raises(RuntimeError, match="plugin_profile_unavailable"):
        profiles.default_plugin_agent_id(restored)


def test_plugin_selection_is_independent_of_the_personal_default():
    ai = {"active_agent_id": "chosen", "agents": [{"id": "first"}, {"id": "chosen"}]}
    plugin_agent_profiles.reconcile(ai, {"schema_version": 2, "enabled_builtin": ["llm-wiki"]})
    assert profiles.default_plugin_agent_id(ai) == "builtin.llm-wiki.default"
    ai["active_agent_id"] = "first"
    assert profiles.default_plugin_agent_id(ai) == "builtin.llm-wiki.default"


def test_activation_and_suspension_leave_user_owned_profile_untouched():
    ai = {"active_agent_id": "llm-wiki", "agents": [{"id": "llm-wiki", "enabled": True}]}
    assert profiles.ensure_agent(ai, create=False) == (ai, False)
    assert profiles.suspend_agent(ai) == (ai, False)


def test_transition_does_not_require_a_personal_profile(monkeypatch):
    monkeypatch.setattr("backend.services.principal_agent_migration.ensure_migrated", lambda: {"agents": []})
    assert profiles.transition_agent(True)["agent_id"] == "builtin.llm-wiki.default"
