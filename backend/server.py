"""Stable Uvicorn and Electron entrypoint for the Gnosi backend."""

from __future__ import annotations

import sys
from pathlib import Path

import uvicorn


# Configure paths before importing the application package. Packaged desktop
# builds still rely on both roots being available exactly as in the legacy
# entrypoint.
BASE_DIR = Path(__file__).resolve().parents[1]  # Gnosi
BACKEND_DIR = Path(__file__).resolve().parent  # Gnosi/backend

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from backend.config.startup_vault import materialize_startup_vault_files


# Cloud providers can evict small critical Vault files between native restarts.
# Recover those read-only inputs before modules cache configuration and state.
materialize_startup_vault_files()

from backend.app.factory import create_app
from backend.app.lifespan import lifespan as lifespan
from backend.config.app_config import load_params
from backend.config.env_config import is_frozen_runtime


app = create_app(lifespan)


if __name__ == "__main__":
    cfg = load_params(strict_env=False)
    server_cfg = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}
    HOST = server_cfg.get("host", "0.0.0.0")
    PORT = int(server_cfg.get("backend_port", 5002))
    uvicorn.run(
        "backend.server:app",
        host=HOST,
        port=PORT,
        reload=not is_frozen_runtime(),
    )
