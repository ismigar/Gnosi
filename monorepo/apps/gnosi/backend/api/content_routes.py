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
        # Handle Media Nodes Direct (New)
        if node_id.startswith("media_"):
            from backend.services.media_service import MediaService
            service = MediaService()
            media_id = node_id.replace("media_", "")
            
            # Find the media in all media (recursive scan)
            all_media = service.get_all_media()
            media = next((m for m in all_media if m["id"] == media_id), None)
            
            if not media:
                return jsonify({"error": "Media not found"}), 404
                
            # Construct node-like response
            return jsonify({
                "id": node_id,
                "title": media["filename"],
                "kind": "media",
                "url": media["url"],
                "tags": media.get("tags", []),
                "last_edited_time": media.get("date_taken") or media.get("last_modified"),
                "content": f"{media.get('description', '')}\n\n![{media['filename']}]({media['url']})"
            })

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
