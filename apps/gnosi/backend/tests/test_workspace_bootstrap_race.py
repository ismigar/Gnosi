"""Concurrent bootstrap of the 'personal' workspace must be idempotent.

On a fresh install, the first parallel requests after login/registration all
run `_ensure_personal_exists` at the same time over an empty management DB.
Before the fix, every loser of that race bubbled a raw
`sqlite3.IntegrityError` (`UNIQUE constraint failed: workspaces.id` /
`memberships.user_id, memberships.workspace_id`) up as a transient 500; a
retry then succeeded. The bootstrap must instead roll back, re-read what the
winner committed and answer normally — without ever leaving a duplicate
"Main Vault" behind.

Uses a file-backed SQLite DB (not StaticPool in-memory) so each session gets
its own connection, reproducing the real multi-connection race.
"""
import threading

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from backend.data.management_db import Base
from backend.models.management import Membership, User, Vault, Workspace
from backend.services import workspace_service as ws
from backend.services.auth_service import PLACEHOLDER_EMAIL, REQUIRE_AUTH_ENV

USER_ID = "u1"


@pytest.fixture
def session_factory(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'management.sqlite'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    yield factory
    engine.dispose()


def _seed_user(session_factory, user_id=USER_ID, email="u1@corp.com"):
    s = session_factory()
    s.add(User(id=user_id, name="User", email=email))
    s.commit()
    s.close()


def _assert_single_bootstrap(session_factory, expected_memberships=1):
    """The rows the winner committed, exactly once — no duplicates from losers."""
    s = session_factory()
    try:
        assert s.query(Workspace).count() == 1
        assert s.query(Vault).filter(Vault.workspace_id == "personal").count() == 1
        assert s.query(Membership).count() == expected_memberships
        m = s.query(Membership).filter(Membership.user_id == USER_ID).one()
        assert m.workspace_id == "personal"
        assert m.role == "owner"
    finally:
        s.close()


def test_loser_of_the_workspace_race_reuses_the_winner_rows(session_factory, tmp_path):
    """Deterministic replay of the production race.

    The loser session reads an empty DB and stages workspace + vault +
    membership. Just before its commit, a `before_commit` hook lets a second
    session (the winner) run the full bootstrap first, so the loser's commit
    hits the UNIQUE constraints exactly like a lost concurrent request.
    """
    _seed_user(session_factory)
    loser = session_factory()
    fired = {"done": False}

    @event.listens_for(loser, "before_commit")
    def _winner_commits_first(session):
        if fired["done"]:
            return
        fired["done"] = True
        winner = session_factory()
        try:
            assert ws._ensure_personal_exists(winner, USER_ID, tmp_path / "vault") == "personal"
        finally:
            winner.close()

    assert ws._ensure_personal_exists(loser, USER_ID, tmp_path / "vault") == "personal"
    assert fired["done"], "the hook never fired: the race was not exercised"
    loser.close()

    _assert_single_bootstrap(session_factory)


def test_loser_of_the_auto_user_race_reuses_the_winner_row(
    session_factory, tmp_path, monkeypatch
):
    """Same race, one step earlier: two requests auto-provisioning the user."""
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    loser = session_factory()
    fired = {"done": False}

    @event.listens_for(loser, "before_commit")
    def _winner_commits_first(session):
        if fired["done"]:
            return
        fired["done"] = True
        winner = session_factory()
        try:
            ws._ensure_personal_exists(winner, USER_ID, tmp_path / "vault")
        finally:
            winner.close()

    assert ws._ensure_personal_exists(loser, USER_ID, tmp_path / "vault") == "personal"
    assert fired["done"]
    loser.close()

    s = session_factory()
    assert s.query(User).count() == 1
    s.close()
    _assert_single_bootstrap(session_factory)


def test_n_concurrent_bootstraps_all_succeed(session_factory, tmp_path):
    """Stress shape of the original report: N parallel requests, zero 500s."""
    _seed_user(session_factory)
    n = 8
    barrier = threading.Barrier(n)
    results, errors = [], []

    def bootstrap():
        s = session_factory()
        try:
            barrier.wait()
            results.append(ws._ensure_personal_exists(s, USER_ID, tmp_path / "vault"))
        except Exception as exc:  # noqa: BLE001 — any leak here is the bug
            errors.append(exc)
        finally:
            s.close()

    threads = [threading.Thread(target=bootstrap) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert results == ["personal"] * n
    _assert_single_bootstrap(session_factory)


def test_placeholder_email_guard_still_fails_loudly(
    session_factory, tmp_path, monkeypatch
):
    """Not every IntegrityError is a race: a different user id already holding
    the placeholder email is the documented guard and must keep raising."""
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    _seed_user(session_factory, user_id="someone-else", email=PLACEHOLDER_EMAIL)

    s = session_factory()
    with pytest.raises(IntegrityError):
        ws._ensure_personal_exists(s, "new-id", tmp_path / "vault")
    s.close()
