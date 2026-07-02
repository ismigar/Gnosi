"""Tests del nucli del sistema de plugins v2 (manifest, permisos, descobriment).

Purs: sense xarxa ni backend. Toquen només `plugin_system` i el filesystem
(directori temporal).
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import plugin_system as ps  # noqa: E402


# --- Validació de manifest ---------------------------------------------------
def test_validate_manifest_ok():
    m = ps.validate_manifest({
        "id": "my-plugin", "version": "1.2.3", "name": "Meu",
        "main": "main.js", "backend": "b.mjs",
        "permissions": ["ui:command", "vault:read"],
        "events": ["clone:finished"],
    })
    assert m["id"] == "my-plugin"
    assert m["permissions"] == ["ui:command", "vault:read"]
    assert m["events"] == ["clone:finished"]
    assert m["main"] == "main.js"


@pytest.mark.parametrize("bad_id", ["", "  ", "../evil", "UPPER", "a", "x/y", ".hidden"])
def test_validate_manifest_bad_id(bad_id):
    with pytest.raises(ps.PluginError):
        ps.validate_manifest({"id": bad_id, "version": "1.0.0"})


def test_validate_manifest_unknown_permission():
    with pytest.raises(ps.PluginError):
        ps.validate_manifest({"id": "p", "version": "1.0.0", "permissions": ["do:anything"]})


def test_validate_manifest_bad_version():
    with pytest.raises(ps.PluginError):
        ps.validate_manifest({"id": "p", "version": "not-semver"})


def test_validate_manifest_entry_traversal():
    with pytest.raises(ps.PluginError):
        ps.validate_manifest({"id": "p", "version": "1.0.0", "main": "../../etc/passwd"})


# --- Seguretat de path -------------------------------------------------------
def test_plugin_dir_rejects_traversal(tmp_path):
    with pytest.raises(ps.PluginError):
        ps.plugin_dir(tmp_path, "../escape")


def test_plugin_dir_ok(tmp_path):
    d = ps.plugin_dir(tmp_path, "good-plugin")
    assert d.name == "good-plugin"
    assert (tmp_path / "plugins") in d.parents


# --- Permisos ----------------------------------------------------------------
def test_grant_and_has_permission():
    state = {"disabled": [], "granted": {}}
    state = ps.set_granted(state, "p", ["vault:read", "ui:command"])
    assert ps.has_permission(state, "p", "vault:read")
    assert ps.has_permission(state, "p", "ui:command")
    assert not ps.has_permission(state, "p", "vault:write")


def test_disabled_plugin_has_no_permissions():
    state = {"disabled": ["p"], "granted": {"p": ["vault:read"]}}
    assert not ps.has_permission(state, "p", "vault:read")


def test_set_granted_filters_unknown():
    state = ps.set_granted({}, "p", ["vault:read", "bogus"])
    assert ps.granted_permissions(state, "p") == ["vault:read"]


def test_set_granted_empty_revokes():
    state = ps.set_granted({"granted": {"p": ["vault:read"]}}, "p", [])
    assert "p" not in state.get("granted", {})


# --- Descobriment ------------------------------------------------------------
def _install(base: Path, pid: str, manifest: dict):
    d = base / "plugins" / pid
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return d


def test_discover_plugins(tmp_path):
    _install(tmp_path, "good", {"id": "good", "version": "1.0.0", "name": "Good",
                                "permissions": ["ui:command"]})
    _install(tmp_path, "broken", {"id": "MISMATCH", "version": "1.0.0"})
    found = ps.discover_plugins(tmp_path)
    by_id = {}
    for e in found:
        key = e.get("manifest", {}).get("id") if e.get("manifest") else e.get("id")
        by_id[key] = e
    assert "good" in by_id and by_id["good"]["manifest"]["name"] == "Good"
    # El de carpeta "broken" té id que no casa amb la carpeta → error, no manifest.
    assert "broken" in by_id and by_id["broken"].get("error")


def test_discover_empty(tmp_path):
    assert ps.discover_plugins(tmp_path) == []
