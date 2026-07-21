"""Unit tests for provider disconnection semantics.

Pure pieces only — the cascade filter, the connected/enabled gate and the
api_key hygiene in the secrets migration. No keychain, no params.yaml.
"""
import backend.security.ai_credentials as creds
from backend.api.ai_routes import _registry_rows_without_provider


def test_registry_rows_without_provider_filters_and_counts():
    registry = [
        {"provider": "groq", "model_id": "a"},
        {"provider": "openai", "model_id": "b"},
        {"provider": "groq", "model_id": "c"},
    ]
    filtered, removed = _registry_rows_without_provider(registry, "groq")
    assert [m["model_id"] for m in filtered] == ["b"]
    assert removed == 2
    # No match → untouched list, zero removed (caller skips the write)
    same, none_removed = _registry_rows_without_provider(registry, "mistral")
    assert same == registry and none_removed == 0
    assert _registry_rows_without_provider([], "groq") == ([], 0)
    assert _registry_rows_without_provider(None, "groq") == ([], 0)


def test_is_provider_connected_respects_enabled_flag(monkeypatch):
    # Credentials present, but the user toggled the provider OFF → not
    # connected (same semantics as the router's availability check).
    monkeypatch.setattr(creds, "has_provider_api_key", lambda *_: True)
    assert creds.is_provider_connected("groq", {"enabled": False}) is False
    assert creds.is_provider_connected("groq", {"enabled": True}) is True
    assert creds.is_provider_connected("groq", {}) is True  # default enabled
    # Local providers need no key — but disabled still wins
    assert creds.is_provider_connected("ollama", {"enabled": False}) is False
    assert creds.is_provider_connected("ollama", {}) is True


def test_migrate_pops_empty_api_key(monkeypatch):
    # The edit modal posts api_key: "" — it must never persist to params.yaml
    monkeypatch.setattr(creds, "set_provider_api_key",
                        lambda *_: (True, "__keychain__:x"))
    migrated, changed = creds.migrate_ai_provider_secrets(
        {"providers": {"groq": {"api_key": "", "base_url": "https://x"}}})
    assert changed is True
    assert "api_key" not in migrated["providers"]["groq"]
    assert migrated["providers"]["groq"]["base_url"] == "https://x"
