import feedparser
from datetime import datetime, timedelta, timezone
import time
from bs4 import BeautifulSoup
import logging
from sqlalchemy.orm import Session

from backend.data.db import SessionLocal
from backend.models.reader import FeedSource, Article

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
                        
                    # Process only recent articles
                    if pub_date > target_time:
                        # Extract URL and check uniqueness
                        article_link = entry.get('link', '')
                        existing = db.query(Article).filter(Article.url == article_link).first()
                        
                        if not existing and article_link:
                            # Clean HTML content
                            content_raw = entry.get('content', [{'value': entry.get('summary', '')}])[0]['value']
                            soup = BeautifulSoup(content_raw, 'html.parser')
                            text_content = soup.get_text(separator=' ', strip=True)
                            
                            new_article = Article(
                                source_id=source.id,
                                title=entry.get('title', 'Untitled'),
                                url=article_link,
                                content=text_content,
                                published_at=pub_date,
                                is_read=False
                            )
                            db.add(new_article)
                            new_articles_count += 1
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
