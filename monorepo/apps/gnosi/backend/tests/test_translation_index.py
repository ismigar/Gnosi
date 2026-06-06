"""Tests del mòdul `translation_index` (índex local d'idempotència de translate-row).

`GNOSI_LOCAL_DATA` apunta a un tmp, així que NO toquen el /app/data real.

    docker exec gnosi_backend python -m pytest backend/tests/test_translation_index.py -v
"""
import pytest

from backend.services import translation_index


@pytest.fixture(autouse=True)
def _isolated_index(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_LOCAL_DATA", str(tmp_path))
    return tmp_path


def test_record_and_get():
    translation_index.record_translation("abc-123", "ca", "sub-ca")
    translation_index.record_translation("abc-123", "EN", "sub-en")  # lang es normalitza
    assert translation_index.get_known_translations("abc-123") == {"ca": "sub-ca", "en": "sub-en"}


def test_canonical_origin_id_match():
    # Registrat amb guions, consultat sense (forma de Notion) → mateixa entrada.
    translation_index.record_translation("df361486-5ff3-4a14-9005-5d9b7b456492", "ca", "x")
    assert translation_index.get_known_translations("df3614865ff34a1490055d9b7b456492") == {"ca": "x"}


def test_record_overwrites_same_lang():
    translation_index.record_translation("o", "ca", "first")
    translation_index.record_translation("o", "ca", "second")
    assert translation_index.get_known_translations("o") == {"ca": "second"}


def test_forget_translation():
    translation_index.record_translation("o", "ca", "x")
    translation_index.record_translation("o", "en", "y")
    translation_index.forget_translation("o", "ca")
    assert translation_index.get_known_translations("o") == {"en": "y"}
    translation_index.forget_translation("o", "en")
    assert translation_index.get_known_translations("o") == {}


def test_get_unknown_or_blank_origin():
    assert translation_index.get_known_translations("nonexistent") == {}
    assert translation_index.get_known_translations("") == {}


def test_record_ignores_incomplete_args():
    translation_index.record_translation("", "ca", "x")
    translation_index.record_translation("o", "", "x")
    translation_index.record_translation("o", "ca", "")
    assert translation_index.get_known_translations("o") == {}


def test_persists_across_reloads():
    # Una segona lectura (que re-llegeix el JSON del disc) veu el que es va escriure.
    translation_index.record_translation("persist", "fr", "sub-fr")
    assert translation_index.get_known_translations("persist") == {"fr": "sub-fr"}
