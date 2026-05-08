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

from backend.data.db import get_engine_for_path
from backend.services.context_vars import get_active_vault_path
from backend.models.reader import FeedSource, Article, NewsletterAccount

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

# ── POP3 Config defaults (from env) ──
# These act ONLY as a fallback if no NewsletterAccount row exists in the DB yet.
# The source of truth is the NewsletterAccount table — see _load_account_config().
_ENV_MAIL_SERVER = os.environ.get("NEWSLETTERS_MAIL_SERVER", "mail.pangea.org")
_ENV_MAIL_PORT = int(os.environ.get("NEWSLETTERS_MAIL_PORT", "110"))
_ENV_MAIL_SSL = os.environ.get("NEWSLETTERS_MAIL_SSL", "starttls").lower()
_ENV_EMAIL = os.environ.get("NEWSLETTERS_EMAIL", "")
_ENV_PASSWORD = os.environ.get("NEWSLETTERS_PASSWORD", "")
_ENV_DELETE_AFTER_INGEST = os.environ.get("NEWSLETTERS_DELETE_AFTER_INGEST", "true").lower() in ("true", "1", "yes")


def _load_account_config(db: Session):
    """Load POP3 config from DB; fall back to env vars if no row exists yet."""
    acc = db.query(NewsletterAccount).first()
    if acc is None:
        return {
            "server": _ENV_MAIL_SERVER,
            "port": _ENV_MAIL_PORT,
            "ssl_mode": _ENV_MAIL_SSL,
            "email": _ENV_EMAIL,
            "password": _ENV_PASSWORD,
            "delete_after_ingest": _ENV_DELETE_AFTER_INGEST,
        }
    return {
        "server": acc.mail_server or _ENV_MAIL_SERVER,
        "port": int(acc.mail_port or _ENV_MAIL_PORT),
        "ssl_mode": (acc.mail_ssl or _ENV_MAIL_SSL).lower(),
        "email": acc.email or _ENV_EMAIL,
        "password": acc.password or _ENV_PASSWORD,
        "delete_after_ingest": bool(acc.delete_after_ingest),
    }


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


def _connect_pop3(server: str, port: int, ssl_mode: str, email: str, password: str):
    """Connect to POP3 server with appropriate encryption."""
    ssl_mode = (ssl_mode or "starttls").lower()
    if ssl_mode == "ssl":
        # Direct SSL (port 995 typically)
        pop = poplib.POP3_SSL(server, port)
    else:
        # Plain or STARTTLS
        pop = poplib.POP3(server, port)
        if ssl_mode == "starttls":
            pop.stls()

    pop.user(email)
    pop.pass_(password)
    return pop


def test_connection(server: str, port: int, ssl_mode: str, email: str, password: str) -> int:
    """Open a POP3 connection, count messages, log out. Raises on any failure."""
    pop = _connect_pop3(server=server, port=port, ssl_mode=ssl_mode, email=email, password=password)
    try:
        n = len(pop.list()[1])
    finally:
        try:
            pop.quit()
        except Exception:
            pass
    return n


def fetch_and_store_newsletters():
    """
    Connects to POP3 server, downloads all emails, stores them as
    articles in the DB, and deletes them from the server.
    Reads config from the NewsletterAccount table; falls back to env vars.
    """
    v_path = get_active_vault_path()
    _, SessionLocal = get_engine_for_path(v_path)
    db: Session = SessionLocal()
    try:
        cfg = _load_account_config(db)
        if not cfg["email"] or not cfg["password"]:
            log.warning("⚠️ Mail credentials not configured. Skipping newsletters.")
            return 0

        # Create or get the "Newsletters Inbox" source
        source = db.query(FeedSource).filter(FeedSource.type == "newsletter").first()
        if not source:
            source = FeedSource(
                name="Newsletters Inbox",
                url=cfg["email"],
                category="Newsletters",
                type="newsletter"
            )
            db.add(source)
            db.commit()
            db.refresh(source)

        try:
            pop = _connect_pop3(
                server=cfg["server"],
                port=cfg["port"],
                ssl_mode=cfg["ssl_mode"],
                email=cfg["email"],
                password=cfg["password"],
            )
            num_messages = len(pop.list()[1])
            log.info(f"📬 Connected to {cfg['server']}. {num_messages} message(s) in the mailbox.")

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
                message_id = sanitize_filename_component(msg.get('Message-ID', ''))
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
                if cfg["delete_after_ingest"]:
                    delete_ids.append(i)

            db.commit()

            # Delete from server
            if cfg["delete_after_ingest"] and delete_ids:
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
