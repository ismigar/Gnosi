"""Frozen HTTP contract for the PR4 workspace/configuration extraction."""

from __future__ import annotations

import hashlib
import json

from fastapi import FastAPI

from backend.api import (
    config_routes as legacy_config,
    credentials_routes as legacy_credentials,
    env_routes as legacy_environment,
    workspace_routes as legacy_workspace,
)
from backend.domains.configuration.api import credentials, environment, settings
from backend.domains.workspace.api import routes as workspace


EXPECTED_OPENAPI_SHA256 = (
    "5a64c979718b136c9fb61521cac346d21f0e2a5f88ea900e39629aa3f0023202"
)


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(workspace.router, tags=["Workspaces"])
    app.include_router(settings.router, prefix="/api", tags=["Config"])
    app.include_router(environment.router, prefix="/api", tags=["Env"])
    app.include_router(credentials.router, prefix="/api", tags=["Credentials"])
    return app.openapi()


def test_workspace_configuration_openapi_is_unchanged() -> None:
    payload = json.dumps(
        _focused_openapi(),
        sort_keys=True,
        separators=(",", ":"),
    ).encode()

    assert hashlib.sha256(payload).hexdigest() == EXPECTED_OPENAPI_SHA256


def test_legacy_facades_export_the_domain_router_singletons() -> None:
    assert legacy_workspace.router is workspace.router
    assert legacy_config.router is settings.router
    assert legacy_environment.router is environment.router
    assert legacy_credentials.router is credentials.router


def test_legacy_facades_preserve_historical_public_symbols() -> None:
    assert legacy_workspace.create_workspace is workspace.create_workspace
    assert legacy_workspace.revoke_vault_access is workspace.revoke_vault_access
    assert legacy_config.get_config is settings.get_config
    assert legacy_config.deep_merge is settings.deep_merge
    assert legacy_environment.ENV_PATH is environment.ENV_PATH
    assert legacy_environment.write_env_file is environment.write_env_file
    assert legacy_credentials.CredentialSet is credentials.CredentialSet
    assert legacy_credentials.CREDENTIAL_KEYS is credentials.CREDENTIAL_KEYS
    assert legacy_credentials.migrate_from_env is credentials.migrate_from_env
