"""Backend contract tests for governed agent skills and tools."""

import sys
from types import ModuleType
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.models.agent_skills import (
    CatalogOrigin,
    ConfirmationPolicy,
    OriginType,
    SkillActivation,
    SkillDescriptor,
    SkillKind,
    ToolDescriptor,
    ToolEffect,
)
from backend.services import agent_skill_catalog as agent_skill_catalog_module
from backend.services.agent_skill_assignments import (
    AgentAssignmentConflictError,
    AgentSkillAssignmentStore,
    LEGACY_SKILL_ID,
    migrate_legacy_agent_skills,
)
from backend.services.agent_skill_catalog import (
    CatalogConflictError,
    SkillCatalog,
    ToolCatalog,
    ToolRegistration,
    register_plugin_skill_provider,
    register_plugin_tool_provider,
    resolve_agent_runtime,
    unregister_plugin_skill_provider,
    unregister_plugin_tool_provider,
)
from backend.services.user_skill_store import (
    UserSkillConflictError,
    UserSkillStore,
)


def _core_origin():
    return CatalogOrigin(type=OriginType.CORE, id="gnosi")


def _user_metadata(*, name="Research", tool_ids=None):
    return {
        "schema_version": 1,
        "version": "1.0.0",
        "name": name,
        "description": "Test skill",
        "kind": SkillKind.AGENT,
        "activation": SkillActivation.AUTOMATIC,
        "tool_ids": tool_ids or [],
    }


def _read_tool(tool_id="core.read-page", *, handler=None):
    descriptor = ToolDescriptor(
        id=tool_id,
        name="Read page",
        origin=_core_origin(),
        effects=[ToolEffect.READ],
        confirmation=ConfirmationPolicy.NONE,
    )
    return descriptor, handler


def test_descriptor_validation_enforces_namespaces_and_sensitive_policy():
    with pytest.raises(ValidationError, match="namespace"):
        SkillDescriptor(
            id="core.fake",
            name="Impersonation",
            origin=CatalogOrigin(type=OriginType.PLUGIN, id="example"),
        )

    with pytest.raises(ValidationError, match="turn authorization"):
        ToolDescriptor(
            id="core.write-page",
            name="Write page",
            origin=_core_origin(),
            effects=[ToolEffect.LOCAL_WRITE],
            confirmation=ConfirmationPolicy.NONE,
        )

    with pytest.raises(ValidationError, match="confirmation=always"):
        ToolDescriptor(
            id="core.delete-page",
            name="Delete page",
            origin=_core_origin(),
            effects=[ToolEffect.DESTRUCTIVE],
            confirmation=ConfirmationPolicy.EXPLICIT_REQUEST,
        )

    with pytest.raises(ValidationError, match="undefined properties"):
        ToolDescriptor(
            id="core.invalid-schema",
            name="Invalid schema",
            origin=_core_origin(),
            input_schema={
                "type": "object",
                "properties": {},
                "required": ["missing"],
            },
        )

    with pytest.raises(ValidationError, match="JSON-safe"):
        SkillDescriptor(
            id="core.invalid-metadata",
            name="Invalid metadata",
            origin=_core_origin(),
            metadata={"callable": lambda: None},
        )


@pytest.mark.parametrize(
    ("effect", "confirmation"),
    [
        (ToolEffect.READ, ConfirmationPolicy.NONE),
        (ToolEffect.LOCAL_WRITE, ConfirmationPolicy.EXPLICIT_REQUEST),
        (ToolEffect.EXTERNAL_WRITE, ConfirmationPolicy.ALWAYS),
        (ToolEffect.DESTRUCTIVE, ConfirmationPolicy.ALWAYS),
        (ToolEffect.CODE_EXECUTION, ConfirmationPolicy.EXPLICIT_REQUEST),
        (ToolEffect.AI_COST, ConfirmationPolicy.EXPLICIT_REQUEST),
    ],
)
def test_descriptor_accepts_governed_policy_for_each_effect(
    effect, confirmation
):
    descriptor = ToolDescriptor(
        id=f"core.effect-{effect.value.replace('_', '-')}",
        name=f"{effect.value} test",
        origin=_core_origin(),
        effects=[effect],
        confirmation=confirmation,
    )
    assert descriptor.effects == [effect]


def test_plugin_provider_derives_ownership_and_rejects_duplicate_ids():
    tools = ToolCatalog()
    catalog = SkillCatalog(tools)
    catalog.register_plugin_provider(
        "example",
        lambda: [
            {
                "id": "plugin.example.search",
                "name": "Search",
                "origin": {"type": "core", "id": "forged"},
            }
        ],
    )

    descriptor = catalog.descriptors()["plugin.example.search"]
    assert descriptor.origin.type == OriginType.PLUGIN
    assert descriptor.origin.id == "example"

    catalog.register_core(
        SkillDescriptor(
            id="core.same",
            name="Core same",
            origin=_core_origin(),
        )
    )
    catalog.register_plugin_provider(
        "duplicate",
        lambda: [
            {
                "id": "plugin.duplicate.same",
                "name": "One",
            },
            {
                "id": "plugin.duplicate.same",
                "name": "Two",
            },
        ],
    )
    with pytest.raises(CatalogConflictError, match="duplicate skill ID"):
        catalog.descriptors()


def test_plugin_provider_accepts_plugin_system_underscore_ids():
    tools = ToolCatalog()
    catalog = SkillCatalog(tools)
    catalog.register_plugin_provider(
        "my_plugin",
        lambda: [
            {
                "id": "plugin.my_plugin.lookup_items",
                "name": "Lookup items",
            }
        ],
    )
    assert "plugin.my_plugin.lookup_items" in catalog.descriptors()


def test_generic_plugin_reconciler_is_loaded_lazily_and_once(monkeypatch):
    calls = []
    module = ModuleType("backend.services.plugin_ai_contributions")
    module.reconcile_plugin_ai_contributions = lambda: calls.append("called")
    monkeypatch.setitem(
        sys.modules,
        "backend.services.plugin_ai_contributions",
        module,
    )
    monkeypatch.setattr(
        agent_skill_catalog_module,
        "_BUILTIN_PROVIDER_HOOKS_REGISTERED",
        {"llm-wiki"},
    )

    agent_skill_catalog_module.get_tool_catalog()
    agent_skill_catalog_module.get_skill_catalog()

    assert calls == ["called"]


def test_skill_availability_is_derived_from_registered_tools(tmp_path):
    tools = ToolCatalog()
    catalog = SkillCatalog(tools)
    catalog.register_core(
        SkillDescriptor(
            id="core.lookup",
            name="Lookup",
            origin=_core_origin(),
            tool_ids=["core.missing"],
        )
    )

    entry = catalog.get_entry("core.lookup", tmp_path)
    assert entry is not None
    assert entry.available is False
    assert entry.missing_tool_ids == ["core.missing"]

    descriptor, handler = _read_tool(
        "core.missing", handler=lambda: None
    )
    tools.register_core(descriptor, handler)
    entry = catalog.get_entry("core.lookup", tmp_path)
    assert entry is not None
    assert entry.available is True
    assert entry.effects == [ToolEffect.READ]


def test_tool_provider_can_supply_runtime_adapter_and_detects_duplicates():
    tools = ToolCatalog()

    def handler():
        return None

    tools.register_plugin_provider(
        "example",
        lambda: [
            ToolRegistration(
                descriptor=ToolDescriptor(
                    id="plugin.example.search",
                    name="Search",
                    origin=CatalogOrigin(type=OriginType.PLUGIN, id="example"),
                ),
                handler=handler,
            )
        ],
    )
    assert tools.get_handler("plugin.example.search") is handler

    tools.register_core(_read_tool("core.read-page")[0])
    tools.register_plugin_provider(
        "dupe",
        lambda: [
            {"id": "plugin.dupe.run", "name": "One"},
            {"id": "plugin.dupe.run", "name": "Two"},
        ],
    )
    with pytest.raises(CatalogConflictError, match="duplicate tool ID"):
        tools.snapshot()

    invalid = ToolCatalog()
    with pytest.raises(TypeError, match="not executable"):
        invalid.register_core(
            _read_tool("core.invalid-handler")[0],
            handler=object(),
        )


def test_runtime_resolution_is_exact_and_keeps_handlers_aligned(monkeypatch):
    monkeypatch.setattr(
        agent_skill_catalog_module,
        "_BUILTIN_PROVIDER_HOOKS_REGISTERED",
        {"llm-wiki", "plugins"},
    )
    def automatic_handler():
        return "automatic"

    def explicit_handler():
        return "explicit"

    register_plugin_tool_provider(
        "runtime-test",
        lambda: [
            ToolRegistration(
                ToolDescriptor(
                    id="plugin.runtime-test.automatic",
                    name="Automatic",
                    origin=CatalogOrigin(
                        type=OriginType.PLUGIN, id="runtime-test"
                    ),
                ),
                automatic_handler,
            ),
            ToolRegistration(
                ToolDescriptor(
                    id="plugin.runtime-test.explicit",
                    name="Explicit",
                    origin=CatalogOrigin(
                        type=OriginType.PLUGIN, id="runtime-test"
                    ),
                ),
                explicit_handler,
            ),
        ],
    )
    register_plugin_skill_provider(
        "runtime-test",
        lambda: [
            SkillDescriptor(
                id="plugin.runtime-test.automatic",
                name="Automatic",
                origin=CatalogOrigin(
                    type=OriginType.PLUGIN, id="runtime-test"
                ),
                tool_ids=["plugin.runtime-test.automatic"],
                instructions="Automatic instructions.",
            ),
            SkillDescriptor(
                id="plugin.runtime-test.explicit",
                name="Explicit",
                origin=CatalogOrigin(
                    type=OriginType.PLUGIN, id="runtime-test"
                ),
                activation=SkillActivation.EXPLICIT,
                tool_ids=["plugin.runtime-test.explicit"],
                instructions="Explicit instructions.",
            ),
        ],
    )
    try:
        profile = {
            "id": "agent",
            "skill_ids": [
                "plugin.runtime-test.automatic",
                "plugin.runtime-test.explicit",
            ],
        }
        automatic = resolve_agent_runtime(profile)
        assert automatic.active_skill_ids == (
            "plugin.runtime-test.automatic",
        )
        assert automatic.tools == (automatic_handler,)
        assert [item.id for item in automatic.tool_descriptors] == [
            "plugin.runtime-test.automatic"
        ]

        explicit = resolve_agent_runtime(
            profile,
            active_skill_ids=["plugin.runtime-test.explicit"],
        )
        assert explicit.active_skill_ids == ("plugin.runtime-test.explicit",)
        assert explicit.instructions == ("Explicit instructions.",)
        assert explicit.tools == (explicit_handler,)
        assert len(explicit.tools) == len(explicit.tool_descriptors)

        assert resolve_agent_runtime({"id": "legacy"}).active_skill_ids == (
            LEGACY_SKILL_ID,
        )
        assert resolve_agent_runtime(
            {"id": "explicit-empty", "skill_ids": []}
        ).active_skill_ids == ()
    finally:
        unregister_plugin_skill_provider("runtime-test")
        unregister_plugin_tool_provider("runtime-test")


def test_user_skill_store_crud_is_portable_and_revision_aware(tmp_path):
    store = UserSkillStore(tmp_path)
    created = store.create(_user_metadata(), "Read sources carefully.")

    assert created.id.startswith("user.research-")
    package = tmp_path / ".gnosi" / "agent" / "skills" / created.id
    assert (package / "skill.yaml").is_file()
    assert (package / "SKILL.md").read_text(encoding="utf-8") == (
        "Read sources carefully."
    )
    revision = store.revision(created.id)

    updated = store.update(
        created.id,
        _user_metadata(name="Updated"),
        "Updated instructions.",
        expected_revision=revision,
    )
    assert updated.name == "Updated"
    assert store.load(created.id).instructions == "Updated instructions."

    with pytest.raises(UserSkillConflictError, match="changed since"):
        store.update(
            created.id,
            _user_metadata(name="Stale"),
            "No",
            expected_revision=revision,
        )

    store.delete(created.id)
    assert not package.exists()


def test_user_skill_ids_are_collision_safe_and_requested_ids_conflict(tmp_path):
    store = UserSkillStore(tmp_path)
    first = store.create(_user_metadata(), "")
    second = store.create(_user_metadata(), "")
    assert first.id != second.id

    store.create(
        _user_metadata(name="Named"),
        "",
        requested_id="user.named",
    )
    with pytest.raises(UserSkillConflictError, match="already exists"):
        store.create(
            _user_metadata(name="Named again"),
            "",
            requested_id="user.named",
        )


def test_invalid_user_package_is_reported_without_hiding_valid_skills(tmp_path):
    store = UserSkillStore(tmp_path)
    valid = store.create(_user_metadata(), "")
    invalid = store.root / "user.invalid"
    invalid.mkdir(parents=True)
    (invalid / "skill.yaml").write_text("id: core.impersonation\n", encoding="utf-8")
    (invalid / "SKILL.md").write_text("", encoding="utf-8")

    skills, issues = store.load_all()
    assert [skill.id for skill in skills] == [valid.id]
    assert issues[0]["package"] == "user.invalid"
    assert "invalid descriptor" in issues[0]["error"]


def test_legacy_migration_distinguishes_missing_and_explicit_empty():
    params = {
        "ai": {
            "agents": [
                {"id": "legacy"},
                {"id": "empty", "skill_ids": []},
                {"id": "configured", "skill_ids": ["core.custom"]},
            ]
        }
    }

    assert migrate_legacy_agent_skills(params) is True
    agents = {agent["id"]: agent for agent in params["ai"]["agents"]}
    assert agents["legacy"]["skill_ids"] == [LEGACY_SKILL_ID]
    assert agents["empty"]["skill_ids"] == []
    assert agents["configured"]["skill_ids"] == ["core.custom"]
    assert params["ai"]["schema_version"] == 2
    assert migrate_legacy_agent_skills(params) is False


def test_assignments_reject_missing_unavailable_and_stale_revisions(tmp_path):
    tool_catalog = ToolCatalog()
    skill_catalog = SkillCatalog(tool_catalog)
    params_path = tmp_path / ".gnosi" / "params.yaml"
    store = AgentSkillAssignmentStore(
        params_path,
        {"ai": {"agents": [{"id": "agent", "skill_ids": []}]}},
    )
    user_store = UserSkillStore(tmp_path)
    skill = user_store.create(
        _user_metadata(tool_ids=["core.read-page"]),
        "Read.",
        requested_id="user.read",
    )

    with pytest.raises(AgentAssignmentConflictError) as missing_tool:
        store.assign(
            "agent",
            [skill.id],
            catalog=skill_catalog,
            vault_path=tmp_path,
        )
    assert missing_tool.value.details["unavailable_skill_ids"] == [skill.id]

    descriptor, handler = _read_tool(
        "core.read-page", handler=lambda: None
    )
    tool_catalog.register_core(descriptor, handler)
    old_revision = store.agent_revision("agent")
    agent, new_revision = store.assign(
        "agent",
        [skill.id],
        catalog=skill_catalog,
        vault_path=tmp_path,
        expected_revision=old_revision,
    )
    assert agent["skill_ids"] == [skill.id]
    assert new_revision != old_revision

    with pytest.raises(AgentAssignmentConflictError, match="changed since"):
        store.assign(
            "agent",
            [],
            catalog=skill_catalog,
            vault_path=tmp_path,
            expected_revision=old_revision,
        )

    with pytest.raises(AgentAssignmentConflictError) as missing_skill:
        store.assign(
            "agent",
            ["user.does-not-exist"],
            catalog=skill_catalog,
            vault_path=tmp_path,
        )
    assert missing_skill.value.details["missing_skill_ids"] == [
        "user.does-not-exist"
    ]


def test_required_assignments_cannot_be_removed(tmp_path):
    tool_catalog = ToolCatalog()
    skill_catalog = SkillCatalog(tool_catalog)
    skill_catalog.register_core(
        SkillDescriptor(
            id="core.required",
            name="Required",
            origin=_core_origin(),
        )
    )
    store = AgentSkillAssignmentStore(
        tmp_path / "params.yaml",
        {
            "ai": {
                "agents": [
                    {
                        "id": "agent",
                        "skill_ids": ["core.required"],
                        "required_skill_ids": ["core.required"],
                    }
                ]
            }
        },
    )

    with pytest.raises(AgentAssignmentConflictError) as exc:
        store.assign(
            "agent",
            [],
            catalog=skill_catalog,
            vault_path=tmp_path,
        )
    assert exc.value.details["required_skill_ids"] == ["core.required"]

    with pytest.raises(AgentAssignmentConflictError, match="required plugin"):
        store.unassign_skill("core.required")


def test_stale_assignment_store_rebases_before_writing(tmp_path):
    tool_catalog = ToolCatalog()
    skill_catalog = SkillCatalog(tool_catalog)
    skill_catalog.register_core(
        SkillDescriptor(
            id="core.first",
            name="First",
            origin=_core_origin(),
        )
    )
    skill_catalog.register_core(
        SkillDescriptor(
            id="core.second",
            name="Second",
            origin=_core_origin(),
        )
    )
    params_path = tmp_path / "params.yaml"
    initial = {
        "ai": {
            "agents": [
                {"id": "first-agent", "skill_ids": []},
                {"id": "second-agent", "skill_ids": []},
            ]
        }
    }
    first_request = AgentSkillAssignmentStore(params_path, initial)
    second_request = AgentSkillAssignmentStore(params_path, initial)

    first_request.assign(
        "first-agent",
        ["core.first"],
        catalog=skill_catalog,
        vault_path=tmp_path,
    )
    second_request.assign(
        "second-agent",
        ["core.second"],
        catalog=skill_catalog,
        vault_path=tmp_path,
    )

    persisted = AgentSkillAssignmentStore.load(params_path)
    assert persisted.get_agent("first-agent")["skill_ids"] == ["core.first"]
    assert persisted.get_agent("second-agent")["skill_ids"] == ["core.second"]
