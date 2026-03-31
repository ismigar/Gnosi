"""
Newsletter ingestion via POP3 (STARTTLS).

Downloads all emails from the mailbox, stores them as articles,
and deletes them from the server. POP3 is used instead of IMAP
because its "download → delete" model is a perfect fit for
clearing the newsletter inbox after ingestion.

Server: mail.pangea.org:110 (STARTTLS)
"""

import poplib
import email
import email.utils
from email.header import decode_header
import os
import logging
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from pathlib import Path

from backend.data.db import SessionLocal
from backend.models.reader import FeedSource, Article

# Load .env_shared (global) then .env (local override)
# Works both locally (deep path) and inside Docker (/app/...)
try:
    from dotenv import load_dotenv
    _here = Path(__file__).resolve().parent
    # Walk upward looking for .env_shared
    for _p in _here.parents:
        _shared = _p / ".env_shared"
        if _shared.exists():
            load_dotenv(_shared)
            break
    # Load local .env (2 levels up from services/ → backend root → app root)
    for _p in _here.parents:
        _local = _p / ".env"
        if _local.exists():
            load_dotenv(_local, override=True)
            break
except ImportError:
    pass  # Inside Docker, env_file handles this

log = logging.getLogger(__name__)

# ── POP3 Config ──
MAIL_SERVER = os.environ.get("NEWSLETTERS_MAIL_SERVER", "mail.pangea.org")
MAIL_PORT = int(os.environ.get("NEWSLETTERS_MAIL_PORT", "110"))
MAIL_USE_SSL = os.environ.get("NEWSLETTERS_MAIL_SSL", "starttls").lower()  # "starttls" | "ssl" | "none"
EMAIL_ACCOUNT = os.environ.get("NEWSLETTERS_EMAIL", "")
EMAIL_PASSWORD = os.environ.get("NEWSLETTERS_PASSWORD", "")
DELETE_AFTER_INGEST = os.environ.get("NEWSLETTERS_DELETE_AFTER_INGEST", "true").lower() in ("true", "1", "yes")


def get_email_body(msg):
    """Extract email body, preferring HTML over plain text."""
    html_body = None
    text_body = None

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))
            if "attachment" in content_disposition:
                continue
            try:
                body = part.get_payload(decode=True).decode(errors='replace')
                if content_type == "text/html" and not html_body:
                    html_body = body
                elif content_type == "text/plain" and not text_body:
                    text_body = body
            except Exception:
                pass
    else:
        content_type = msg.get_content_type()
        try:
            body = msg.get_payload(decode=True).decode(errors='replace')
            if content_type == "text/html":
                html_body = body
            elif content_type == "text/plain":
                text_body = body
        except Exception:
            pass

    # Prefer HTML; fall back to plain text
    return html_body or text_body or ""


def sanitize_html(raw_html):
    """
    Clean HTML for safe rendering: remove scripts, styles,
    tracking pixels, and unsafe attributes.
    """
    soup = BeautifulSoup(raw_html, 'html.parser')

    # Remove dangerous/noisy tags
    for tag in soup.find_all(['script', 'style', 'meta', 'link', 'head']):
        tag.decompose()

    # Remove tracking pixels (img with 1x1 or hidden)
    for img in soup.find_all('img'):
        width = img.get('width', '')
        height = img.get('height', '')
        if width in ('1', '0') or height in ('1', '0'):
            img.decompose()
            continue
        # Remove inline style that hides images
        style = img.get('style', '')
        if 'display:none' in style.replace(' ', '') or 'visibility:hidden' in style.replace(' ', ''):
            img.decompose()

    # Remove event handler attributes (onclick, onload, etc.)
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.startswith('on') or attr in ('class', 'id'):
                del tag[attr]

    return str(soup)


def _connect_pop3():
    """Connect to POP3 server with appropriate encryption."""
    if MAIL_USE_SSL == "ssl":
        # Direct SSL (port 995 typically)
        pop = poplib.POP3_SSL(MAIL_SERVER, MAIL_PORT)
    else:
        # Plain or STARTTLS (port 110)
        pop = poplib.POP3(MAIL_SERVER, MAIL_PORT)
        if MAIL_USE_SSL == "starttls":
            pop.stls()

    pop.user(EMAIL_ACCOUNT)
    pop.pass_(EMAIL_PASSWORD)
    return pop


def fetch_and_store_newsletters():
    """
    Connects to POP3 server, downloads all emails, stores them as
    articles in the DB, and deletes them from the server.
    """
    if not EMAIL_ACCOUNT or not EMAIL_PASSWORD:
        log.warning("⚠️ Mail credentials not configured. Skipping newsletters.")
        return 0

    db: Session = SessionLocal()
    try:
        # Create or get the "Newsletters Inbox" source
        source = db.query(FeedSource).filter(FeedSource.type == "newsletter").first()
        if not source:
            source = FeedSource(
                name="Newsletters Inbox",
                url=EMAIL_ACCOUNT,
                category="Newsletters",
                type="newsletter"
            )
            db.add(source)
            db.commit()
            db.refresh(source)

        try:
            pop = _connect_pop3()
            num_messages = len(pop.list()[1])
            log.info(f"📬 Connected to {MAIL_SERVER}. {num_messages} message(s) in the mailbox.")

            if num_messages == 0:
                pop.quit()
                return 0

            new_articles_count = 0
            delete_ids = []

            for i in range(1, num_messages + 1):
                # Download message
                resp, lines, octets = pop.retr(i)
                raw_email = b"\r\n".join(lines)
                msg = email.message_from_bytes(raw_email)

                # Decode Subject
                subject_raw = msg.get("Subject", "(No subject)")
                decoded_parts = decode_header(subject_raw)
                subject = ""
                for part, enc in decoded_parts:
                    if isinstance(part, bytes):
                        subject += part.decode(enc if enc else "utf-8", errors='replace')
                    else:
                        subject += part

                # Parse Date
                local_date = None
                date_tuple = email.utils.parsedate_tz(msg.get('Date', ''))
                if date_tuple:
                    local_date = datetime.fromtimestamp(
                        email.utils.mktime_tz(date_tuple), tz=timezone.utc
                    )
                else:
                    local_date = datetime.now(timezone.utc)

                # Parse Body – keep HTML if available
                raw_body = get_email_body(msg)
                if '<' in raw_body and '>' in raw_body:
                    # Looks like HTML — sanitize it
                    content = sanitize_html(raw_body)
                else:
                    # Plain text — wrap paragraphs
                    paragraphs = raw_body.strip().split('\n')
                    content = '\n'.join(f'<p>{p.strip()}</p>' for p in paragraphs if p.strip())

                # Unique identifier
                message_id = msg.get('Message-ID', '').strip('<>')
                if not message_id:
                    # Fallback: use subject + date hash
                    import hashlib
                    message_id = hashlib.md5(f"{subject}{local_date}".encode()).hexdigest()

                unique_url = f"mail://{message_id}"
                existing = db.query(Article).filter(Article.url == unique_url).first()

                if not existing:
                    new_article = Article(
                        source_id=source.id,
                        title=subject.strip(),
                        url=unique_url,
                        content=content,
                        published_at=local_date,
                        is_read=False
                    )
                    db.add(new_article)
                    new_articles_count += 1
                    log.info(f"  📩 {subject.strip()[:80]}")

                # Mark for deletion (always, since POP3 is "consume & clear")
                if DELETE_AFTER_INGEST:
                    delete_ids.append(i)

            db.commit()

            # Delete from server
            if DELETE_AFTER_INGEST and delete_ids:
                for msg_id in delete_ids:
                    pop.dele(msg_id)
                log.info(f"🗑️ {len(delete_ids)} email(s) deleted from the mailbox.")

            pop.quit()
            log.info(f"✅ Newsletter ingestion complete. {new_articles_count} new article(s).")
            return new_articles_count

        except Exception as e:
            log.error(f"❌ Error fetching newsletters: {e}", exc_info=True)
            db.rollback()
            raise  # Re-raise so scheduler shows the real error

    finally:
        db.close()


if __name__ == "__main__":
    fetch_and_store_newsletters()
