"""Typed HTTP and OpenAPI contracts for the password/session auth routes."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import auth_routes
from backend.data.management_db import Base, get_mgmt_db

PASSWORD = "contract-password-1"
EMAIL = "typed-auth@corp.com"


def _routes() -> dict[str, APIRoute]:
    return {
        route.endpoint.__name__: route
        for route in auth_routes.router.routes
        if isinstance(route, APIRoute)
    }


@pytest.fixture
def client() -> Iterator[TestClient]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    app = FastAPI()
    app.include_router(auth_routes.router)

    def _db() -> Iterator[Session]:
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_mgmt_db] = _db
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()


def test_auth_routes_publish_exact_response_models() -> None:
    routes = _routes()
    expected: dict[str, tuple[str, set[str], int | None, object]] = {
        "register": (
            "/api/auth/register",
            {"POST"},
            201,
            auth_routes.UserInfo,
        ),
        "login": ("/api/auth/login", {"POST"}, None, auth_routes.UserInfo),
        "logout": (
            "/api/auth/logout",
            {"POST"},
            None,
            auth_routes.AuthOperationResponse,
        ),
        "me": ("/api/auth/me", {"GET"}, None, auth_routes.UserInfo),
        "change_password": (
            "/api/auth/change-password",
            {"POST"},
            None,
            auth_routes.AuthOperationResponse,
        ),
        "update_me": ("/api/auth/me", {"PATCH"}, None, auth_routes.UserInfo),
    }

    for handler_name, (path, methods, status_code, response_model) in expected.items():
        route = routes[handler_name]
        assert route.path == path
        assert route.methods == methods
        assert route.status_code == status_code
        assert route.response_model is response_model


def test_auth_focused_openapi_has_precise_success_schemas() -> None:
    app = FastAPI()
    app.include_router(auth_routes.router)
    schema = app.openapi()

    paths = schema["paths"]
    expected = {
        ("/api/auth/register", "post", "201"): "UserInfo",
        ("/api/auth/login", "post", "200"): "UserInfo",
        ("/api/auth/logout", "post", "200"): "AuthOperationResponse",
        ("/api/auth/me", "get", "200"): "UserInfo",
        ("/api/auth/change-password", "post", "200"): "AuthOperationResponse",
        ("/api/auth/me", "patch", "200"): "UserInfo",
    }
    for (path, method, status), model_name in expected.items():
        success_schema = paths[path][method]["responses"][status]["content"]["application/json"][
            "schema"
        ]
        assert success_schema == {"$ref": f"#/components/schemas/{model_name}"}

    components = schema["components"]["schemas"]
    assert components["AuthOperationResponse"]["properties"]["ok"] == {
        "const": True,
        "title": "Ok",
        "type": "boolean",
    }
    assert components["UserInfo"]["properties"]["workspaces"]["items"] == {
        "$ref": "#/components/schemas/AuthWorkspaceInfo"
    }


def test_auth_http_keeps_payloads_and_session_cookie(client: TestClient) -> None:
    register = client.post(
        "/api/auth/register",
        json={"email": EMAIL, "password": PASSWORD, "name": "Typed Auth"},
    )
    assert register.status_code == 201
    assert register.json() == {
        "id": register.json()["id"],
        "email": EMAIL,
        "name": "Typed Auth",
        "avatar_url": None,
        "workspaces": [],
    }
    register_cookie = register.headers["set-cookie"]
    assert "gnosi_session=" in register_cookie
    assert "HttpOnly" in register_cookie
    assert "Path=/" in register_cookie
    assert "SameSite=lax" in register_cookie

    current = client.get("/api/auth/me")
    assert current.status_code == 200
    assert current.json() == register.json()
    assert "set-cookie" not in current.headers

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    assert logout.json() == {"ok": True}
    logout_cookie = logout.headers["set-cookie"]
    assert 'gnosi_session=""' in logout_cookie
    assert "Max-Age=0" in logout_cookie
    assert "Path=/" in logout_cookie
    assert "SameSite=lax" in logout_cookie

    logged_out = client.get("/api/auth/me")
    assert logged_out.status_code == 401
    assert logged_out.json() == {"detail": "Not authenticated"}

    login = client.post(
        "/api/auth/login",
        json={"email": EMAIL.upper(), "password": PASSWORD},
    )
    assert login.status_code == 200
    assert login.json() == register.json()
    assert "gnosi_session=" in login.headers["set-cookie"]
