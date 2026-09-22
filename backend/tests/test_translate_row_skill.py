"""Functional translations use the principal, never another provider."""
import pytest
from pipeline.skills.translate_row.scripts import translate_text


def test_language_detection():
    assert translate_text.detect_source_lang("Això és també nostre") == "ca"
    assert translate_text.detect_source_lang("12345") == "en"


@pytest.mark.parametrize("source,target", [("ca","en"),("es","fr"),("fr","ca"),("en","es")])
def test_all_language_pairs_use_translation_skill(monkeypatch, source, target):
    calls = []
    def generate(operation, prompt, **kwargs):
        calls.append((operation, prompt))
        return "translated API", "principal-model"
    monkeypatch.setattr("backend.services.agent_execution.generate_for", generate)
    assert translate_text.translate("Source API", source, target, deepl_api_key="ignored", softcatala_url="ignored") == ("translated API", "principal_agent")
    assert calls == [("translation", f"Source language: {source}\nTarget language: {target}\n\nSource API")]


def test_unavailable_principal_never_returns_a_fake_translation(monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("principal unavailable")
    monkeypatch.setattr("backend.services.agent_execution.generate_for", unavailable)
    with pytest.raises(RuntimeError, match="principal unavailable"):
        translate_text.translate("Hola", "ca", "es")


def test_noop_translation_does_not_invoke_ai(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("No model should be called")
    monkeypatch.setattr("backend.services.agent_execution.generate_for", forbidden)
    assert translate_text.translate("Text", "ca", "ca") == ("Text", "noop")
