"""Self-service account endpoints — POST /change-password and PATCH /me.

These are the session-side counterpart of `set_user_password.py`: they only
operate on the caller's own account, and both sensitive changes (email and
password) demand the CURRENT password, so neither a hijacked session nor a
spoofed identity header can move the account. Accounts without a password are
refused outright — handing out first credentials over HTTP is the takeover
hole documented in auth_routes.py.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from backend.data.management_db import get_mgmt_db
from backend.models.management import Membership, User
from backend.services.auth_service import COOKIE_NAME, create_access_token

PASSWORD = "pytest-secret-1"
NEW_PASSWORD = "pytest-secret-2"


@pytest.fixture
def client():
    from backend.server import app

    return TestClient(app, raise_server_exceptions=False)


def _delete_user(user_id: str) -> None:
    db = next(get_mgmt_db())
    try:
        db.query(Membership).filter(Membership.user_id == user_id).delete()
        db.query(User).filter(User.id == user_id).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def account(client):
    """Registers a throwaway user (unique email) and leaves the client logged in."""
    email = f"pytest-account-{uuid.uuid4().hex[:10]}@example.com"
    r = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "name": "pytest-qa"},
    )
    assert r.status_code == 201, r.text
    info = r.json()
    yield {"email": email, "id": info["id"]}
    _delete_user(info["id"])


# --- change-password ---------------------------------------------------------

def test_change_password_needs_a_session(client):
    r = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert r.status_code == 401, r.text


def test_wrong_current_password_is_403_not_401(client, account):
    """403, so the frontend never mistakes it for an expired session."""
    r = client.post(
        "/api/auth/change-password",
        json={"current_password": "not-the-password", "new_password": NEW_PASSWORD},
    )
    assert r.status_code == 403, r.text


def test_too_short_new_password_is_rejected(client, account):
    r = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "short"},
    )
    assert r.status_code == 422, r.text


def test_change_password_roundtrip(client, account):
    r = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert r.status_code == 200, r.text

    client.post("/api/auth/logout")
    old = client.post(
        "/api/auth/login", json={"email": account["email"], "password": PASSWORD}
    )
    assert old.status_code == 401, "the old password must stop working"
    new = client.post(
        "/api/auth/login", json={"email": account["email"], "password": NEW_PASSWORD}
    )
    assert new.status_code == 200, new.text


def test_passwordless_account_cannot_set_first_password_here(client):
    """The guard that keeps this endpoint from becoming the takeover hole."""
    db = next(get_mgmt_db())
    try:
        ghost = User(email=f"pytest-ghost-{uuid.uuid4().hex[:10]}@example.com")
        db.add(ghost)
        db.commit()
        db.refresh(ghost)
        ghost_id = ghost.id
    finally:
        db.close()
    try:
        client.cookies.set(COOKIE_NAME, create_access_token(ghost_id))
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": "anything", "new_password": NEW_PASSWORD},
        )
        assert r.status_code == 403, r.text
    finally:
        _delete_user(ghost_id)


# --- PATCH /me ---------------------------------------------------------------

def test_patch_me_needs_a_session(client):
    r = client.patch("/api/auth/me", json={"name": "Nobody"})
    assert r.status_code == 401, r.text


def test_patch_me_updates_name_without_password(client, account):
    r = client.patch("/api/auth/me", json={"name": "pytest renamed"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "pytest renamed"


def test_patch_me_email_requires_current_password(client, account):
    wanted = f"pytest-moved-{uuid.uuid4().hex[:10]}@example.com"

    r = client.patch("/api/auth/me", json={"email": wanted})
    assert r.status_code == 403, r.text
    r = client.patch(
        "/api/auth/me", json={"email": wanted, "current_password": "not-the-password"}
    )
    assert r.status_code == 403, r.text

    r = client.patch(
        "/api/auth/me", json={"email": wanted, "current_password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    assert r.json()["email"] == wanted

    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"email": wanted, "password": PASSWORD})
    assert r.status_code == 200, "the new email is the login identifier"


def test_patch_me_email_conflict_is_409(client, account):
    other_email = f"pytest-other-{uuid.uuid4().hex[:10]}@example.com"
    other_client = TestClient(client.app, raise_server_exceptions=False)
    r = other_client.post(
        "/api/auth/register", json={"email": other_email, "password": PASSWORD}
    )
    assert r.status_code == 201, r.text
    other_id = r.json()["id"]
    try:
        r = client.patch(
            "/api/auth/me",
            json={"email": other_email, "current_password": PASSWORD},
        )
        assert r.status_code == 409, r.text
    finally:
        _delete_user(other_id)
