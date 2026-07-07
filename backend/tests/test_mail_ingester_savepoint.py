"""Aïllament per-missatge a la ingesta de newsletters (POP3).

Regressió: el bucle de `fetch_and_store_newsletters` processava TOTS els missatges
dins d'un únic try/except global amb un `db.commit()` únic al final. Un sol email
verinós (parseig/decodificació que peta, o error de DB al flush) tombava tota la
ingesta: es propagava fins a l'except exterior, feia `db.rollback()` i re-llançava
→ cap article es desava i cap missatge s'esborrava del servidor, deixant la bústia
bloquejada indefinidament (el mateix email tornava a petar al següent intent).

Fix (mateix patró que el #771 del feed_ingester): cada missatge en el seu propi
try/except + un savepoint (`db.begin_nested()`) al voltant del `db.add`/`flush`.
Un missatge que peta es registra i se salta (`continue`) SENSE tocar la transacció
global, i — CRÍTIC — NO es marca per esborrar del servidor (`delete_ids`), perquè
es pugui reintentar/inspeccionar. Els bons es desen al `commit()` únic del final.

Test d'integració: SQLite en memòria (StaticPool) + models reals + un POP3 fals
que retorna N missatges, un parseig-verinós i un DB-verinós entre els bons.
"""
from __future__ import annotations

import os
import tempfile

# El backend fa mkdir del directori de dades a l'import; cal apuntar-lo a scratch
# ABANS d'importar res de `backend.*`. També apuntem el vault a un path inexistent
# perquè cap codi toqui OneDrive durant el test.
os.environ.setdefault("GNOSI_LOCAL_DATA", tempfile.mkdtemp(prefix="gnosi-test-mailingest-"))
os.environ.setdefault("DIGITAL_BRAIN_VAULT_PATH", "/tmp/nonexistent")

import email  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from backend.data.db import Base  # noqa: E402
# Importa els models perquè els mappers (feed_sources/articles/...) es registrin.
from backend.models.reader import Article, NewsletterAccount  # noqa: E402
from backend.services import mail_ingester  # noqa: E402


# ── Helpers ────────────────────────────────────────────────────────────────

def _raw_email(subject: str, sender: str, body: str, msgid: str) -> bytes:
    """Construeix un email RFC822 mínim amb finals de línia \\r\\n (com POP3)."""
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
    """POP3 fals. `items` és una llista on cada element és bytes (email cru) o una
    Exception (que `retr` re-llança per simular un missatge il·legible/verinós)."""

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
    """Motor SQLite en memòria amb FK activades + monkeypatch de les dependències
    d'entorn del mail_ingester (engine/vault). Retorna (engine, SessionLocal)."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Activa l'enforcement de FK (SQLite el porta OFF per defecte) perquè un
    # source_id inexistent provoqui un IntegrityError real al flush → exercita
    # el savepoint begin_nested.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _rec):  # noqa: ANN001
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)

    # El mail_ingester importa aquests dos noms al seu namespace.
    monkeypatch.setattr(mail_ingester, "get_engine_for_path", lambda _p: (engine, SessionLocal))
    monkeypatch.setattr(mail_ingester, "get_active_vault_path", lambda: "/tmp/nonexistent")

    # Configura el compte POP3 al DB perquè cfg sigui vàlid (email/pass/host).
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


# ── Test principal: aïllament + savepoint + delete-only-on-success ───────────

def test_poison_message_does_not_block_others(db_env, monkeypatch):
    _, SessionLocal = db_env

    # Ordre volgut: un parseig-verinós i un DB-verinós ENTRE els bons, amb un bo
    # DESPRÉS del DB-verinós per demostrar que el savepoint deixa la sessió sana.
    items = [
        _raw_email("Bo 1", "a@example.com", "hola 1", "good-1"),      # 1 ✅
        RuntimeError("retr: missatge il·legible"),                     # 2 💀 parseig
        _raw_email("Bo 2", "b@example.com", "hola 2", "good-2"),      # 3 ✅
        _raw_email("Verí DB", "poisondb@bad.com", "x", "poison-db"),  # 4 💀 flush (FK)
        _raw_email("Bo 3", "c@example.com", "hola 3", "good-3"),      # 5 ✅
    ]
    fake = FakePOP3(items)
    monkeypatch.setattr(mail_ingester, "_connect_pop3", lambda **_kw: fake)

    # Per al missatge DB-verinós, retornem un source amb id inexistent → el flush
    # dins del savepoint peta amb IntegrityError (FK). La resta usa la funció real.
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

    # 3 bons ingerits (el de després del verí-DB inclòs → sessió sana post-savepoint).
    assert count == 3

    verify = SessionLocal()
    try:
        urls = {a.url for a in verify.query(Article).all()}
    finally:
        verify.close()
    assert urls == {"mail://good-1", "mail://good-2", "mail://good-3"}

    # Només els bons s'han marcat per esborrar del servidor (índexs 1, 3, 5).
    # Els verinosos (2 i 4) es queden a la bústia per reintentar/inspeccionar.
    assert sorted(fake.deleted) == [1, 3, 5]
    assert 2 not in fake.deleted
    assert 4 not in fake.deleted


# ── Control negatiu: el flux PRE-fix (un sol try global) bloqueja tot ────────

def test_negative_control_single_flow_blocks_and_loses_batch(db_env):
    """Reprodueix el flux vulnerable pre-#771 (tot dins d'UN try global, commit
    únic, rollback+raise a qualsevol error). Demostra que un sol email verinós
    tomba tota la ingesta: propaga, cap article persisteix i res s'esborra."""
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
                _resp, lines, _oct = fake.retr(i)  # el verí (índex 2) peta aquí
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
            db.rollback()  # ← borra TOT el lot, inclòs "Bo 1" ja afegit
            raise
        finally:
            db.close()

    with pytest.raises(RuntimeError):
        vulnerable_fetch()

    # El "Bo 1" (afegit abans del verí) s'ha perdut pel rollback global.
    verify = SessionLocal()
    try:
        assert verify.query(Article).count() == 0
    finally:
        verify.close()
