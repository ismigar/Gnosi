"""A Personal Access Token must satisfy enforcement.

This is what makes phase 3 possible: the LibreOffice macro, the Word add-in and
the pipeline scripts cannot hold a session cookie, so a PAT is their only way
through once `GNOSI_REQUIRE_AUTH` is on. Before this, `Authorization: Bearer`
was decoded strictly as a JWT and a PAT was rejected as malformed.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.data.management_db import Base, get_mgmt_db
from backend.models.management import ApiToken, Membership, User, Workspace
from backend.services.auth_service import (
    REQUIRE_AUTH_ENV,
    TOKEN_PREFIX,
    hash_token,
    resolve_pat_user_id,
)

RAW_TOKEN = TOKEN_PREFIX + "test-token-value"
OWNER = "ismael-legacy"


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    S = sessionmaker(bind=engine)
    s = S()
    s.add(User(id=OWNER, email="real@corp.com", password_hash="x"))
    s.add(Workspace(id="personal", name="P"))
    s.add(Membership(user_id=OWNER, workspace_id="personal", role="owner"))
    s.add(ApiToken(
        id="tok-1", user_id=OWNER, workspace_id="personal", name="test",
        token_hash=hash_token(RAW_TOKEN), token_prefix=RAW_TOKEN[:14], revoked=0,
    ))
    s.commit()
    s.close()
    return S


def test_resolves_to_the_owning_user(session_factory):
    s = session_factory()
    assert resolve_pat_user_id(s, RAW_TOKEN) == OWNER
    s.close()


def test_unknown_token_resolves_to_nothing(session_factory):
    s = session_factory()
    assert resolve_pat_user_id(s, TOKEN_PREFIX + "not-a-real-token") is None
    s.close()


def test_revoked_token_resolves_to_nothing(session_factory):
    s = session_factory()
    s.query(ApiToken).filter(ApiToken.id == "tok-1").one().revoked = 1
    s.commit()
    assert resolve_pat_user_id(s, RAW_TOKEN) is None
    s.close()


def test_using_a_token_records_last_used(session_factory):
    s = session_factory()
    assert s.query(ApiToken).one().last_used_at is None
    resolve_pat_user_id(s, RAW_TOKEN)
    assert s.query(ApiToken).one().last_used_at is not None
    s.close()


# --- through the app, with enforcement on ------------------------------------

@pytest.fixture
def client(session_factory):
    from backend.server import app

    def _db():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_mgmt_db] = _db
    # `resolve_identity` opens its own session (so none is opened for cookie or
    # anonymous requests), which `dependency_overrides` cannot reach — patch the
    # factory it actually calls.
    import backend.services.auth_service as auth
    real = auth.get_mgmt_db
    auth.get_mgmt_db = _db
    yield TestClient(app, raise_server_exceptions=False)
    auth.get_mgmt_db = real
    app.dependency_overrides.pop(get_mgmt_db, None)


def test_a_pat_gets_through_the_gate(client, monkeypatch):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    r = client.get("/api/ai/models", headers={"Authorization": f"Bearer {RAW_TOKEN}"})
    assert r.status_code != 401, r.text


def test_a_bad_pat_does_not(client, monkeypatch):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    r = client.get(
        "/api/ai/models",
        headers={"Authorization": f"Bearer {TOKEN_PREFIX}wrong"},
    )
    assert r.status_code == 401, r.text


# --- the collab socket must accept the same credential as HTTP ---------------

def test_a_pat_opens_the_collab_websocket(client, monkeypatch):
    """Checking only the session cookie there would refuse every phase-3 client.

    The macro, the add-in and the pipeline scripts hold a PAT and no cookie. If
    the socket disagreed with the HTTP gate about what counts, the same token
    would work on every route and silently fail here.
    """
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    with client.websocket_connect(
        "/api/vault/collab/p1?user_id=x",
        headers={"Authorization": f"Bearer {RAW_TOKEN}"},
    ) as ws:
        assert ws is not None


def test_an_unauthenticated_collab_websocket_is_refused(client, monkeypatch):
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    # WebSocketDisconnect specifically: any-Exception would also pass on the
    # TypeError this gate raised before it took an HTTPConnection.
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/vault/collab/p1?user_id=attacker"):
            pass


def test_a_db_failure_during_pat_lookup_does_not_500_the_api(client, monkeypatch):
    """The gate runs on every request, so its failures are total.

    A locked or unavailable SQLite file must degrade to "unauthenticated" (401),
    not surface as a 500 across the whole API.
    """
    import backend.services.auth_service as auth

    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    monkeypatch.setattr(
        auth, "resolve_pat_user_id",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("database is locked")),
    )
    r = client.get("/api/ai/models", headers={"Authorization": f"Bearer {RAW_TOKEN}"})
    assert r.status_code == 401, r.text
