"""Per-message isolation in newsletter ingestion (POP3).

Regression: the `fetch_and_store_newsletters` loop processed ALL messages
inside a single global try/except with one final `db.commit()`. A single
poisoned email (parsing/decoding that crashes, or a DB error on flush) took down
the whole ingestion: it propagated to the outer except, did `db.rollback()`, and re-raised
→ no article was saved and no message was deleted from the server, leaving the mailbox
stuck indefinitely (the same email would crash again on the next attempt).

Fix (same pattern as #771 in feed_ingester): each message gets its own
try/except plus a savepoint (`db.begin_nested()`) around the `db.add`/`flush`.
A message that crashes is logged and skipped (`continue`) WITHOUT touching the
global transaction, and — CRITICALLY — is NOT marked for deletion from the server (`delete_ids`), so
it can be retried/inspected. Good ones are saved in the single final `commit()`.

Integration test: in-memory SQLite (StaticPool) + real models + a fake POP3
that returns N messages, with one parse-poisoned and one DB-poisoned message among the good ones.
"""
from __future__ import annotations

import os
import tempfile

# The backend does a mkdir of the data directory on import; it must be pointed to scratch
# BEFORE importing anything from `backend.*`. We also point the vault to a nonexistent path
# so that no code touches OneDrive during the test.
os.environ.setdefault("GNOSI_DATA_DIR", tempfile.mkdtemp(prefix="gnosi-test-mailingest-"))
os.environ.setdefault("DIGITAL_BRAIN_VAULT_PATH", "/tmp/nonexistent")

import email  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from backend.data.db import Base  # noqa: E402
# Import the models so the mappers (feed_sources/articles/...) get registered.
from backend.models.reader import Article, NewsletterAccount  # noqa: E402
from backend.services import mail_ingester  # noqa: E402


# ── Helpers ────────────────────────────────────────────────────────────────

def _raw_email(subject: str, sender: str, body: str, msgid: str) -> bytes:
    """Build a minimal RFC822 email with \\r\\n line endings (like POP3)."""
    return (
        f"From: {sender}\r\n"
        f"Subject: {subject}\r\n"
        f"Message-ID: <{msgid}>\r\n"
        f"Date: Mon, 07 Jul 2026 10:00:00 +0000\r\n"
        f"Content-Type: text/plain; charset=utf-8\r\n"
        f"\r\n"
        f"{body}\r\n"
    ).encode("utf-8")


class FakePOP3:
    """Fake POP3. `items` is a list where each element is bytes (raw email) or an
    Exception (which `retr` re-raises to simulate an unreadable/poisoned message)."""

    def __init__(self, items):
        self._items = items
        self.deleted: list[int] = []
        self.quit_called = False

    def list(self):
        lines = [f"{i + 1} 100".encode() for i in range(len(self._items))]
        return (b"+OK", lines, len(self._items))

    def retr(self, i):
        item = self._items[i - 1]
        if isinstance(item, Exception):
            raise item
        return (b"+OK", item.split(b"\r\n"), len(item))

    def dele(self, i):
        self.deleted.append(i)

    def quit(self):
        self.quit_called = True


@pytest.fixture()
def db_env(monkeypatch):
    """In-memory SQLite engine with FK enabled + monkeypatch of the mail_ingester's
    environment dependencies (engine/vault). Returns (engine, SessionLocal)."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Enables FK enforcement (SQLite has it OFF by default) so that a
    # nonexistent source_id triggers a real IntegrityError on flush → exercises
    # the begin_nested savepoint.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _rec):  # noqa: ANN001
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)

    # The mail_ingester imports these two names into its namespace.
    monkeypatch.setattr(mail_ingester, "get_engine_for_path", lambda _p: (engine, SessionLocal))
    monkeypatch.setattr(mail_ingester, "get_active_vault_path", lambda: "/tmp/nonexistent")

    # Configure the POP3 account in the DB so cfg is valid (email/pass/host).
    s = SessionLocal()
    s.add(NewsletterAccount(
        mail_server="mail.example.com",
        mail_port=110,
        mail_ssl="none",
        email="news@example.com",
        password="secret",
        delete_after_ingest=True,
    ))
    s.commit()
    s.close()

    return engine, SessionLocal


# ── Main test: isolation + savepoint + delete-only-on-success ────────────────

def test_poison_message_does_not_block_others(db_env, monkeypatch):
    _, SessionLocal = db_env

    # Intended order: one parse-poisoned and one DB-poisoned message BETWEEN the good ones, with a good one
    # AFTER the DB-poisoned one, to demonstrate that the savepoint leaves the session healthy.
    items = [
        _raw_email("Bo 1", "a@example.com", "hola 1", "good-1"),      # 1 ✅
        RuntimeError("retr: missatge il·legible"),                     # 2 💀 parsing
        _raw_email("Bo 2", "b@example.com", "hola 2", "good-2"),      # 3 ✅
        _raw_email("Verí DB", "poisondb@bad.com", "x", "poison-db"),  # 4 💀 flush (FK)
        _raw_email("Bo 3", "c@example.com", "hola 3", "good-3"),      # 5 ✅
    ]
    fake = FakePOP3(items)
    monkeypatch.setattr(mail_ingester, "_connect_pop3", lambda **_kw: fake)

    # For the DB-poisoned message, we return a source with a nonexistent id → the flush
    # inside the savepoint fails with IntegrityError (FK). The rest use the real function.
    real_source = mail_ingester._get_or_create_sender_source

    class _BogusSource:
        id = 10 ** 9
        name = "poison"

    def fake_source(db, msg):
        if "poisondb@" in (msg.get("From", "") or ""):
            return _BogusSource()
        return real_source(db, msg)

    monkeypatch.setattr(mail_ingester, "_get_or_create_sender_source", fake_source)

    count = mail_ingester.fetch_and_store_newsletters()

    # 3 good ones ingested (including the one after the DB poison → session healthy post-savepoint).
    assert count == 3

    verify = SessionLocal()
    try:
        urls = {a.url for a in verify.query(Article).all()}
    finally:
        verify.close()
    assert urls == {"mail://good-1", "mail://good-2", "mail://good-3"}

    # Only the good ones have been marked for deletion from the server (indexes 1, 3, 5).
    # The poisoned ones (2 and 4) stay in the mailbox to be retried/inspected.
    assert sorted(fake.deleted) == [1, 3, 5]
    assert 2 not in fake.deleted
    assert 4 not in fake.deleted


# ── Negative control: the PRE-fix flow (a single global try) blocks everything ────────

def test_negative_control_single_flow_blocks_and_loses_batch(db_env):
    """Reproduces the vulnerable pre-#771 flow (everything inside ONE global try, a single
    commit, rollback+raise on any error). Demonstrates that a single poisoned email
    brings down the whole ingestion: it propagates, no article persists, and nothing is deleted."""
    _, SessionLocal = db_env

    items = [
        _raw_email("Bo 1", "a@example.com", "hola", "neg-1"),
        RuntimeError("retr: missatge il·legible"),
        _raw_email("Bo 2", "b@example.com", "hola", "neg-2"),
    ]
    fake = FakePOP3(items)

    def vulnerable_fetch():
        db = SessionLocal()
        try:
            count = 0
            num = len(fake.list()[1])
            for i in range(1, num + 1):
                _resp, lines, _oct = fake.retr(i)  # the poison (index 2) fails here
                raw = b"\r\n".join(lines)
                msg = email.message_from_bytes(raw)
                db.add(Article(
                    source_id=None,
                    title=msg.get("Subject", ""),
                    url=f"mail://{msg.get('Message-ID', '')}",
                    content="x",
                    published_at=datetime.now(timezone.utc),
                    is_read=False,
                ))
                count += 1
                fake.deleted.append(i)
            db.commit()
            return count
        except Exception:
            db.rollback()  # ← wipes the ENTIRE batch, including "Bo 1" already added
            raise
        finally:
            db.close()

    with pytest.raises(RuntimeError):
        vulnerable_fetch()

    # The "Bo 1" (added before the poison) is lost due to the global rollback.
    verify = SessionLocal()
    try:
        assert verify.query(Article).count() == 0
    finally:
        verify.close()
