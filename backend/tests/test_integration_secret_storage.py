import json
from types import SimpleNamespace

import pytest

import backend.services.integration_manager as integration_module
from backend.services.integration_manager import IntegrationManager


class FakeKeychain:
    def __init__(self, *, writable=True):
        self.values = {}
        self.deleted = []
        self.writable = writable

    def save_credential(self, key, value):
        if not self.writable:
            return False
        self.values[key] = value
        return True

    def get_credential(self, key):
        return self.values.get(key)

    def delete_credential(self, key):
        self.deleted.append(key)
        self.values.pop(key, None)
        return True


def _manager(tmp_path, monkeypatch, keychain):
    monkeypatch.setattr(
        integration_module,
        "load_params",
        lambda strict_env=False: SimpleNamespace(paths={"SECRETS": tmp_path}),
    )
    monkeypatch.setattr(integration_module, "get_keychain", lambda: keychain)
    return IntegrationManager()


def test_legacy_plaintext_integrations_migrate_to_secure_refs(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.config_file.write_text(
        json.dumps(
            {
                "mail_accounts": [
                    {
                        "id": "google_person@example.test",
                        "email": "person@example.test",
                        "token": "access-secret",
                        "refresh_token": "refresh-secret",
                        "token_uri": "https://oauth.example.test/token",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    raw = manager.get_raw("mail_accounts")

    assert raw[0]["token"] == "access-secret"
    assert raw[0]["refresh_token"] == "refresh-secret"
    assert raw[0]["token_uri"] == "https://oauth.example.test/token"
    persisted = manager.config_file.read_text(encoding="utf-8")
    assert "access-secret" not in persisted
    assert "refresh-secret" not in persisted
    assert persisted.count("__keychain__:") == 2
    assert sorted(keychain.values.values()) == ["access-secret", "refresh-secret"]


def test_safe_view_masks_resolved_credentials(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.update(
        "notion",
        {"name": "Workspace", "token": "notion-secret", "token_status": "connected"},
    )

    safe = manager.get_all_safe()["notion"]

    assert safe["name"] == "Workspace"
    assert safe["token"].startswith("********")
    assert safe["token_status"] == "connected"
    assert "notion-secret" not in manager.config_file.read_text(encoding="utf-8")


def test_masked_ui_update_preserves_existing_secure_value(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.replace_key("notion", {"token": "original-secret", "name": "Old"})

    manager.update("notion", {"token": "********cret", "name": "New"})

    assert manager.get_raw("notion") == {"token": "original-secret", "name": "New"}


def test_removed_integration_deletes_orphaned_secure_refs(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.replace_key("notion", {"token": "secret"})
    stored_keys = set(keychain.values)

    manager.replace_key("notion", {})

    assert stored_keys
    assert stored_keys.issubset(set(keychain.deleted))
    assert manager.get_raw("notion") == {}


def test_secure_store_failure_does_not_persist_plaintext(tmp_path, monkeypatch):
    keychain = FakeKeychain(writable=False)
    manager = _manager(tmp_path, monkeypatch, keychain)

    with pytest.raises(RuntimeError, match="Secure storage is unavailable"):
        manager.replace_key("notion", {"token": "must-not-leak"})

    assert not manager.config_file.exists()
