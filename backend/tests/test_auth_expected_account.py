"""A stale tab can restrict its authenticated identity but cannot choose one."""

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.services import auth_public_surface as surface


@pytest.mark.parametrize("enforced", [False, True])
@pytest.mark.parametrize("actual", ["account-a", "account-b", None])
def test_expected_account_prevents_mutations_after_cookie_switch(
    monkeypatch: pytest.MonkeyPatch, enforced: bool, actual: str | None
) -> None:
    async def policy() -> bool:
        return enforced

    monkeypatch.setattr(surface, "_request_requires_auth", policy)
    monkeypatch.setattr(surface, "resolve_identity", lambda conn: actual)
    app = FastAPI(dependencies=[Depends(surface.enforce_authentication)])
    mutations: list[str] = []

    @app.patch("/api/synthetic-note")
    def save() -> dict[str, bool]:
        mutations.append("saved")
        return {"saved": True}

    with TestClient(app) as client:
        result = client.patch(
            "/api/synthetic-note", headers={"X-Gnosi-Expected-User-ID": "account-a"}
        )
    if actual == "account-a":
        assert result.status_code == 200
        assert mutations == ["saved"]
    else:
        assert result.status_code == (409 if actual else 401)
        assert mutations == []
        if actual:
            assert result.json()["detail"] == {"code": "account_changed"}
