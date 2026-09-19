"""Feature tools are assignable, localized, and revoked with their plugin."""

import json
from pathlib import Path

import pytest

from backend.agent import feature_tool_support
from backend.models.agent_skills import CatalogStatus, ConfirmationPolicy, ToolEffect
from backend.services import agent_skill_catalog
from backend.services.agent_skill_catalog import SkillCatalog, ToolCatalog, resolve_agent_runtime
from backend.services.context_vars import active_vault_path
from backend.services.feature_ai_contributions import FEATURE_DOMAINS, feature_registrations
from backend.services.gnosi_ai_contributions import (
    core_gnosi_registrations,
    core_gnosi_skill_descriptors,
)
from backend.services.user_skill_store import UserSkillStore


def test_new_tools_have_executable_schemas_and_domain_skills():
    registrations = core_gnosi_registrations()
    tools = {descriptor.id: descriptor for descriptor, _ in registrations}
    assert len(tools) == len(registrations)
    skills = {skill.id: skill for skill in core_gnosi_skill_descriptors(registrations)}
    for descriptor, handler in feature_registrations():
        assert descriptor.id in skills[f"core.gnosi-{descriptor.metadata['domain']}"].tool_ids
        assert descriptor.input_schema.get("type") == "object"
        assert handler.func is not None or handler.coroutine is not None
        assert descriptor.metadata["required_plugins"]
        if ToolEffect.LOCAL_WRITE in descriptor.effects:
            assert descriptor.minimum_role == "editor"
            assert descriptor.confirmation != ConfirmationPolicy.NONE
    deletion = tools["core.gnosi.planning-delete-entity"]
    assert deletion.confirmation == ConfirmationPolicy.ALWAYS
    assert ToolEffect.DESTRUCTIVE in deletion.effects
    search = tools["core.gnosi.literature-start-search"]
    assert ToolEffect.DATA_EGRESS in search.effects


def test_plugin_availability_is_rechecked_without_mutating_registration(monkeypatch):
    descriptor, handler = feature_registrations()[0]
    catalog = ToolCatalog()
    catalog.register_core(descriptor, handler)
    monkeypatch.setattr(feature_tool_support, "feature_enabled", lambda _: False)
    assert catalog.snapshot()[descriptor.id].descriptor.status == CatalogStatus.SUSPENDED
    monkeypatch.setattr(feature_tool_support, "feature_enabled", lambda _: True)
    assert catalog.snapshot()[descriptor.id].descriptor.status == CatalogStatus.AVAILABLE

    def unavailable(_):
        raise OSError("configuration unavailable")

    monkeypatch.setattr(feature_tool_support, "feature_enabled", unavailable)
    assert catalog.snapshot()[descriptor.id].descriptor.status == CatalogStatus.SUSPENDED


def test_agent_receives_only_assigned_feature_tools_and_revocation_removes_them(
    tmp_path, monkeypatch
):
    token = active_vault_path.set(tmp_path)
    monkeypatch.setattr(feature_tool_support, "feature_enabled", lambda _: True)
    registrations = core_gnosi_registrations()
    tools = ToolCatalog()
    skills = SkillCatalog(tools)
    for descriptor, handler in registrations:
        tools.register_core(descriptor, handler)
    for descriptor in core_gnosi_skill_descriptors(registrations):
        skills.register_core(descriptor)
    monkeypatch.setattr(agent_skill_catalog, "get_tool_catalog", lambda: tools)
    monkeypatch.setattr(agent_skill_catalog, "get_skill_catalog", lambda: skills)
    profile = {"id": "feature-agent", "skill_ids": ["core.gnosi-notebooks"]}
    try:
        assert resolve_agent_runtime({"id": "empty-agent", "skill_ids": []}).tools == ()
        runtime = resolve_agent_runtime(profile)
        assert len(runtime.tools) == 10
        assert {tool.metadata["domain"] for tool in runtime.tool_descriptors} == {"notebooks"}
        custom = UserSkillStore(tmp_path).create(
            {
                "name": "Notebook reader",
                "tool_ids": ["core.gnosi.notebook-read"],
                "activation": "automatic",
            },
            "Read the requested notebook without modifying it.",
        )
        custom_profile = {"id": "custom-agent", "skill_ids": [custom.id]}
        custom_runtime = resolve_agent_runtime(custom_profile, vault_path=tmp_path)
        assert [tool.id for tool in custom_runtime.tool_descriptors] == ["core.gnosi.notebook-read"]
        assert custom_runtime.instructions == (custom.instructions,)
        monkeypatch.setattr(feature_tool_support, "feature_enabled", lambda _: False)
        assert resolve_agent_runtime(profile).tools == ()
        assert resolve_agent_runtime(custom_profile, vault_path=tmp_path).tools == ()
    finally:
        active_vault_path.reset(token)


@pytest.mark.parametrize("language", ["ca", "en", "es", "fr"])
def test_new_catalog_entries_have_unique_localized_names_and_descriptions(language):
    root = Path(__file__).resolve().parents[2]
    locale = json.loads(
        (root / "frontend/src/shared/i18n/locales" / language / "translation.json").read_text()
    )
    catalog = locale["settings"]["ai"]["catalog"]
    names = []
    for descriptor, _ in feature_registrations():
        key = descriptor.id.removeprefix("core.gnosi.").replace("-", "_")
        names.append(catalog["tool_names"][key])
        assert len(catalog["tool_descriptions"][key]) > 30
    assert len(names) == len(set(names))
    for domain in FEATURE_DOMAINS:
        assert catalog["domains"][domain]
        assert len(catalog["skill_descriptions"][f"core_gnosi_{domain}"]) > 30
