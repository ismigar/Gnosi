from flask import Blueprint, jsonify
from pathlib import Path
import json
from backend.config.logger_config import get_logger
from backend.config.app_config import load_params

content_bp = Blueprint("content", __name__)
log = get_logger(__name__)

cfg = load_params()
CACHE_PATH = cfg.paths["CACHE"]


@content_bp.route("/node/<node_id>", methods=["GET"])
def get_node_content(node_id):
    try:
        if not CACHE_PATH.exists():
            return jsonify({"error": "Cache not found"}), 404

        # In a high-traffic app we would cache this in memory.
        # For a personal brain, reading the file is fine and ensures data freshness after sync.
        with CACHE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)

        node_data = data.get(node_id)
        if not node_data:
            return jsonify({"error": "Node not found"}), 404

        return jsonify(node_data)

    except Exception as e:
        log.error(f"Error fetching node content: {e}")
        return jsonify({"error": "Internal Error"}), 500
