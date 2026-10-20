"""Cornell captures cannot save malformed model output as a finished note."""

import json

from jsonschema import ValidationError
import pytest

from backend.agent import vault_tools
from backend.services import agent_execution
from backend.services.capture_contracts import CORNELL_SCHEMA, parse_cornell_content


@pytest.fixture
def capture(monkeypatch):
    source = "---\nid: source-id\ntitle: Original\nauthor: Júlia\nprovenance: 'literal --- marker'\nzero: 0\nflag: false\nempty: ''\n---\nThe workshop costs 240 euros."
    monkeypatch.setattr(vault_tools.read_page, "func", lambda _source: source)
    writes = []
    monkeypatch.setattr(vault_tools.create_page, "func", lambda *args, **kwargs: writes.append((args, kwargs)) or "new-id")
    valid = {"notes": "Workshop: 240 euros.", "cues": ["What?", "When?", "Where?", "How much?"],
             "summary": "The workshop costs 240 euros."}
    return source, writes, valid


@pytest.mark.parametrize("invalid", [
    {"notes": {"section": ["Text"]}, "cues": ["a", "b", "c", "d"], "summary": "Text"},
    {"notes": "Text", "cues": "a;b;c;d", "summary": "Text"},
    {"notes": "Text", "cues": ["a", "b", "c", "d"], "summary": "  "},
    {"notes": "Text", "cues": ["a", "A", "c", "d"], "summary": "Text"},
    {"notes": "Text", "cues": ["a", "b", "c", "d"], "summary": "Text", "warning": "Saved"},
])
def test_invalid_capture_output_never_creates_a_page(capture, monkeypatch, invalid):
    monkeypatch.setattr(agent_execution, "generate_for", lambda *args, **kwargs: (json.dumps(invalid), "fixture"))
    with pytest.raises((ValueError, ValidationError)):
        vault_tools.summarize_to_cornell.func("source-id")
    assert capture[1] == []


def test_trailing_model_commentary_cannot_become_a_note(capture, monkeypatch):
    monkeypatch.setattr(agent_execution, "generate_for", lambda *args, **kwargs: (json.dumps(capture[2]) + "\nAlready saved.", "fixture"))
    with pytest.raises(ValueError):
        vault_tools.summarize_to_cornell.func("source-id")
    assert capture[1] == []


@pytest.mark.parametrize("language,heading", [("ca", "Pistes / preguntes"), ("es", "Pistas / preguntas"),
                                              ("en", "Cues / questions"), ("fr", "Indices / questions")])
def test_capture_uses_exact_schema_and_preserves_attribution_outside_body(capture, monkeypatch, language, heading):
    calls = []
    def generate(*args, **kwargs):
        calls.append((args, kwargs))
        assert kwargs["output_schema"] == CORNELL_SCHEMA
        return kwargs["output_validator"](json.dumps(capture[2])), "fixture"
    monkeypatch.setattr(agent_execution, "generate_for", generate)
    assert vault_tools.summarize_to_cornell.func("source-id", title="Capture", language=language) == "new-id"
    args, kwargs = capture[1][0]
    assert len(calls) == len(capture[1]) == 1 and heading in args[1]
    assert "author:" not in args[1] and "Already saved" not in args[1]
    metadata = kwargs["metadata"]
    assert metadata["source_reference"] == "source-id" and metadata["capture_language"] == language
    assert metadata["source_excerpt"] is False
    assert metadata["source_attribution"]["id"] == "source-id"
    assert metadata["source_attribution"]["author"] == "Júlia"
    assert metadata["source_attribution"]["provenance"] == "literal --- marker"
    assert metadata["source_attribution"]["zero"] == 0
    assert metadata["source_attribution"]["flag"] is False
    assert metadata["source_attribution"]["empty"] == ""
    assert parse_cornell_content(calls[0][1]["output_validator"](json.dumps(capture[2]))).notes == "Workshop: 240 euros."


def test_truncated_page_is_marked_as_an_excerpt_in_prompt_and_saved_metadata(capture, monkeypatch):
    monkeypatch.setattr(vault_tools.read_page, "func", lambda _: capture[0] + "\n\n[Page content truncated by Gnosi.]")
    calls = []
    def generate(_operation, prompt, **kwargs):
        calls.append(prompt)
        return json.dumps(capture[2]), "fixture"
    monkeypatch.setattr(agent_execution, "generate_for", generate)
    vault_tools.summarize_to_cornell.func("source-id")
    assert "bounded_excerpt" in calls[0]
    assert capture[1][0][1]["metadata"]["source_excerpt"] is True


@pytest.mark.parametrize("error", ["Access denied: private", "PDF does not exist: missing", "", "(PDF has no extractable text; it may be scanned)"])
def test_missing_pdf_content_cannot_trigger_generation_or_save(capture, monkeypatch, error):
    monkeypatch.setattr(vault_tools.read_pdf, "func", lambda *_args: error)
    monkeypatch.setattr(agent_execution, "generate_for", lambda *args, **kwargs: pytest.fail("Unavailable source reached the model"))
    vault_tools.summarize_to_cornell.func("missing.pdf")
    assert capture[1] == []
