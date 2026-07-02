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


# --- Instal·lació des de zip -------------------------------------------------
def _make_zip(files: dict) -> bytes:
    import io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_install_from_zip_root_manifest(tmp_path):
    data = _make_zip({
        "manifest.json": json.dumps({"id": "zp", "version": "1.0.0", "name": "Zp",
                                     "permissions": ["ui:command"], "main": "main.js"}),
        "main.js": "gnosi.log('hi')",
    })
    m = ps.install_from_zip(tmp_path, data)
    assert m["id"] == "zp"
    assert (ps.plugin_dir(tmp_path, "zp") / "main.js").exists()


def test_install_from_zip_single_subfolder(tmp_path):
    data = _make_zip({
        "my-plugin/manifest.json": json.dumps({"id": "sub", "version": "1.0.0"}),
        "my-plugin/main.js": "x",
    })
    m = ps.install_from_zip(tmp_path, data)
    assert m["id"] == "sub"
    assert (ps.plugin_dir(tmp_path, "sub") / "main.js").exists()


def test_install_from_zip_blocks_zip_slip(tmp_path):
    data = _make_zip({
        "manifest.json": json.dumps({"id": "evil", "version": "1.0.0"}),
        "../escape.txt": "pwned",
    })
    with pytest.raises(ps.PluginError):
        ps.install_from_zip(tmp_path, data)
    assert not (tmp_path.parent / "escape.txt").exists()


def test_install_from_zip_rejects_bad_manifest(tmp_path):
    data = _make_zip({"manifest.json": json.dumps({"id": "Bad Id!!"})})
    with pytest.raises(ps.PluginError):
        ps.install_from_zip(tmp_path, data)


def test_uninstall_removes_dir(tmp_path):
    data = _make_zip({"manifest.json": json.dumps({"id": "gone", "version": "1.0.0"})})
    ps.install_from_zip(tmp_path, data)
    assert ps.plugin_dir(tmp_path, "gone").exists()
    ps.uninstall(tmp_path, "gone")
    assert not ps.plugin_dir(tmp_path, "gone").exists()


# --- Catàleg / galeria -------------------------------------------------------
def test_catalog_loads_and_installs_bundled(tmp_path):
    from backend.services import plugin_catalog as pc
    cat = pc.load_catalog()
    ids = {e.get("id") for e in cat}
    assert "hello-command" in ids  # exemple empaquetat al repo
    m = pc.install_bundled(tmp_path, "hello-command")
    assert m["id"] == "hello-command"
    assert (ps.plugin_dir(tmp_path, "hello-command") / "manifest.json").exists()


def test_catalog_install_unknown_raises(tmp_path):
    from backend.services import plugin_catalog as pc
    with pytest.raises(ps.PluginError):
        pc.install_bundled(tmp_path, "no-existeix")


# --- Verificació d'integritat (checksum) d'instal·lació remota ---------------
def test_install_from_url_checksum_mismatch(tmp_path, monkeypatch):
    import hashlib
    from backend.services import plugin_catalog as pc

    data = _make_zip({"manifest.json": json.dumps({"id": "remot", "version": "1.0.0"})})

    class _Resp:
        def raise_for_status(self): pass
        def iter_content(self, n): yield data

    monkeypatch.setattr(pc.requests, "get", lambda *a, **k: _Resp())

    good = hashlib.sha256(data).hexdigest()
    # Checksum correcte → instal·la.
    m = pc.install_from_url(tmp_path, "https://x/plugin.zip", good)
    assert m["id"] == "remot"
    # Checksum incorrecte → rebutja i NO instal·la.
    ps.uninstall(tmp_path, "remot")
    with pytest.raises(ps.PluginError):
        pc.install_from_url(tmp_path, "https://x/plugin.zip", "deadbeef" * 8)
    assert not ps.plugin_dir(tmp_path, "remot").exists()


# --- Versionat de l'API de plugins ------------------------------------------
def test_manifest_api_version_default_and_parse():
    assert ps.validate_manifest({"id": "av1", "version": "1.0.0"})["apiVersion"] == 1
    assert ps.validate_manifest({"id": "av2", "version": "1.0.0", "apiVersion": 1})["apiVersion"] == 1


def test_manifest_api_version_invalid():
    with pytest.raises(ps.PluginError):
        ps.validate_manifest({"id": "av3", "version": "1.0.0", "apiVersion": "x"})
    with pytest.raises(ps.PluginError):
        ps.validate_manifest({"id": "av4", "version": "1.0.0", "apiVersion": 0})


def test_install_refuses_future_api_version(tmp_path):
    future = ps.PLUGIN_API_VERSION + 1
    data = _make_zip({"manifest.json": json.dumps(
        {"id": "futur", "version": "1.0.0", "apiVersion": future})})
    with pytest.raises(ps.PluginError):
        ps.install_from_zip(tmp_path, data)
    assert not ps.plugin_dir(tmp_path, "futur").exists()


def test_read_manifest_refuses_future_api_version(tmp_path):
    _install(tmp_path, "futur2", {"id": "futur2", "version": "1.0.0",
                                   "apiVersion": ps.PLUGIN_API_VERSION + 1})
    with pytest.raises(ps.PluginError):
        ps.read_manifest(tmp_path, "futur2")


def test_bundled_examples_have_valid_manifests():
    # Els exemples del catàleg s'han d'instal·lar tots (manifest vàlid + compat).
    from backend.services import plugin_catalog as pc
    import tempfile
    cfg = Path(tempfile.mkdtemp())
    for entry in pc.load_catalog():
        if entry.get("source") == "bundled":
            m = pc.install_bundled(cfg, entry["id"])
            assert m["id"] == entry["id"]
            assert m["apiVersion"] <= ps.PLUGIN_API_VERSION
