"""`POST /api/auth/bootstrap-credentials` — first-time credentials for a
password-less account.

Covers the migration this endpoint exists for: an install whose only user is the
pre-auth legacy account, which owns the workspace, vaults and PATs but cannot
log in. The account must keep its `id` (everything is keyed by it) while getting
a real email, and the endpoint must close itself afterwards so it can never be
used to take over an account or reset a forgotten password.

Exercises the real routing with an in-memory management DB and
`get_workspace_context` overridden to resolve to the legacy user.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.api.auth_routes as ar
from backend.data.management_db import Base, get_mgmt_db
from backend.models.management import Membership, User, Workspace
from backend.services.auth_service import verify_password
from backend.services.workspace_service import WorkspaceContext, get_workspace_context

LEGACY_ID = "ismael-legacy"
WS_ID = "personal"
GOOD_PASSWORD = "corr3ct-horse-battery"


@pytest.fixture
def session_factory(tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    # The legacy account as it exists on a real install: placeholder email,
    # no password, owner of the personal workspace.
    s.add(User(id=LEGACY_ID, email="user@example.com", name="User", password_hash=None))
    s.add(Workspace(id=WS_ID, name="Personal Workspace"))
    s.add(Membership(user_id=LEGACY_ID, workspace_id=WS_ID, role="owner"))
    s.commit()
    s.close()
    return Session


def _client(session_factory, user_id: str = LEGACY_ID, tmp_path=None) -> TestClient:
    app = FastAPI()
    app.include_router(ar.router)

    def _override_db():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    def _override_ctx():
        return WorkspaceContext(
            workspace_id=WS_ID,
            user_id=user_id,
            role="owner",
            vault_path=tmp_path,
        )

    app.dependency_overrides[get_mgmt_db] = _override_db
    app.dependency_overrides[get_workspace_context] = _override_ctx
    return TestClient(app)


def _bootstrap(client: TestClient, email: str = "real@example.com", password: str = GOOD_PASSWORD):
    return client.post(
        "/api/auth/bootstrap-credentials",
        json={"email": email, "password": password, "name": "Ismael"},
    )


# --- the happy path: the account is claimed without losing its identity ------

def test_sets_credentials_and_keeps_the_user_id(session_factory, tmp_path):
    client = _client(session_factory, tmp_path=tmp_path)
    r = _bootstrap(client)
    assert r.status_code == 200, r.text

    body = r.json()
    # The id is what memberships, vaults and PATs are keyed by — it must survive.
    assert body["id"] == LEGACY_ID
    assert body["email"] == "real@example.com"

    s = session_factory()
    user = s.query(User).filter(User.id == LEGACY_ID).one()
    assert user.email == "real@example.com"
    assert user.password_hash and verify_password(GOOD_PASSWORD, user.password_hash)
    # The membership is untouched, so the workspace is still reachable.
    assert s.query(Membership).filter(Membership.user_id == LEGACY_ID).count() == 1
    s.close()


def test_issues_a_session_cookie(session_factory, tmp_path):
    client = _client(session_factory, tmp_path=tmp_path)
    r = _bootstrap(client)
    assert r.status_code == 200
    assert ar.COOKIE_NAME in r.cookies


def test_login_works_after_bootstrap(session_factory, tmp_path):
    client = _client(session_factory, tmp_path=tmp_path)
    assert _bootstrap(client).status_code == 200

    r = client.post(
        "/api/auth/login",
        json={"email": "real@example.com", "password": GOOD_PASSWORD},
    )
    assert r.status_code == 200, r.text
    assert r.json()["id"] == LEGACY_ID


# --- the endpoint must close itself -----------------------------------------

def test_refuses_once_a_password_exists(session_factory, tmp_path):
    """Second call must fail: this is not a password reset and not a takeover."""
    client = _client(session_factory, tmp_path=tmp_path)
    assert _bootstrap(client).status_code == 200

    r = _bootstrap(client, email="attacker@example.com", password="another-password")
    assert r.status_code == 409

    s = session_factory()
    user = s.query(User).filter(User.id == LEGACY_ID).one()
    # Neither the email nor the password was changed by the refused call.
    assert user.email == "real@example.com"
    assert verify_password(GOOD_PASSWORD, user.password_hash)
    s.close()


def test_rejects_an_email_owned_by_another_user(session_factory, tmp_path):
    s = session_factory()
    s.add(User(id="someone-else", email="taken@example.com", password_hash="x"))
    s.commit()
    s.close()

    client = _client(session_factory, tmp_path=tmp_path)
    r = _bootstrap(client, email="taken@example.com")
    assert r.status_code == 409

    s = session_factory()
    assert s.query(User).filter(User.id == LEGACY_ID).one().password_hash is None
    s.close()


def test_404_when_the_context_user_does_not_exist(session_factory, tmp_path):
    client = _client(session_factory, user_id="ghost", tmp_path=tmp_path)
    assert _bootstrap(client).status_code == 404


@pytest.mark.parametrize("password", ["short", "", "1234567"])
def test_rejects_a_weak_password(session_factory, tmp_path, password):
    client = _client(session_factory, tmp_path=tmp_path)
    r = _bootstrap(client, password=password)
    assert r.status_code == 422
