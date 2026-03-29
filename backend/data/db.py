from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from pathlib import Path
from config.app_config import load_params

# Carregar paràmetres per obtenir la ruta de la Vault
params = load_params(strict_env=False)
vault_path = params.paths.get("VAULT", Path("/vault"))
db_dir = vault_path / "data"
db_dir.mkdir(parents=True, exist_ok=True)
SQLALCHEMY_DATABASE_URL = f"sqlite:///{db_dir}/gnosi_vault.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency per a FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
