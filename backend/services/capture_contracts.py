"""Validated Cornell content, separate from source metadata and warnings."""

import json
from dataclasses import dataclass
from typing import Any

from backend.services.json_contracts import validate_json_value


CORNELL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "notes": {"type": "string", "minLength": 1,
                  "description": "Faithful Markdown notes summarizing the supplied source facts."},
        "cues": {"type": "array", "minItems": 4, "maxItems": 7, "uniqueItems": True,
                 "items": {"type": "string", "minLength": 1,
                           "description": "A key question grounded in the supplied source."}},
        "summary": {"type": "string", "minLength": 1,
                    "description": "Short factual synthesis of the supplied source."},
    },
    "required": ["notes", "cues", "summary"],
    "additionalProperties": False,
}

CORNELL_LABELS = {
    "ca": ("Notes", "Pistes / preguntes", "Resum"),
    "es": ("Notas", "Pistas / preguntas", "Resumen"),
    "en": ("Notes", "Cues / questions", "Summary"),
    "fr": ("Notes", "Indices / questions", "Résumé"),
}


def capture_language(language: str) -> str:
    code = language.strip().lower().split("-")[0]
    if code not in CORNELL_LABELS:
        raise ValueError("Unsupported capture language")
    return code


@dataclass(frozen=True)
class CornellContent:
    notes: str
    cues: tuple[str, ...]
    summary: str


def parse_cornell_content(text: str) -> CornellContent:
    payload: object = json.loads(text)
    validate_json_value(payload, CORNELL_SCHEMA)
    if not isinstance(payload, dict):
        raise ValueError("Cornell content must be an object")
    notes, cues, summary = payload["notes"], payload["cues"], payload["summary"]
    if not isinstance(notes, str) or not isinstance(summary, str) or not isinstance(cues, list):
        raise ValueError("Invalid Cornell content")
    if not notes.strip() or not summary.strip():
        raise ValueError("Cornell notes and summary must not be blank")
    questions: list[str] = []
    for cue in cues:
        if not isinstance(cue, str):
            raise ValueError("Cornell questions must be strings")
        if not cue.strip():
            raise ValueError("Cornell questions must not be blank")
        questions.append(cue.strip())
    if len({cue.casefold() for cue in questions}) != len(questions):
        raise ValueError("Repeated Cornell questions")
    return CornellContent(notes.strip(), tuple(questions), summary.strip())


def validate_cornell_output(text: str) -> str:
    content = parse_cornell_content(text)
    return json.dumps({"notes": content.notes, "cues": content.cues, "summary": content.summary}, ensure_ascii=False)
