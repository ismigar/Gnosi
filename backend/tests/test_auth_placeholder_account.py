"""The auto-provisioned account must not be claimable over HTTP.

`_ensure_personal_exists` gives every fresh install a user whose email is the
same hardcoded placeholder, published in this repo. That account owns the
workspace, the vaults and the API tokens, so if `/register`'s claim flow accepts
it, anyone who can reach the API owns the install — no guessing required.

The invited-user claim flow must keep working: there, knowing the address is a
deliberate (if weak) signal, because an admin entered it on purpose.
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
from backend.services.auth_service import PLACEHOLDER_EMAIL, verify_password

ATTACKER_PW = "attacker-password-123"


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    # A stock, unmigrated install.
    s.add(User(id="ismael-legacy", email=PLACEHOLDER_EMAIL, name="User", password_hash=None))
    s.add(Workspace(id="personal", name="Personal Workspace"))
    s.add(Membership(user_id="ismael-legacy", workspace_id="personal", role="owner"))
    # An invited colleague: real address, no password yet.
    s.add(User(id="invited", email="colleague@corp.com", name="Colleague", password_hash=None))
    s.commit()
    s.close()

    app = FastAPI()
    app.include_router(ar.router)

    def _db():
        x = Session()
        try:
            yield x
        finally:
            x.close()

    app.dependency_overrides[get_mgmt_db] = _db
    c = TestClient(app)
    c.session_factory = Session
    return c


def test_register_cannot_claim_the_placeholder_account(client):
    r = client.post(
        "/api/auth/register",
        json={"email": PLACEHOLDER_EMAIL, "password": ATTACKER_PW},
    )
    assert r.status_code == 403, r.text
    assert ar.COOKIE_NAME not in r.cookies

    s = client.session_factory()
    user = s.query(User).filter(User.id == "ismael-legacy").one()
    assert user.password_hash is None
    assert user.email == PLACEHOLDER_EMAIL
    s.close()


def test_the_case_variant_cannot_claim_it_either(client):
    r = client.post(
        "/api/auth/register",
        json={"email": "User@Example.COM", "password": ATTACKER_PW},
    )
    assert r.status_code == 403, r.text

    s = client.session_factory()
    assert s.query(User).filter(User.id == "ismael-legacy").one().password_hash is None
    s.close()


def test_an_invited_user_can_still_claim_their_account(client):
    """The legitimate flow this guard must not break."""
    r = client.post(
        "/api/auth/register",
        json={"email": "colleague@corp.com", "password": "colleague-password-1"},
    )
    assert r.status_code == 201, r.text
    # Same row, so any membership created by the invite is inherited.
    assert r.json()["id"] == "invited"

    s = client.session_factory()
    assert verify_password(
        "colleague-password-1",
        s.query(User).filter(User.id == "invited").one().password_hash,
    )
    s.close()
