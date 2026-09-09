"""Concurrent calendar readers share only the active secure-store operation."""

from concurrent.futures import Future, ThreadPoolExecutor
from copy import deepcopy
from threading import Event, Lock
from types import SimpleNamespace

import pytest

from backend.domains.calendar import google


@pytest.fixture
def credential_reads(monkeypatch, tmp_path):
    manager = google.integration_manager
    config_file = tmp_path / "integrations.json"
    config_file.write_text("initial")
    monkeypatch.setattr(manager, "config_file", config_file)
    monkeypatch.setattr(google, "_credential_reads", {})
    selections = []
    follower_waiting = Event()

    class ObservedFuture(Future):
        def result(self, timeout=None):
            follower_waiting.set()
            return super().result(timeout=timeout)

    monkeypatch.setattr(google, "Future", ObservedFuture)

    def select(email, **filters):
        selections.append((email, filters))
        assert filters == {"provider": "google", "auth_type": "oauth2", "resolve_secrets": False}
        return [{
            "email": email, "provider": "google", "auth_type": "oauth2",
            "token": "__keychain__:access", "client_id": "synthetic-client",
            "client_secret": "__keychain__:client", "nested": {"value": "original"},
        }]

    monkeypatch.setattr(manager, "get_calendar_accounts", select)
    return manager, config_file, follower_waiting, selections


def test_overlapping_readers_resolve_once_but_build_independent_clients(credential_reads, monkeypatch):
    manager, _, follower_waiting, selections = credential_reads
    entered, release = Event(), Event()
    resolutions = []
    builds = []

    def resolve(account):
        resolutions.append(account["email"])
        entered.set()
        assert release.wait(timeout=3)
        return {**account, "token": "synthetic-token", "client_secret": "synthetic-secret"}

    class Credentials:
        def __init__(self, **values):
            self.values = values

    def build(api, version, *, credentials, cache_discovery, static_discovery):
        assert cache_discovery is False and static_discovery is True
        client = SimpleNamespace(credentials=credentials, transport=object())
        builds.append(client)
        return client

    monkeypatch.setattr(manager, "_resolve_secret_refs", resolve)
    monkeypatch.setattr("google.oauth2.credentials.Credentials", Credentials)
    monkeypatch.setattr("googleapiclient.discovery.build", build)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(google.get_google_calendar_service, "one@example.test")
        try:
            assert entered.wait(timeout=2)
            second = pool.submit(google.get_google_calendar_service, "one@example.test")
            assert follower_waiting.wait(timeout=2)
        finally:
            release.set()
        one, two = first.result(timeout=3), second.result(timeout=3)
    assert resolutions == ["one@example.test"]
    assert one is not two and one.transport is not two.transport
    assert one.credentials is not two.credentials
    assert one.credentials.values == two.credentials.values
    assert google._credential_reads == {}
    # Completion does not create a secret TTL or retain a reusable client.
    three = google.get_google_calendar_service("one@example.test")
    assert three not in (one, two)
    assert len(resolutions) == 2 and len(builds) == 3 and len(selections) == 3


def test_other_identity_and_changed_configuration_do_not_join_old_read(credential_reads, monkeypatch):
    manager, config_file, _, _ = credential_reads
    entered, release = Event(), Event()
    guard = Lock()
    calls = []

    def resolve(account):
        with guard:
            calls.append(account["email"])
            number = len(calls)
        if number == 1:
            entered.set()
            assert release.wait(timeout=3)
        return {**account, "token": f"synthetic-{number}"}

    monkeypatch.setattr(manager, "_resolve_secret_refs", resolve)
    with ThreadPoolExecutor(max_workers=1) as pool:
        old = pool.submit(google._resolved_google_accounts, "one@example.test")
        try:
            assert entered.wait(timeout=2)
            other = google._resolved_google_accounts("two@example.test")
            # References can remain identical when their secure-store values rotate.
            config_file.write_text("configuration-rotated")
            new = google._resolved_google_accounts("one@example.test")
            assert other[0]["token"] == "synthetic-2"
            assert new[0]["token"] == "synthetic-3"
        finally:
            release.set()
        assert old.result(timeout=3)[0]["token"] == "synthetic-1"
    assert calls == ["one@example.test", "two@example.test", "one@example.test"]
    assert google._credential_reads == {}


def test_shared_failure_is_removed_and_a_later_read_can_retry(credential_reads, monkeypatch):
    manager, _, follower_waiting, _ = credential_reads
    entered, release = Event(), Event()
    failure = RuntimeError("Synthetic secure-store failure")
    calls = []

    def resolve(account):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            assert release.wait(timeout=3)
            raise failure
        return deepcopy(account)

    monkeypatch.setattr(manager, "_resolve_secret_refs", resolve)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(google._resolved_google_accounts, "one@example.test")
        try:
            assert entered.wait(timeout=2)
            second = pool.submit(google._resolved_google_accounts, "one@example.test")
            assert follower_waiting.wait(timeout=2)
        finally:
            release.set()
        for reader in (first, second):
            with pytest.raises(RuntimeError) as caught:
                reader.result(timeout=3)
            assert caught.value is failure
    assert len(calls) == 1 and google._credential_reads == {}
    assert google._resolved_google_accounts("one@example.test")[0]["email"] == "one@example.test"
    assert len(calls) == 2 and google._credential_reads == {}


def test_shared_resolution_returns_independent_account_snapshots(credential_reads, monkeypatch):
    manager, _, follower_waiting, _ = credential_reads
    entered, release = Event(), Event()

    def resolve(account):
        entered.set()
        assert release.wait(timeout=3)
        return account

    monkeypatch.setattr(manager, "_resolve_secret_refs", resolve)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(google._resolved_google_accounts, "one@example.test")
        try:
            assert entered.wait(timeout=2)
            second = pool.submit(google._resolved_google_accounts, "one@example.test")
            assert follower_waiting.wait(timeout=2)
        finally:
            release.set()
        one, two = first.result(timeout=3), second.result(timeout=3)
    one[0]["nested"]["value"] = "changed by first reader"
    assert two[0]["nested"]["value"] == "original"
    assert google._credential_reads == {}
