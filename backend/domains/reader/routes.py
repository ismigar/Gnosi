from datetime import datetime, timezone
import logging
import os
from typing import Any, List, Optional, TypedDict, cast
import xml.etree.ElementTree as ET

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from backend.data.db import get_db
from backend.domains.reader.analysis_routes import (
    ReaderAnalysisRequest as ReaderAnalysisRequest,
    cancel_reader_analysis as cancel_reader_analysis,
    get_reader_analysis_result as get_reader_analysis_result,
    get_reader_analysis_status as get_reader_analysis_status,
    get_reader_inventory as get_reader_inventory,
    list_reader_analyses as list_reader_analyses,
    register_routes as _register_analysis_routes,
    resume_reader_analysis as resume_reader_analysis,
    start_reader_analysis as start_reader_analysis,
)
from backend.domains.reader.backfill_routes import (
    BackfillStatus as BackfillStatus,
    _run_backfill as _run_backfill,
    backfill_status as backfill_status,
    get_backfill_extract_status as get_backfill_extract_status,
    register_routes as _register_backfill_routes,
    trigger_backfill_extract as trigger_backfill_extract,
)
from backend.domains.reader.internal_sources import fetch_newsletters
from backend.domains.reader.podcast_routes import (
    get_latest_podcast as get_latest_podcast,
    get_podcast_info as get_podcast_info,
    get_podcast_status as get_podcast_status,
    register_routes as _register_podcast_routes,
    trigger_podcast_generation as trigger_podcast_generation,
)
from backend.domains.reader.routing import (
    RouteReturn,
    require_active_vault as _require_active_vault,
)
from backend.domains.reader.schemas import (
    NewsletterConnectionTestResponse,
    NewsletterSyncResponse,
    ReaderArticleExtractResponse,
    ReaderArticleReadResponse,
    ReaderMessageResponse,
)
from backend.models import reader as models
from backend.services.workspace_service import get_workspace_context, require_role


log = logging.getLogger(__name__)


ALLOWED_SSL_MODES = ("starttls", "ssl", "none")


class NewsletterDefaults(TypedDict):
    mail_server: str
    mail_port: int
    mail_ssl: str
    email: str
    password: str
    delete_after_ingest: bool


router = APIRouter(
    prefix="/api/reader", tags=["reader"], dependencies=[Depends(get_workspace_context)]
)


@router.get("/sources", response_model=List[models.FeedSourceResponse])
def get_sources(db: Session = Depends(get_db)) -> RouteReturn:
    """List all feed sources"""
    sources = db.query(models.FeedSource).all()
    return sources


@router.post(
    "/sources",
    response_model=models.FeedSourceResponse,
    dependencies=[Depends(require_role("editor"))],
)
def create_source(source: models.FeedSourceCreate, db: Session = Depends(get_db)) -> RouteReturn:
    """Add a new feed source"""
    db_source = db.query(models.FeedSource).filter(models.FeedSource.url == source.url).first()
    if db_source:
        raise HTTPException(status_code=400, detail="Source URL already registered")

    new_source = models.FeedSource(**source.dict())
    db.add(new_source)
    db.commit()
    db.refresh(new_source)
    return new_source


@router.delete(
    "/sources/{source_id}",
    response_model=ReaderMessageResponse,
    dependencies=[Depends(require_role("editor"))],
)
def delete_source(source_id: int, db: Session = Depends(get_db)) -> RouteReturn:
    """Delete a source and its articles"""
    db_source = db.query(models.FeedSource).filter(models.FeedSource.id == source_id).first()
    if not db_source:
        raise HTTPException(status_code=404, detail="Source not found")

    db.delete(db_source)
    db.commit()
    return {"message": "Source deleted successfully"}


@router.post(
    "/sources/opml",
    response_model=ReaderMessageResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def upload_opml(file: UploadFile = File(...), db: Session = Depends(get_db)) -> RouteReturn:
    """Upload an OPML file to import feeds"""
    log.info(f"[OPML] Iniciant pujada de: {file.filename}")
    filename = cast(str, file.filename)
    if not filename.endswith(".opml") and not filename.endswith(".xml"):
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
    outlines = tree.findall(".//outline")
    log.info("[OPML] Found %d outline elements", len(outlines))
    for idx, outline in enumerate(outlines):
        if "xmlUrl" not in outline.attrib:
            continue

        url = outline.attrib.get("xmlUrl")
        title = outline.attrib.get("title", outline.attrib.get("text", "Unknown"))
        log.info(f"[OPML] Processant outline #{idx}: {title} ({url})")

        category = "Uncategorized"
        ancestor = parent_map.get(outline)
        log.info(f"  [OPML] Ancestor inicial: {ancestor.tag if ancestor is not None else None}")

        step = 0
        while ancestor is not None and ancestor.tag == "outline":
            step += 1
            log.info(
                f"    [OPML] Pas de bucle {step}: ancestor={ancestor.tag}, attrib={ancestor.attrib}"
            )
            if "xmlUrl" not in ancestor.attrib:
                category = ancestor.attrib.get("title", ancestor.attrib.get("text", category))
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


def _env_default_account_dict() -> NewsletterDefaults:
    """Default values from env vars when no DB row exists yet."""
    return {
        "mail_server": os.environ.get("NEWSLETTERS_MAIL_SERVER", ""),
        "mail_port": int(os.environ.get("NEWSLETTERS_MAIL_PORT", "110") or 110),
        "mail_ssl": os.environ.get("NEWSLETTERS_MAIL_SSL", "starttls").lower(),
        "email": os.environ.get("NEWSLETTERS_EMAIL", ""),
        "password": os.environ.get("NEWSLETTERS_PASSWORD", ""),
        "delete_after_ingest": os.environ.get("NEWSLETTERS_DELETE_AFTER_INGEST", "true").lower()
        in ("true", "1", "yes"),
    }


def _create_account_with_env_defaults(db: Session) -> models.NewsletterAccount:
    """Persist a new NewsletterAccount row using env-var defaults. Caller commits."""
    defaults = _env_default_account_dict()
    acc = models.NewsletterAccount(**defaults)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


def _account_to_response(
    acc: Optional[models.NewsletterAccount],
) -> models.NewsletterAccountResponse:
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
    runtime_acc = cast(Any, acc)
    return models.NewsletterAccountResponse(
        mail_server=runtime_acc.mail_server or "",
        mail_port=runtime_acc.mail_port or 110,
        mail_ssl=runtime_acc.mail_ssl or "starttls",
        email=runtime_acc.email or "",
        delete_after_ingest=runtime_acc.delete_after_ingest
        if runtime_acc.delete_after_ingest is not None
        else _env_default_account_dict()["delete_after_ingest"],
        password_set=bool(runtime_acc.password),
        updated_at=runtime_acc.updated_at,
    )


@router.get("/newsletter-account", response_model=models.NewsletterAccountResponse)
def get_newsletter_account(db: Session = Depends(get_db)) -> RouteReturn:
    """
    Read POP3 newsletter account config. Side-effect-free: if no row exists,
    returns env-var defaults without persisting anything. Password is never
    returned (only the boolean `password_set`).
    """
    acc = db.query(models.NewsletterAccount).first()
    return _account_to_response(acc)


@router.put(
    "/newsletter-account",
    response_model=models.NewsletterAccountResponse,
    dependencies=[Depends(require_role("editor"))],
)
def update_newsletter_account(
    payload: models.NewsletterAccountUpdate, db: Session = Depends(get_db)
) -> RouteReturn:
    """Update POP3 newsletter account. Only fields provided are updated; password optional."""
    # PUT is the path that may persist a new row if none exists yet.
    acc = cast(Any, db.query(models.NewsletterAccount).first())
    if acc is None:
        acc = _create_account_with_env_defaults(db)

    if payload.mail_server is not None:
        acc.mail_server = payload.mail_server.strip()
    if payload.mail_port is not None:
        acc.mail_port = int(payload.mail_port)
    if payload.mail_ssl is not None:
        ssl = (payload.mail_ssl or "starttls").lower()
        if ssl not in ALLOWED_SSL_MODES:
            raise HTTPException(
                status_code=400, detail=f"mail_ssl must be one of {ALLOWED_SSL_MODES}"
            )
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


@router.post(
    "/newsletter-account/test",
    response_model=NewsletterConnectionTestResponse,
    dependencies=[Depends(require_role("editor"))],
)
def test_newsletter_account(
    payload: Optional[models.NewsletterAccountUpdate] = None, db: Session = Depends(get_db)
) -> RouteReturn:
    """Try to log in to the POP3 server and report number of messages waiting.

    Side-effect-free: never persists anything. If a payload is provided, those
    values override the stored ones (useful for testing credentials before
    saving). Empty/None fields fall back to DB values, then to env defaults.
    """
    from backend.services.mail_ingester import test_connection

    # Start from DB row (or env defaults) without creating a row.
    acc = cast(Any, db.query(models.NewsletterAccount).first())
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
                raise HTTPException(
                    status_code=400, detail=f"mail_ssl must be one of {ALLOWED_SSL_MODES}"
                )
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
        raise HTTPException(
            status_code=400,
            detail="Connexió POP3 fallida. Comprova servidor, port, encriptació i credencials.",
        )


def _run_newsletter_sync_safe() -> None:
    """Background task wrapper that swallows exceptions (logs them)."""
    try:
        count = fetch_newsletters()
        log.info("Newsletter sync finished: %s new article(s)", count or 0)
    except Exception:
        log.exception("Newsletter sync failed")


@router.post(
    "/newsletter-account/sync",
    response_model=NewsletterSyncResponse,
    dependencies=[Depends(require_role("editor"))],
)
def sync_newsletter_account(background_tasks: BackgroundTasks) -> RouteReturn:
    """
    Schedule a newsletter ingestion run. Returns immediately (202 Accepted-ish);
    the actual POP3 fetch happens in the background to avoid blocking the
    request when the mailbox has many messages or POP3 is slow.
    """
    background_tasks.add_task(_run_newsletter_sync_safe)
    return {"ok": True, "message": "Sincronització iniciada en segon pla."}


_register_analysis_routes(router)


@router.get("/articles", response_model=List[models.ArticleResponse])
def get_articles(
    unread_only: bool = True,
    source_id: Optional[List[int]] = Query(default=None),
    limit: int = 500,
    db: Session = Depends(get_db),
) -> RouteReturn:
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


@router.patch(
    "/articles/{article_id}/read",
    response_model=ReaderArticleReadResponse,
    dependencies=[Depends(require_role("editor"))],
)
def mark_article_read(
    article_id: int, read: bool = True, db: Session = Depends(get_db)
) -> RouteReturn:
    """Mark an article as read or unread"""
    db_article = cast(
        Any,
        db.query(models.Article).filter(models.Article.id == article_id).first(),
    )
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")

    db_article.is_read = read
    db.commit()
    return {"message": f"Article marked as {'read' if read else 'unread'}"}


@router.post(
    "/articles/{article_id}/extract",
    response_model=ReaderArticleExtractResponse,
    dependencies=[Depends(require_role("editor"))],
)
def extract_article_full_content(article_id: int, db: Session = Depends(get_db)) -> RouteReturn:
    """Force a full-text extraction for an existing article.

    Used to recover the body for old rows ingested before the extractor
    existed, or to refresh `full_content` when the publisher updated the
    article. Returns 200 with the extracted length on success, or 422 if
    extraction returned nothing (paywall, JS-rendered, blocked, etc.).
    """
    from backend.services.article_extractor import extract_full_content as _extract

    db_article = cast(
        Any,
        db.query(models.Article).filter(models.Article.id == article_id).first(),
    )
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


_register_backfill_routes(router)


@router.get("/articles/{article_id}", response_model=models.ArticleResponse)
def get_article(article_id: int, db: Session = Depends(get_db)) -> RouteReturn:
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


_register_podcast_routes(router)
