# pipeline/config/env_config.py
import os
from pathlib import Path
from dotenv import load_dotenv

# Ordre de càrrega:
# 1. .env_shared (Projectes - variables compartides)
# 2. .env local (variables específiques del projecte)
# Les locals sobreescriuen les compartides si hi ha conflicte.

try:
    PROJECTES_ROOT = (
        Path(__file__).resolve().parents[5]
    )  # config -> backend -> gnosi -> apps -> monorepo -> Projectes
except IndexError:
    PROJECTES_ROOT = Path(__file__).resolve().parent.parent.parent
SHARED_ENV = PROJECTES_ROOT / ".env_shared"

ENV_LOCATIONS = [
    SHARED_ENV,  # Primer les compartides
    Path.cwd() / ".env",
    Path(__file__).resolve().parents[1] / ".env",
]

_loaded = False


def load_env():
    global _loaded
    if _loaded:
        return

    # Carregar .env_shared primer (si existeix)
    if SHARED_ENV.exists():
        load_dotenv(ENV_SHARED)

    # Després carregar .env local (sobreescriu si cal)
    for p in ENV_LOCATIONS[1:]:  # Saltem SHARED_ENV que ja s'ha carregat
        if p.exists():
            load_dotenv(p, override=True)
            break

    _loaded = True


def get_env(name: str, default=None, required=False):
    load_env()
    value = os.environ.get(name, default)
    if required and (value is None or value == ""):
        raise RuntimeError(f"❌ Missing environment variable: {name}")
    return value


def require_env(*names: str):
    """
    Checks that all indicated environment variables exist.
    Raises a clear exception if any are missing.
    """
    load_env()

    missing = []
    for name in names:
        value = os.environ.get(name)
        if value is None or value == "":
            missing.append(name)

    if missing:
        raise RuntimeError(
            f"❌ Missing environment variables configuration: {', '.join(missing)}"
        )
