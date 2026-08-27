"""
Newsletter ingestion via POP3 (STARTTLS).

Downloads all emails from the mailbox, stores them as articles,
and deletes them from the server. POP3 is used instead of IMAP
because its "download → delete" model is a perfect fit for
clearing the newsletter inbox after ingestion.

Server: mail.pangea.org:110 (STARTTLS)
"""

import email
import email.utils
import hashlib
import logging
import os
import poplib
import re
from datetime import datetime, timezone
from email.header import decode_header
from typing import Any

from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from backend.config.env_config import load_env
from backend.data.db import get_engine_for_path
from backend.models.reader import Article, FeedSource, NewsletterAccount
from backend.services.context_vars import get_active_vault_path
from backend.utils.safe_io import sanitize_filename_component

load_env()

log = logging.getLogger(__name__)

# ── POP3 Config defaults (from env) ──
# These act ONLY as a fallback if no NewsletterAccount row exists in the DB yet.
# The source of truth is the NewsletterAccount table — see _load_account_config().
_ENV_MAIL_SERVER = os.environ.get("NEWSLETTERS_MAIL_SERVER", "mail.pangea.org")
_ENV_MAIL_PORT = int(os.environ.get("NEWSLETTERS_MAIL_PORT", "110"))
_ENV_MAIL_SSL = os.environ.get("NEWSLETTERS_MAIL_SSL", "starttls").lower()
_ENV_EMAIL = os.environ.get("NEWSLETTERS_EMAIL", "")
_ENV_PASSWORD = os.environ.get("NEWSLETTERS_PASSWORD", "")
_ENV_DELETE_AFTER_INGEST = os.environ.get("NEWSLETTERS_DELETE_AFTER_INGEST", "true").lower() in (
    "true",
    "1",
    "yes",
)


def _load_account_config(db: Session) -> Any:
    """Load POP3 config from DB; fall back to env vars for any missing/NULL field."""
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
    # Treat NULL distinctly from False for delete_after_ingest, otherwise a NULL
    # column would silently disable deletion (changing semantics).
    delete_after = acc.delete_after_ingest
    if delete_after is None:
        delete_after = _ENV_DELETE_AFTER_INGEST
    return {
        "server": acc.mail_server or _ENV_MAIL_SERVER,
        "port": int(acc.mail_port or _ENV_MAIL_PORT),
        "ssl_mode": (acc.mail_ssl or _ENV_MAIL_SSL).lower(),
        "email": acc.email or _ENV_EMAIL,
        "password": acc.password or _ENV_PASSWORD,
        "delete_after_ingest": bool(delete_after),
    }


def get_email_body(msg: Any) -> Any:
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
                body = part.get_payload(decode=True).decode(errors="replace")
                if content_type == "text/html" and not html_body:
                    html_body = body
                elif content_type == "text/plain" and not text_body:
                    text_body = body
            except Exception:
                pass
    else:
        content_type = msg.get_content_type()
        try:
            body = msg.get_payload(decode=True).decode(errors="replace")
            if content_type == "text/html":
                html_body = body
            elif content_type == "text/plain":
                text_body = body
        except Exception:
            pass

    # Prefer HTML; fall back to plain text
    return html_body or text_body or ""


# Tags an email must never contain: they execute code, load arbitrary external
# content, or exfiltrate data. Even though rendering uses a sandboxed iframe,
# `allow-same-origin allow-popups` does not block `<iframe>` or `<form>`. If
# `allow-scripts` were ever added, `<script>` and `javascript:` would become
# executable again. Sanitization removes them as defense in depth.
_UNSAFE_TAGS = [
    "script",
    "style",
    "meta",
    "link",
    "head",
    "iframe",
    "object",
    "embed",
    "applet",
    "form",
    "base",
    "frame",
    "frameset",
]

# Attributes that contain URLs and can therefore carry a dangerous scheme.
_URL_ATTRS = ("href", "src", "action", "formaction", "poster", "background", "xlink:href", "data")


def _is_safe_url(value: str) -> bool:
    """Returns False for dangerous URL schemes.

    Blocks `javascript:`, `vbscript:`, `file:`, and non-image `data:` URLs.
    Relative URLs, anchors, and normal schemes such as HTTP, HTTPS, mailto, and
    tel are safe.
    """
    v = value or ""
    if ":" not in v:
        return True  # Relative URL, anchor, or absolute path.
    # Browsers ignore spaces and control characters INSIDE schemes, such as
    # "java\tscript:", so remove them before checking.
    scheme = re.sub(r"[\s\x00-\x20]", "", v.split(":", 1)[0]).lower()
    if scheme in ("javascript", "vbscript", "file"):
        return False
    if scheme == "data":
        return bool(re.match(r"^\s*data:image/", v, re.IGNORECASE))
    return True


def sanitize_html(raw_html: Any) -> Any:
    """
    Clean HTML for safe rendering: remove scripts, styles, dangerous tags
    (iframe/object/form/…), tracking pixels, event handlers and unsafe URL
    schemes (javascript:/data:text/…).
    """
    soup = BeautifulSoup(raw_html, "html.parser")

    # Remove dangerous/noisy tags
    for tag in soup.find_all(_UNSAFE_TAGS):
        tag.decompose()

    # Remove tracking pixels (img with 1x1 or hidden)
    for img in soup.find_all("img"):
        width = img.get("width", "")
        height = img.get("height", "")
        if width in ("1", "0") or height in ("1", "0"):
            img.decompose()
            continue
        # Remove inline style that hides images
        style = str(img.get("style") or "")
        if "display:none" in style.replace(" ", "") or "visibility:hidden" in style.replace(
            " ", ""
        ):
            img.decompose()

    # Remove event handlers (on*), class/id, and any URL attribute whose value
    # uses a dangerous scheme (javascript:/data:text/…).
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.startswith("on") or attr in ("class", "id"):
                del tag[attr]
            elif attr in _URL_ATTRS and not _is_safe_url(str(tag.get(attr) or "")):
                del tag[attr]

    return str(soup)


def _decode_mime_words(raw: str) -> str:
    """Decode an RFC2047-encoded header value to a plain Python string."""
    if not raw:
        return ""
    try:
        parts = decode_header(raw)
        out = ""
        for part, enc in parts:
            if isinstance(part, bytes):
                codec = enc
                if codec:
                    codec = codec.strip().strip('"').strip("'").lower()
                    if codec in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                        codec = "utf-8"
                else:
                    codec = "utf-8"
                try:
                    out += part.decode(codec, errors="replace")
                except LookupError:
                    out += part.decode("latin1", errors="replace")
                except Exception:
                    out += part.decode("utf-8", errors="replace")
            else:
                out += part
        return out.strip()
    except Exception:
        return raw


def _extract_sender(msg: Any) -> tuple[str, str]:
    """Extract (display_name, email) from the From header. Falls back gracefully."""
    raw_from = msg.get("From", "") or msg.get("Sender", "") or ""
    decoded = _decode_mime_words(raw_from)
    name, addr = email.utils.parseaddr(decoded)
    addr = (addr or "").strip().lower()
    name = (name or "").strip().strip('"').strip("'")
    if not name:
        # Use the part before @ as a friendly name
        name = addr.split("@")[0] if addr else "Unknown sender"
    return name, addr


def _get_or_create_sender_source(db: Session, msg: Any) -> FeedSource:
    """
    Returns the FeedSource for the sender of this email.
    Each unique sender email gets its own FeedSource (type=newsletter)
    so users can filter by individual newsletter in the reader.
    """
    name, addr = _extract_sender(msg)
    source_url = f"mailto:{addr}" if addr else "mailto:unknown@local"
    auto_name = addr.split("@")[0] if addr else ""
    new_is_real = bool(name) and name != auto_name

    existing = db.query(FeedSource).filter(FeedSource.url == source_url).first()
    if existing:
        # Only upgrade the display name if the new one is a real "From"
        # (not just the email's local part). Avoids degrading a friendly
        # name to "username" when later emails arrive without From name.
        if new_is_real and existing.name != name:
            setattr(existing, "name", name)
            db.commit()
        return existing

    new_source = FeedSource(
        name=name or addr or "Newsletter",
        url=source_url,
        category="Newsletters",
        type="newsletter",
    )
    db.add(new_source)
    db.commit()
    db.refresh(new_source)
    log.info(f"  ➕ New newsletter source: {new_source.name} <{addr}>")
    return new_source


def _connect_pop3(server: str, port: int, ssl_mode: str, email: str, password: str) -> Any:
    """Connect to POP3 server with appropriate encryption."""
    ssl_mode = (ssl_mode or "starttls").lower()
    pop: poplib.POP3
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


def _is_valid_pop3_host(host: str) -> bool:
    if not host:
        return False
    try:
        host.encode("idna")
        return True
    except Exception:
        return False


def _decode_subject(msg: Any) -> str:
    subject_raw = msg.get("Subject", "(No subject)")
    try:
        decoded_parts = decode_header(subject_raw)
    except Exception:
        decoded_parts = [(subject_raw, None)]
    subject = ""
    for part, encoding in decoded_parts:
        if not isinstance(part, bytes):
            subject += part
            continue
        codec = encoding.strip().strip('"').strip("'").lower() if encoding else "utf-8"
        if codec in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
            codec = "utf-8"
        try:
            subject += part.decode(codec, errors="replace")
        except LookupError:
            subject += part.decode("latin1", errors="replace")
        except Exception:
            subject += part.decode("utf-8", errors="replace")
    return subject


def _message_date(msg: Any) -> datetime:
    date_tuple = email.utils.parsedate_tz(msg.get("Date", ""))
    if date_tuple:
        return datetime.fromtimestamp(email.utils.mktime_tz(date_tuple), tz=timezone.utc)
    return datetime.now(timezone.utc)


def _message_content(msg: Any) -> str:
    raw_body = get_email_body(msg)
    if "<" in raw_body and ">" in raw_body:
        return str(sanitize_html(raw_body))
    paragraphs = raw_body.strip().split("\n")
    return "\n".join(f"<p>{paragraph.strip()}</p>" for paragraph in paragraphs if paragraph.strip())


def _store_newsletter_message(
    db: Session, pop: Any, message_number: int, source_factory: Any
) -> tuple[int, str]:
    _, lines, _ = pop.retr(message_number)
    msg = email.message_from_bytes(b"\r\n".join(lines))
    subject = _decode_subject(msg)
    local_date = _message_date(msg)
    content = _message_content(msg)
    message_id = sanitize_filename_component(msg.get("Message-ID", ""))
    if not message_id:
        message_id = hashlib.md5(f"{subject}{local_date}".encode()).hexdigest()
    unique_url = f"mail://{message_id}"
    existing = db.query(Article).filter(Article.url == unique_url).first()
    if existing:
        return 0, subject
    sender_source = source_factory(db, msg)
    new_article = Article(
        source_id=sender_source.id,
        title=subject.strip(),
        url=unique_url,
        content=content,
        published_at=local_date,
        is_read=False,
    )
    with db.begin_nested():
        db.add(new_article)
        db.flush()
    log.info(f"  📩 [{sender_source.name}] {subject.strip()[:60]}")
    return 1, subject


def _ingest_pop3_messages(
    db: Session,
    pop: Any,
    num_messages: int,
    delete_after_ingest: bool,
    source_factory: Any,
) -> tuple[int, list[int]]:
    new_articles_count = 0
    delete_ids: list[int] = []
    for message_number in range(1, num_messages + 1):
        subject = "(No subject)"
        try:
            added, subject = _store_newsletter_message(db, pop, message_number, source_factory)
            new_articles_count += added
            if delete_after_ingest:
                delete_ids.append(message_number)
        except Exception as exc:
            log.warning(
                f"  ⚠️ Skipping malformed newsletter #{message_number} "
                f"({subject.strip()[:60]!r}): {exc}"
            )
    return new_articles_count, delete_ids


def fetch_and_store_newsletters(
    *,
    engine_factory: Any = get_engine_for_path,
    vault_path_factory: Any = get_active_vault_path,
    connect_pop3: Any = _connect_pop3,
    source_factory: Any = _get_or_create_sender_source,
) -> Any:
    """
    Connects to POP3 server, downloads all emails, stores them as
    articles in the DB, and deletes them from the server.
    Reads config from the NewsletterAccount table; falls back to env vars.
    """
    v_path = vault_path_factory()
    _, SessionLocal = engine_factory(v_path)
    db: Session = SessionLocal()
    try:
        cfg = _load_account_config(db)
        server = (cfg.get("server") or "").strip()

        if not cfg["email"] or not cfg["password"] or not _is_valid_pop3_host(server):
            log.warning(
                f"⚠️ Newsletter POP3 is not configured or has an invalid host ('{server}'). "
                "Skipping newsletters."
            )
            return 0

        try:
            pop = connect_pop3(
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

            new_articles_count, delete_ids = _ingest_pop3_messages(
                db,
                pop,
                num_messages,
                bool(cfg["delete_after_ingest"]),
                source_factory,
            )

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
