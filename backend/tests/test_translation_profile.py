"""Translation buttons use a preserved plugin profile; chat snapshots stay inherited."""
from copy import deepcopy

import pytest

from backend.services import agent_execution, plugin_agent_profiles as profiles
from backend.services.agent_operation_catalog import skill_id


def configuration():
    return {"active_agent_id": "personal", "agents": [{
        "id": "personal", "provider": "fixture", "model": "first", "skill_ids": [],
    }]}


def translation_settings(ai):
    return next(profile for profile in ai["agents"] if profile["id"] == "builtin.translation.default")


def test_translation_profile_copies_defaults_once_and_preserves_edits():
    ai = configuration()
    assert profiles.reconcile(ai, {})
    selected = profiles.select_profile(ai, skill_id("translation"))
    assert selected["id"] == "builtin.translation.default"
    assert (selected["provider"], selected["model"]) == ("fixture", "first")
    ai["agents"][0]["model"] = "changed-principal"
    translation_settings(ai).update(model="chosen", persona="Keep me", context_refs=[{"id": "source"}])
    expected = deepcopy(ai)
    assert not profiles.reconcile(ai, {})
    assert ai == expected
    assert profiles.select_profile(ai, skill_id("translation"))["model"] == "chosen"
    assert profiles.select_profile(ai, skill_id("writing"))["id"] == "builtin.ai-platform.default"


def test_disable_and_reenable_preserve_translation_settings():
    ai = configuration()
    profiles.reconcile(ai, {})
    assert profiles.reconcile(ai, {"disabled": ["translation"]})
    with pytest.raises(RuntimeError, match="plugin_profile_unavailable"):
        profiles.select_profile(ai, skill_id("translation"))
    assert profiles.reconcile(ai, {})
    assert profiles.select_profile(ai, skill_id("translation"))["model"] == "first"


@pytest.mark.parametrize("change", ["missing-skill", "disabled", "ambiguous"])
def test_unavailable_profile_never_silently_uses_the_principal(change):
    ai = configuration()
    profiles.reconcile(ai, {})
    if change == "missing-skill":
        translation_settings(ai)["skill_ids"] = []
    elif change == "disabled":
        translation_settings(ai)["enabled"] = False
    else:
        ai["agents"].append({**profiles.select_profile(ai, skill_id("translation")), "id": "duplicate"})
    with pytest.raises(RuntimeError, match="plugin_profile_unavailable"):
        profiles.select_profile(ai, skill_id("translation"))


def test_translation_profile_cannot_be_deleted_through_settings():
    ai = configuration()
    profiles.reconcile(ai, {})
    with pytest.raises(ValueError, match="plugin_profile_must_be_preserved"):
        profiles.validate_preserved(ai, configuration())


def test_conversation_translation_keeps_the_running_snapshot(monkeypatch):
    inherited = object()
    selected = object()
    observed = []
    monkeypatch.setattr(agent_execution, "select_snapshot_skill", lambda snapshot, skill: (
        observed.append((snapshot, skill)) or selected
    ))
    token = agent_execution._snapshot.set(inherited)
    try:
        assert agent_execution.prepare_snapshot(skill_id("translation")) is selected
        assert observed == [(inherited, skill_id("translation"))]
    finally:
        agent_execution._snapshot.reset(token)
