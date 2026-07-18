"""`pipeline/scripts/set_user_password.py` — local bootstrap of an account's
first credentials.

The account this migrates (`ismael-legacy`) owns the workspace, the vaults and
the API tokens, all keyed by its `id`, so the one thing these tests guard above
all is that the id survives.

They also pin the reason this is a script and not an endpoint: the review that
preceded it found that resolving the account from the request context let an
unauthenticated caller install their own password on any password-less account,
because `get_workspace_context` trusts the `X-User-ID` header. `test_no_http_
endpoint_grants_first_credentials` fails if such an endpoint ever comes back.
"""
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.data.management_db import Base
from backend.models.management import Membership, User, Workspace
from backend.services.auth_service import verify_password

LEGACY_ID = "ismael-legacy"
GOOD_PASSWORD = "corr3ct-horse-battery"

_SCRIPT = (
    Path(__file__).resolve().parents[2] / "pipeline" / "scripts" / "set_user_password.py"
)


@pytest.fixture
def script():
    spec = importlib.util.spec_from_file_location("set_user_password", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    s.add(User(id=LEGACY_ID, email="user@example.com", name="User", password_hash=None))
    s.add(Workspace(id="personal", name="Personal Workspace"))
    s.add(Membership(user_id=LEGACY_ID, workspace_id="personal", role="owner"))
    s.commit()
    return s


def _answer(monkeypatch, script, password: str, confirm: str | None = None):
    """Feed the interactive getpass prompts."""
    answers = iter([password, confirm if confirm is not None else password])
    monkeypatch.setattr(script.getpass, "getpass", lambda *_a, **_k: next(answers))


# --- the migration itself ----------------------------------------------------

def test_sets_credentials_and_keeps_the_user_id(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    rc = script.set_password(db, LEGACY_ID, "real@example.com", None, force=False)
    assert rc == 0

    user = db.query(User).filter(User.id == LEGACY_ID).one()
    # The id is what memberships, vaults and PATs hang off — it must not change.
    assert user.id == LEGACY_ID
    assert user.email == "real@example.com"
    assert verify_password(GOOD_PASSWORD, user.password_hash)
    assert db.query(Membership).filter(Membership.user_id == LEGACY_ID).count() == 1


def test_normalizes_the_email_to_lowercase(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "  Real@Example.COM  ", None, force=False) == 0
    assert db.query(User).filter(User.id == LEGACY_ID).one().email == "real@example.com"


# --- guards ------------------------------------------------------------------

def test_refuses_when_a_password_already_exists(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "real@example.com", None, force=False) == 0

    _answer(monkeypatch, script, "a-different-password")
    assert script.set_password(db, LEGACY_ID, None, None, force=False) == 1
    # Untouched by the refused run.
    assert verify_password(GOOD_PASSWORD, db.query(User).filter(User.id == LEGACY_ID).one().password_hash)


def test_force_replaces_an_existing_password(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "real@example.com", None, force=False) == 0

    _answer(monkeypatch, script, "a-different-password")
    assert script.set_password(db, LEGACY_ID, None, None, force=True) == 0
    assert verify_password("a-different-password", db.query(User).filter(User.id == LEGACY_ID).one().password_hash)


def test_rejects_an_email_owned_by_another_user_ignoring_case(script, db, monkeypatch):
    db.add(User(id="someone-else", email="taken@example.com", password_hash="x"))
    db.commit()

    _answer(monkeypatch, script, GOOD_PASSWORD)
    # Different case must still collide: the DB unique index would not catch it.
    assert script.set_password(db, LEGACY_ID, "Taken@Example.com", None, force=False) == 1
    assert db.query(User).filter(User.id == LEGACY_ID).one().password_hash is None


def test_unknown_user_id_is_an_error(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, "ghost", None, None, force=False) == 1


def test_mismatched_confirmation_changes_nothing(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD, confirm="something-else")
    with pytest.raises(SystemExit):
        script.set_password(db, LEGACY_ID, "real@example.com", None, force=False)
    assert db.query(User).filter(User.id == LEGACY_ID).one().password_hash is None


@pytest.mark.parametrize("password", ["short", "1234567"])
def test_rejects_a_weak_password(script, db, monkeypatch, password):
    _answer(monkeypatch, script, password)
    with pytest.raises(SystemExit):
        script.set_password(db, LEGACY_ID, None, None, force=False)
    assert db.query(User).filter(User.id == LEGACY_ID).one().password_hash is None


def test_rejects_a_password_over_the_bcrypt_byte_limit(script, db, monkeypatch):
    # 40 accented characters = 80 UTF-8 bytes: over the limit while looking short.
    _answer(monkeypatch, script, "à" * 40)
    with pytest.raises(SystemExit):
        script.set_password(db, LEGACY_ID, None, None, force=False)
    assert db.query(User).filter(User.id == LEGACY_ID).one().password_hash is None


# --- the hole this script exists to avoid ------------------------------------

def test_no_http_endpoint_grants_first_credentials():
    """No route may set a password on an account resolved from the request.

    `get_workspace_context` derives the user from the client-controlled
    `X-User-ID` header, so such a route is an unauthenticated account takeover of
    every password-less account. Claiming by email via `/register` is fine (the
    caller must know the address); handing out credentials for whoever the
    context says you are is not.
    """
    import backend.api.auth_routes as ar

    routes = {getattr(r, "path", "") for r in ar.router.routes}
    assert "/api/auth/bootstrap-credentials" not in routes
    assert not any("bootstrap" in p or "set-password" in p for p in routes), routes
