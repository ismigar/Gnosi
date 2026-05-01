from flask import Blueprint, request, jsonify
from pipeline.utils.vault_writer import create_local_note
from backend.utils.errors import safe_error_detail

input_bp = Blueprint("input_routes", __name__)


@input_bp.route("/note", methods=["POST"])
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

        lines = text.split("\n")
        title = lines[0]
        content = "\n".join(lines[1:]) if len(lines) > 1 else ""

    try:
        result = create_local_note(
            title=title, content=content, note_type=note_type, tags=tags
        )

        return jsonify(
            {
                "status": "success",
                "id": result["id"],
                "path": result["path"],
                "title": title,
                "message": "Nota creada correctament a la Vault local.",
            }
        ), 201

    except Exception as e:
        return jsonify({"status": "error", "message": safe_error_detail(e, context="POST /note")}), 500
