import feedparser
from datetime import datetime, timedelta, timezone
import time
from bs4 import BeautifulSoup
import logging
from sqlalchemy.orm import Session

from backend.data.db import get_engine_for_path
from backend.services.context_vars import get_active_vault_path
from backend.models.reader import FeedSource, Article
from backend.services.article_extractor import (
    extract_full_content,
    looks_like_excerpt,
)

log = logging.getLogger(__name__)

import concurrent.futures
import requests

def _fetch_feed(source):
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

def fetch_and_store_feeds():
    """
    Downloads all active RSS/YouTube feeds from the database, parses them,
    and saves new articles from the last 24 hours into the database.
    """
    v_path = get_active_vault_path()
    _, SessionLocal = get_engine_for_path(v_path)
    db: Session = SessionLocal()
    try:
        sources = db.query(FeedSource).filter(FeedSource.type.in_(["rss", "youtube"])).all()
        target_time = datetime.now(timezone.utc) - timedelta(hours=24)
        
        new_articles_count = 0
        parsed_results = []
        
        # 1. Fetch all feeds concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=30) as executor:
            # Submit all fetch jobs
            future_to_source = {executor.submit(_fetch_feed, s): s for s in sources}
            # Collect results as they complete
            for future in concurrent.futures.as_completed(future_to_source):
                source, parsed = future.result()
                if parsed:
                    parsed_results.append((source, parsed))
                    
        # 2. Process results and save to DB sequentially (DB session is not thread-safe)
        processed_urls = set()
        for source, parsed in parsed_results:
            try:
                for entry in parsed.entries:
                    # Determine publication date
                    pub_date = None
                    if hasattr(entry, 'published_parsed') and entry.published_parsed:
                        pub_date = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)
                    elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                        pub_date = datetime.fromtimestamp(time.mktime(entry.updated_parsed), tz=timezone.utc)
                    
                    if not pub_date:
                        pub_date = datetime.now(timezone.utc) # fallback

                    # Removed 24h filter to allow full history ingestion.
                    # `target_time` queda al closure però no s'usa — mantenim
                    # la variable per si en el futur volem reactivar-lo.
                    _ = target_time
                    # Extract URL and check uniqueness
                    article_link = entry.get('link', '')
                    if not article_link:
                        continue

                    # Normalize URL
                    article_link = article_link.strip()

                    if article_link in processed_urls:
                        continue

                    existing = db.query(Article).filter(Article.url == article_link).first()

                    if not existing:
                        try:
                            processed_urls.add(article_link)
                            # Keep raw HTML so the reader frontend can render
                            # rich formatting (paragraphs, headings, images,
                            # blockquotes, etc.) inside its sandbox iframe.
                            # The previous BeautifulSoup get_text() flattened
                            # everything to a single paragraph and lost
                            # structure — see directive
                            # reader_minimalist_redesign.md for the iframe
                            # XSS mitigation.
                            # `content` pot faltar, ser una llista BUIDA (alguns feeds
                            # Atom) o portar ítems sense `value`: el llegim de forma
                            # robusta i caiem a `summary`. Abans `[0]['value']` cru petava
                            # amb IndexError/KeyError i l'article se saltava en silenci
                            # (via el try/except de sota) tot i tenir un `summary` usable.
                            _content = entry.get('content') or []
                            content_raw = ''
                            if _content and isinstance(_content[0], dict):
                                content_raw = _content[0].get('value', '')
                            if not content_raw:
                                content_raw = entry.get('summary', '')

                            # When the feed only ships a teaser, fetch the
                            # canonical URL and extract the full body. We do
                            # this synchronously inside the ingester (which
                            # already runs as a scheduled job, so the extra
                            # HTTP per article doesn't block any user
                            # request). On failure we fall back to whatever
                            # the feed gave us.
                            full_content = None
                            if looks_like_excerpt(content_raw):
                                full_content = extract_full_content(article_link)

                            new_article = Article(
                                source_id=source.id,
                                title=entry.get('title', 'Untitled'),
                                url=article_link,
                                content=content_raw,
                                full_content=full_content,
                                published_at=pub_date,
                                is_read=False
                            )
                            # Savepoint per article: si el flush peta (col·lisió
                            # d'URL, valor invàlid…) NOMÉS es descarta AQUEST
                            # article. Abans el `except` feia `db.rollback()`,
                            # que revertia TOTA la transacció del run (el commit
                            # és únic, al final del bucle) i esborrava en silenci
                            # tots els articles ja inserits del lot, a més de
                            # deixar `new_articles_count` sobrecomptat. Un error
                            # habitual és `extract_full_content` (petició HTTP a
                            # la URL de l'article) llançant — queda FORA del
                            # savepoint, i el `except` ja no toca la transacció.
                            with db.begin_nested():
                                db.add(new_article)
                                db.flush()  # Catch IntegrityError early
                            new_articles_count += 1
                        except Exception as e:
                            # Sense `db.rollback()`: si s'havia obert el
                            # savepoint, ja ha revertit només aquest article; la
                            # resta del lot es conserva per al commit final.
                            log.warning(f"  ⚠️ Skipping article due to insertion error: {article_link} - {e}")
                            continue

            except Exception as e:
                log.error(f"❌ Error processing feed entries for {source.url}: {e}")
                
        db.commit()
        log.info(f"✅ Feed ingestion complete. Added {new_articles_count} new articles.")
        return new_articles_count
        
    finally:
        db.close()

if __name__ == "__main__":
    # For manual testing
    fetch_and_store_feeds()
