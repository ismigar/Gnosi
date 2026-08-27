"""Inviting a member must resolve the same account auth would.

Auth looks users up case-insensitively and stores addresses lowercased. If the
invite path matched exactly, inviting `Ismael@X.com` while `ismael@x.com` exists
would create a SECOND, password-less row: the membership would hang off the
duplicate while the real user keeps logging into the original, and the duplicate
— a password-less account with a known address — is exactly the kind of account
the placeholder guard exists to keep unclaimable.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.domains.workspace.api import routes as wr
from backend.data.management_db import Base, get_mgmt_db
from backend.models.management import Membership, User, Workspace
from backend.services.workspace_service import WorkspaceContext, get_workspace_context

WS_ID = "ws-test"


@pytest.fixture
def client(tmp_path):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    s.add(Workspace(id=WS_ID, name="Test WS"))
    s.add(User(id="admin", email="admin@corp.com", password_hash="x"))
    s.add(Membership(user_id="admin", workspace_id=WS_ID, role="owner"))
    # The member already exists, stored lowercased the way register() writes it.
    s.add(User(id="member", email="ismael@corp.com", password_hash="x"))
    s.commit()
    s.close()

    app = FastAPI()
    app.include_router(wr.router)

    def _db():
        x = Session()
        try:
            yield x
        finally:
            x.close()

    app.dependency_overrides[get_mgmt_db] = _db
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext(
        workspace_id=WS_ID, user_id="admin", role="owner", vault_path=tmp_path
    )
    c = TestClient(app)
    c.session_factory = Session
    return c


def _invite(client, email, role="editor"):
    return client.post(
        f"/api/workspaces/{WS_ID}/members", json={"email": email, "role": role}
    )


def test_inviting_a_case_variant_reuses_the_existing_account(client):
    r = _invite(client, "Ismael@Corp.com")
    assert r.status_code < 400, r.text

    s = client.session_factory()
    # No duplicate row, and the membership landed on the real account.
    assert s.query(User).filter(User.email.ilike("ismael@corp.com")).count() == 1
    assert (
        s.query(Membership)
        .filter(Membership.workspace_id == WS_ID, Membership.user_id == "member")
        .count()
        == 1
    )
    s.close()


def test_a_new_invitee_is_stored_lowercased(client):
    r = _invite(client, "  Newbie@Corp.COM  ")
    assert r.status_code < 400, r.text

    s = client.session_factory()
    created = s.query(User).filter(User.id.notin_(["admin", "member"])).one()
    assert created.email == "newbie@corp.com"
    s.close()
