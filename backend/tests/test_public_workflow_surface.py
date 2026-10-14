import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.services import active_vault_middleware as vault_middleware
from backend.services.auth_public_surface import is_public_endpoint
from backend.services.context_vars import active_vault_path
from backend.services.public_workflow_headers import PublicWorkflowHeadersMiddleware


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/forms/public/token"), ("POST", "/api/forms/public/token/submissions"),
    ("GET", "/api/booking/public/token"), ("GET", "/api/booking/public/token/slots"),
    ("POST", "/api/booking/public/token/reservations"),
])
def test_only_deliberate_methods_are_public(method, path):
    assert is_public_endpoint(method, path)
    assert not is_public_endpoint("DELETE", path)
    assert not is_public_endpoint(method, path + "/private")


@pytest.mark.parametrize("path", ["/api/forms", "/api/forms/id", "/api/booking/links", "/api/booking/availability"])
def test_owner_endpoints_remain_private(path):
    assert not any(is_public_endpoint(method, path) for method in ("GET", "POST", "DELETE", "PATCH"))


def test_public_requests_ignore_visitor_vault_and_never_cache_even_errors(monkeypatch):
    app = FastAPI()

    @app.get("/api/forms/public/test")
    async def read_form():
        assert active_vault_path.get() is None
        return {"title": "Synthetic form"}

    async def must_not_lookup(_):
        pytest.fail("public request resolved the visitor vault")

    monkeypatch.setattr(vault_middleware, "_resolve_request_vault_identity", must_not_lookup)
    app.add_middleware(vault_middleware.ActiveVaultMiddleware)
    app.add_middleware(PublicWorkflowHeadersMiddleware)
    with TestClient(app) as client:
        for path, status in [("/api/forms/public/test", 200), ("/api/forms/public/missing", 404)]:
            response = client.get(path + "?vault=other", headers={"X-Vault-ID": "visitor"})
            assert response.status_code == status
            assert response.headers["cache-control"] == "no-store"
            assert response.headers["referrer-policy"] == "no-referrer"
            assert response.headers["x-robots-tag"] == "noindex, nofollow"
