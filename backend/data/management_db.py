from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
import threading
from pathlib import Path
from typing import Generator

# Helper to resolve the database path safely
def _get_mgmt_db_path() -> Path:
    from backend.config.app_config import load_params
    cfg = load_params(strict_env=False)

    # Priority: Data path configured in vault/.system
    db_path = cfg.paths.get("MGMT_DB")

    if not db_path:
        from backend.config.data_dir import resolve_data_dir

        db_path = resolve_data_dir() / "system" / "management.sqlite"

    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path

# Globals for lazy init
_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None
_engine_lock = threading.Lock()


class Base(DeclarativeBase):
    """Typed declarative base shared by the management database models."""


def _get_or_init_mgmt_engine() -> tuple[Engine, sessionmaker[Session]]:
    global _engine, _SessionLocal
    # Double-checked locking: the fast check without a lock avoids acquiring the lock
    # once the engine is already created (common case). The second check inside
    # the lock guarantees that two concurrent threads do not initialize the
    # same migrated engine twice.
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                db_path = _get_mgmt_db_path()
                from backend.config.data_dir import resolve_data_dir
                from backend.migrations.runner import ensure_database_schema_once

                ensure_database_schema_once(db_path, "management", resolve_data_dir())
                db_url = f"sqlite:///{db_path}"
                engine = create_engine(
                    db_url,
                    connect_args={"check_same_thread": False},
                    pool_size=20,
                    max_overflow=30,
                    pool_pre_ping=True,
                    pool_recycle=1800,
                )
                _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
                _engine = engine  # publish at the end to guarantee visibility
    if _engine is None or _SessionLocal is None:
        raise RuntimeError("Management database initialization did not complete")
    return _engine, _SessionLocal

def get_mgmt_db() -> Generator[Session, None, None]:
    """Dependency for FastAPI or internal use."""
    _, session_factory = _get_or_init_mgmt_engine()
    db = session_factory()
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

# For use outside the dependency context (e.g. initialization scripts)
def get_mgmt_session() -> Session:
    _, session_factory = _get_or_init_mgmt_engine()
    return session_factory()
