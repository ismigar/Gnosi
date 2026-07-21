"""The app-wide gate covers the routes per-route gating misses.

Enforcement lives in a single `dependencies=[Depends(enforce_authentication)]`
on the FastAPI app rather than on each router. That choice came from measuring:
**50** routes — schedulers, tools, AI settings, integrations, system — never
touch `get_workspace_context`, so gating through it would have left every one of
them open, plus every endpoint added later.

These tests exercise a sample of exactly those routes, so a regression that
removes the app-wide dependency fails here rather than silently reopening them.
"""
import pytest
from fastapi.testclient import TestClient

from backend.services.auth_service import REQUIRE_AUTH_ENV

# Routes that have NO auth dependency of their own — before the central gate
# these answered an unauthenticated caller.
PREVIOUSLY_OPEN = [
    ("GET", "/api/ai/models"),
    ("GET", "/api/ai/catalog"),
    ("GET", "/api/analytics/"),
    ("GET", "/api/analytics/directives"),
]


@pytest.fixture
def client():
    from backend.server import app

    return TestClient(app, raise_server_exceptions=False)


def test_the_app_wide_dependency_is_installed():
    """If someone drops this, every route below silently reopens."""
    from backend.server import app
    from backend.services.auth_public_surface import enforce_authentication

    # `Depends` exposes the callable as `.dependency` (not `.call`, which is
    # what the resolved `Dependant` uses).
    installed = {
        getattr(d.dependency, "__name__", "") for d in (app.router.dependencies or [])
    }
    assert enforce_authentication.__name__ in installed, installed


@pytest.mark.parametrize("method,path", PREVIOUSLY_OPEN)
def test_on_previously_open_routes_are_gated(client, monkeypatch, method, path):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    r = client.request(method, path)
    assert r.status_code == 401, f"{method} {path} -> {r.status_code}"


@pytest.mark.parametrize("method,path", PREVIOUSLY_OPEN)
def test_off_they_behave_exactly_as_before(client, monkeypatch, method, path):
    """Merging this must not change any behaviour while the flag is off.

    Asserting only `!= 401` would let a 500 through, which is how a broken gate
    stayed green earlier in this branch's history.
    """
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    r = client.request(method, path)
    assert r.status_code < 500, f"{method} {path} -> {r.status_code}: {r.text[:200]}"
    assert r.status_code != 401, f"{method} {path} -> {r.status_code}"
