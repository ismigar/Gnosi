"""Workspace role wiring checked without application data or external services."""

from __future__ import annotations

import inspect
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ROLES = ("owner", "admin", "editor", "viewer", "OWNER", "AdMiN", "EDITOR", "VIEWER", "", "unknown")
WEIGHTS = {"owner": 3, "admin": 2, "editor": 1, "viewer": 0}


def test_table_security_in_isolated_subprocess() -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-table-security-") as temporary:
        root = Path(temporary).resolve()
        for name in ("data", "vault", "host"):
            (root / name).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_REQUIRE_AUTH": "1",
            "GNOSI_JWT_SECRET": "synthetic-table-security-contract-not-a-real-key",
            "GNOSI_TABLE_SECURITY_CONTRACT_CHILD": "1",
        }
        result = subprocess.run(
            [
                sys.executable, "-m", "pytest", "-q", "--tb=short",
                "-p", "no:cacheprovider", "--basetemp", str(root / "tests"),
                "-o", "python_functions=check_*", "--maxfail=1",
                "backend/tests/test_table_workspace_security_contract.py",
            ],
            cwd=ROOT, env=environment, capture_output=True, text=True,
            timeout=120, check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


@pytest.fixture(scope="session", autouse=True)
def isolated_backend() -> Iterator[None]:
    # Collection in the parent must not import any backend module.
    if os.environ.get("GNOSI_TABLE_SECURITY_CONTRACT_CHILD") != "1":
        yield
        return
    import socket
    import urllib.request

    import dotenv
    import dotenv.main
    import keyring
    import requests
    from sqlalchemy.engine import Engine

    root = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    assert root.is_absolute() and root.is_dir()
    assert "backend.services.workspace_service" not in sys.modules
    for variable, name in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        assert Path(os.environ[variable]) == root / name
    assert os.environ["GNOSI_DISABLE_SCHEDULER"] == "1"
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"
    assert not {"GNOSI_SHARED_ENV_FILE", "GNOSI_API_TOKEN", "OPENAI_API_KEY"} & os.environ.keys()

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("External I/O is forbidden in table security contracts")

    with pytest.MonkeyPatch.context() as guard:
        guard.setattr(requests.sessions.Session, "request", forbidden)
        guard.setattr(urllib.request, "urlopen", forbidden)
        guard.setattr(socket, "create_connection", forbidden)
        guard.setattr(socket.socket, "connect", forbidden)
        guard.setattr(subprocess, "Popen", forbidden)
        guard.setattr(Engine, "connect", forbidden)
        for owner in (dotenv, dotenv.main):
            guard.setattr(owner, "load_dotenv", forbidden)
            guard.setattr(owner, "dotenv_values", forbidden)
        for name in ("get_keyring", "get_password", "get_credential", "set_password", "delete_password"):
            guard.setattr(keyring, name, forbidden)
        from backend.config.validation_runtime import validation_runtime_enabled

        assert validation_runtime_enabled()
        yield
        from backend.data import management_db

        assert management_db._engine is None


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("minimum", ROLES)
@pytest.mark.parametrize("role_keyword", [False, True])
def check_role_matrix_preserves_context_and_denials(
    role: str, minimum: str, role_keyword: bool, tmp_path: Path,
) -> None:
    from fastapi import HTTPException

    from backend.domains.vault.tables import security
    from backend.services.workspace_service import WorkspaceContext

    context = WorkspaceContext("synthetic-workspace", "synthetic-user", role, tmp_path)
    checker = security.require_role(role=minimum) if role_keyword else security.require_role(minimum)
    allowed = WEIGHTS.get(role.lower(), 0) >= WEIGHTS.get(minimum.lower(), 0)
    if allowed:
        assert checker(context) is context
    else:
        with pytest.raises(HTTPException) as denied:
            checker(context)
        assert denied.value.status_code == 403
        assert denied.value.detail == (
            f"Insufficient permission. Role {minimum} is required (you have {role})"
        )
        assert denied.value.headers is None
    assert vars(context) == {
        "workspace_id": "synthetic-workspace", "user_id": "synthetic-user",
        "role": role, "vault_path": tmp_path, "capabilities": ["read"],
    }


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("minimum", ROLES)
def check_role_matrix_through_fastapi(role: str, minimum: str, tmp_path: Path) -> None:
    # FastAPI calls the real role_checker with context=, exercising its named
    # argument contract without pretending positional Callable retains names.
    from fastapi import Depends, FastAPI
    from fastapi.routing import APIRoute
    from fastapi.testclient import TestClient

    from backend.domains.vault.tables import security
    from backend.services import workspace_service

    context = workspace_service.WorkspaceContext("ws", "user", role, tmp_path)
    checker = security.require_role(minimum)
    app = FastAPI()
    calls: list[str] = []

    def provide_context() -> workspace_service.WorkspaceContext:
        calls.append("context")
        return context

    def endpoint() -> dict[str, str]:
        calls.append("endpoint")
        return {"status": "allowed"}

    app.add_api_route("/role", endpoint, dependencies=[Depends(checker)])
    route = next(route for route in app.routes if isinstance(route, APIRoute))
    dependency = route.dependant.dependencies[0]
    assert dependency.call is checker
    assert dependency.dependencies[0].call is security.get_workspace_context
    assert security.get_workspace_context is workspace_service.get_workspace_context
    app.dependency_overrides[security.get_workspace_context] = provide_context
    with TestClient(app) as client:
        response = client.get("/role")
    if WEIGHTS.get(role.lower(), 0) >= WEIGHTS.get(minimum.lower(), 0):
        assert response.status_code == 200
        assert response.json() == {"status": "allowed"}
        assert calls == ["context", "endpoint"]
    else:
        assert response.status_code == 403
        assert response.json() == {
            "detail": f"Insufficient permission. Role {minimum} is required (you have {role})",
        }
        assert calls == ["context"]


def check_context_capture_and_checker_defaults(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from fastapi.params import Depends

    from backend.domains.vault.tables import security
    from backend.services import workspace_service

    original = workspace_service.get_workspace_context
    assert security.get_workspace_context is original
    before = security.require_role("editor")

    def replacement() -> workspace_service.WorkspaceContext:
        return workspace_service.WorkspaceContext("ws", "user", "editor", tmp_path)

    monkeypatch.setattr(workspace_service, "get_workspace_context", replacement)
    after = security.require_role("editor")
    assert security.get_workspace_context is original
    for checker, expected in ((before, original), (after, replacement)):
        parameter = inspect.signature(checker).parameters["context"]
        assert parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
        assert isinstance(parameter.default, Depends)
        assert parameter.default.dependency is expected
        assert parameter.default.use_cache is True
        assert checker.__module__ == workspace_service.__name__
        assert checker.__qualname__ == "require_role.<locals>.role_checker"


def check_factory_is_resolved_late_and_forwards_positionally(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    from collections.abc import Callable

    from backend.domains.vault.tables import security
    from backend.services import workspace_service

    calls: list[str] = []

    def sentinel(context: workspace_service.WorkspaceContext) -> workspace_service.WorkspaceContext:
        return context

    def factory(min_role: str, /) -> Callable[
        [workspace_service.WorkspaceContext], workspace_service.WorkspaceContext
    ]:
        calls.append(min_role)
        return sentinel

    monkeypatch.setattr(workspace_service, "require_role", factory)
    assert security.require_role("editor") is sentinel
    assert security.require_role(role="admin") is sentinel
    assert calls == ["editor", "admin"]
    context = workspace_service.WorkspaceContext("ws", "user", "owner", tmp_path)
    assert security.require_role("viewer")(context) is context
    failure = RuntimeError("synthetic factory failure")

    def failing_factory(min_role: str) -> Callable[
        [workspace_service.WorkspaceContext], workspace_service.WorkspaceContext
    ]:
        raise failure

    monkeypatch.setattr(workspace_service, "require_role", failing_factory)
    with pytest.raises(RuntimeError) as caught:
        security.require_role("owner")
    assert caught.value is failure


def check_callback_exceptions_and_identity_are_not_wrapped(monkeypatch: pytest.MonkeyPatch) -> None:
    from collections.abc import Callable

    from fastapi import HTTPException

    from backend.domains.vault.tables import security
    from backend.services import workspace_service

    failure = HTTPException(status_code=401, detail="synthetic denial", headers={"X-Probe": "denied"})

    def reject(context: workspace_service.WorkspaceContext) -> workspace_service.WorkspaceContext:
        raise failure

    def factory(min_role: str) -> Callable[
        [workspace_service.WorkspaceContext], workspace_service.WorkspaceContext
    ]:
        return reject

    monkeypatch.setattr(workspace_service, "require_role", factory)
    checker = security.require_role("owner")
    assert checker is reject
    context = workspace_service.WorkspaceContext("ws", "user", "owner", Path("synthetic-vault"))
    with pytest.raises(HTTPException) as caught:
        checker(context)
    assert caught.value is failure


def check_public_keyword_contract_is_not_the_owner_keyword_contract() -> None:
    from backend.domains.vault.tables import security
    from backend.services import workspace_service

    signature = inspect.signature(security.require_role)
    assert list(signature.parameters) == ["role"]
    assert signature.parameters["role"].kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
    assert list(inspect.signature(workspace_service.require_role).parameters) == ["min_role"]
    with pytest.raises(TypeError, match="min_role"):
        security.require_role(**{"min_role": "editor"})
    assert security.__all__ == ["get_workspace_context", "require_role"]


def check_table_routes_use_the_canonical_context_and_role_dependencies(tmp_path: Path) -> None:
    from fastapi import HTTPException
    from fastapi.routing import APIRoute

    from backend.domains.vault.tables import routes, security
    from backend.services.workspace_service import WorkspaceContext

    protected = 0
    for route in routes.router.routes:
        assert isinstance(route, APIRoute)
        assert route.dependant.dependencies[0].call is security.get_workspace_context
        for dependency in route.dependant.dependencies[1:]:
            checker = dependency.call
            assert checker is not None
            assert dependency.dependencies[0].call is security.get_workspace_context
            assert checker(WorkspaceContext("ws", "user", "owner", tmp_path)).role == "owner"
            with pytest.raises(HTTPException) as denied:
                checker(WorkspaceContext("ws", "user", "viewer", tmp_path))
            minimum = "admin" if route.endpoint.__name__ in {"delete_database", "delete_table"} else "editor"
            assert denied.value.status_code == 403
            assert denied.value.detail == (
                f"Insufficient permission. Role {minimum} is required (you have viewer)"
            )
            protected += 1
    assert protected == 15
