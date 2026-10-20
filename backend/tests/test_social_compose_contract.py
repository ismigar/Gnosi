"""Composition returns publishable text, never control metadata or an oversized post."""

import json

from jsonschema import ValidationError
import pytest

from backend.services import agent_execution, social_compose


@pytest.mark.parametrize("label", ["Destinatari", "Data programada", "Text del post", "Estat",
                                  "Destinatario", "Fecha programada", "Estado", "Recipient",
                                  "Scheduled time", "Post text", "Status", "Destinataire",
                                  "Date programmée", "Texte du post", "Statut"])
def test_control_metadata_inside_text_is_rejected(label):
    with pytest.raises(ValueError, match="publishable text"):
        social_compose.validate_compose_output(json.dumps({"text": f"Taller a Girona\n**{label}**: pendent"}), char_limit=500)


@pytest.mark.parametrize("result", [None, [], {}, {"text": 0}, {"text": ""}, {"text": "   "},
                                   {"text": "Post", "recipient": "someone"}, {"text": "x" * 21}])
def test_invalid_or_oversized_results_are_rejected(result):
    with pytest.raises((ValueError, ValidationError)):
        social_compose.validate_compose_output(json.dumps(result), char_limit=20)


def test_valid_post_preserves_its_quotes_links_and_hashtags(monkeypatch):
    text = '«Taller a Girona»: 12 persones, 240 euros. https://example.org/taller #Aprenentatge'
    captured = {}
    def generate(operation, prompt, **kwargs):
        captured.update({"operation": operation, "task": json.loads(prompt), **kwargs})
        return json.dumps({"text": text}), "fixture-model"
    monkeypatch.setattr(agent_execution, "generate_for", generate)
    result = social_compose.compose_one(network="mastodon", char_limit=500, content="source", title="Title",
                                       url="https://example.org/taller", source_lang="ca", variation=2)
    assert result == {"text": text, "hashtags": ["#Aprenentatge"], "char_count": len(text),
                      "over_limit": False, "provider": "fixture-model"}
    assert captured["operation"] == "social"
    assert captured["task"]["data"]["variation"] == 2
    assert captured["output_schema"]["properties"]["text"]["maxLength"] == 500
    with pytest.raises(ValueError):
        captured["output_validator"](json.dumps({"text": "Estat: pendent"}))


@pytest.mark.parametrize("limit", [0, -1, True, "500"])
def test_invalid_character_limit_is_rejected(limit):
    with pytest.raises(ValueError):
        social_compose.compose_output_schema(limit)
