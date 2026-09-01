import concurrent.futures
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import feedparser
import requests
from sqlalchemy.orm import Session

from backend.data.db import get_engine_for_path
from backend.models.reader import Article, FeedSource
from backend.services.article_extractor import (
    extract_full_content,
    looks_like_excerpt,
)
from backend.services.context_vars import get_active_vault_path

log = logging.getLogger(__name__)


def _fetch_feed(source: Any) -> Any:
    """Fetches and parses a single feed with a strict timeout."""
    log.info(f"📥 Fetching feed: {source.name} ({source.url})")
    try:
        # Requests with strict timeout to avoid blocking if an RSS server is slow or down
        response = requests.get(source.url, timeout=7)
        response.raise_for_status()
        parsed = feedparser.parse(response.content)
        return source, parsed
    except Exception as e:
        log.error(f"❌ Error fetching feed {source.url}: {e}")
        return source, None


def _collect_parsed_feeds(sources: list[Any], fetch_feed: Any) -> list[tuple[Any, Any]]:
    parsed_results: list[tuple[Any, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as executor:
        futures = {executor.submit(fetch_feed, source): source for source in sources}
        for future in concurrent.futures.as_completed(futures):
            source, parsed = future.result()
            if parsed:
                parsed_results.append((source, parsed))
    return parsed_results


def _entry_publication_date(entry: Any) -> datetime:
    parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if parsed:
        return datetime.fromtimestamp(time.mktime(parsed), tz=timezone.utc)
    return datetime.now(timezone.utc)


def _entry_content(entry: Any) -> str:
    content_items = entry.get("content") or []
    if content_items and isinstance(content_items[0], dict):
        content = content_items[0].get("value", "")
        if content:
            return str(content)
    return str(entry.get("summary", ""))


def _store_feed_entry(
    db: Session,
    source: Any,
    entry: Any,
    processed_urls: set[str],
    excerpt_detector: Any,
    content_extractor: Any,
) -> bool:
    article_link = str(entry.get("link", "")).strip()
    if not article_link or article_link in processed_urls:
        return False
    existing = db.query(Article).filter(Article.url == article_link).first()
    if existing:
        return False
    try:
        processed_urls.add(article_link)
        content_raw = _entry_content(entry)
        full_content = content_extractor(article_link) if excerpt_detector(content_raw) else None
        new_article = Article(
            source_id=source.id,
            title=entry.get("title", "Untitled"),
            url=article_link,
            content=content_raw,
            full_content=full_content,
            published_at=_entry_publication_date(entry),
            is_read=False,
        )
        with db.begin_nested():
            db.add(new_article)
            db.flush()
        return True
    except Exception as exc:
        log.warning(f"  ⚠️ Skipping article due to insertion error: {article_link} - {exc}")
        return False


def fetch_and_store_feeds(
    *,
    fetch_feed: Any = _fetch_feed,
    engine_factory: Any = get_engine_for_path,
    vault_path_factory: Any = get_active_vault_path,
    excerpt_detector: Any = looks_like_excerpt,
    content_extractor: Any = extract_full_content,
) -> Any:
    """
    Downloads all active RSS/YouTube feeds from the database, parses them,
    and saves new articles from the last 24 hours into the database.
    """
    v_path = vault_path_factory()
    _, SessionLocal = engine_factory(v_path)
    db: Session = SessionLocal()
    try:
        sources = db.query(FeedSource).filter(FeedSource.type.in_(["rss", "youtube"])).all()
        _ = datetime.now(timezone.utc) - timedelta(hours=24)
        new_articles_count = 0
        processed_urls: set[str] = set()
        for source, parsed in _collect_parsed_feeds(sources, fetch_feed):
            try:
                for entry in parsed.entries:
                    new_articles_count += int(
                        _store_feed_entry(
                            db,
                            source,
                            entry,
                            processed_urls,
                            excerpt_detector,
                            content_extractor,
                        )
                    )
            except Exception as exc:
                log.error(f"❌ Error processing feed entries for {source.url}: {exc}")

        db.commit()
        log.info(f"✅ Feed ingestion complete. Added {new_articles_count} new articles.")
        return new_articles_count

    finally:
        db.close()


if __name__ == "__main__":
    # For manual testing
    fetch_and_store_feeds()
