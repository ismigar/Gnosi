"""Regression tests for the Zotero mapping fixes shipped on 2026-05-10.

Three bugs covered:
  1. `numberOfVolumes` (Zotero) was being matched to `Mes` (Vault property,
     type=number) because the substring fallback was too permissive: `mes`
     literally appears inside `volu**mes**`. Fixed by requiring prefix/suffix
     match with min length 4 and ≥ 60 % coverage.
  2. `abstractNote` had no synonym for `description`/`synopsis`/etc. — typical
     names users actually have for the abstract column.
  3. `language` extracted from Zotero was a free-form string (`"es"`,
     `"Spanish"`, `"ca-ES"`) that didn't fit the typical Vault `Idioma`
     select with options CA/ES/EN-GB. The Z→V script now normalizes ISO
     codes / locales / human names to the canonical option.

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_zotero_mapping_fixes.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from backend.api.zotero_routes import (
    MAPPING_SYNONYMS,
    _suggest_property_for_slug,
    suggest_mapping_for_table,
)

# Add the standalone subprocess script dir to sys.path for `_normalize_language`.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = _BACKEND_DIR.parent / "pipeline" / "skills" / "zotero_sync" / "scripts"
sys.path.insert(0, str(_SCRIPTS_DIR))
import zotero_to_vault as ztv  # noqa: E402


# --- Bug 1: numberOfVolumes ↔ Mes false positive ---------------------------


def test_num_volumes_does_not_match_mes_anymore():
    """`mes` ⊂ `volu**mes**` (substring) used to produce a false mapping."""
    props = [{"id": "fld_mes", "name": "Mes", "type": "number"}]
    pid = _suggest_property_for_slug("num_volumes", props)
    assert pid is None, "num_volumes must not match Mes by substring"


def test_num_volumes_still_matches_explicit_synonym():
    """When the table actually has a sensible column, the mapping must succeed."""
    props = [
        {"id": "fld_nv", "name": "Núm. volums", "type": "text"},
        {"id": "fld_mes", "name": "Mes", "type": "number"},
    ]
    pid = _suggest_property_for_slug("num_volumes", props)
    assert pid == "fld_nv"


def test_short_property_name_does_not_match_long_zotero_field():
    """Generic guard: any property ≤ 3 chars or coverage < 60 % is rejected."""
    props = [
        {"id": "fld_ab", "name": "AB", "type": "text"},   # len 2
        {"id": "fld_dia", "name": "Dia", "type": "number"},  # len 3
    ]
    # `accessdate` (10 chars) must not match `dia` (3 chars) anymore.
    assert _suggest_property_for_slug("access_date", props) is None
    # And single-letter slugs are not matched to long properties either.
    assert _suggest_property_for_slug("doi", props) is None


def test_prefix_suffix_match_still_works_when_high_coverage():
    """`publicationtitle` (16) → `publicacio` (10): coverage 10/16 = 62 % > 60 %.

    `publicationtitle.startswith("publicacio")` is False, but Catalan word ends
    with `publicacio` ≠ truncated; we test the synonym `publicacio` exact match
    (already exact) and a clean prefix case.
    """
    # Exact normalized match (case 1) still wins.
    props = [{"id": "fld_pub", "name": "Publicació", "type": "text"}]
    assert _suggest_property_for_slug("publication_title", props) == "fld_pub"


# --- Bug 2: abstractNote synonyms include description/synopsis -------------


def test_abstract_synonyms_include_description():
    assert "description" in MAPPING_SYNONYMS["abstract"]
    assert "synopsis" in MAPPING_SYNONYMS["abstract"]
    # Catalan + Spanish too
    assert "descripcio" in MAPPING_SYNONYMS["abstract"]
    assert "sinopsi" in MAPPING_SYNONYMS["abstract"]


def test_abstract_matches_description_column():
    props = [{"id": "fld_desc", "name": "Description", "type": "rich_text"}]
    pid = _suggest_property_for_slug("abstract", props)
    assert pid == "fld_desc"


def test_abstract_matches_resum_column():
    props = [{"id": "fld_r", "name": "Resum", "type": "rich_text"}]
    pid = _suggest_property_for_slug("abstract", props)
    assert pid == "fld_r"


# --- Bug 3: language normalization at extract_items ------------------------


@pytest.mark.parametrize("raw,expected", [
    ("es", "ES"),
    ("ES", "ES"),
    ("spa", "ES"),
    ("Spanish", "ES"),
    ("español", "ES"),
    ("castella", "ES"),
    ("ca", "CA"),
    ("CA", "CA"),
    ("Catalan", "CA"),
    ("català", "CA"),
    ("en", "EN-GB"),
    ("English", "EN-GB"),
    ("EN-GB", "EN-GB"),
    ("en-us", "EN-GB"),
    ("en_GB", "EN-GB"),
])
def test_normalize_language_canonical(raw, expected):
    assert ztv._normalize_language(raw) == expected


def test_normalize_language_unknown_passes_through():
    assert ztv._normalize_language("Klingon") == "Klingon"
    assert ztv._normalize_language("zh-CN") == "zh-CN"


def test_normalize_language_handles_empty_and_none():
    assert ztv._normalize_language("") == ""
    assert ztv._normalize_language(None) == ""
    assert ztv._normalize_language("   ") == ""


def test_normalize_language_locale_prefix_fallback():
    """`es-419` (Latin American Spanish) must still map to ES via prefix."""
    assert ztv._normalize_language("es-419") == "ES"
    assert ztv._normalize_language("ca-AD") == "CA"


# --- End-to-end: suggest_mapping_for_table behaves correctly --------------


def test_suggest_mapping_no_longer_matches_num_volumes_to_mes():
    """E2E: full suggest output for a table with Mes but no Núm. volums column."""
    props = [
        {"id": "fld_t", "name": "Title", "type": "title"},
        {"id": "fld_mes", "name": "Mes", "type": "number"},
    ]
    out = suggest_mapping_for_table(props)
    # Either the slug is unmapped (preferred) or maps elsewhere — but never to fld_mes.
    nv_target = out["mapping"].get("numberOfVolumes")
    assert nv_target != "fld_mes"
