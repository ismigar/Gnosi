"""Plugin activation contributes capabilities without proliferating profiles."""
from types import SimpleNamespace
from backend.services import llm_wiki_agent as profiles


def test_activation_does_not_create_or_assign_profiles(tmp_path, monkeypatch):
    ai = {"active_agent_id": "main", "agents": [{"id": "main", "skill_ids": []}]}
    path = tmp_path / "params.yaml"
    monkeypatch.setattr(profiles, "load_params", lambda **_: SimpleNamespace(ai=ai, params_source=path))
    monkeypatch.setattr("backend.services.principal_agent_migration.ensure_migrated", lambda: ai)
    result = profiles.transition_agent(True)
    assert result == {"agent_id": "main", "agent_changed": False}
    assert not path.exists()
    assert ai["agents"][0]["skill_ids"] == []


def test_activation_restores_legacy_profiles_without_creating_more():
    original, _ = profiles.ensure_agent({"agents": [{"id": "main"}]})
    suspended, _ = profiles.suspend_agent(original)
    restored, _ = profiles.ensure_agent(suspended, create=False)
    assert len(restored["agents"]) == 2
    assert profiles.default_plugin_agent_id(restored) == "main"


def test_plugin_defaults_preserve_explicit_principal_and_legacy_selection():
    ai = {"active_agent_id": "chosen", "agents": [{"id": "first"}, {"id": "chosen"}]}
    assert profiles.default_plugin_agent_id(ai) == "chosen"
    legacy, _ = profiles.ensure_agent(ai)
    assert profiles.default_plugin_agent_id(legacy) == "chosen"
    assert profiles.default_plugin_agent_id({"agents": [{"id": "off", "enabled": False}, {"id": "on"}]}) == "on"


def test_activation_and_suspension_leave_user_owned_profile_untouched():
    ai = {"active_agent_id": "llm-wiki", "agents": [{"id": "llm-wiki", "enabled": True}]}
    assert profiles.ensure_agent(ai, create=False) == (ai, False)
    assert profiles.suspend_agent(ai) == (ai, False)
