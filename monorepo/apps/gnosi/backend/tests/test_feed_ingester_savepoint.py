"""Regressió: un error en UN article no ha d'esborrar tot el lot del run.

`fetch_and_store_feeds` insereix els articles dins d'UNA sola transacció
(el `db.commit()` és únic, al final). El codi antic, quan un article fallava
(típicament `extract_full_content` llançant en fer la petició HTTP a la URL
de l'article), feia `db.rollback()` al `except` — revertint TOTA la
transacció i esborrant en silenci tots els articles ja inserits del lot.

El fix embolcalla la inserció en un savepoint (`db.begin_nested()`) i treu
el `db.rollback()` del `except`, de manera que només es descarta l'article
que falla i la resta del lot sobreviu al commit final.
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.data.db import Base
from backend.models.reader import FeedSource, Article
import backend.services.feed_ingester as fi


class _Entry(dict):
    """Imita una entrada de feedparser: accés per dict.get I per atribut."""
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:  # pragma: no cover - defensive
            raise AttributeError(name) from exc


class _Parsed:
    def __init__(self, entries):
        self.entries = entries


@pytest.fixture()
def in_memory_db(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    # El motor real es demana via get_engine_for_path(vault_path); el
    # substituïm perquè retorni sempre el nostre motor en memòria.
    monkeypatch.setattr(fi, "get_engine_for_path", lambda _p: (engine, SessionLocal))
    monkeypatch.setattr(fi, "get_active_vault_path", lambda: "/tmp/vault-test")

    seed = SessionLocal()
    src = FeedSource(name="Test", url="http://feed.test/rss", category="x", type="rss")
    seed.add(src)
    seed.commit()
    seed.refresh(src)
    src_id = src.id
    seed.close()
    return engine, SessionLocal, src_id


def _entry(url, title):
    return _Entry(
        link=url,
        title=title,
        summary="teaser curt",  # dispara looks_like_excerpt → extract_full_content
        published_parsed=None,
        updated_parsed=None,
    )


def test_un_article_fallit_no_esborra_el_lot(in_memory_db, monkeypatch):
    engine, SessionLocal, src_id = in_memory_db

    entries = [
        _entry("http://feed.test/a", "A"),
        _entry("http://feed.test/BAD", "B"),  # aquest farà petar l'extracció
        _entry("http://feed.test/c", "C"),
    ]

    # Totes les entrades semblen teasers → s'intenta extreure el cos complet.
    monkeypatch.setattr(fi, "looks_like_excerpt", lambda _c: True)

    def _extract(url):
        if url.endswith("/BAD"):
            raise RuntimeError("connexió rebutjada")  # error HTTP realista
        return "<p>cos complet</p>"

    monkeypatch.setattr(fi, "extract_full_content", _extract)

    # _fetch_feed s'executa dins d'un ThreadPoolExecutor; el substituïm per
    # retornar el feed ja parsejat sense xarxa.
    def _fake_fetch(source):
        return source, _Parsed(entries)

    monkeypatch.setattr(fi, "_fetch_feed", _fake_fetch)

    count = fi.fetch_and_store_feeds()

    db = SessionLocal()
    urls = {a.url for a in db.query(Article).all()}
    total = db.query(Article).count()
    db.close()

    # A i C s'han de conservar; només B (el que peta) es descarta.
    assert urls == {"http://feed.test/a", "http://feed.test/c"}, urls
    assert total == 2
    # I el comptador retornat ha de coincidir amb el que hi ha realment a la BD.
    assert count == 2
