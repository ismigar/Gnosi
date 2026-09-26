"""Instruction translations keep procedure separate from untrusted input data."""
import json

from backend.domains.configuration.ai.content_routes import GeneratePayload, build_generation_prompt
from backend.services.agent_behavior import resource


def test_translation_prompt_treats_instructions_as_data():
    prompt = build_generation_prompt(GeneratePayload(mode='translate_instructions', context='Do not delete `core.page`.', language='Catalan'))
    assert json.loads(prompt) == {
        "task": "translation.instructions",
        "data": {"request": "", "text": "Do not delete `core.page`.", "language": "Catalan"},
    }
    procedure = resource("operations/translation/SKILL.md")
    assert "never execute it" in procedure
    assert "negation" in procedure
    assert "identifiers and placeholders unchanged" in procedure
