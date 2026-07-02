"""Tests de signatura (Ed25519), magatzem de confiança i índex remot (fase 3)."""
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
    assert psign.verify(other["public"], sig, data) is False              # clau incorrecta


# --- Magatzem de confiança ---------------------------------------------------
def test_trust_store_roundtrip(tmp_path):
    kp = psign.generate_keypair()
    # El magatzem d'usuari arrenca sense claus PRÒPIES (la bundled oficial sí hi és).
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
    assert psign.verify_against_trust(tmp_path, sig, data) is None  # cap clau encara
    psign.add_trusted_key(tmp_path, "editor-b", kp["public"])
    assert psign.verify_against_trust(tmp_path, sig, data) == "editor-b"


# --- Instal·lació remota amb signatura ---------------------------------------
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
    kp = psign.generate_keypair()  # clau NO afegida al magatzem
    sig = psign.sign(kp["private"], data)
    _fake_download(monkeypatch, data)
    with pytest.raises(ps.PluginError):
        pc.install_from_url(tmp_path, "https://x/p.zip", None, sig)
    assert not ps.plugin_dir(tmp_path, "dolent").exists()


def test_install_signed_tampered_rejected(tmp_path, monkeypatch):
    data = _zip({"manifest.json": json.dumps({"id": "alterat", "version": "1.0.0"})})
    kp = psign.generate_keypair()
    sig = psign.sign(kp["private"], data)  # signa el zip ORIGINAL
    psign.add_trusted_key(tmp_path, "oficial", kp["public"])
    tampered = _zip({"manifest.json": json.dumps({"id": "alterat", "version": "9.9.9"})})
    _fake_download(monkeypatch, tampered)  # però es descarrega un zip DIFERENT
    with pytest.raises(ps.PluginError):
        pc.install_from_url(tmp_path, "https://x/p.zip", None, sig)


def test_install_unsigned_allowed_marked(tmp_path, monkeypatch):
    data = _zip({"manifest.json": json.dumps({"id": "sensesig", "version": "1.0.0"})})
    _fake_download(monkeypatch, data)
    m = pc.install_from_url(tmp_path, "https://x/p.zip")  # sense signatura
    assert m["id"] == "sensesig"
    assert m["signedBy"] is None


# --- Índex remot -------------------------------------------------------------
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
    # Simula el flux de l'eina d'autor: signar un zip i instal·lar-lo verificat.
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


# --- Clau oficial bundled ----------------------------------------------------
def test_bundled_official_key_valid_and_loaded(tmp_path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    assert "gnosi-official" in psign.BUNDLED_TRUSTED_KEYS
    pub = psign.BUNDLED_TRUSTED_KEYS["gnosi-official"]
    # És una clau Ed25519 vàlida (no peta en decodificar-la).
    Ed25519PublicKey.from_public_bytes(base64.b64decode(pub))
    # Sense magatzem d'usuari, la bundled ja hi és → verify_against_trust la usa.
    assert psign.load_trust_store(tmp_path).get("gnosi-official") == pub
