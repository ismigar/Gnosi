"""Stable Uvicorn and Electron entrypoint for the Gnosi backend."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Configure paths before importing the application package. Packaged desktop
# builds still rely on both roots being available exactly as in the legacy
# entrypoint.
BASE_DIR = Path(__file__).resolve().parents[1]  # Gnosi
BACKEND_DIR = Path(__file__).resolve().parent  # Gnosi/backend

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
# Direct script execution can already put backend first. Keep it as a fallback
# in both entry modes, so legacy flat imports never shadow installed SDKs.
while str(BACKEND_DIR) in sys.path:
    sys.path.remove(str(BACKEND_DIR))
sys.path.append(str(BACKEND_DIR))

if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--bounded-file-io-worker":
    if len(sys.argv) != 4:
        raise SystemExit(64)
    from backend.utils.bounded_file_io import worker_main
    raise SystemExit(worker_main(int(sys.argv[2]), int(sys.argv[3])))

import uvicorn

from backend.config.startup_vault import materialize_startup_vault_files
from backend.config.startup_errors import desktop_startup_errors


# Cloud providers can evict small critical Vault files between native restarts.
# Recover those read-only inputs before modules cache configuration and state.
with desktop_startup_errors():
    materialize_startup_vault_files()

    from backend.app.factory import create_app
    from backend.app.lifespan import lifespan as lifespan
    from backend.config.app_config import load_params
    from backend.config.env_config import is_frozen_runtime
    from backend.config.desktop_server import desktop_server_address

    app = create_app(lifespan)


if __name__ == "__main__":
    with desktop_startup_errors():
        cfg = load_params(strict_env=False)
        server_cfg = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}
        desktop_address = desktop_server_address(os.environ)
        HOST, PORT = desktop_address or (
            server_cfg.get("host", "0.0.0.0"), int(server_cfg.get("backend_port", 5002))
        )
        uvicorn.run(
            "backend.server:app",
            host=HOST,
            port=PORT,
            reload=not is_frozen_runtime() and desktop_address is None,
        )
