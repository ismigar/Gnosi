from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from backend.data.db import get_db
from backend.models import reader as models
import logging
import os
import xml.etree.ElementTree as ET
from fastapi.responses import FileResponse
from backend.services.workspace_service import get_workspace_context, require_role
from backend.services.context_vars import get_active_vault_path

log = logging.getLogger(__name__)
ALLOWED_SSL_MODES = ("starttls", "ssl", "none")

# Tables and models are now managed automatically per vault in db.py
router = APIRouter(prefix="/api/reader", tags=["reader"], dependencies=[Depends(get_workspace_context)])


class ReaderAnalysisRequest(BaseModel):
    """Validated scope and output preferences for a durable Reader analysis."""

    unread_only: bool = True
    source_ids: List[int] = Field(default_factory=list, max_length=50)
    categories: List[str] = Field(default_factory=list, max_length=50)
    date_from: str = Field(default="", max_length=64)
    date_to: str = Field(default="", max_length=64)
    language: str = Field(default="Catalan", max_length=64)
    guidance: str = Field(default="", max_length=2_000)

    def source_scope(self) -> Dict[str, Any]:
        return {
            "unread_only": self.unread_only,
            "source_ids": self.source_ids,
            "categories": self.categories,
            "date_from": self.date_from,
            "date_to": self.date_to,
            "include_full_content": True,
        }

# -- Feed Sources --

@router.get("/sources", response_model=List[models.FeedSourceResponse])
def get_sources(db: Session = Depends(get_db)):
    """List all feed sources"""
    sources = db.query(models.FeedSource).all()
    return sources

@router.post("/sources", response_model=models.FeedSourceResponse, dependencies=[Depends(require_role("editor"))])
def create_source(source: models.FeedSourceCreate, db: Session = Depends(get_db)):
    """Add a new feed source"""
    db_source = db.query(models.FeedSource).filter(models.FeedSource.url == source.url).first()
    if db_source:
        raise HTTPException(status_code=400, detail="Source URL already registered")
    
    new_source = models.FeedSource(**source.dict())
    db.add(new_source)
    db.commit()
    db.refresh(new_source)
    return new_source

@router.delete("/sources/{source_id}", dependencies=[Depends(require_role("editor"))])
def delete_source(source_id: int, db: Session = Depends(get_db)):
    """Delete a source and its articles"""
    db_source = db.query(models.FeedSource).filter(models.FeedSource.id == source_id).first()
    if not db_source:
        raise HTTPException(status_code=404, detail="Source not found")
    
    db.delete(db_source)
    db.commit()
    return {"message": "Source deleted successfully"}

@router.post("/sources/opml", dependencies=[Depends(require_role("editor"))])
async def upload_opml(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload an OPML file to import feeds"""
    log.info(f"[OPML] Iniciant pujada de: {file.filename}")
    if not file.filename.endswith('.opml') and not file.filename.endswith('.xml'):
        log.warning("[OPML] File has an unsupported extension: %s", file.filename)
        raise HTTPException(status_code=400, detail="File must be .opml or .xml")
    
    log.info("[OPML] Reading file contents")
    content = await file.read()
    log.info(f"[OPML] Contingut llegit: {len(content)} bytes. Parsejant XML...")
    try:
        tree = ET.fromstring(content)
        log.info("[OPML] XML parsejat correctament.")
    except ET.ParseError as e:
        log.error(f"[OPML] Error de parsing XML: {e}")
        raise HTTPException(status_code=400, detail="Invalid XML format")

    log.info("[OPML] Generant parent_map...")
    parent_map = {child: parent for parent in tree.iter() for child in parent}
    log.info(f"[OPML] parent_map generat. Mida: {len(parent_map)}")

    imported_count = 0
    outlines = tree.findall('.//outline')
    log.info("[OPML] Found %d outline elements", len(outlines))
    for idx, outline in enumerate(outlines):
        if 'xmlUrl' not in outline.attrib:
            continue

        url = outline.attrib.get('xmlUrl')
        title = outline.attrib.get('title', outline.attrib.get('text', 'Unknown'))
        log.info(f"[OPML] Processant outline #{idx}: {title} ({url})")

        category = "Uncategorized"
        ancestor = parent_map.get(outline)
        log.info(f"  [OPML] Ancestor inicial: {ancestor.tag if ancestor is not None else None}")
        
        step = 0
        while ancestor is not None and ancestor.tag == 'outline':
            step += 1
            log.info(f"    [OPML] Pas de bucle {step}: ancestor={ancestor.tag}, attrib={ancestor.attrib}")
            if 'xmlUrl' not in ancestor.attrib:
                category = ancestor.attrib.get('title', ancestor.attrib.get('text', category))
                log.info(f"    [OPML] Categoria trobada: {category}. Surt del bucle.")
                break
            ancestor = parent_map.get(ancestor)
            if step > 1000:
                log.error("[OPML] BUCLE INFINIT DETECTAT EN ELS ANCESTORS!")
                break

        log.info(f"  [OPML] Categoria resolta: {category}. Cerca a DB...")
        existing = db.query(models.FeedSource).filter(models.FeedSource.url == url).first()
        log.info(f"  [OPML] Cerca completada. Existeix? {existing is not None}")
        if not existing:
            new_source = models.FeedSource(name=title, url=url, category=category, type="rss")
            db.add(new_source)
            imported_count += 1
            log.info(f"  [OPML] Afegida nova font a la sessió.")

    log.info("[OPML] Committing to the database; newly imported: %d", imported_count)
    db.commit()
    log.info("[OPML] Commit completat amb èxit!")
    return {"message": f"Successfully imported {imported_count} new feeds."}


# -- Newsletter POP3 account --

def _env_default_account_dict() -> dict:
    """Default values from env vars when no DB row exists yet."""
    return {
        "mail_server": os.environ.get("NEWSLETTERS_MAIL_SERVER", ""),
        "mail_port": int(os.environ.get("NEWSLETTERS_MAIL_PORT", "110") or 110),
        "mail_ssl": os.environ.get("NEWSLETTERS_MAIL_SSL", "starttls").lower(),
        "email": os.environ.get("NEWSLETTERS_EMAIL", ""),
        "password": os.environ.get("NEWSLETTERS_PASSWORD", ""),
        "delete_after_ingest": os.environ.get("NEWSLETTERS_DELETE_AFTER_INGEST", "true").lower() in ("true", "1", "yes"),
    }


def _create_account_with_env_defaults(db: Session) -> models.NewsletterAccount:
    """Persist a new NewsletterAccount row using env-var defaults. Caller commits."""
    defaults = _env_default_account_dict()
    acc = models.NewsletterAccount(**defaults)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


def _account_to_response(acc: Optional[models.NewsletterAccount]) -> models.NewsletterAccountResponse:
    """Render a sanitized response. If no row exists, fall back to env defaults."""
    if acc is None:
        d = _env_default_account_dict()
        return models.NewsletterAccountResponse(
            mail_server=d["mail_server"] or "",
            mail_port=d["mail_port"] or 110,
            mail_ssl=d["mail_ssl"] or "starttls",
            email=d["email"] or "",
            delete_after_ingest=bool(d["delete_after_ingest"]),
            password_set=bool(d["password"]),
            updated_at=None,
        )
    return models.NewsletterAccountResponse(
        mail_server=acc.mail_server or "",
        mail_port=acc.mail_port or 110,
        mail_ssl=acc.mail_ssl or "starttls",
        email=acc.email or "",
        delete_after_ingest=acc.delete_after_ingest if acc.delete_after_ingest is not None else _env_default_account_dict()["delete_after_ingest"],
        password_set=bool(acc.password),
        updated_at=acc.updated_at,
    )


@router.get("/newsletter-account", response_model=models.NewsletterAccountResponse)
def get_newsletter_account(db: Session = Depends(get_db)):
    """
    Read POP3 newsletter account config. Side-effect-free: if no row exists,
    returns env-var defaults without persisting anything. Password is never
    returned (only the boolean `password_set`).
    """
    acc = db.query(models.NewsletterAccount).first()
    return _account_to_response(acc)


@router.put("/newsletter-account", response_model=models.NewsletterAccountResponse, dependencies=[Depends(require_role("editor"))])
def update_newsletter_account(payload: models.NewsletterAccountUpdate, db: Session = Depends(get_db)):
    """Update POP3 newsletter account. Only fields provided are updated; password optional."""
    # PUT is the path that may persist a new row if none exists yet.
    acc = db.query(models.NewsletterAccount).first()
    if acc is None:
        acc = _create_account_with_env_defaults(db)

    if payload.mail_server is not None:
        acc.mail_server = payload.mail_server.strip()
    if payload.mail_port is not None:
        acc.mail_port = int(payload.mail_port)
    if payload.mail_ssl is not None:
        ssl = (payload.mail_ssl or "starttls").lower()
        if ssl not in ALLOWED_SSL_MODES:
            raise HTTPException(status_code=400, detail=f"mail_ssl must be one of {ALLOWED_SSL_MODES}")
        acc.mail_ssl = ssl
    if payload.email is not None:
        acc.email = payload.email.strip()
    if payload.password is not None and payload.password != "":
        # Only overwrite password if a non-empty new value is provided.
        acc.password = payload.password
    if payload.delete_after_ingest is not None:
        acc.delete_after_ingest = bool(payload.delete_after_ingest)
    acc.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(acc)
    return _account_to_response(acc)


@router.post("/newsletter-account/test", dependencies=[Depends(require_role("editor"))])
def test_newsletter_account(payload: Optional[models.NewsletterAccountUpdate] = None, db: Session = Depends(get_db)):
    """Try to log in to the POP3 server and report number of messages waiting.

    Side-effect-free: never persists anything. If a payload is provided, those
    values override the stored ones (useful for testing credentials before
    saving). Empty/None fields fall back to DB values, then to env defaults.
    """
    from backend.services.mail_ingester import test_connection

    # Start from DB row (or env defaults) without creating a row.
    acc = db.query(models.NewsletterAccount).first()
    defaults = _env_default_account_dict()
    server = (acc.mail_server if acc else None) or defaults["mail_server"]
    port = int((acc.mail_port if acc else None) or defaults["mail_port"])
    ssl_mode = (acc.mail_ssl if acc else None) or defaults["mail_ssl"]
    email_account = (acc.email if acc else None) or defaults["email"]
    password = (acc.password if acc else None) or defaults["password"]

    if payload:
        if payload.mail_server is not None and payload.mail_server.strip():
            server = payload.mail_server.strip()
        if payload.mail_port is not None:
            port = int(payload.mail_port)
        if payload.mail_ssl is not None and payload.mail_ssl.strip():
            ssl_candidate = payload.mail_ssl.strip().lower()
            if ssl_candidate not in ALLOWED_SSL_MODES:
                raise HTTPException(status_code=400, detail=f"mail_ssl must be one of {ALLOWED_SSL_MODES}")
            ssl_mode = ssl_candidate
        if payload.email is not None and payload.email.strip():
            email_account = payload.email.strip()
        if payload.password is not None and payload.password != "":
            password = payload.password

    if not email_account or not password or not server:
        raise HTTPException(status_code=400, detail="Server, email, and password are required.")

    try:
        n = test_connection(
            server=server,
            port=port,
            ssl_mode=ssl_mode,
            email=email_account,
            password=password,
        )
        return {"ok": True, "messages": n, "message": f"Connexió OK. {n} missatge(s) a la bústia."}
    except Exception as e:
        # Log the raw error server-side; return a stable, non-leaky message to the UI.
        log.warning("POP3 test_connection failed for %s@%s:%s: %s", email_account, server, port, e)
        raise HTTPException(status_code=400, detail="Connexió POP3 fallida. Comprova servidor, port, encriptació i credencials.")


def _run_newsletter_sync_safe() -> None:
    """Background task wrapper that swallows exceptions (logs them)."""
    from backend.services.mail_ingester import fetch_and_store_newsletters
    try:
        count = fetch_and_store_newsletters()
        log.info("Newsletter sync finished: %s new article(s)", count or 0)
    except Exception:
        log.exception("Newsletter sync failed")


@router.post("/newsletter-account/sync", dependencies=[Depends(require_role("editor"))])
def sync_newsletter_account(background_tasks: BackgroundTasks):
    """
    Schedule a newsletter ingestion run. Returns immediately (202 Accepted-ish);
    the actual POP3 fetch happens in the background to avoid blocking the
    request when the mailbox has many messages or POP3 is slow.
    """
    background_tasks.add_task(_run_newsletter_sync_safe)
    return {"ok": True, "message": "Sincronització iniciada en segon pla."}


# -- Articles --


@router.get("/inventory")
def get_reader_inventory(
    unread_only: bool = True,
    source_id: Optional[List[int]] = Query(default=None),
    category: Optional[List[str]] = Query(default=None),
    date_from: str = "",
    date_to: str = "",
):
    """Return exact Reader counts and source breakdown without fetching rows."""
    from backend.agent.internal_sources import _reader_inventory, normalize_internal_scope

    scope = normalize_internal_scope("reader", {
        "unread_only": unread_only,
        "source_ids": source_id or [],
        "categories": category or [],
        "date_from": date_from,
        "date_to": date_to,
    })
    return _reader_inventory(scope)


@router.post(
    "/analysis",
    dependencies=[Depends(require_role("editor"))],
)
def start_reader_analysis(payload: ReaderAnalysisRequest):
    """Snapshot the selected Reader corpus and start durable topic analysis."""
    from backend.services.reader_analysis import start_analysis

    return start_analysis(
        get_active_vault_path(),
        payload.source_scope(),
        language=payload.language,
        guidance=payload.guidance,
    )


@router.get("/analysis")
def list_reader_analyses(limit: int = Query(default=20, ge=1, le=100)):
    """List recent durable Reader analyses in the active vault."""
    from backend.services.reader_analysis import list_analyses

    return list_analyses(get_active_vault_path(), limit=limit)


@router.get("/analysis/{job_id}")
def get_reader_analysis_status(job_id: str):
    """Return progress for one analysis job in the active vault."""
    from backend.services.reader_analysis import get_status

    try:
        return get_status(get_active_vault_path(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error


@router.get("/analysis/{job_id}/result")
def get_reader_analysis_result(job_id: str):
    """Return the structured cited result for one completed analysis."""
    from backend.services.reader_analysis import read_result

    try:
        return read_result(get_active_vault_path(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post(
    "/analysis/{job_id}/resume",
    dependencies=[Depends(require_role("editor"))],
)
def resume_reader_analysis(job_id: str):
    """Resume a durable job from completed checkpoints."""
    from backend.services.reader_analysis import resume_analysis

    try:
        return resume_analysis(get_active_vault_path(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error


@router.post(
    "/analysis/{job_id}/cancel",
    dependencies=[Depends(require_role("editor"))],
)
def cancel_reader_analysis(job_id: str):
    """Request cooperative cancellation of a running analysis."""
    from backend.services.reader_analysis import cancel_analysis

    try:
        return cancel_analysis(get_active_vault_path(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error

@router.get("/articles", response_model=List[models.ArticleResponse])
def get_articles(
    unread_only: bool = True,
    source_id: Optional[List[int]] = Query(default=None),
    limit: int = 500,
    db: Session = Depends(get_db),
):
    """List articles. Filters: unread only, one or more source IDs.

    `source_id` can be repeated (`?source_id=1&source_id=2`) or omitted to
    return articles from all sources.
    """
    from sqlalchemy.orm import joinedload
    query = db.query(models.Article).options(joinedload(models.Article.source))

    if unread_only:
        query = query.filter(models.Article.is_read == False)

    if source_id:
        # Filter by any of the provided source IDs (OR semantics).
        query = query.filter(models.Article.source_id.in_(source_id))

    articles = query.order_by(models.Article.published_at.desc()).limit(limit).all()
    
    result = []
    for art in articles:
        data = models.ArticleResponse.model_validate(art)
        data.source_name = art.source.name if art.source else None
        result.append(data)
    return result

@router.patch("/articles/{article_id}/read", dependencies=[Depends(require_role("editor"))])
def mark_article_read(article_id: int, read: bool = True, db: Session = Depends(get_db)):
    """Mark an article as read or unread"""
    db_article = db.query(models.Article).filter(models.Article.id == article_id).first()
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")

    db_article.is_read = read
    db.commit()
    return {"message": f"Article marked as {'read' if read else 'unread'}"}


@router.post(
    "/articles/{article_id}/extract",
    dependencies=[Depends(require_role("editor"))],
)
def extract_article_full_content(article_id: int, db: Session = Depends(get_db)):
    """Force a full-text extraction for an existing article.

    Used to recover the body for old rows ingested before the extractor
    existed, or to refresh `full_content` when the publisher updated the
    article. Returns 200 with the extracted length on success, or 422 if
    extraction returned nothing (paywall, JS-rendered, blocked, etc.).
    """
    from backend.services.article_extractor import extract_full_content as _extract

    db_article = db.query(models.Article).filter(models.Article.id == article_id).first()
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")

    extracted = _extract(db_article.url)
    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="Could not extract full content from the article URL.",
        )

    db_article.full_content = extracted
    db.commit()
    return {"message": "ok", "length": len(extracted)}


# Global state for the bulk backfill task. Same shape as
# `audio_summarizer.generation_status` so the FE can poll it the same
# way. The thread is daemon=True so it dies with the worker; the user
# can re-trigger after a restart and we'll resume from whatever's still
# missing.
backfill_status = {
    "running": False,
    "total": 0,
    "done": 0,
    "extracted": 0,
    "failed": 0,
    "current": "",
    "error": None,
}


def _run_backfill(vault_path):
    """Iterate excerpt-only articles, extract via trafilatura, persist.

    Polite: 1s sleep between fetches of the same hostname so we don't
    hammer a single publisher. 8s per-request timeout already lives in
    the extractor. Stops if the global flag goes False (set on a fresh
    trigger; container restart is an implicit stop).
    """
    import time
    from urllib.parse import urlparse
    from sqlalchemy.orm import sessionmaker
    from backend.data.db import get_engine_for_path
    from backend.services.article_extractor import (
        extract_full_content,
        looks_like_excerpt,
    )
    from backend.services.context_vars import active_vault_path

    # ContextVars don't propagate to fresh threads; set it explicitly
    # so anything inside the worker that calls get_active_vault_path()
    # (logging, downstream services) sees the right vault.
    active_vault_path.set(vault_path)
    engine, _ = get_engine_for_path(vault_path)
    SessionLocal = sessionmaker(bind=engine)

    last_seen_at = {}  # hostname -> monotonic timestamp

    try:
        with SessionLocal() as db:
            # Pick everything that still lacks a full_content. We then
            # filter client-side to those that look like excerpts so we
            # don't waste an HTTP call on already-rich articles.
            candidates = (
                db.query(models.Article)
                .filter(models.Article.full_content.is_(None))
                .order_by(models.Article.published_at.desc().nullslast())
                .all()
            )
            targets = [a for a in candidates if looks_like_excerpt(a.content)]
            backfill_status["total"] = len(targets)
            log.info("Backfill: %s articles to process", len(targets))

            for art in targets:
                if not backfill_status["running"]:
                    log.info("Backfill: stopped externally")
                    break
                backfill_status["current"] = (art.title or "")[:80]

                # Per-host rate limit
                try:
                    host = urlparse(art.url).hostname or ""
                except Exception:
                    host = ""
                now = time.monotonic()
                wait = 1.0 - (now - last_seen_at.get(host, 0))
                if wait > 0:
                    time.sleep(wait)
                last_seen_at[host] = time.monotonic()

                extracted = extract_full_content(art.url)
                if extracted:
                    art.full_content = extracted
                    db.commit()
                    backfill_status["extracted"] += 1
                else:
                    backfill_status["failed"] += 1
                backfill_status["done"] += 1
    except Exception as e:
        log.exception("Backfill crashed")
        backfill_status["error"] = str(e)
    finally:
        backfill_status["running"] = False
        backfill_status["current"] = ""


@router.post(
    "/articles/backfill-extract",
    dependencies=[Depends(require_role("editor"))],
)
def trigger_backfill_extract():
    """Spin up a background pass that fills `full_content` on existing
    articles whose RSS body looks like an excerpt. Idempotent — only
    rows with `full_content IS NULL` are touched.
    """
    import threading

    if backfill_status["running"]:
        return {"status": "already_running", **backfill_status}

    backfill_status.update(
        running=True, total=0, done=0, extracted=0, failed=0, current="", error=None,
    )

    from backend.services.context_vars import get_active_vault_path
    vault_path = get_active_vault_path()

    thread = threading.Thread(target=_run_backfill, args=(vault_path,), daemon=True)
    thread.start()
    return {"status": "started"}


@router.get("/articles/backfill-extract/status")
def get_backfill_extract_status():
    """Poll the backfill progress. Safe to call any time."""
    return backfill_status


@router.get("/articles/{article_id}", response_model=models.ArticleResponse)
def get_article(article_id: int, db: Session = Depends(get_db)):
    """Read one exact Reader article for evidence links and deep linking."""
    from sqlalchemy.orm import joinedload

    article = (
        db.query(models.Article)
        .options(joinedload(models.Article.source))
        .filter(models.Article.id == article_id)
        .first()
    )
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    result = models.ArticleResponse.model_validate(article)
    result.source_name = article.source.name if article.source else None
    return result


# -- Podcast --

@router.post("/podcast/generate", dependencies=[Depends(require_role("editor"))])
def trigger_podcast_generation():
    """Launches podcast generation in the background"""
    from backend.services.audio_summarizer import start_generation_async, generation_status
    from backend.services.context_vars import get_active_vault_path
    
    if generation_status["running"]:
        return {"status": "already_running", "message": "A podcast is already being generated.", "progress": generation_status["progress"]}
    
    started = start_generation_async(vault_path=get_active_vault_path())
    if not started:
        raise HTTPException(status_code=409, detail="Generation already in progress.")
    return {"status": "started", "message": "Generation started in the background."}

@router.get("/podcast/status")
def get_podcast_status():
    """Returns the current status of podcast generation"""
    from backend.services.audio_summarizer import generation_status
    return {
        "running": generation_status["running"],
        "progress": generation_status["progress"],
        "error": generation_status["error"],
        "result_filename": generation_status["result_filename"],
    }

@router.get("/podcast/info")
def get_podcast_info():
    """Returns information about the last generated podcast"""
    import os
    from datetime import datetime

    from backend.services.audio_summarizer import get_podcast_output_dir

    pod_dir = get_podcast_output_dir()
    pod_dir.mkdir(parents=True, exist_ok=True)

    files = [f for f in os.listdir(pod_dir) if f.endswith('.mp3')]
    if not files:
        return {"exists": False}

    latest_file = sorted(files, reverse=True)[0]
    # Previous bug: file_path was built using AUDIO_OUTPUT_DIR (config.paths.AUDIO)
    # but the files lived in pod_dir → getmtime failed with FileNotFoundError.
    file_path = os.path.join(pod_dir, latest_file)

    # Get the modification date
    mtime = os.path.getmtime(file_path)
    dt = datetime.fromtimestamp(mtime)
    
    return {
        "exists": True,
        "filename": latest_file,
        "created_at": dt.isoformat(),
        "formatted_date": dt.strftime("%d/%m/%Y"),
        "formatted_time": dt.strftime("%H:%M")
    }

@router.get("/podcast/latest")
def get_latest_podcast():
    """Download/Stream the most recent podcast"""
    from backend.services.audio_summarizer import get_podcast_output_dir
    
    pod_dir = get_podcast_output_dir()
    if not os.path.exists(pod_dir):
        raise HTTPException(status_code=404, detail="No podcasts available")
        
    files = [f for f in os.listdir(pod_dir) if f.endswith('.mp3')]
    if not files:
        raise HTTPException(status_code=404, detail="No podcasts available")
        
    # Sort files by name (which contains the date format YYYY_MM_DD) to get the latest
    latest_file = sorted(files, reverse=True)[0]
    file_path = os.path.join(pod_dir, latest_file)
    
    return FileResponse(file_path, media_type="audio/mpeg", filename="gnosi_daily.mp3")
