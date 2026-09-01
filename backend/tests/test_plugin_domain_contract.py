"""Compatibility contracts for the typed plugin lifecycle and sandbox domain."""

from __future__ import annotations

import inspect
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, Dict

import pytest

from backend.domains.plugins import contracts
from backend.services import plugin_sandbox as sandbox_facade
from backend.services import plugin_system as plugin_facade


def test_historical_plugin_system_signatures_are_stable() -> None:
    expected = {
        "is_valid_plugin_id": "(pid: 'Any') -> 'bool'",
        "plugins_dir": "(config_dir: 'Path') -> 'Path'",
        "plugin_dir": "(config_dir: 'Path', plugin_id: 'str') -> 'Path'",
        "validate_manifest": "(raw: 'Any') -> 'Dict[str, Any]'",
        "read_manifest": ("(config_dir: 'Path', plugin_id: 'str') -> 'Dict[str, Any]'"),
        "discover_plugins": "(config_dir: 'Path') -> 'List[Dict[str, Any]]'",
        "_find_manifest_root": "(zf: 'zipfile.ZipFile') -> 'str'",
        "install_from_zip": (
            "(config_dir: 'Path', data: 'bytes', *, overwrite: 'bool' = True) -> 'Dict[str, Any]'"
        ),
        "write_provenance": (
            "(config_dir: 'Path', plugin_id: 'str', provenance: 'Dict[str, Any]') -> 'None'"
        ),
        "package_plugin": "(config_dir: 'Path', plugin_id: 'str') -> 'bytes'",
        "uninstall": "(config_dir: 'Path', plugin_id: 'str') -> 'None'",
        "granted_permissions": ("(state: 'Dict[str, Any]', plugin_id: 'str') -> 'List[str]'"),
        "has_permission": (
            "(state: 'Dict[str, Any]', plugin_id: 'str', permission: 'str') -> 'bool'"
        ),
        "set_granted": (
            "(state: 'Dict[str, Any]', plugin_id: 'str', permissions: "
            "'List[str]') -> 'Dict[str, Any]'"
        ),
    }

    for name, signature in expected.items():
        assert str(inspect.signature(getattr(plugin_facade, name))) == signature


def test_historical_plugin_sandbox_signatures_are_stable() -> None:
    expected = {
        "set_host_handlers": ("(handlers: 'Dict[str, Callable[[Dict[str, Any]], Any]]') -> 'None'"),
        "runtime_permissions": "() -> 'frozenset[str]'",
        "node_available": "() -> 'bool'",
        "run_event": (
            "(config_dir: 'Path', manifest: 'Dict[str, Any]', granted: "
            "'List[str]', event_name: 'str', payload: 'Dict[str, Any]', *, "
            "timeout_s: 'float' = 15.0) -> 'Dict[str, Any]'"
        ),
    }

    for name, signature in expected.items():
        assert str(inspect.signature(getattr(sandbox_facade, name))) == signature


def test_plugin_error_keeps_its_historical_import_identity() -> None:
    assert plugin_facade.PluginError is contracts.PluginError
    assert plugin_facade.PluginError.__module__ == "backend.services.plugin_system"


def test_manifest_and_path_seams_are_resolved_late(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    custom_root = tmp_path / "custom-plugins"
    plugin_path = custom_root / "seam-plugin"
    plugin_path.mkdir(parents=True)
    (plugin_path / "manifest.json").write_text("{}", encoding="utf-8")
    sentinel: Dict[str, Any] = {
        "id": "seam-plugin",
        "apiVersion": 1,
        "marker": object(),
    }

    def fake_plugins_dir(config_dir: Path) -> Path:
        assert config_dir == tmp_path
        return custom_root

    def fake_validate_manifest(raw: Any) -> Dict[str, Any]:
        assert raw == {}
        return sentinel

    monkeypatch.setattr(plugin_facade, "plugins_dir", fake_plugins_dir)
    monkeypatch.setattr(plugin_facade, "validate_manifest", fake_validate_manifest)

    assert plugin_facade.plugin_dir(tmp_path, "seam-plugin") == plugin_path.resolve()
    assert plugin_facade.read_manifest(tmp_path, "seam-plugin") is sentinel


def test_sandbox_runtime_globals_remain_late_bound(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sandbox_facade, "node_available", lambda: False)
    monkeypatch.setattr(
        sandbox_facade,
        "_METHOD_PERMISSION",
        {"custom.rpc": "custom:permission"},
    )

    result = sandbox_facade.run_event(
        tmp_path,
        {"id": "late-bound", "backend": "backend.mjs"},
        [],
        "event",
        {},
    )

    assert result == {"ok": False, "error": "Node.js is unavailable on the host"}
    assert sandbox_facade.runtime_permissions() == frozenset({"custom:permission"})


def test_sandbox_host_handler_registry_copies_injected_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: list[dict[str, Any]] = []

    def handler(arguments: Dict[str, Any]) -> None:
        observed.append(arguments)

    handlers: Dict[str, Callable[[Dict[str, Any]], Any]] = {"vault.readPage": handler}
    monkeypatch.setattr(sandbox_facade, "_host_handlers", {})

    sandbox_facade.set_host_handlers(handlers)
    handlers.clear()

    assert "vault.readPage" in sandbox_facade._host_handlers
    assert observed == []


def test_manifest_facade_still_returns_json_compatible_mappings() -> None:
    manifest = plugin_facade.validate_manifest({"id": "json-contract", "version": "1.0.0"})

    assert json.loads(json.dumps(manifest)) == manifest
