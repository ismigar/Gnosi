from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, Session, declarative_base
import logging
import os
import threading
from pathlib import Path
from typing import Generator

log = logging.getLogger(__name__)

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
_engine_lock = threading.Lock()
Base = declarative_base()

def _get_or_init_mgmt_engine():
    global _engine, _SessionLocal
    # Double-checked locking: el check ràpid sense lock evita prendre el lock
    # un cop l'engine ja està creat (cas comú). El segon check dins el lock
    # garanteix que dos threads concurrents al primer arrencada no creïn
    # dos engines diferents (i possiblement Base.metadata.create_all races).
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                db_path = _get_mgmt_db_path()
                db_url = f"sqlite:///{db_path}"
                engine = create_engine(
                    db_url,
                    connect_args={"check_same_thread": False},
                    pool_size=20,
                    max_overflow=30,
                    pool_pre_ping=True,
                    pool_recycle=1800,
                )
                Base.metadata.create_all(bind=engine)
                _apply_lightweight_migrations(engine)
                _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
                _engine = engine  # publicar al final per garantir visibilitat
    return _engine, _SessionLocal


def _apply_lightweight_migrations(engine):
    """Afegeix columnes noves a taules ja existents (no tenim Alembic).

    `Base.metadata.create_all` crea taules que falten però MAI columnes noves
    sobre taules que ja existeixen. Quan s'afegeix un camp a un model —p.ex.
    `User.password_hash` per a l'auth JWT— les BD creades abans no el tenen i
    qualsevol query peta amb «no such column». Aquí ho resolem de forma
    idempotent: inspeccionem l'esquema real i fem `ALTER TABLE ... ADD COLUMN`
    només si la columna no hi és. SQLite accepta afegir columnes nullable
    sense reescriure la taula.
    """
    additive_columns = {
        "users": {
            "password_hash": "VARCHAR",
        },
    }
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        for table, columns in additive_columns.items():
            if table not in existing_tables:
                continue  # create_all ja l'haurà creat amb totes les columnes
            present = {c["name"] for c in inspector.get_columns(table)}
            for col_name, col_type in columns.items():
                if col_name in present:
                    continue
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"))
                log.info(f"🛠️ Migració lleugera: afegida columna {table}.{col_name}")
    except Exception as e:
        # No bloquegem l'arrencada per un upgrade fallit; si la columna
        # realment falta, l'error sortirà a la primera query i quedarà al log.
        log.warning(f"⚠️ _apply_lightweight_migrations ha fallat: {e}")

def get_mgmt_db() -> Generator[Session, None, None]:
    """Dependency per a FastAPI o ús intern."""
    _, SessionLocal = _get_or_init_mgmt_engine()
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()

# Per a ús fora del context de dependency (ex: scripts d'inicialització)
def get_mgmt_session() -> Session:
    _, SessionLocal = _get_or_init_mgmt_engine()
    return SessionLocal()
