from ai_config.catalog.merge import merge_catalogs
from ai_config.catalog.normalize import normalize_catalog


def test_replace_mode_uses_implicit_catalog():
    explicit = {
        "mode": "replace",
        "providers": [
            {"id": "OpenAI", "name": "OpenAI", "type": "api", "auth": {"mode": "api_key", "value": "a"}}
        ],
        "models": [
            {
                "id": "GPT-4O-MINI",
                "name": "GPT",
                "provider_id": "OpenAI",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            }
        ],
    }

    implicit = {
        "providers": [
            {"id": "Anthropic", "name": "Anthropic", "type": "api", "auth": {"mode": "api_key", "value": "b"}}
        ],
        "models": [
            {
                "id": "Claude-3-5-sonnet",
                "name": "Claude",
                "provider_id": "Anthropic",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            }
        ],
    }

    merged = merge_catalogs(explicit, implicit)
    assert len(merged["providers"]) == 1
    assert merged["providers"][0]["id"] == "Anthropic"


def test_merge_mode_preserves_explicit_secret_when_implicit_has_no_value():
    explicit = {
        "mode": "merge",
        "providers": [
            {
                "id": "openai",
                "name": "OpenAI",
                "type": "api",
                "auth": {"mode": "api_key", "value": "resolved-env-secret"},
            }
        ],
        "models": [],
    }

    implicit = {
        "providers": [
            {
                "id": "openai",
                "name": "OpenAI from plugin",
                "type": "api",
                "auth": {"mode": "api_key"},
            }
        ],
        "models": [],
    }

    merged = merge_catalogs(explicit, implicit)
    assert len(merged["providers"]) == 1
    assert merged["providers"][0]["name"] == "OpenAI from plugin"
    assert merged["providers"][0]["auth"]["value"] == "resolved-env-secret"


def test_normalize_after_merge_is_deterministic():
    catalog = {
        "mode": "merge",
        "providers": [
            {"id": "OpenAI", "name": "OpenAI", "type": "api", "auth": {"mode": "api_key", "value": "a"}},
            {"id": "Anthropic", "name": "Anthropic", "type": "api", "auth": {"mode": "api_key", "value": "b"}},
        ],
        "models": [
            {
                "id": "GPT-4O-MINI",
                "name": "GPT",
                "provider_id": "OpenAI",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            },
            {
                "id": "Claude-3-5-sonnet",
                "name": "Claude",
                "provider_id": "Anthropic",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            },
        ],
    }

    normalized = normalize_catalog(catalog)
    assert [provider["id"] for provider in normalized["providers"]] == ["anthropic", "openai"]
    assert [f"{model['provider_id']}/{model['id']}" for model in normalized["models"]] == [
        "anthropic/claude-3-5-sonnet",
        "openai/gpt-4o-mini",
    ]
