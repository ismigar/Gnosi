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
    rc = script.set_password(db, LEGACY_ID, "real@example.com", None, force=False, acknowledged=True)
    assert rc == 0

    user = db.query(User).filter(User.id == LEGACY_ID).one()
    # The id is what memberships, vaults and PATs hang off — it must not change.
    assert user.id == LEGACY_ID
    assert user.email == "real@example.com"
    assert verify_password(GOOD_PASSWORD, user.password_hash)
    assert db.query(Membership).filter(Membership.user_id == LEGACY_ID).count() == 1


def test_normalizes_the_email_to_lowercase(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "  Real@Example.COM  ", None, force=False, acknowledged=True) == 0
    assert db.query(User).filter(User.id == LEGACY_ID).one().email == "real@example.com"


# --- guards ------------------------------------------------------------------

def test_refuses_when_a_password_already_exists(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "real@example.com", None, force=False, acknowledged=True) == 0

    _answer(monkeypatch, script, "a-different-password")
    assert script.set_password(db, LEGACY_ID, None, None, force=False, acknowledged=True) == 1
    # Untouched by the refused run.
    assert verify_password(GOOD_PASSWORD, db.query(User).filter(User.id == LEGACY_ID).one().password_hash)


def test_force_replaces_an_existing_password(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "real@example.com", None, force=False, acknowledged=True) == 0

    _answer(monkeypatch, script, "a-different-password")
    assert script.set_password(db, LEGACY_ID, None, None, force=True, acknowledged=True) == 0
    assert verify_password("a-different-password", db.query(User).filter(User.id == LEGACY_ID).one().password_hash)


def test_rejects_an_email_owned_by_another_user_ignoring_case(script, db, monkeypatch):
    db.add(User(id="someone-else", email="taken@example.com", password_hash="x"))
    db.commit()

    _answer(monkeypatch, script, GOOD_PASSWORD)
    # Different case must still collide: the DB unique index would not catch it.
    assert script.set_password(db, LEGACY_ID, "Taken@Example.com", None, force=False, acknowledged=True) == 1
    assert db.query(User).filter(User.id == LEGACY_ID).one().password_hash is None


def test_unknown_user_id_is_an_error(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, "ghost", None, None, force=False, acknowledged=True) == 1


def test_mismatched_confirmation_changes_nothing(script, db, monkeypatch):
    _answer(monkeypatch, script, GOOD_PASSWORD, confirm="something-else")
    with pytest.raises(SystemExit):
        script.set_password(db, LEGACY_ID, "real@example.com", None, force=False, acknowledged=True)
    assert db.query(User).filter(User.id == LEGACY_ID).one().password_hash is None


@pytest.mark.parametrize("password", ["short", "1234567"])
def test_rejects_a_weak_password(script, db, monkeypatch, password):
    _answer(monkeypatch, script, password)
    with pytest.raises(SystemExit):
        script.set_password(db, LEGACY_ID, "real@example.com", None, force=False, acknowledged=True)
    assert db.query(User).filter(User.id == LEGACY_ID).one().password_hash is None


def test_rejects_a_password_over_the_bcrypt_byte_limit(script, db, monkeypatch):
    # 40 accented characters = 80 UTF-8 bytes: over the limit while looking short.
    _answer(monkeypatch, script, "à" * 40)
    with pytest.raises(SystemExit):
        script.set_password(db, LEGACY_ID, "real@example.com", None, force=False, acknowledged=True)
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


def test_refuses_to_leave_the_placeholder_email_in_place(script, db, monkeypatch):
    """Setting a password without --email would freeze the placeholder address.

    That is the outcome the script exists to prevent, so running it without an
    email on an account still carrying the placeholder must fail loudly.
    """
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, None, None, force=False, acknowledged=True) == 1
    user = db.query(User).filter(User.id == LEGACY_ID).one()
    assert user.password_hash is None
    assert user.email == "user@example.com"


# --- the migration must not be run unknowingly -------------------------------

def test_refuses_without_acknowledging_the_minting_warning(script, db, monkeypatch):
    """Freeing the placeholder address is what enables header-driven minting.

    While `users.email` is UNIQUE and every auto-provisioned user gets the same
    placeholder, an unknown X-User-ID dies on an IntegrityError. Giving this
    account a real address frees that slot, so the next unknown header value
    succeeds in creating an `owner` of the personal workspace. The script must
    not let an operator cross that line without saying so.
    """
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "real@example.com", None, force=False) == 1

    user = db.query(User).filter(User.id == LEGACY_ID).one()
    assert user.password_hash is None
    assert user.email == "user@example.com"


def test_the_warning_does_not_apply_once_the_email_is_real(script, db, monkeypatch):
    """An account already migrated has no placeholder slot to free."""
    _answer(monkeypatch, script, GOOD_PASSWORD)
    assert script.set_password(db, LEGACY_ID, "real@example.com", None, force=False,
                               acknowledged=True) == 0

    # Second run: no acknowledgement needed, the placeholder is long gone.
    _answer(monkeypatch, script, "another-password-99")
    assert script.set_password(db, LEGACY_ID, None, None, force=True) == 0


# --- the auto_provisioned flag ----------------------------------------------

def test_claiming_clears_the_auto_provisioned_flag(script, db, monkeypatch):
    """This script is how an auto-provisioned account becomes a deliberate one.

    The flag records "nobody invited this account". Once the operator sets a
    real address and a password, that is no longer true — and leaving it set
    makes the column assert something false about the account that owns the
    workspace, the vaults and the PATs. Harmless only while the claim guard
    happens to check `password_hash` first.
    """
    user = db.query(User).filter(User.id == LEGACY_ID).one()
    user.auto_provisioned = True
    db.commit()

    _answer(monkeypatch, script, GOOD_PASSWORD)
    rc = script.set_password(db, LEGACY_ID, "real@correu.cat", None, force=False, acknowledged=True)
    assert rc == 0

    user = db.query(User).filter(User.id == LEGACY_ID).one()
    assert user.auto_provisioned is False, "the claimed account is still flagged as auto-provisioned"
    # And the claim guard must agree, since that is what consumes the flag.
    from backend.services.auth_service import is_auto_provisioned_account
    assert is_auto_provisioned_account(user) is False


def test_a_failed_claim_leaves_the_flag_alone(script, db, monkeypatch):
    """The flag must not be cleared by an attempt that does not go through."""
    user = db.query(User).filter(User.id == LEGACY_ID).one()
    user.auto_provisioned = True
    user.password_hash = "already-set"
    db.commit()

    _answer(monkeypatch, script, GOOD_PASSWORD)
    rc = script.set_password(db, LEGACY_ID, "real@correu.cat", None, force=False, acknowledged=True)
    assert rc == 1, "refusing an existing password is the precondition of this test"

    user = db.query(User).filter(User.id == LEGACY_ID).one()
    assert user.auto_provisioned is True
