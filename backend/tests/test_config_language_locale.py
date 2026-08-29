"""Configuration persistence tests for declarative UI locales."""

import asyncio
from pathlib import Path
from types import SimpleNamespace

import yaml

from backend.domains.configuration.api import settings as config_routes
from backend.domains.configuration.settings_schemas import ConfigurationUpdateRequest


class _Request:
    def __init__(self, payload):
        self._payload = payload
        self.app = SimpleNamespace(state=SimpleNamespace())

    async def json(self):
        return self._payload


def test_config_update_preserves_unknown_valid_bcp47_locale(
    monkeypatch,
    tmp_path: Path,
):
    params_path = tmp_path / "params.yaml"
    params_path.write_text(
        yaml.safe_dump({"settings": {"language": "en"}, "unrelated": True}),
        encoding="utf-8",
    )
    config = SimpleNamespace(params_source=params_path)

    monkeypatch.setattr(config_routes, "load_params", lambda **_kwargs: config)
    monkeypatch.setattr(
        config_routes,
        "migrate_ai_provider_secrets",
        lambda value: (value, False),
    )

    response = asyncio.run(
        config_routes.update_config(
            ConfigurationUpdateRequest(
                root={"settings": {"language": "pt-BR"}},
            ),
            _Request({"settings": {"language": "pt-BR"}}),
        )
    )

    saved = yaml.safe_load(params_path.read_text(encoding="utf-8"))
    assert response["status"] == "success"
    assert saved["settings"]["language"] == "pt-BR"
    assert saved["unrelated"] is True
