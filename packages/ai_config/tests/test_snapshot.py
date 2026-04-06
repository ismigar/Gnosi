from ai_config.catalog.normalize import normalize_catalog
from ai_config.catalog.snapshot import build_catalog_snapshot


def _build_input_a():
    return {
        "mode": "merge",
        "providers": [
            {"id": "openai", "name": "OpenAI", "type": "api", "auth": {"mode": "api_key", "value": "x"}},
            {"id": "anthropic", "name": "Anthropic", "type": "api", "auth": {"mode": "api_key", "value": "y"}},
        ],
        "models": [
            {
                "id": "gpt-4o-mini",
                "name": "GPT",
                "provider_id": "openai",
                "compat": {"context": ["chat"], "reasoning": ["fast"], "tools": ["function"], "transport": ["http"]},
            },
            {
                "id": "claude-3-5-sonnet",
                "name": "Claude",
                "provider_id": "anthropic",
                "compat": {"context": ["chat"], "reasoning": ["deep"], "tools": ["function"], "transport": ["http"]},
            },
        ],
        "defaults": {"provider": "openai", "model": "gpt-4o-mini", "by_context": {}},
    }


def _build_input_b():
    return {
        "mode": "merge",
        "providers": [
            {"id": "anthropic", "name": "Anthropic", "type": "api", "auth": {"mode": "api_key", "value": "y"}},
            {"id": "openai", "name": "OpenAI", "type": "api", "auth": {"mode": "api_key", "value": "x"}},
        ],
        "models": [
            {
                "id": "claude-3-5-sonnet",
                "name": "Claude",
                "provider_id": "anthropic",
                "compat": {"context": ["chat"], "reasoning": ["deep"], "tools": ["function"], "transport": ["http"]},
            },
            {
                "id": "gpt-4o-mini",
                "name": "GPT",
                "provider_id": "openai",
                "compat": {"context": ["chat"], "reasoning": ["fast"], "tools": ["function"], "transport": ["http"]},
            },
        ],
        "defaults": {"provider": "openai", "model": "gpt-4o-mini", "by_context": {}},
    }


def test_snapshot_is_deterministic_for_equivalent_catalogs():
    snapshot_a = build_catalog_snapshot(normalize_catalog(_build_input_a()))
    snapshot_b = build_catalog_snapshot(normalize_catalog(_build_input_b()))

    assert snapshot_a == snapshot_b
