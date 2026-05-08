from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

from backend.data.db import get_db
from backend.models import reader as models
import os
import xml.etree.ElementTree as ET
from fastapi.responses import FileResponse
from backend.services.audio_summarizer import AUDIO_OUTPUT_DIR, generate_daily_podcast
from backend.services.workspace_service import get_workspace_context, require_role
from fastapi import Depends

# Taules i models ara es gestionen automàticament per cada vault a db.py
router = APIRouter(prefix="/api/reader", tags=["reader"], dependencies=[Depends(get_workspace_context)])

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
    if not file.filename.endswith('.opml') and not file.filename.endswith('.xml'):
        raise HTTPException(status_code=400, detail="File must be .opml or .xml")
    
    content = await file.read()
    try:
        tree = ET.fromstring(content)
    except ET.ParseError:
        raise HTTPException(status_code=400, detail="Invalid XML format")

    parent_map = {child: parent for parent in tree.iter() for child in parent}

    imported_count = 0
    for outline in tree.findall('.//outline'):
        if 'xmlUrl' not in outline.attrib:
            continue

        url = outline.attrib.get('xmlUrl')
        title = outline.attrib.get('title', outline.attrib.get('text', 'Unknown'))

        category = "Uncategorized"
        ancestor = parent_map.get(outline)
        while ancestor is not None and ancestor.tag == 'outline':
            if 'xmlUrl' not in ancestor.attrib:
                category = ancestor.attrib.get('title', ancestor.attrib.get('text', category))
                break
            ancestor = parent_map.get(ancestor)

        existing = db.query(models.FeedSource).filter(models.FeedSource.url == url).first()
        if not existing:
            new_source = models.FeedSource(name=title, url=url, category=category, type="rss")
            db.add(new_source)
            imported_count += 1

    db.commit()
    return {"message": f"Successfully imported {imported_count} new feeds."}


# -- Newsletter POP3 account --

def _get_or_create_account(db: Session) -> models.NewsletterAccount:
    """Single-row table: get the first row, or create one with defaults from env vars."""
    acc = db.query(models.NewsletterAccount).first()
    if acc is None:
        acc = models.NewsletterAccount(
            mail_server=os.environ.get("NEWSLETTERS_MAIL_SERVER", ""),
            mail_port=int(os.environ.get("NEWSLETTERS_MAIL_PORT", "110") or 110),
            mail_ssl=os.environ.get("NEWSLETTERS_MAIL_SSL", "starttls").lower(),
            email=os.environ.get("NEWSLETTERS_EMAIL", ""),
            password=os.environ.get("NEWSLETTERS_PASSWORD", ""),
            delete_after_ingest=os.environ.get("NEWSLETTERS_DELETE_AFTER_INGEST", "true").lower() in ("true", "1", "yes"),
        )
        db.add(acc)
        db.commit()
        db.refresh(acc)
    return acc


def _account_to_response(acc: models.NewsletterAccount) -> models.NewsletterAccountResponse:
    return models.NewsletterAccountResponse(
        mail_server=acc.mail_server or "",
        mail_port=acc.mail_port or 110,
        mail_ssl=acc.mail_ssl or "starttls",
        email=acc.email or "",
        delete_after_ingest=bool(acc.delete_after_ingest),
        password_set=bool(acc.password),
        updated_at=acc.updated_at,
    )


@router.get("/newsletter-account", response_model=models.NewsletterAccountResponse)
def get_newsletter_account(db: Session = Depends(get_db)):
    """Read POP3 newsletter account config (password is never returned)."""
    acc = _get_or_create_account(db)
    return _account_to_response(acc)


@router.put("/newsletter-account", response_model=models.NewsletterAccountResponse, dependencies=[Depends(require_role("editor"))])
def update_newsletter_account(payload: models.NewsletterAccountUpdate, db: Session = Depends(get_db)):
    """Update POP3 newsletter account. Only fields provided are updated; password optional."""
    acc = _get_or_create_account(db)
    if payload.mail_server is not None:
        acc.mail_server = payload.mail_server.strip()
    if payload.mail_port is not None:
        acc.mail_port = int(payload.mail_port)
    if payload.mail_ssl is not None:
        ssl = (payload.mail_ssl or "starttls").lower()
        if ssl not in ("starttls", "ssl", "none"):
            raise HTTPException(status_code=400, detail="mail_ssl must be 'starttls', 'ssl', or 'none'")
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

    If a payload is provided, those values override the stored ones (useful for
    testing credentials before saving). Empty/None fields fall back to DB values.
    """
    from backend.services.mail_ingester import test_connection
    acc = _get_or_create_account(db)

    server = acc.mail_server
    port = int(acc.mail_port or 110)
    ssl_mode = acc.mail_ssl or "starttls"
    email_account = acc.email
    password = acc.password

    if payload:
        if payload.mail_server is not None and payload.mail_server.strip():
            server = payload.mail_server.strip()
        if payload.mail_port is not None:
            port = int(payload.mail_port)
        if payload.mail_ssl is not None and payload.mail_ssl.strip():
            ssl_mode = payload.mail_ssl.strip().lower()
        if payload.email is not None and payload.email.strip():
            email_account = payload.email.strip()
        if payload.password is not None and payload.password != "":
            password = payload.password

    if not email_account or not password or not server:
        raise HTTPException(status_code=400, detail="Falta completar el servidor, l'email i la contrasenya.")

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
        raise HTTPException(status_code=400, detail=f"Connexió fallida: {e}")


@router.post("/newsletter-account/sync", dependencies=[Depends(require_role("editor"))])
def sync_newsletter_account():
    """Trigger a one-shot ingestion run."""
    from backend.services.mail_ingester import fetch_and_store_newsletters
    try:
        count = fetch_and_store_newsletters()
        return {"ok": True, "new_articles": int(count or 0), "message": f"Sincronització OK. {count or 0} article(s) nou(s)."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Sincronització fallida: {e}")


# -- Articles --

@router.get("/articles", response_model=List[models.ArticleResponse])
def get_articles(unread_only: bool = True, source_id: int = None, limit: int = 500, db: Session = Depends(get_db)):
    """List articles (options: unread only, filter by source)"""
    from sqlalchemy.orm import joinedload
    query = db.query(models.Article).options(joinedload(models.Article.source))
    
    if unread_only:
        query = query.filter(models.Article.is_read == False)
    
    if source_id:
        query = query.filter(models.Article.source_id == source_id)
    
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

# -- Podcast --

@router.post("/podcast/generate", dependencies=[Depends(require_role("editor"))])
def trigger_podcast_generation():
    """Launches podcast generation in the background"""
    from backend.services.audio_summarizer import start_generation_async, generation_status
    
    if generation_status["running"]:
        return {"status": "already_running", "message": "A podcast is already being generated.", "progress": generation_status["progress"]}
    
    started = start_generation_async()
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

    from backend.services.context_vars import get_active_vault_path

    # Podcast path within the active vault
    pod_dir = get_active_vault_path() / "data" / "podcasts"
    pod_dir.mkdir(parents=True, exist_ok=True)

    files = [f for f in os.listdir(pod_dir) if f.endswith('.mp3')]
    if not files:
        return {"exists": False}

    latest_file = sorted(files, reverse=True)[0]
    # Bug previ: el file_path es construïa amb AUDIO_OUTPUT_DIR (config.paths.AUDIO)
    # però els fitxers vivien a pod_dir → getmtime fallava amb FileNotFoundError.
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
    from backend.services.context_vars import get_active_vault_path
    
    pod_dir = get_active_vault_path() / "data" / "podcasts"
    if not os.path.exists(pod_dir):
        raise HTTPException(status_code=404, detail="No podcasts available")
        
    files = [f for f in os.listdir(pod_dir) if f.endswith('.mp3')]
    if not files:
        raise HTTPException(status_code=404, detail="No podcasts available")
        
    # Sort files by name (which contains the date format YYYY_MM_DD) to get the latest
    latest_file = sorted(files, reverse=True)[0]
    file_path = os.path.join(pod_dir, latest_file)
    
    return FileResponse(file_path, media_type="audio/mpeg", filename="gnosi_daily.mp3")

