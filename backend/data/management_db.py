from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import os
from pathlib import Path
from typing import Generator

# Helper to resolve the database path safely
def _get_mgmt_db_path() -> Path:
    from backend.config.app_config import load_params
    cfg = load_params(strict_env=False)
    
    # Prioritat: Ruta de dades configurada al vault/.system
    db_path = cfg.paths.get("MGMT_DB")
    
    if not db_path:
        # Fallback a la carpeta data del projecte
        project_root = cfg.paths.get("PROJECT_DIR") or Path(__file__).resolve().parents[2]
        db_path = project_root / "data" / "management.sqlite"
        
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path

# Globals for lazy init
_engine = None
_SessionLocal = None
Base = declarative_base()

def _get_or_init_mgmt_engine():
    global _engine, _SessionLocal
    if _engine is None:
        db_path = _get_mgmt_db_path()
        db_url = f"sqlite:///{db_path}"
        _engine = create_engine(
            db_url, connect_args={"check_same_thread": False}
        )
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
        # Assegurar que les taules existeixen
        Base.metadata.create_all(bind=_engine)
    return _engine, _SessionLocal

def get_mgmt_db() -> Generator[Session, None, None]:
    """Dependency per a FastAPI o ús intern."""
    _, SessionLocal = _get_or_init_mgmt_engine()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Per a ús fora del context de dependency (ex: scripts d'inicialització)
def get_mgmt_session() -> Session:
    _, SessionLocal = _get_or_init_mgmt_engine()
    return SessionLocal()
