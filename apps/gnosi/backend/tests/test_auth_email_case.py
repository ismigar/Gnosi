"""Email matching in register/login must ignore case.

Addresses are not typed consistently, and the DB unique index does not collapse
case: with an exact-match lookup, `Victim@corp.com` and `victim@corp.com` both
persisted as separate rows and which one a login reached came down to row order.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.api.auth_routes as ar
from backend.data.management_db import Base, get_mgmt_db
from backend.models.management import User

PASSWORD = "corr3ct-horse-battery"


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    app = FastAPI()
    app.include_router(ar.router)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_mgmt_db] = _db
    c = TestClient(app)
    c.session_factory = Session
    return c


def test_register_stores_the_email_lowercased(client):
    r = client.post(
        "/api/auth/register",
        json={"email": "Ismael@Example.COM", "password": PASSWORD},
    )
    assert r.status_code == 201, r.text
    assert r.json()["email"] == "ismael@example.com"


def test_login_accepts_a_different_case(client):
    assert client.post(
        "/api/auth/register", json={"email": "ismael@example.com", "password": PASSWORD}
    ).status_code == 201

    r = client.post(
        "/api/auth/login", json={"email": "ISMAEL@example.com", "password": PASSWORD}
    )
    assert r.status_code == 200, r.text


def test_a_case_variant_cannot_register_a_second_account(client):
    assert client.post(
        "/api/auth/register", json={"email": "ismael@example.com", "password": PASSWORD}
    ).status_code == 201

    r = client.post(
        "/api/auth/register",
        json={"email": "Ismael@Example.com", "password": "another-password-99"},
    )
    assert r.status_code == 409

    s = client.session_factory()
    assert s.query(User).count() == 1
    s.close()
