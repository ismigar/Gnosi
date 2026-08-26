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

    # Priority: Data path configured in vault/.system
    db_path = cfg.paths.get("MGMT_DB")

    if not db_path:
        # Fallback to the project's data folder
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
    # Double-checked locking: the fast check without a lock avoids acquiring the lock
    # once the engine is already created (common case). The second check inside the lock
    # guarantees that two concurrent threads on first startup don't create
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
                _engine = engine  # publish at the end to guarantee visibility
    return _engine, _SessionLocal


def _apply_lightweight_migrations(engine):
    """Adds new columns to already existing tables (we don't have Alembic).

    `Base.metadata.create_all` creates missing tables but NEVER new columns
    on tables that already exist. When a field is added to a model —e.g.
    `User.password_hash` for JWT auth— databases created earlier don't have it and
    any query fails with «no such column». Here we solve it in an
    idempotent way: we inspect the real schema and run `ALTER TABLE ... ADD COLUMN`
    only if the column isn't there. SQLite allows adding nullable columns
    without rewriting the table.
    
    """
    additive_columns = {
        "users": {
            "password_hash": "VARCHAR",
            # NOT NULL DEFAULT 0 so existing rows land on "invited" rather than
            # NULL; the backfill below then flips the ones that were in fact
            # auto-provisioned. Without the backfill this migration would REMOVE
            # a protection: the claim guard would stop refusing the placeholder
            # accounts an older install already has.
            "auto_provisioned": "BOOLEAN NOT NULL DEFAULT 0",
        },
        "share_links": {
            "vault_id": "VARCHAR",
        },
        "vaults": {
            "slug": "VARCHAR",
        },
    }
    # Runs once, right after the column is added: addresses are the only
    # evidence available for accounts minted before the column existed.
    backfills = {
        ("users", "auto_provisioned"): (
            "UPDATE users SET auto_provisioned = 1 "
            "WHERE lower(email) LIKE '%@example.com' "
            "   OR lower(email) = 'ismael-legacy@gnosi.app'"
        ),
    }
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        for table, columns in additive_columns.items():
            if table not in existing_tables:
                continue  # create_all will have already created it with all the columns
            present = {c["name"] for c in inspector.get_columns(table)}
            for col_name, col_type in columns.items():
                if col_name in present:
                    continue
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"))
                    backfill = backfills.get((table, col_name))
                    if backfill:
                        result = conn.execute(text(backfill))
                        log.info(
                            f"🛠️ Migració lleugera: {table}.{col_name} omplerta "
                            f"per a {result.rowcount} fila/es existents"
                        )
                log.info(f"🛠️ Migració lleugera: afegida columna {table}.{col_name}")
    except Exception as e:
        # We don't block startup for a failed upgrade; if the column
        # is really missing, the error will show up on the first query and will be logged.
        log.warning(f"⚠️ _apply_lightweight_migrations ha fallat: {e}")

def get_mgmt_db() -> Generator[Session, None, None]:
    """Dependency for FastAPI or internal use."""
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

# For use outside the dependency context (e.g. initialization scripts)
def get_mgmt_session() -> Session:
    _, SessionLocal = _get_or_init_mgmt_engine()
    return SessionLocal()
