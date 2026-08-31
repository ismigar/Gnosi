import json
import stat
from types import SimpleNamespace

import backend.security.keychain_manager as keychain_module
from backend.security.keychain_manager import KeychainManager


def _fallback_manager(tmp_path, monkeypatch, *, system="Linux"):
    # Keep OS discovery and all secret-store adapters synthetic before the
    # constructor runs; fallback data and legacy input both belong to tmp_path.
    monkeypatch.setattr(
        keychain_module, "platform", SimpleNamespace(system=lambda: system)
    )
    monkeypatch.setattr(keychain_module, "os", SimpleNamespace(environ={}))
    monkeypatch.setattr(KeychainManager, "_check_docker", lambda self: False)
    monkeypatch.setattr(
        keychain_module,
        "resolve_data_dir",
        lambda **_kwargs: tmp_path,
    )
    manager = KeychainManager()
    monkeypatch.setattr(manager, "_portable_save", lambda *_: False)
    monkeypatch.setattr(manager, "_portable_get", lambda *_: None)
    monkeypatch.setattr(manager, "_portable_delete", lambda *_: False)
    monkeypatch.setattr(manager, "_macos_save", lambda *_: False)
    monkeypatch.setattr(manager, "_macos_get", lambda *_: None)
    monkeypatch.setattr(manager, "_macos_delete", lambda *_: False)
    monkeypatch.setattr(manager, "_macos_list", lambda: [])
    monkeypatch.setattr(manager, "_legacy_fallback_path", lambda: tmp_path / "legacy.enc")
    # The real public API and encryption still run. Only this module's policy
    # seam is overridden; GNOSI_VALIDATION_ROOT remains set for every other unit.
    monkeypatch.setattr(keychain_module, "validation_runtime_enabled", lambda: False)
    return manager


def test_fallback_is_encrypted_and_owner_only(tmp_path, monkeypatch):
    manager = _fallback_manager(tmp_path, monkeypatch)

    assert manager.save_credential("example", "plain-secret-value") is True

    storage_path = tmp_path / "secrets" / "credentials.enc"
    key_path = tmp_path / "secrets" / "credentials.key"
    assert storage_path.is_file()
    assert key_path.is_file()
    assert b"plain-secret-value" not in storage_path.read_bytes()
    assert stat.S_IMODE(storage_path.stat().st_mode) == 0o600
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o600
    assert manager.get_credential("example") == "plain-secret-value"

    assert manager.delete_credential("example") is True
    assert manager.get_credential("example") is None


def test_macos_failure_uses_the_same_encrypted_fallback(tmp_path, monkeypatch):
    manager = _fallback_manager(tmp_path, monkeypatch, system="Darwin")
    monkeypatch.setattr(manager, "_macos_save", lambda *_: False)
    monkeypatch.setattr(manager, "_macos_get", lambda *_: None)

    assert manager.save_credential("token", "secret") is True
    assert manager.get_credential("token") == "secret"


def test_missing_key_never_overwrites_existing_ciphertext(tmp_path, monkeypatch):
    manager = _fallback_manager(tmp_path, monkeypatch)
    storage_path = tmp_path / "secrets" / "credentials.enc"
    storage_path.parent.mkdir(parents=True)
    original = b"existing-encrypted-content"
    storage_path.write_bytes(original)

    assert manager.save_credential("token", "new-secret") is False
    assert storage_path.read_bytes() == original
    assert not (tmp_path / "secrets" / "credentials.key").exists()


def test_legacy_plaintext_is_read_only_input_and_migrates_encrypted(tmp_path, monkeypatch):
    manager = _fallback_manager(tmp_path, monkeypatch)
    legacy = tmp_path / "legacy.enc"
    legacy.write_text(json.dumps({"old": "legacy-secret"}), encoding="utf-8")

    assert manager.get_credential("old") == "legacy-secret"
    assert manager.save_credential("new", "new-secret") is True

    encrypted = (tmp_path / "secrets" / "credentials.enc").read_bytes()
    assert b"legacy-secret" not in encrypted
    assert b"new-secret" not in encrypted
    assert manager.get_credential("old") == "legacy-secret"
    assert manager.get_credential("new") == "new-secret"
