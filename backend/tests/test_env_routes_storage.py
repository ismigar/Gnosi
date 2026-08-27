import asyncio
import json

from starlette.requests import Request

from backend.domains.configuration.api import credentials as credentials_routes
from backend.domains.configuration.api import environment as env_routes


class FakeKeychain:
    def __init__(self):
        self.values = {}

    def save_credential(self, key, value):
        self.values[key] = value
        return True

    def delete_credential(self, key):
        self.values.pop(key, None)
        return True


def _json_request(payload):
    body = json.dumps(payload).encode("utf-8")
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {"type": "http", "method": "POST", "path": "/api/env", "headers": []},
        receive,
    )


def test_ui_environment_endpoint_never_writes_credentials_to_env_file(tmp_path, monkeypatch):
    local_env = tmp_path / ".env"
    local_env.write_text("EXISTING_SETTING=keep\n", encoding="utf-8")
    keychain = FakeKeychain()
    monkeypatch.setattr(env_routes, "ENV_PATH", local_env)
    monkeypatch.setattr(env_routes, "get_keychain", lambda: keychain)
    monkeypatch.setattr(env_routes, "load_env", lambda **_kwargs: None)

    response = asyncio.run(
        env_routes.update_env(
            _json_request(
                {
                    "SOFTCATALA_API_URL": "http://localhost:8000",
                    "CUSTOM_PRIVATE_TOKEN": "super-secret",
                }
            )
        )
    )

    content = local_env.read_text(encoding="utf-8")
    assert response["secure_updates"] == 1
    assert "SOFTCATALA_API_URL=http://localhost:8000" in content
    assert "CUSTOM_PRIVATE_TOKEN" not in content
    assert "super-secret" not in content
    assert keychain.values == {"env_custom_private_token": "super-secret"}


def test_shared_credential_import_is_explicit_and_read_only(tmp_path, monkeypatch):
    shared = tmp_path / ".env_shared"
    original = "GROQ_API_KEY=shared-secret\nNON_SECRET_SETTING=keep\n"
    shared.write_text(original, encoding="utf-8")
    keychain = FakeKeychain()
    monkeypatch.setattr(credentials_routes, "configured_shared_env_path", lambda: shared)
    monkeypatch.setattr(credentials_routes, "get_keychain", lambda: keychain)

    response = asyncio.run(credentials_routes.migrate_from_env())

    assert response["migrated"] == ["groq_api_key"]
    assert response["source_modified"] is False
    assert shared.read_text(encoding="utf-8") == original
    assert keychain.values == {"groq_api_key": "shared-secret"}
