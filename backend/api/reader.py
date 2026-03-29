from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone

from backend.data.db import get_db, engine
from backend.models import reader as models
import os
import xml.etree.ElementTree as ET
from fastapi.responses import FileResponse
from backend.services.audio_summarizer import AUDIO_OUTPUT_DIR, generate_daily_podcast
# Create tables if they don't exist
models.Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/api/reader", tags=["reader"])

# -- Feed Sources --

@router.get("/sources", response_model=List[models.FeedSourceResponse])
def get_sources(db: Session = Depends(get_db)):
    """List all feed sources"""
    sources = db.query(models.FeedSource).all()
    return sources

@router.post("/sources", response_model=models.FeedSourceResponse)
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

@router.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    """Delete a source and its articles"""
    db_source = db.query(models.FeedSource).filter(models.FeedSource.id == source_id).first()
    if not db_source:
        raise HTTPException(status_code=404, detail="Source not found")
    
    db.delete(db_source)
    db.commit()
    return {"message": "Source deleted successfully"}

@router.post("/sources/opml")
async def upload_opml(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload an OPML file to import feeds"""
    if not file.filename.endswith('.opml') and not file.filename.endswith('.xml'):
        raise HTTPException(status_code=400, detail="File must be .opml or .xml")
    
    content = await file.read()
    try:
        tree = ET.fromstring(content)
    except ET.ParseError:
        raise HTTPException(status_code=400, detail="Invalid XML format")

    imported_count = 0
    # Basic OPML parsing
    for outline in tree.findall('.//outline'):
        if 'xmlUrl' in outline.attrib:
            url = outline.attrib.get('xmlUrl')
            title = outline.attrib.get('title', outline.attrib.get('text', 'Unknown'))
            
            # Travesar cap a dalt per trobar la categoria
            category = "Uncategorized"
            parent = getattr(outline, "parent", None) # xml.etree no fa parents fàcils, simplifiquem
            
            # Check if exists
            existing = db.query(models.FeedSource).filter(models.FeedSource.url == url).first()
            if not existing:
                new_source = models.FeedSource(name=title, url=url, category=category, type="rss")
                db.add(new_source)
                imported_count += 1
                
    db.commit()
    return {"message": f"Successfully imported {imported_count} new feeds."}

# -- Articles --

@router.get("/articles", response_model=List[models.ArticleResponse])
def get_articles(unread_only: bool = True, limit: int = 100, db: Session = Depends(get_db)):
    """List articles (options: unread only)"""
    from sqlalchemy.orm import joinedload
    query = db.query(models.Article).options(joinedload(models.Article.source))
    if unread_only:
        query = query.filter(models.Article.is_read == False)
    
    articles = query.order_by(models.Article.published_at.desc()).limit(limit).all()
    
    result = []
    for art in articles:
        data = models.ArticleResponse.model_validate(art)
        data.source_name = art.source.name if art.source else None
        result.append(data)
    return result

@router.patch("/articles/{article_id}/read")
def mark_article_read(article_id: int, read: bool = True, db: Session = Depends(get_db)):
    """Mark an article as read or unread"""
    db_article = db.query(models.Article).filter(models.Article.id == article_id).first()
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")
    
    db_article.is_read = read
    db.commit()
    return {"message": f"Article marked as {'read' if read else 'unread'}"}

# -- Podcast --

@router.post("/podcast/generate")
def trigger_podcast_generation():
    """Llança la generació del podcast en segon pla"""
    from backend.services.audio_summarizer import start_generation_async, generation_status
    
    if generation_status["running"]:
        return {"status": "already_running", "message": "Ja s'està generant un podcast.", "progress": generation_status["progress"]}
    
    started = start_generation_async()
    if not started:
        raise HTTPException(status_code=409, detail="Generació ja en curs.")
    return {"status": "started", "message": "Generació iniciada en segon pla."}

@router.get("/podcast/status")
def get_podcast_status():
    """Retorna l'estat actual de la generació del podcast"""
    from backend.services.audio_summarizer import generation_status
    return {
        "running": generation_status["running"],
        "progress": generation_status["progress"],
        "error": generation_status["error"],
        "result_filename": generation_status["result_filename"],
    }

@router.get("/podcast/info")
def get_podcast_info():
    """Retorna informació sobre l'últim podcast generat"""
    import os
    from datetime import datetime
    
    # AUDIO_OUTPUT_DIR es defineix a l'inici d'aquest fitxer? Ho comprovem: no, ho estem important o usant directament des de audio_summarizer?
    # Revisant l'endpoint get_latest_podcast, utilitza AUDIO_OUTPUT_DIR directament... Anem a resoldre de forma segura:
    from backend.services.audio_summarizer import AUDIO_OUTPUT_DIR
    
    if not os.path.exists(AUDIO_OUTPUT_DIR):
        return {"exists": False}
        
    files = [f for f in os.listdir(AUDIO_OUTPUT_DIR) if f.endswith('.mp3')]
    if not files:
        return {"exists": False}
    
    latest_file = sorted(files, reverse=True)[0]
    file_path = os.path.join(AUDIO_OUTPUT_DIR, latest_file)
    
    # Obtenir la data de modificació
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
    from backend.services.audio_summarizer import AUDIO_OUTPUT_DIR
    import os
    if not os.path.exists(AUDIO_OUTPUT_DIR):
        raise HTTPException(status_code=404, detail="No podcasts available")
        
    files = [f for f in os.listdir(AUDIO_OUTPUT_DIR) if f.endswith('.mp3')]
    if not files:
        raise HTTPException(status_code=404, detail="No podcasts available")
        
    # Sort files by name (which contains the date format YYYY_MM_DD) to get the latest
    latest_file = sorted(files, reverse=True)[0]
    file_path = os.path.join(AUDIO_OUTPUT_DIR, latest_file)
    
    return FileResponse(file_path, media_type="audio/mpeg", filename="gnosi_daily.mp3")

