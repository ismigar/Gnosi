from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import threading
from pathlib import Path
from backend.services.context_vars import get_active_vault_path

# Magatzem de motors de base de dades (un per cada ruta de vault activa)
_engines = {}
_sessionmakers = {}
_lock = threading.Lock()

Base = declarative_base()


class VaultNotConfiguredError(Exception):
    """Raised when no vault path has been configured by the user."""

    pass


def get_engine_for_path(vault_path: Path):
    """Retorna o crea un motor SQLAlchemy per a una ruta específica."""
    if not vault_path:
        raise VaultNotConfiguredError(
            "No vault configured. Please set DIGITAL_BRAIN_VAULT_PATH environment variable "
            "or configure a vault path in the application settings."
        )

    v_str = str(vault_path)
    with _lock:
        if v_str not in _engines:
            db_dir = vault_path / "data"
            db_dir.mkdir(parents=True, exist_ok=True)
            db_path = db_dir / "gnosi_vault.db"

            engine = create_engine(
                f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
            )
            Base.metadata.create_all(bind=engine)

            _engines[v_str] = engine
            _sessionmakers[v_str] = sessionmaker(
                autocommit=False, autoflush=False, bind=engine
            )

        return _engines[v_str], _sessionmakers[v_str]


# Proxy object for the legacy 'engine' variable to avoid breaking imports
# But it's better to avoid global engine access if possible.
# Since existing code might use 'engine', we'll provide a warning or a default.
engine = None  # Placeholder, we should use get_db()


def get_db():
    """Dependency per a FastAPI que resol el DB segons el context actiu."""
    v_path = get_active_vault_path()

    if not v_path:
        raise VaultNotConfiguredError(
            "Vault no configurat. Si us plau, configura una carpeta de vault a l'aplicació."
        )

    _engine, SessionLocal = get_engine_for_path(v_path)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
