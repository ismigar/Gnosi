from ai_config.runtime.resolve_effective_model import resolve_effective_model


class DemoPlugin:
    id = "dynamic-anthropic"
    order = 20

    def discover(self, context):
        return {
            "providers": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "type": "api",
                    "auth": {"mode": "api_key", "value": "plugin-key"},
                }
            ],
            "models": [
                {
                    "id": "claude-3-5-sonnet",
                    "name": "Claude",
                    "provider_id": "anthropic",
                    "compat": {"context": ["chat"], "reasoning": ["deep"], "tools": ["function"], "transport": ["http"]},
                }
            ],
        }


def test_runtime_end_to_end_env_precedence_and_discovery():
    raw = {
        "mode": "merge",
        "providers": [
            {
                "id": "openai",
                "name": "OpenAI",
                "type": "api",
                "auth": {"mode": "api_key", "value": "config-key"},
            }
        ],
        "models": [
            {
                "id": "gpt-4o-mini",
                "name": "GPT",
                "provider_id": "openai",
                "compat": {"context": ["chat"], "reasoning": ["fast"], "tools": ["function"], "transport": ["http"]},
            }
        ],
        "defaults": {"provider": "openai", "model": "gpt-4o-mini"},
    }

    result = resolve_effective_model(
        raw,
        {
            "env": {"OPENAI_API_KEY": "env-key"},
            "plugins": [DemoPlugin()],
            "requested": "openai/gpt-4o-mini",
        },
    )

    providers = result["catalog"]["providers"]
    assert [provider["id"] for provider in providers] == ["anthropic", "openai"]
    openai = [provider for provider in providers if provider["id"] == "openai"][0]
    assert openai["auth"]["value"] == "env-key"
    assert result["selection"]["provider"] == "openai"
