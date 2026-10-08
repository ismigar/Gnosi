import json
from backend.domains.llm_wiki.suggestion_localization import locale_code, translate_batch, translated_text
from backend.services import llm_wiki_suggestions as service
import pytest


def test_localization_sends_only_display_text_and_preserves_evidence():
    original = {"id": "proposal", "title": "Connection", "why": "Shared question", "evidence": ["Cita original"], "member_ids": ["first", "second"]}
    def generate(prompt):
        data = json.loads(prompt)["data"]
        assert data["language"] == "Catalan"
        assert data["proposals"] == [{"id": "proposal", "title": "Connection", "why": "Shared question"}]
        return json.dumps({"translations": [{"id": "proposal", "title": "Connexió", "why": "Una pregunta compartida"}]})
    result = translate_batch([original], "ca", generate)
    assert result["proposal"]["title"] == "Connexió"
    assert original["evidence"] == ["Cita original"] and original["title"] == "Connection"


@pytest.mark.parametrize("locale", ["ca", "en", "es", "fr"])
def test_cached_localizations_are_used_in_each_active_language(locale):
    item = {"title": "Original", "why": "Why", "source_locale": "en",
            "localizations": {locale: {"title": "Translated", "why": "Localized reason"}}}
    assert translated_text(item, locale)["title"] == ("Original" if locale == "en" else "Translated")
    assert locale_code(locale + "-ES") == locale


def test_translation_rejects_different_or_missing_proposal_ids():
    with pytest.raises(ValueError):
        translate_batch([{"id": "original", "title": "Title"}], "ca", lambda _: '{"translations": [{"id":"wrong","title":"Title","why":"Why"}]}')


def test_cached_queue_translation_never_requests_a_model_or_changes_the_queue(monkeypatch):
    item = {"id": "proposal", "title": "Original", "why": "Why", "evidence": ["Original quote"],
            "localizations": {"ca": {"title": "Connexió", "why": "Motiu"}}}
    monkeypatch.setattr(service, "load_queue", lambda: [item])
    monkeypatch.setattr(service, "_save_queue", lambda _: pytest.fail("Cached display read must not rewrite the queue"))
    result = service.localized_queue("ca")
    assert result[0]["title"] == "Connexió" and result[0]["evidence"] == ["Original quote"]
    assert item["title"] == "Original"
