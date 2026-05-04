from pathlib import Path
import sys
import json
import hashlib

# Afegeix l'arrel del projecte (…/digital-brain)
BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from flask import Flask, jsonify, Response
from backend.config.logger_config import setup_logging, get_logger
from backend.config.app_config import load_params
import threading
import time
import os
from pipeline.skills.suggest_connections.scripts import (
    suggest_connections_digital_brain,
)
from pipeline.skills.json_to_sigma.scripts import json_to_sigma
from pipeline.private_skills.backup_markdown.scripts.backup_to_markdown import (
    process_backup,
)

# ──────────────── Config unificada ────────────────
setup_logging()
log = get_logger(__name__)

cfg = load_params(strict_env=False)
server_cfg = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}

HOST = server_cfg.get("host", "0.0.0.0")
BACKEND_PORT = int(server_cfg.get("backend_port", 5001))
ENABLED_CORS = bool(server_cfg.get("enabled_cors", True))
OUT_GRAPH = cfg.paths.get("OUT_GRAPH")

app = Flask(__name__, static_folder="../frontend/dist", static_url_path="/")

if ENABLED_CORS:
    from flask_cors import CORS

    CORS(app, resources={r"/api/*": {"origins": "*"}})

from backend.api.config_routes import config_bp
from backend.api.env_routes import env_bp
from api.input_routes import input_bp
from backend.api.content_routes import content_bp

app.register_blueprint(config_bp, url_prefix="/api")
app.register_blueprint(input_bp, url_prefix="/api")
app.register_blueprint(env_bp, url_prefix="/api")
app.register_blueprint(content_bp, url_prefix="/api")


# Global lock for sync
IS_SYNCING = False
SYNC_LOCK = threading.Lock()


@app.post("/api/sync")
def api_sync():
    global IS_SYNCING

    # Non-blocking check
    if IS_SYNCING:
        return jsonify(
            {"status": "skipped", "message": "Sync already in progress"}
        ), 429

    def run_sync():
        global IS_SYNCING
        with SYNC_LOCK:
            IS_SYNCING = True
            try:
                log.info("🔄 Starting background sync...")
                suggest_connections_digital_brain.process()
                json_to_sigma.convert_for_sigma()
                log.info("✅ Background sync finished.")
            except Exception as e:
                log.exception("❌ Error during sync: %s", e)
            finally:
                IS_SYNCING = False

    # Run in separate thread to not block the request?
    # User wants auto-sync every 5s. If we block, the frontend waits 5s+.
    # Better to block? No, if we block, the browser request hangs.
    # But if we don't block, how does frontend know when to refresh?
    # Option A: Frontend polls /api/sync, gets "started". Then polls /api/status? Too complex.
    # Option B: Frontend calls /api/sync and WAITS. If it takes 10s, it waits 10s.
    # The user suggested "every 5 seconds". If the sync takes 2s (cached), it returns in 2s.
    # If it takes 20s (uncached), it returns in 20s.
    # We should BLOCK to ensure we only refresh graph when done.

    # Blocking implementation for simplicity and correctness of "refresh after sync"
    # But we still need the lock to prevent parallel executions from other tabs/intervals.

    if SYNC_LOCK.acquire(blocking=False):
        try:
            IS_SYNCING = True
            log.info("🔄 Starting sync (blocking)...")
            suggest_connections_digital_brain.process()
            json_to_sigma.convert_for_sigma()
            log.info("✅ Sync finished.")
            return jsonify({"status": "ok", "message": "Sync completed"})
        except Exception as e:
            log.exception("❌ Sync failed")
            return jsonify({"status": "error", "detail": str(e)}), 500
        finally:
            IS_SYNCING = False
            SYNC_LOCK.release()
    else:
        return jsonify(
            {"status": "skipped", "message": "Sync already in progress"}
        ), 429


def _get_graph_hash() -> str:
    """Calculate MD5 hash of the graph file for versioning."""
    path = Path(OUT_GRAPH)
    if not path.exists():
        return "NOT_FOUND"
    with path.open("rb") as f:
        return hashlib.md5(f.read()).hexdigest()


# ──────────────── ÚNICA RUTA /api/graph ────────────────
@app.get("/api/graph")
def api_graph():
    try:
        log.info(f"Demana /api/graph, OUT_GRAPH_SIGMA={OUT_GRAPH}")
        path = Path(OUT_GRAPH)

        if not path.exists():
            log.error(f"FITXER NO TROBAT: {path}")
            return jsonify({"error": "NOT_FOUND", "path": str(path)}), 404

        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        # Create response with version header
        response = jsonify(data)
        response.headers["X-Graph-Version"] = _get_graph_hash()
        return response

    except Exception as e:
        log.exception("Error servint /api/graph")
        return jsonify({"error": "INTERNAL", "detail": str(e)}), 500


@app.get("/api/graph/version")
def api_graph_version():
    """Returns only the graph version hash (lightweight check)."""
    return jsonify({"version": _get_graph_hash()})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path != "" and (Path(app.static_folder) / path).exists():
        return app.send_static_file(path)
    return app.send_static_file("index.html")


# ──────────────── MAIN ────────────────
# ─────────────────────────────────────────────────────
# AUTO-UPDATE SCHEDULER
# ─────────────────────────────────────────────────────
def run_scheduler():
    """Runs the pipeline every X seconds."""
    # Delay initial run to let server start
    time.sleep(10)

    interval = 300  # 5 minutes default

    log.info(f"⏰ Scheduler started. Interval: {interval}s")

    while True:
        try:
            # Acquire lock to avoid conflict with manual /api/sync
            if SYNC_LOCK.acquire(blocking=False):
                try:
                    global IS_SYNCING
                    IS_SYNCING = True
                    log.info("⏰ Running scheduled update (Graph + Backup + Gemini)...")
                    suggest_connections_digital_brain.process()
                    json_to_sigma.convert_for_sigma()

                    try:
                        process_backup()
                    except Exception as e:
                        log.error(f"❌ Scheduled backup failed: {e}")

                    log.info("✅ Scheduled update completed.")
                finally:
                    IS_SYNCING = False
                    SYNC_LOCK.release()
            else:
                log.info("⏰ Scheduled update skipped (Sync already in progress)")

        except Exception as e:
            log.error(f"❌ Scheduled update failed: {e}")

        time.sleep(interval)


if __name__ == "__main__":
    debug_mode = cfg.get("logging_level", "").lower() == "debug"

    # Start scheduler in background thread (daemon=True so it dies with main app)
    # We only start it if we are not the reloader (to avoid double threads in debug mode)
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not debug_mode:
        threading.Thread(target=run_scheduler, daemon=True).start()

    log.info(f"Arrencant Flask a {HOST}:{BACKEND_PORT}, debug={debug_mode}")
    app.run(host=HOST, port=BACKEND_PORT, debug=debug_mode)
