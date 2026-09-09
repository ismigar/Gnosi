import json
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

import backend.services.integration_manager as integration_module
from backend.services.integration_manager import IntegrationManager


class FakeKeychain:
    def __init__(self, *, writable=True):
        self.values = {}
        self.deleted = []
        self.read = []
        self.writable = writable

    def save_credential(self, key, value):
        if not self.writable:
            return False
        self.values[key] = value
        return True

    def get_credential(self, key):
        self.read.append(key)
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


def test_safe_view_does_not_read_credentials_from_secure_store(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    keychain.values.update({"calendar-token": "calendar-secret", "notion-token": "notion-secret"})
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.config_file.write_text(
        json.dumps(
            {
                "calendars": [{"token": "__keychain__:calendar-token"}],
                "notion": {"token": "__keychain__:notion-token"},
            }
        ),
        encoding="utf-8",
    )

    safe = manager.get_all_safe()

    assert safe["calendars"][0]["token"].startswith("********")
    assert safe["notion"]["token"].startswith("********")
    assert keychain.read == []


def test_safe_view_does_not_wait_for_another_reader_unlocking_credentials(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.update("notion", {"name": "Workspace", "token": "fixture-secret"})
    entered = threading.Event()
    release = threading.Event()
    original_read = keychain.get_credential

    def slow_read(key):
        entered.set()
        assert release.wait(5)
        return original_read(key)

    monkeypatch.setattr(keychain, "get_credential", slow_read)
    with ThreadPoolExecutor(max_workers=2) as pool:
        raw = pool.submit(manager._load)
        try:
            assert entered.wait(2)
            safe = pool.submit(manager.get_all_safe).result(timeout=2)
            assert safe["notion"]["token"].startswith("********")
            assert safe["notion"]["name"] == "Workspace"
        finally:
            release.set()
        assert raw.result(timeout=2)["notion"]["token"] == "fixture-secret"


@pytest.mark.parametrize("operation", [
    lambda manager: manager.update("social_streams", [{"id": "one", "name": "Stream"}]),
    lambda manager: manager.replace_key("social_streams", []),
    lambda manager: manager.delete_key("social_streams"),
    lambda manager: manager.bulk_update({"social_streams": []}),
    lambda manager: manager.set_mail_account_enabled("mail@example.test", False),
    lambda manager: manager.update_mail_account_token("mail@example.test", "new-token"),
])
def test_updates_preserve_unrelated_credentials_without_reading_them(tmp_path, monkeypatch, operation):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.bulk_update({
        "notion": {"token": "unrelated-secret"},
        "mail_accounts": [{"id": "one", "email": "mail@example.test", "token": "old-token"}],
        "social_streams": [{"id": "one", "name": "Before"}],
    })
    before = json.loads(manager.config_file.read_text())
    original_secret_values = dict(keychain.values)
    operation(manager)
    after = json.loads(manager.config_file.read_text())
    assert keychain.read == []
    assert after["notion"] == before["notion"]
    secret_key = after["notion"]["token"].split(":", 1)[1]
    assert keychain.values[secret_key] == original_secret_values[secret_key]


@pytest.mark.parametrize("section", ["emails", "mail_accounts"])
def test_imap_sync_resolves_only_the_requested_account(tmp_path, monkeypatch, section):
    from backend.domains.mail.sync import imap_core

    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.bulk_update({section: [
        {"id": "chosen", "email": "chosen@example.test", "password": "chosen-secret"},
        {"id": "other", "email": "other@example.test", "password": "other-secret"},
    ]})
    monkeypatch.setattr(imap_core, "integration_manager", manager)
    service = object.__new__(imap_core.ImapMailSyncCore)
    account = service._get_account_data("CHOSEN@example.test")
    assert account["password"] == "chosen-secret"
    assert len(keychain.read) == 1
    assert keychain.values[keychain.read[0]] == "chosen-secret"


def test_raw_view_resolves_only_requested_integration_section(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    keychain.values.update({"calendar-token": "calendar-secret", "notion-token": "notion-secret"})
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.config_file.write_text(
        json.dumps(
            {
                "calendars": [{"token": "__keychain__:calendar-token"}],
                "notion": {"token": "__keychain__:notion-token"},
            }
        ),
        encoding="utf-8",
    )

    assert manager.get_raw("calendars") == [{"token": "calendar-secret"}]
    assert keychain.read == ["calendar-token"]


@pytest.mark.parametrize("section", ["calendars", "emails"])
@pytest.mark.parametrize("adapter", ["google", "caldav"])
def test_calendar_adapter_resolves_only_selected_credentials(
    tmp_path, monkeypatch, section, adapter
):
    from backend.domains.calendar import google
    from backend.services import hybrid_calendar_service

    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.bulk_update({
        section: [
            {
                "username": "chosen@example.test",
                "provider": adapter,
                "auth_type": "oauth2",
                "password": "chosen-secret",
            },
            {"email": "other@example.test", "password": "other-secret"},
        ],
        "mail_accounts": [{"email": "chosen@example.test", "password": "unrelated-secret"}],
        "notion": {"token": "unrelated-notion-secret"},
    })
    monkeypatch.setattr(google, "integration_manager", manager)
    monkeypatch.setattr(hybrid_calendar_service, "integration_manager", manager)

    if adapter == "google":
        accounts = google._resolved_google_accounts("chosen@example.test")
        assert len(accounts) == 1
        account = accounts[0]
    else:
        account = hybrid_calendar_service._get_account("chosen@example.test")
        assert account is not None

    assert account["password"] == "chosen-secret"
    assert len(keychain.read) == 1
    assert keychain.values[keychain.read[0]] == "chosen-secret"


@pytest.mark.parametrize("operation", ["calendars", "events", "event"])
def test_calendar_dispatch_does_not_unlock_credentials(tmp_path, monkeypatch, operation):
    from backend.services import hybrid_calendar_service as hybrid

    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.replace_key("calendars", [
        {"email": "chosen@example.test", "provider": "google", "token": "chosen-secret"},
        {"email": "other@example.test", "provider": "google", "token": "other-secret"},
    ])
    monkeypatch.setattr(hybrid, "integration_manager", manager)
    monkeypatch.setattr(hybrid, "google_list_calendars", lambda *_: [{"id": "one"}])
    monkeypatch.setattr(hybrid, "google_list_events", lambda *_: [{"id": "one"}])
    monkeypatch.setattr(hybrid, "google_get_event", lambda *_: {"id": "one"})

    if operation == "calendars":
        assert hybrid.list_calendars("chosen@example.test") == [{"id": "one"}]
    elif operation == "events":
        assert hybrid.list_events("chosen@example.test", "start", "end") == [{"id": "one"}]
    else:
        assert hybrid.get_event("chosen@example.test", "one") == {"id": "one"}
    assert keychain.read == []


def test_calendar_selection_preserves_order_filters_and_fresh_credentials(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.bulk_update({
        "calendars": [
            {"email": "same@example.test", "provider": "caldav", "password": "caldav-secret"},
            {
                "email": "same@example.test", "provider": "google", "auth_type": "oauth2",
                "token": "first-token", "options": {"color": "blue"},
            },
        ],
        "emails": [
            {
                "email": "same@example.test", "provider": "google", "auth_type": "oauth2",
                "token": "second-token",
            },
            {"email": "same@example.test", "provider": "google", "token": "unsupported-token"},
        ],
    })

    refs = manager.get_calendar_accounts("same@example.test", resolve_secrets=False)
    assert [account["provider"] for account in refs] == ["caldav", "google", "google", "google"]
    assert keychain.read == []
    accounts = manager.get_calendar_accounts("same@example.test", provider="google", auth_type="oauth2")
    assert [account["token"] for account in accounts] == ["first-token", "second-token"]
    assert len(keychain.read) == 2

    refs[1]["options"]["color"] = "changed"
    keychain.values[keychain.read[0]] = "rotated-token"
    refreshed = manager.get_calendar_accounts("same@example.test", provider="google", auth_type="oauth2")
    assert refreshed[0]["token"] == "rotated-token"
    assert refreshed[0]["options"] == {"color": "blue"}
    assert len(keychain.read) == 4
    assert manager.get_calendar_accounts("missing@example.test") == []
    assert len(keychain.read) == 4


def test_masked_ui_update_preserves_existing_secure_value(tmp_path, monkeypatch):
    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.replace_key("notion", {"token": "original-secret", "name": "Old"})

    manager.update("notion", {"token": "********cret", "name": "New"})

    assert manager.get_raw("notion") == {"token": "original-secret", "name": "New"}


@pytest.mark.parametrize("stored", [None, []])
def test_social_reads_preserve_defaults_without_unlocking_other_sections(
    tmp_path, monkeypatch, stored
):
    from backend.domains.social import configuration

    keychain = FakeKeychain()
    manager = _manager(tmp_path, monkeypatch, keychain)
    data = {"notion": {"token": "__keychain__:unrelated"}}
    if stored is not None:
        data.update(social_streams=stored, social_networks=stored)
    manager.config_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(configuration, "integration_manager", manager)
    monkeypatch.setattr(configuration, "SOCIAL_PUBLISHERS", {})

    expected_streams = configuration.DEFAULT_STREAMS if stored is None else []
    expected_networks = configuration.DEFAULT_NETWORKS if stored is None else []
    assert [stream.id for stream in configuration.configured_streams()] == [
        stream["id"] for stream in expected_streams
    ]
    assert [network.id for network in configuration.configured_networks()] == [
        network["id"] for network in expected_networks
    ]
    for network in expected_networks:
        assert configuration.network_settings(network["id"]) == network
    assert configuration.network_settings("missing-network") == {}
    assert keychain.read == []


@pytest.mark.parametrize("lookup", ["email", "metadata", "alias", "enabled", "missing", "all"])
def test_mail_lookup_unlocks_only_selected_accounts(tmp_path, monkeypatch, lookup):
    keychain = FakeKeychain()
    keychain.values.update({key: f"{key}-secret" for key in ("one", "two", "notion")})
    manager = _manager(tmp_path, monkeypatch, keychain)
    manager.config_file.write_text(
        json.dumps(
            {
                "emails": [
                    {
                        "email": "one@example.test",
                        "token": "__keychain__:one",
                        "aliases": [{"email": "alias@example.test"}],
                    }
                ],
                "mail_accounts": [
                    {
                        "username": "two@example.test",
                        "token": "__keychain__:two",
                        "enabled": False,
                    }
                ],
                "notion": {"token": "__keychain__:notion"},
            }
        ),
        encoding="utf-8",
    )

    if lookup == "email":
        assert manager.get_mail_account(" TWO@example.test ")["token"] == "two-secret"
        expected = ["two"]
    elif lookup == "metadata":
        reference = manager.get_mail_account(" TWO@example.test ", resolve_secrets=False)
        assert reference["token"] == "__keychain__:two"
        assert keychain.read == []
        keychain.values["two"] = "rotated-secret"
        assert manager.get_mail_account("two@example.test")["token"] == "rotated-secret"
        expected = ["two"]
    elif lookup == "alias":
        assert manager.get_account_by_alias(" ALIAS@example.test ")["token"] == "one-secret"
        expected = ["one"]
    elif lookup == "enabled":
        assert [a["token"] for a in manager.get_all_mail_accounts(True)] == ["one-secret"]
        expected = ["one"]
    elif lookup == "missing":
        assert manager.get_mail_account("missing@example.test") is None
        assert manager.get_account_by_alias("missing@example.test") is None
        expected = []
    else:
        assert [a["token"] for a in manager.get_all_mail_accounts()] == ["one-secret", "two-secret"]
        expected = ["one", "two"]
    assert keychain.read == expected
    assert "one-secret" not in manager.config_file.read_text(encoding="utf-8")


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
