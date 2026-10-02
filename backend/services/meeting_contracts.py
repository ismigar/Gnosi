"""Meeting excerpts with explicit source evidence and localized presentation."""
import json
from typing import Any
from backend.services.json_contracts import validate_json_value

_EXCERPT = {"type": "string", "minLength": 1, "description": "An exact verbatim excerpt from the transcript, without rewriting or translation."}
_NULLABLE = {"type": ["string", "null"], "description": "Exact transcript wording, or null when not explicitly stated for this task."}
MINUTES_SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "topics", "decisions", "tasks", "next_steps"],
    "properties": {
        "summary": {"type": "array", "minItems": 1, "items": _EXCERPT},
        "topics": {"type": "array", "items": _EXCERPT},
        "decisions": {"type": "array", "items": _EXCERPT},
        "next_steps": {"type": "array", "items": _EXCERPT},
        "tasks": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["evidence", "owner", "deadline"],
            "properties": {"evidence": _EXCERPT, "owner": _NULLABLE, "deadline": _NULLABLE},
        }},
    },
}
LABELS = {
    "ca": ("Resum", "Temes tractats", "Decisions", "Tasques i acords", "Passos següents", "No consta a la transcripció.", "Responsable", "Termini", "Transcripció completa", "Acta"),
    "es": ("Resumen", "Temas tratados", "Decisiones", "Tareas y acuerdos", "Próximos pasos", "No consta en la transcripción.", "Responsable", "Plazo", "Transcripción completa", "Acta"),
    "en": ("Summary", "Topics discussed", "Decisions", "Tasks and agreements", "Next steps", "Not recorded in the transcript.", "Owner", "Deadline", "Full transcript", "Minutes"),
    "fr": ("Résumé", "Sujets abordés", "Décisions", "Tâches et accords", "Prochaines étapes", "Non indiqué dans la transcription.", "Responsable", "Échéance", "Transcription complète", "Compte rendu"),
}
META_LABELS = {
    "ca": ("Data", "Modalitat", "En línia", "Presencial", "Durada", "Idioma"),
    "es": ("Fecha", "Modalidad", "En línea", "Presencial", "Duración", "Idioma"),
    "en": ("Date", "Mode", "Online", "In person", "Duration", "Language"),
    "fr": ("Date", "Modalité", "En ligne", "En présentiel", "Durée", "Langue"),
}
WARNINGS = {
    "ca": "No s’ha pogut generar una acta validada. S’ha desat la transcripció.",
    "es": "No se ha podido generar un acta validada. Se ha guardado la transcripción.",
    "en": "Validated minutes could not be generated. The transcript has been saved.",
    "fr": "Un compte rendu validé n’a pas pu être généré. La transcription a été enregistrée.",
}

def meeting_language(language: object) -> str:
    code = str(language or "ca").lower().split("-")[0]
    return code if code in LABELS else "en"

def parse_minutes(text: str, transcript: str) -> dict[str, Any]:
    payload: object = json.loads(text)
    validate_json_value(payload, MINUTES_SCHEMA)
    if not isinstance(payload, dict):
        raise ValueError("Minutes must be an object")
    def excerpt(value: object) -> None:
        if not isinstance(value, str) or not value.strip() or value not in transcript:
            raise ValueError("Meeting evidence must be an exact nonblank transcript excerpt")
    for field in ("summary", "topics", "decisions", "next_steps"):
        for value in payload[field]:
            excerpt(value)
    for task in payload["tasks"]:
        excerpt(task["evidence"])
        for field in ("owner", "deadline"):
            value = task[field]
            if value is not None:
                excerpt(value)
                if value not in task["evidence"]:
                    raise ValueError("Task owner and deadline must occur in that task's evidence")
    return payload

def validate_minutes(text: str, transcript: str) -> str:
    return json.dumps(parse_minutes(text, transcript), ensure_ascii=False)

def render_minutes(payload: dict[str, Any], language: str) -> str:
    labels = LABELS[language]
    sections: list[str] = []
    for index, field in enumerate(("summary", "topics", "decisions", "tasks", "next_steps")):
        lines: list[str] = []
        for entry in payload[field]:
            if field == "tasks":
                line = entry["evidence"]
                for name, label in (("owner", labels[6]), ("deadline", labels[7])):
                    if entry[name] is not None:
                        line += f" · {label}: {entry[name]}"
                lines.append(f"- [ ] {line}")
            else:
                lines.append(f"- {entry}")
        sections.append(f"## {labels[index]}\n\n" + ("\n".join(lines) or labels[5]))
    return "\n\n".join(sections)
