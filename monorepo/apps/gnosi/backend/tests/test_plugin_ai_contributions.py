"""Lifecycle tests for governed third-party agent contributions."""

from __future__ import annotations

import json
from types import SimpleNamespace

import yaml

from backend.services import plugin_ai_contributions as contributions
from backend.services.agent_skill_catalog import (
    get_skill_catalog,
    get_tool_catalog,
    unregister_plugin_skill_provider,
    unregister_plugin_tool_provider,
)


def _write_plugin(config_dir):
    plugin_dir = config_dir / "plugins" / "ai-demo"
    plugin_dir.mkdir(parents=True)
    manifest = {
        "id": "ai-demo",
        "version": "1.0.0",
        "apiVersion": 2,
        "backend": "backend.mjs",
        "permissions": [
            "ai:skills",
            "ai:agents",
            "ai:tools",
            "vault:read",
        ],
        "contributes": {
            "skills": ["skills.yaml"],
            "agents": ["agents.yaml"],
            "agentTools": ["tools.yaml"],
        },
    }
    (plugin_dir / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    (plugin_dir / "backend.mjs").write_text(
        """
        export default { async onEvent(event) {
          return { received: event.payload.arguments.query };
        } };
        """,
        encoding="utf-8",
    )
    (plugin_dir / "skills.yaml").write_text(
        yaml.safe_dump({
            "id": "plugin.ai-demo.lookup",
            "name": "Demo lookup",
            "activation": "automatic",
            "tool_ids": ["plugin.ai-demo.lookup-tool"],
            "instructions": "Use the demo lookup when relevant.",
        }),
        encoding="utf-8",
    )
    (plugin_dir / "tools.yaml").write_text(
        yaml.safe_dump({
            "id": "plugin.ai-demo.lookup-tool",
            "name": "Demo lookup tool",
            "description": "Read from the demo plugin.",
            "required_permissions": ["vault:read"],
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        }),
        encoding="utf-8",
    )
    (plugin_dir / "agents.yaml").write_text(
        yaml.safe_dump({
            "id": "assistant",
            "name": "Demo assistant",
            "persona": "Keep this default unless the user edits it.",
            "skill_ids": ["plugin.ai-demo.lookup"],
            "required_skill_ids": ["plugin.ai-demo.lookup"],
        }),
        encoding="utf-8",
    )


def _install_runtime(monkeypatch, tmp_path, state, params):
    config_dir = tmp_path / ".gnosi"
    config_dir.mkdir()
    _write_plugin(config_dir)
    params_path = config_dir / "params.yaml"
    params_path.write_text(yaml.safe_dump(params), encoding="utf-8")
    monkeypatch.setattr(
        contributions,
        "_runtime_context",
        lambda: (config_dir, state),
    )
    monkeypatch.setattr(
        contributions,
        "load_params",
        lambda strict_env=False: SimpleNamespace(
            params=params,
            params_source=params_path,
        ),
    )
    return config_dir, params_path


def test_reconcile_registers_catalogs_and_preserves_agent_overrides(
    monkeypatch,
    tmp_path,
):
    state = {
        "disabled": [],
        "granted": {
            "ai-demo": [
                "ai:skills",
                "ai:agents",
                "ai:tools",
                "vault:read",
            ]
        },
    }
    params = {"ai": {"agents": []}}
    config_dir, params_path = _install_runtime(
        monkeypatch, tmp_path, state, params
    )

    try:
        result = contributions.reconcile_plugin_ai_contributions()
        profile = params["ai"]["agents"][0]
        assert result["agents_changed"] is True
        assert profile["id"] == "plugin.ai-demo.assistant"
        assert profile["skill_ids"] == ["plugin.ai-demo.lookup"]

        skill = get_skill_catalog().get_entry(
            "plugin.ai-demo.lookup", tmp_path
        )
        tool = get_tool_catalog().get("plugin.ai-demo.lookup-tool")
        handler = get_tool_catalog().get_handler(
            "plugin.ai-demo.lookup-tool"
        )
        assert skill is not None and skill.available is True
        assert tool is not None and tool.status.value == "available"
        assert handler(query="hello") == {"received": "hello"}

        profile["persona"] = "User override"
        state["disabled"] = ["ai-demo"]
        suspended = contributions.reconcile_plugin_ai_contributions()
        assert suspended["agents_changed"] is True
        assert profile["plugin_suspended"] is True
        assert profile["enabled"] is False
        assert profile["persona"] == "User override"
        assert (
            get_skill_catalog()
            .get_entry("plugin.ai-demo.lookup", tmp_path)
            .descriptor.status.value
            == "suspended"
        )

        state["disabled"] = []
        resumed = contributions.reconcile_plugin_ai_contributions()
        assert resumed["agents_changed"] is True
        assert profile["persona"] == "User override"
        assert profile.get("plugin_suspended") is None

        persisted = yaml.safe_load(params_path.read_text(encoding="utf-8"))
        persisted_profile = persisted["ai"]["agents"][0]
        assert persisted_profile["persona"] == "User override"
    finally:
        unregister_plugin_skill_provider("ai-demo")
        unregister_plugin_tool_provider("ai-demo")


def test_tool_effects_are_derived_from_per_tool_permissions():
    policy = contributions._permission_policy({"vault:write"})
    assert {effect.value for effect in policy["effects"]} == {
        "read",
        "local_write",
    }
    assert policy["minimum_role"] == "editor"
    assert policy["confirmation"].value == "explicit_request"
