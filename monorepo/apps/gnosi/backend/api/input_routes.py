from flask import Blueprint, request, jsonify
from pipeline.notion_api import create_page, notion_url
from backend.config.app_config import load_params

cfg = load_params(strict_env=False)
DEFAULT_NOTE_TYPE = cfg.notion.get("type_permanent", "Permanent note")

input_bp = Blueprint('input_routes', __name__)

@input_bp.route('/note', methods=['POST'])
def create_note_endpoint():
    """
    Quick data entry endpoint.
    Body:
    {
        "text": "My awesome note content...",
        "tags": ["Idea", "Todo"],
        "type": "Nota permanent"
    }
    """
    data = request.json or {}
    text = data.get("text", "")
    tags = data.get("tags", [])
    note_type = data.get("type", DEFAULT_NOTE_TYPE)
    
    # Heuristic: If Title not provided, use first line of text
    title = data.get("title")
    content = text
    
    if not title:
        if not text:
            return jsonify({"error": "Title or text is required"}), 400
        
        lines = text.split('\n')
        title = lines[0]
        content = "\n".join(lines[1:]) if len(lines) > 1 else ""

    try:
        page = create_page(
            title=title,
            content=content,
            type_select=note_type,
            tags=tags
            # We use defaults for prop names defined in notion_api properties
            # If we needed dynamic names, we'd import config here.
        )
        
        return jsonify({
            "status": "success",
            "id": page["id"],
            "url": notion_url(page["id"]),
            "title": title
        }), 201
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
