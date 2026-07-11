"""Tests for signing (Ed25519), the trust store, and the remote index (phase 3)."""
import base64
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import plugin_signing as psign  # noqa: E402
from backend.services import plugin_catalog as pc  # noqa: E402
from backend.services import plugin_system as ps  # noqa: E402


def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


# --- Primitives --------------------------------------------------------------
def test_sign_verify_roundtrip():
    kp = psign.generate_keypair()
    data = b"contingut del plugin"
    sig = psign.sign(kp["private"], data)
    assert psign.verify(kp["public"], sig, data) is True


def test_verify_rejects_tamper_and_wrong_key():
    kp = psign.generate_keypair()
    other = psign.generate_keypair()
    data = b"dades"
    sig = psign.sign(kp["private"], data)
    assert psign.verify(kp["public"], sig, b"dades alterades") is False   # tamper
    assert psign.verify(other["public"], sig, data) is False              # wrong key


# --- Trust store ---------------------------------------------------
def test_trust_store_roundtrip(tmp_path):
    kp = psign.generate_keypair()
    # The user store starts with no keys of ITS OWN (the official bundled one is there).
    assert "editor-a" not in psign.load_trust_store(tmp_path)
    psign.add_trusted_key(tmp_path, "editor-a", kp["public"])
    assert psign.load_trust_store(tmp_path).get("editor-a") == kp["public"]
    psign.remove_trusted_key(tmp_path, "editor-a")
    assert "editor-a" not in psign.load_trust_store(tmp_path)


def test_add_trusted_key_rejects_garbage(tmp_path):
    with pytest.raises(ValueError):
        psign.add_trusted_key(tmp_path, "dolenta", "no-es-base64-valida!!")


def test_verify_against_trust(tmp_path):
    kp = psign.generate_keypair()
    data = b"payload"
    sig = psign.sign(kp["private"], data)
    assert psign.verify_against_trust(tmp_path, sig, data) is None  # no key yet
    psign.add_trusted_key(tmp_path, "editor-b", kp["public"])
    assert psign.verify_against_trust(tmp_path, sig, data) == "editor-b"


# --- Remote installation with signing ---------------------------------------
def _fake_download(monkeypatch, data: bytes):
    class _Resp:
        def raise_for_status(self): pass
        def iter_content(self, n): yield data
    monkeypatch.setattr(pc.requests, "get", lambda *a, **k: _Resp())


def test_install_signed_trusted(tmp_path, monkeypatch):
    data = _zip({"manifest.json": json.dumps({"id": "signat", "version": "1.0.0"})})
    kp = psign.generate_keypair()
    sig = psign.sign(kp["private"], data)
    psign.add_trusted_key(tmp_path, "oficial", kp["public"])
    _fake_download(monkeypatch, data)
    m = pc.install_from_url(tmp_path, "https://x/p.zip", None, sig)
    assert m["id"] == "signat"
    assert m["signedBy"] == "oficial"


def test_install_signed_untrusted_rejected(tmp_path, monkeypatch):
    data = _zip({"manifest.json": json.dumps({"id": "dolent", "version": "1.0.0"})})
    kp = psign.generate_keypair()  # key NOT added to the store
    sig = psign.sign(kp["private"], data)
    _fake_download(monkeypatch, data)
    with pytest.raises(ps.PluginError):
        pc.install_from_url(tmp_path, "https://x/p.zip", None, sig)
    assert not ps.plugin_dir(tmp_path, "dolent").exists()


def test_install_signed_tampered_rejected(tmp_path, monkeypatch):
    data = _zip({"manifest.json": json.dumps({"id": "alterat", "version": "1.0.0"})})
    kp = psign.generate_keypair()
    sig = psign.sign(kp["private"], data)  # signs the ORIGINAL zip
    psign.add_trusted_key(tmp_path, "oficial", kp["public"])
    tampered = _zip({"manifest.json": json.dumps({"id": "alterat", "version": "9.9.9"})})
    _fake_download(monkeypatch, tampered)  # but a DIFFERENT zip is downloaded
    with pytest.raises(ps.PluginError):
        pc.install_from_url(tmp_path, "https://x/p.zip", None, sig)


def test_install_unsigned_allowed_marked(tmp_path, monkeypatch):
    data = _zip({"manifest.json": json.dumps({"id": "sensesig", "version": "1.0.0"})})
    _fake_download(monkeypatch, data)
    m = pc.install_from_url(tmp_path, "https://x/p.zip")  # no signature
    assert m["id"] == "sensesig"
    assert m["signedBy"] is None


# --- Remote index -------------------------------------------------------------
def test_fetch_remote_index_merges(monkeypatch):
    remote = [{"id": "remot-1", "name": "Remot", "url": "https://x/r1.zip"}]

    class _Resp:
        def raise_for_status(self): pass
        def iter_content(self, n): yield json.dumps(remote).encode()
    monkeypatch.setattr(pc.requests, "get", lambda *a, **k: _Resp())

    entries = pc.fetch_remote_index("https://x/index.json")
    assert entries and entries[0]["id"] == "remot-1"
    assert entries[0]["source"] == "url"

    merged = pc.load_catalog("https://x/index.json")
    ids = {e["id"] for e in merged}
    assert "remot-1" in ids and "hello-command" in ids  # remot + bundled


def test_end_to_end_signing_tool_flow(tmp_path, monkeypatch):
    # Simulates the author tool's flow: sign a zip and install it verified.
    plugin = tmp_path / "el-meu"
    plugin.mkdir()
    (plugin / "manifest.json").write_text(json.dumps({"id": "e2e", "version": "1.0.0"}))
    (plugin / "main.js").write_text("gnosi.log('hi')")
    data = pc._zip_dir_bytes(plugin)
    kp = psign.generate_keypair()
    sig = psign.sign(kp["private"], data)
    sha = hashlib.sha256(data).hexdigest()

    cfg = tmp_path / "cfg"
    cfg.mkdir()
    psign.add_trusted_key(cfg, "jo", kp["public"])
    _fake_download(monkeypatch, data)
    m = pc.install_from_url(cfg, "https://x/e2e.zip", sha, sig)
    assert m["id"] == "e2e" and m["signedBy"] == "jo"


# --- Official bundled key ----------------------------------------------------
def test_bundled_official_key_valid_and_loaded(tmp_path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    assert "gnosi-official" in psign.BUNDLED_TRUSTED_KEYS
    pub = psign.BUNDLED_TRUSTED_KEYS["gnosi-official"]
    # It's a valid Ed25519 key (decoding it doesn't fail).
    Ed25519PublicKey.from_public_bytes(base64.b64decode(pub))
    # Without a user store, the bundled one is already there → verify_against_trust uses it.
    assert psign.load_trust_store(tmp_path).get("gnosi-official") == pub
