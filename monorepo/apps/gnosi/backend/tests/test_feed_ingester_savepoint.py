"""Regression: an error in ONE article must not wipe out the whole run's batch.

`fetch_and_store_feeds` inserts articles within a SINGLE transaction
(the `db.commit()` happens once, at the end). The old code, when an article
failed (typically `extract_full_content` raising while making the HTTP request to the
article's URL), did `db.rollback()` in the `except` — reverting the ENTIRE
transaction and silently deleting every article already inserted in the batch.

The fix wraps the insertion in a savepoint (`db.begin_nested()`) and removes
the `db.rollback()` from the `except`, so that only the failing article
is discarded and the rest of the batch survives the final commit.
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
    """Mimics a feedparser entry: access via dict.get AND via attribute."""
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

    # The real engine is requested via get_engine_for_path(vault_path); the
    # we replace it so it always returns our in-memory engine.
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
        summary="teaser curt",  # triggers looks_like_excerpt → extract_full_content
        published_parsed=None,
        updated_parsed=None,
    )


def test_un_article_fallit_no_esborra_el_lot(in_memory_db, monkeypatch):
    engine, SessionLocal, src_id = in_memory_db

    entries = [
        _entry("http://feed.test/a", "A"),
        _entry("http://feed.test/BAD", "B"),  # this one will make extraction crash
        _entry("http://feed.test/c", "C"),
    ]

    # All entries look like teasers → we try to extract the full body.
    monkeypatch.setattr(fi, "looks_like_excerpt", lambda _c: True)

    def _extract(url):
        if url.endswith("/BAD"):
            raise RuntimeError("connexió rebutjada")  # error HTTP realista
        return "<p>cos complet</p>"

    monkeypatch.setattr(fi, "extract_full_content", _extract)

    # _fetch_feed runs inside a ThreadPoolExecutor; we replace it with
    # return the already-parsed feed without hitting the network.
    def _fake_fetch(source):
        return source, _Parsed(entries)

    monkeypatch.setattr(fi, "_fetch_feed", _fake_fetch)

    count = fi.fetch_and_store_feeds()

    db = SessionLocal()
    urls = {a.url for a in db.query(Article).all()}
    total = db.query(Article).count()
    db.close()

    # A and C must be preserved; only B (the one that fails) is discarded.
    assert urls == {"http://feed.test/a", "http://feed.test/c"}, urls
    assert total == 2
    # And the returned counter must match what's actually in the DB.
    assert count == 2
