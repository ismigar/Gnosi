from ai_config.selection.selector import select_model
from ai_config.catalog.normalize import normalize_catalog


def test_selects_context_default_and_fallback_allowlist():
    catalog = {
        "providers": [
            {"id": "openai", "name": "OpenAI", "type": "api", "auth": {"mode": "api_key", "value": "x"}},
            {"id": "anthropic", "name": "Anthropic", "type": "api", "auth": {"mode": "api_key", "value": "y"}},
        ],
        "models": [
            {
                "id": "gpt-4o-mini",
                "name": "GPT",
                "provider_id": "openai",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            },
            {
                "id": "claude-3-5-sonnet",
                "name": "Claude",
                "provider_id": "anthropic",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            },
        ],
        "defaults": {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "by_context": {
                "analyst": {
                    "provider": "anthropic",
                    "model": "claude-3-5-sonnet",
                    "fallback": "openai/gpt-4o-mini",
                }
            },
        },
    }

    result = select_model(catalog, context_id="analyst")
    assert result["provider"] == "anthropic"
    assert result["fallback_used"] is False

    fallback_result = select_model(
        catalog,
        context_id="analyst",
        allowlist=["openai/gpt-4o-mini"],
        fallback="openai/gpt-4o-mini",
    )
    assert fallback_result["provider"] == "openai"
    assert fallback_result["fallback_used"] is True


def test_selects_model_with_implicit_provider_after_normalization():
    raw_catalog = {
        "providers": [
            {"id": "openai", "name": "OpenAI", "type": "api", "auth": {"mode": "api_key", "value": "x"}},
        ],
        "models": [
            {
                "id": "gpt-4o-mini",
                "name": "GPT",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            },
        ],
        "defaults": {"provider": "openai", "model": "gpt-4o-mini", "by_context": {}},
    }

    catalog = normalize_catalog(raw_catalog)
    result = select_model(catalog, requested="gpt-4o-mini")

    assert result["provider"] == "openai"
    assert result["model"] == "gpt-4o-mini"


def test_uses_fallback_when_primary_is_not_allowlisted():
    catalog = {
        "providers": [
            {"id": "openai", "name": "OpenAI", "type": "api", "auth": {"mode": "api_key", "value": "x"}},
            {"id": "anthropic", "name": "Anthropic", "type": "api", "auth": {"mode": "api_key", "value": "y"}},
        ],
        "models": [
            {
                "id": "gpt-4o-mini",
                "name": "GPT",
                "provider_id": "openai",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            },
            {
                "id": "claude-3-5-sonnet",
                "name": "Claude",
                "provider_id": "anthropic",
                "compat": {"context": [], "reasoning": [], "tools": [], "transport": []},
            },
        ],
        "defaults": {"provider": "openai", "model": "gpt-4o-mini", "by_context": {}},
    }

    result = select_model(
        catalog,
        requested="anthropic/claude-3-5-sonnet",
        fallback="openai/gpt-4o-mini",
        allowlist=["openai/gpt-4o-mini"],
    )

    assert result["provider"] == "openai"
    assert result["model"] == "gpt-4o-mini"
    assert result["fallback_used"] is True
