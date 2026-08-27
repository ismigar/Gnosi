"""Tests for the `translation_index` module (local idempotency index for translate-row).

`GNOSI_DATA_DIR` points to a tmp, so these do NOT touch the real /app/data.

    docker exec gnosi_backend python -m pytest backend/tests/test_translation_index.py -v
"""
import pytest

from backend.services import translation_index


@pytest.fixture(autouse=True)
def _isolated_index(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    return tmp_path


def test_record_and_get():
    translation_index.record_translation("abc-123", "ca", "sub-ca")
    translation_index.record_translation("abc-123", "EN", "sub-en")  # lang es normalitza
    assert translation_index.get_known_translations("abc-123") == {"ca": "sub-ca", "en": "sub-en"}


def test_canonical_origin_id_match():
    # Registered with dashes, looked up without (Notion's form) → same entry.
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
    # A second read (which re-reads the JSON from disk) sees what was written.
    translation_index.record_translation("persist", "fr", "sub-fr")
    assert translation_index.get_known_translations("persist") == {"fr": "sub-fr"}
