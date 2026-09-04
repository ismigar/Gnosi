"""Who a request is, and when it needs a credential to be anyone.

Two rules, tested from the outside wherever possible:

1. **`X-User-ID` is never an identity.** It is a plain request header, so
   honouring it let any caller name themselves — including as `ismael-legacy`,
   a default published in this repo — and mint accounts along the way. It used
   to be ignored only while `GNOSI_REQUIRE_AUTH` was on, which made an open API
   the price of not showing a login screen. The two are now independent.

2. **The login screen follows exposure, not a flag.** A native personal install
   with one account has nothing a credential would protect that the OS login
   does not already: the process runs as the user, on loopback, over their own
   files. Docker, org mode and a second account each end that, and each turns
   enforcement on by itself.

The enforcement is an app-wide dependency rather than per-route gating, because
a survey found 50 routes that never touch `get_workspace_context` and would
otherwise have stayed open.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.models.management  # noqa: F401 — registers the tables on Base
from backend.app import factory as app_factory
from backend.data.management_db import Base
from backend.models.management import User
from backend.services.auth_service import (
    LEGACY_USER_ID,
    REQUIRE_AUTH_ENV,
    auth_policy_override,
    ambient_identity_available,
    require_auth_enabled,
    reset_auth_policy_cache,
    resolve_effective_user_id,
    sole_account_id,
)


@pytest.fixture
def client():
    from backend.server import app

    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _clear_policy_cache():
    """The autodetected policy is cached for a few seconds, which would leak
    one test's deployment shape into the next."""
    reset_auth_policy_cache()
    yield
    reset_auth_policy_cache()


def _refresh_health_snapshot(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def load_test_params(*, strict_env: bool = False) -> SimpleNamespace:
        _ = strict_env
        return SimpleNamespace(gnosi_mode="personal", paths={})

    monkeypatch.setattr(app_factory, "load_params", load_test_params)
    app_factory.refresh_health_snapshot(client.app)


@pytest.fixture
def mem_db():
    """A management DB of its own, so the account count is what the test says."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _add_users(db, *ids):
    for i, uid in enumerate(ids):
        db.add(User(id=uid, email=f"{uid}@example.com", name=uid))
    db.commit()


@pytest.fixture
def enforcement_on(monkeypatch):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    assert require_auth_enabled()


@pytest.fixture
def enforcement_off(monkeypatch):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "0")
    assert not require_auth_enabled()


@pytest.fixture
def local_personal(monkeypatch):
    """Autodetection with nothing overriding it, on a non-exposed install."""
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        "backend.services.auth_service.deployment_is_exposed", lambda: False
    )


# --- the override -----------------------------------------------------------

@pytest.mark.parametrize("value,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("yes", True), ("on", True),
    ("0", False), ("false", False), ("no", False), ("off", False),
])
def test_override_parsing(monkeypatch, value, expected):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, value)
    assert auth_policy_override() is expected
    assert require_auth_enabled() is expected


@pytest.mark.parametrize("value", ["", "auto", "maybe"])
def test_unset_or_unrecognised_means_autodetect(monkeypatch, value):
    """Anything that is not an explicit yes/no hands the decision to the
    autodetection, rather than silently meaning 'off' as it used to."""
    monkeypatch.setenv(REQUIRE_AUTH_ENV, value)
    assert auth_policy_override() is None


def test_an_explicit_off_survives_an_exposed_deployment(monkeypatch):
    """The override has to work in BOTH directions: a Docker install on a
    trusted private host is the operator's call to make, not ours."""
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "0")
    monkeypatch.setattr(
        "backend.services.auth_service.deployment_is_exposed", lambda: True
    )
    assert require_auth_enabled() is False


# --- the autodetected policy ------------------------------------------------

def test_one_account_locally_needs_no_credential(local_personal, mem_db):
    _add_users(mem_db, "solo")
    assert ambient_identity_available(mem_db) is True
    assert require_auth_enabled(mem_db) is False


def test_a_fresh_install_needs_no_credential(local_personal, mem_db):
    """Zero accounts is the first run. Demanding a signup before the tool opens
    is the cloud-shaped ceremony this whole design is avoiding."""
    assert ambient_identity_available(mem_db) is True
    assert require_auth_enabled(mem_db) is False


def test_a_second_account_turns_enforcement_on(local_personal, mem_db):
    """Ambient identity stops having one honest answer, so it stops existing."""
    _add_users(mem_db, "one", "two")
    assert ambient_identity_available(mem_db) is False
    assert require_auth_enabled(mem_db) is True


def test_an_exposed_deployment_needs_a_credential(monkeypatch, mem_db):
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        "backend.services.auth_service.deployment_is_exposed", lambda: True
    )
    _add_users(mem_db, "solo")
    assert require_auth_enabled(mem_db) is True


def test_autodetection_fails_closed(monkeypatch):
    """An install that cannot describe itself is not one to serve openly."""
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)

    def boom():
        raise RuntimeError("config unreadable")

    monkeypatch.setattr("backend.services.auth_service.deployment_is_exposed", boom)
    assert require_auth_enabled() is True


# --- identity resolution ----------------------------------------------------

def test_a_credential_wins(local_personal, mem_db):
    _add_users(mem_db, "solo")
    assert resolve_effective_user_id("real-user", mem_db) == "real-user"


def test_unauthenticated_is_the_sole_account(local_personal, mem_db):
    _add_users(mem_db, "the-only-one")
    assert sole_account_id(mem_db) == "the-only-one"
    assert resolve_effective_user_id(None, mem_db) == "the-only-one"


def test_a_fresh_install_bootstraps_a_fixed_id(local_personal, mem_db):
    """Fixed, and therefore not caller-chosen — which is the whole property."""
    assert sole_account_id(mem_db) is None
    assert resolve_effective_user_id(None, mem_db) == LEGACY_USER_ID


def test_unauthenticated_is_rejected_when_ambiguous(local_personal, mem_db):
    from fastapi import HTTPException

    _add_users(mem_db, "one", "two")
    with pytest.raises(HTTPException) as exc:
        resolve_effective_user_id(None, mem_db)
    assert exc.value.status_code == 401


def test_resolution_takes_no_header_at_all():
    """The regression guard for rule 1, asserted on the signature itself.

    `resolve_effective_user_id` cannot honour `X-User-ID` because it cannot see
    it: the parameter is gone. A future refactor that reintroduces it has to
    delete this test to do so.
    """
    import inspect

    params = inspect.signature(resolve_effective_user_id).parameters
    assert "x_user_id" not in params
    assert list(params) == ["auth_uid", "db"]


# --- end to end through the app ---------------------------------------------

def test_off_a_protected_route_is_reachable(client, enforcement_off):
    """`!= 401` is NOT enough here.

    The first version asserted only that, and a 500 satisfies it — the very
    assertion carrying the claim that merging changes nothing would have stayed
    green through a totally broken route. Anything 5xx now fails.

    The probe deliberately avoids `/api/vault/pages`: that route needs a
    configured vault, which a fresh worktree does not have (`config/params.yaml`
    is gitignored), so it answers 500 for reasons that have nothing to do with
    auth. Chasing that 500 as if it were a regression cost a long detour once
    already.
    """
    r = client.get("/api/ai/models")
    assert r.status_code < 500, r.text
    assert r.status_code != 401


def test_on_a_protected_route_returns_401(client, enforcement_on):
    r = client.get("/api/vault/pages")
    assert r.status_code == 401, r.text


def test_on_x_user_id_does_not_open_a_protected_route(client, enforcement_on):
    r = client.get("/api/vault/pages", headers={"X-User-ID": LEGACY_USER_ID})
    assert r.status_code == 401, r.text


def test_off_x_user_id_cannot_name_the_caller(client, enforcement_off):
    """The header is inert even where no credential is demanded.

    This is the case that used to be open: with the flag off, `X-User-ID` was
    honoured verbatim, so a caller could act as any account — or as one that did
    not exist yet, which `_ensure_personal_exists` would then mint with `owner`
    on the shared personal workspace.
    """
    r = client.get("/api/workspaces", headers={"X-User-ID": "ghost-attacker"})
    assert r.status_code < 500, r.text
    # Whatever comes back belongs to the local account, never to the named id.
    assert "ghost-attacker" not in r.text


def test_off_workspace_creation_cannot_mint_an_account(client, enforcement_off):
    """The second header-driven account factory, with the flag that used to be
    the only thing closing it turned off."""
    before = client.get("/api/workspaces")
    r = client.post("/api/workspaces", json={"name": "ghost-ws"},
                    headers={"X-User-ID": "ghost-attacker"})
    assert r.status_code < 500, r.text
    assert "ghost-attacker" not in r.text
    assert before.status_code < 500


def test_on_workspace_creation_cannot_mint_an_account(client, enforcement_on):
    r = client.post("/api/workspaces", json={"name": "ghost-ws"},
                    headers={"X-User-ID": "ghost-attacker"})
    assert r.status_code == 401, r.text


def test_on_the_liveness_probe_stays_open(client, enforcement_on):
    """The watchdogs poll this with no credentials; 401 would restart-loop them."""
    r = client.get("/api/health")
    assert r.status_code != 401, r.text


def test_health_advertises_the_effective_policy(
    client,
    enforcement_on,
    monkeypatch,
):
    """The frontend gates <LoginPage> on this field (App.jsx): without it,
    personal mode renders the app shell and every call 401s silently."""
    _refresh_health_snapshot(client, monkeypatch)
    assert client.get("/api/health").json()["require_auth"] is True


def test_health_advertises_enforcement_off(
    client,
    enforcement_off,
    monkeypatch,
):
    _refresh_health_snapshot(client, monkeypatch)
    assert client.get("/api/health").json()["require_auth"] is False


def test_on_config_stays_gated_and_is_not_a_liveness_probe(client, enforcement_on):
    """`/api/config` is admin-gated at the router, so it can never be a probe.

    Historical host watchdogs are no longer shipped in public Gnosi. Keep the
    authentication contract independent of those private service implementations:
    liveness is public, configuration is not.
    """
    assert client.get("/api/config").status_code == 401

    assert client.get("/api/health").status_code == 200


def test_on_login_stays_reachable(client, enforcement_on):
    """You cannot present a session to the endpoint that issues one."""
    r = client.post("/api/auth/login", json={"email": "nobody@corp.com", "password": "whatever12"})
    # 401 for BAD CREDENTIALS is expected; what must not happen is being blocked
    # by the gate before the handler runs, which would make login impossible.
    assert r.status_code in (401, 422)
    assert "Cal autenticació" not in r.text


# --- CORS -------------------------------------------------------------------

def test_a_remote_page_is_not_allowed_to_read_the_api(client, enforcement_off):
    """The exfiltration path the wildcard used to leave open.

    With no credential demanded, the response body is real data; the only thing
    standing between an arbitrary site and the vault is whether the browser
    lets that site's JavaScript read it. Without an `Access-Control-Allow-Origin`
    matching the caller, it does not.
    """
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert r.headers.get("access-control-allow-origin") is None


def test_a_loopback_page_is_allowed(client, enforcement_off):
    """The dev server, `vite preview` and the Word add-in webview all arrive
    from a loopback origin on a port nobody pinned down in advance."""
    origin = "http://localhost:5173"
    r = client.get("/api/health", headers={"Origin": origin})
    assert r.headers.get("access-control-allow-origin") == origin


def test_cookies_are_never_allowed_cross_origin_by_default(client, enforcement_off):
    """`SameSite=Lax` treats two ports of localhost as the same site, so a
    hostile page on another local port could ride the session cookie if the
    response invited it to."""
    r = client.get("/api/health", headers={"Origin": "http://localhost:9999"})
    assert r.headers.get("access-control-allow-credentials") is None
