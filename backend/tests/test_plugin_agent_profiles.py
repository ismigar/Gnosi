"""Plugin profiles retain user choices and route each operation to its owner."""
from copy import deepcopy

import pytest

from backend.services import plugin_agent_profiles as profiles
from backend.services.agent_operation_catalog import OPERATIONS, skill_id


def config():
    return {"active_agent_id": "personal", "agents": [{"id": "personal", "provider": "test", "model": "small", "persona": "Private", "skill_ids": ["private"]}]}


def state(*enabled):
    return {"schema_version": 2, "enabled_builtin": list(enabled), "enabled_third_party": []}


def test_seed_has_one_model_and_only_declared_skills():
    ai = config()
    assert profiles.reconcile(ai, state("mail", "feeds-reader"))
    mail = profiles.select_profile(ai, skill_id("mail"))
    assert (mail["provider"], mail["model"]) == ("test", "small")
    assert mail["persona"] == profiles.profile_defaults("builtin:mail")
    assert mail["behavior_migration"]["original"] == mail["persona"]
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


@pytest.mark.parametrize('operation', sorted(OPERATIONS))
def test_every_declared_operation_selects_its_profile_and_rejects_suspension(operation):
    from backend.domains.agent.routes.shared import _validated_identifier

    ai = config()
    plugins = list(profiles.declarations())
    profiles.reconcile(ai, state(*plugins))
    owner = OPERATIONS[operation][0]
    expected_id = 'builtin.llm-wiki.reviewer' if operation == 'reading-review' else f'builtin.{owner}.default'
    owned = next(profile for profile in ai['agents'] if profile['id'] == expected_id)
    owned.update(model=f'{operation}-model', persona=f'{operation}-instructions')
    selected = profiles.select_profile(ai, skill_id(operation))
    assert _validated_identifier(selected['id'], 'profile_id') == expected_id
    assert _validated_identifier(selected['id'], 'agent_id') == expected_id
    assert selected['model'] == f'{operation}-model'
    assert selected['persona'] == f'{operation}-instructions'
    assert skill_id(operation) in selected['skill_ids']
    owned['model'] = 'changed-after-selection'
    assert selected['model'] == f'{operation}-model'
    profiles.reconcile(ai, state(*(plugin for plugin in plugins if plugin != owner)))
    with pytest.raises(RuntimeError, match='plugin_profile_unavailable'):
        profiles.select_profile(ai, skill_id(operation))
    assert ai['agents'][0]['model'] == 'small'


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


def test_knowledge_pair_is_seeded_once_and_existing_reader_configuration_survives():
    from backend.domains.llm_wiki.reading_skill import SKILL_ID
    from backend.services.builtin_plugins import public_registry

    ai = config()
    enabled = state("llm-wiki")
    profiles.reconcile(ai, state())
    assert len(ai["agents"]) == 1
    profiles.reconcile(ai, enabled)
    reader = profiles.select_profile(ai, SKILL_ID)
    reviewer = profiles.select_profile(ai, skill_id("reading-review"))
    assert (reader["provider"], reader["model"]) == ("openai", "gpt-5.6-luna")
    assert (reviewer["provider"], reviewer["model"], reviewer["reasoning_effort"]) == ("openai", "gpt-6.2-sol", "medium")
    assert reader["persona"] != reviewer["persona"] and reviewer["persona"]
    registry = next(p for p in public_registry() if p["id"] == "llm-wiki")
    assert [p["id"] for p in registry["agent_profiles"]] == [reader["id"], reviewer["id"]]
    configured_reader = next(p for p in ai["agents"] if p["id"] == reader["id"])
    configured_reader.update(model="my-local-reader", persona="My inclusion criteria")
    # An installation that enabled the plugin before it gained a reviewer.
    ai["agents"] = [p for p in ai["agents"] if p["id"] != reviewer["id"]]
    profiles.reconcile(ai, enabled)
    assert not profiles.reconcile(ai, enabled)
    profiles.reconcile(ai, state())
    for chosen in (SKILL_ID, skill_id("reading-review")):
        with pytest.raises(RuntimeError, match="plugin_profile_unavailable"):
            profiles.select_profile(ai, chosen)
    profiles.reconcile(ai, enabled)
    assert len(ai["agents"]) == 3 and ai["active_agent_id"] == "personal"
    assert profiles.select_profile(ai, SKILL_ID)["model"] == "my-local-reader"
    assert profiles.select_profile(ai, SKILL_ID)["persona"] == "My inclusion criteria"
