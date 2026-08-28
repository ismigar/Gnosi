import sys
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from pipeline.skills.translate_row.scripts import translate_text


def test_detection_and_apertium_response_narrowing() -> None:
    assert translate_text.detect_source_lang("Això és també nostre") == "ca"
    assert translate_text.detect_source_lang("12345") == "en"
    assert (
        translate_text._parse_apertium_response({"responseData": {"translatedText": "Bonjour"}})
        == "Bonjour"
    )
    with pytest.raises(RuntimeError, match="Unexpected Apertium-shape"):
        translate_text._parse_apertium_response(["not", "an", "object"])


def test_public_apertium_route_restores_acronyms(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_apertium(text: str, source: str, target: str) -> str:
        assert (source, target) == ("es", "en")
        assert "API" not in text
        return text.lower().replace("hola", "hello")

    monkeypatch.setattr(translate_text, "_translate_apertium_public", fake_apertium)

    translated, provider = translate_text.translate("Hola API", "es", "en")

    assert translated == "hello API"
    assert provider == "apertium_public"


def test_opus_cache_uses_protocol_compatible_objects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeTokenizer:
        def __call__(self, texts, **options):
            assert texts == ["hola"]
            assert options == {
                "return_tensors": "pt",
                "truncation": True,
                "max_length": 512,
            }
            return {"input_ids": [1]}

        def decode(self, token_ids, *, skip_special_tokens):
            assert token_ids == [7]
            assert skip_special_tokens is True
            return "bonjour"

    class FakeModel:
        def generate(self, **inputs):
            assert inputs == {
                "input_ids": [1],
                "max_length": 512,
                "num_beams": 4,
                "early_stopping": True,
            }
            return [[7]]

    monkeypatch.setattr(translate_text.time, "time", lambda: 100.0)
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(no_grad=lambda: nullcontext()),
    )
    monkeypatch.setitem(
        translate_text._opus_cache,
        "es-fr",
        (FakeModel(), FakeTokenizer(), 99.0),
    )

    assert translate_text._translate_opus_mt("hola", "es", "fr") == "bonjour"
    assert translate_text._opus_cache["es-fr"][2] == 100.0


def test_translate_returns_visible_placeholder_without_optional_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DEEPL_API_KEY", raising=False)

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("offline")

    monkeypatch.setattr(translate_text, "_translate_softcatala_apertium", unavailable)

    assert translate_text.translate("Hola", "ca", "es") == (
        "[es] Hola",
        "placeholder",
    )
