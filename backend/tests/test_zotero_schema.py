"""Contract tests for the `zotero_schema` skill.

Covers:
  1. **Build idempotency:** regenerating with the current `schema.json` produces
     EXACTLY the same output as the committed files. If it fails, it
     means the build isn't deterministic, or someone hand-edited a
     generated file, or `schema.json` changed without regenerating.
  2. **Py↔TS consistency:** `ALL_ITEM_TYPES` and `ZOTERO_TO_CSL_TYPE` are
     identical across the two generated files.
  3. **Resolver:** canonical key, translated label (ca-AD), legacy alias,
     new types (preprint/dataset), and fallback resolve correctly.

Run:
    docker exec gnosi_backend python -m pytest backend/tests/test_zotero_schema.py -v
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

# The test lives in backend/tests/, the repo root is four levels up:
# Gnosi/backend/tests/test_zotero_schema.py
GNOSI_ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = GNOSI_ROOT / "pipeline/skills/zotero_schema"
BUILD_SCRIPT = SKILL_DIR / "scripts/build_constants.py"
SCHEMA_JSON = SKILL_DIR / "schema.json"
OUT_PY = GNOSI_ROOT / "backend/services/zotero_schema.py"
OUT_TS = GNOSI_ROOT / "frontend/src/generated/zoteroSchema.ts"


@pytest.fixture(scope="module")
def ts_constants() -> dict:
    """Extracts the main constants from the generated TS file via regex.

    The constants come as `export const NAME: Type = <json-literal>;`.
    The build emits ALL_ITEM_TYPES on one line and ZOTERO_TO_CSL_TYPE
    multi-line; we capture up to the final `};` or final `];`.
    
    """
    source = OUT_TS.read_text(encoding="utf-8")

    def capture(name: str) -> object:
        m = re.search(
            rf'export const {name}:[^=]+ = (.+?);\s*\n(?:export|$|\Z)',
            source,
            re.DOTALL,
        )
        if not m:
            raise AssertionError(f"No s'ha trobat l'export {name} al TS generat")
        # TS accepts trailing commas, JSON doesn't. We strip them before parsing.
        literal = re.sub(r',(\s*[}\]])', r'\1', m.group(1))
        return json.loads(literal)

    return {
        "ALL_ITEM_TYPES": capture("ALL_ITEM_TYPES"),
        "ZOTERO_TO_CSL_TYPE": capture("ZOTERO_TO_CSL_TYPE"),
        "ITEM_TYPE_FIELDS": capture("ITEM_TYPE_FIELDS"),
        "SCHEMA_VERSION": int(
            re.search(r"SCHEMA_VERSION: number = (\d+);", source).group(1)
        ),
        "SCHEMA_SOURCE_SHA": re.search(
            r'SCHEMA_SOURCE_SHA: string = "([^"]+)";', source
        ).group(1),
    }


# ---------- 1. Build idempotency ----------

def test_build_is_deterministic(tmp_path: Path) -> None:
    """Regenerating with the current schema emits exactly the same output."""
    py_before = OUT_PY.read_text(encoding="utf-8")
    ts_before = OUT_TS.read_text(encoding="utf-8")

    r = subprocess.run(
        [sys.executable, str(BUILD_SCRIPT)],
        capture_output=True, text=True, timeout=15,
    )
    assert r.returncode == 0, f"build_constants.py va fallar:\n{r.stderr}"

    py_after = OUT_PY.read_text(encoding="utf-8")
    ts_after = OUT_TS.read_text(encoding="utf-8")
    assert py_before == py_after, (
        "Output Python ha canviat al regenerar — build no determinista o "
        "fitxer editat a mà. Re-executa build_constants.py i commiteja."
    )
    assert ts_before == ts_after, (
        "Output TS ha canviat al regenerar — vegis test Python anàleg."
    )


# ---------- 2. Py ↔ TS consistency ----------

def test_py_and_ts_have_same_item_types(ts_constants: dict) -> None:
    from backend.services.zotero_schema import ALL_ITEM_TYPES
    assert sorted(ALL_ITEM_TYPES) == sorted(ts_constants["ALL_ITEM_TYPES"])


def test_py_and_ts_have_same_csl_mapping(ts_constants: dict) -> None:
    from backend.services.zotero_schema import ZOTERO_TO_CSL_TYPE
    assert ZOTERO_TO_CSL_TYPE == ts_constants["ZOTERO_TO_CSL_TYPE"]


def test_py_and_ts_have_same_schema_version(ts_constants: dict) -> None:
    from backend.services.zotero_schema import SCHEMA_VERSION, SCHEMA_SOURCE_SHA
    assert SCHEMA_VERSION == ts_constants["SCHEMA_VERSION"]
    assert SCHEMA_SOURCE_SHA == ts_constants["SCHEMA_SOURCE_SHA"]


# ---------- 3. Resolver ----------

@pytest.mark.parametrize("raw,expected", [
    # Canonical Zotero keys
    ("journalArticle", "article-journal"),
    ("book", "book"),
    ("bookSection", "chapter"),
    ("thesis", "thesis"),
    ("webpage", "webpage"),
    # NEW types that previously fell back to 'document'
    ("preprint", "article"),
    ("dataset", "dataset"),
    ("standard", "standard"),
    # Translated labels (official ca-AD from the schema)
    ("Llibre", "book"),
    ("Article de revista acadèmica", "article-journal"),
    ("Tesi", "thesis"),
    ("Pàgina web", "webpage"),
    # Legacy aliases (pre-schema Catalan synonyms)
    ("Article científic", "article-journal"),
    ("Manual", "book"),
    ("Ponència", "paper-conference"),
    # Legacy aliases that were missing and diverged from the frontend (cslEngine.js):
    # previously fell back to 'document' instead of the correct CSL type.
    ("Vídeo", "motion_picture"),
    ("Entrevista/testimoni", "interview"),
    ("Curs", "document"),
    # Fallbacks
    ("unknown_type_xyz", "document"),
    ("", "document"),
    (None, "document"),
])
def test_resolve_csl_type(raw, expected) -> None:
    from backend.services.csl_type_resolver import resolve_csl_type
    assert resolve_csl_type(raw) == expected


# ---------- 4. Sanity checks ----------

def test_schema_pinned_file_matches_recorded_sha() -> None:
    """The SHA-256 saved in the Python file corresponds to the real schema.json."""
    import hashlib
    from backend.services.zotero_schema import SCHEMA_SOURCE_SHA
    actual = hashlib.sha256(SCHEMA_JSON.read_bytes()).hexdigest()[:16]
    assert SCHEMA_SOURCE_SHA == actual, (
        "SCHEMA_SOURCE_SHA al fitxer generat no coincideix amb el SHA del "
        "schema.json pinned. Regenera amb build_constants.py."
    )


def test_all_csl_types_are_strings() -> None:
    """Each Zotero key maps to a single CSL type (string, not a list)."""
    from backend.services.zotero_schema import ZOTERO_TO_CSL_TYPE
    for zot, csl in ZOTERO_TO_CSL_TYPE.items():
        assert isinstance(csl, str), f"{zot} → {csl!r} no és str"
        assert csl, f"{zot} té un CSL type buit"


# ---------- 5. ITEM_TYPE_FIELDS (L2) ----------

def test_item_type_fields_covers_all_types() -> None:
    """Every itemType has an entry in ITEM_TYPE_FIELDS (even if empty)."""
    from backend.services.zotero_schema import ALL_ITEM_TYPES, ITEM_TYPE_FIELDS
    missing = [t for t in ALL_ITEM_TYPES if t not in ITEM_TYPE_FIELDS]
    assert not missing, f"itemTypes sense entrada a ITEM_TYPE_FIELDS: {missing}"


def test_item_type_fields_known_examples() -> None:
    """Common types have expected fields. If Zotero changes the schema and
    one of these fields disappears, we find out here."""
    from backend.services.zotero_schema import ITEM_TYPE_FIELDS
    cases = {
        'journalArticle': {'title', 'publicationTitle', 'volume', 'issue', 'pages', 'DOI'},
        'book':           {'title', 'publisher', 'ISBN', 'edition'},
        'preprint':       {'title', 'repository', 'archiveID', 'DOI'},
        'dataset':        {'title', 'versionNumber', 'identifier'},
        'webpage':        {'title', 'websiteTitle', 'url'},
        'annotation':     set(),  # explicitly empty per schema
    }
    for itype, expected in cases.items():
        actual = set(ITEM_TYPE_FIELDS[itype])
        missing = expected - actual
        assert not missing, f"{itype} ha perdut camps esperats: {missing}"


def test_py_and_ts_have_same_item_type_fields(ts_constants: dict) -> None:
    from backend.services.zotero_schema import ITEM_TYPE_FIELDS
    assert ITEM_TYPE_FIELDS == ts_constants["ITEM_TYPE_FIELDS"]


# ---------- 6. Mapping Recursos↔Zotero (L2) ----------

@pytest.mark.parametrize("recursos_field,item_type,expected", [
    # Casos clarament rellevants
    ('DOI',              'journalArticle', True),
    ('Llibre/Revista',   'journalArticle', True),   # via publicationTitle
    ('Llibre/Revista',   'bookSection',    True),   # via bookTitle
    ('Llibre/Revista',   'conferencePaper', True),  # via proceedingsTitle
    ('ISBN',             'book',           True),
    ('Pàgines',          'journalArticle', True),
    ('URL',              'webpage',        True),
    # Casos clarament no-rellevants
    ('ISBN',             'webpage',        False),
    ('Volum',            'webpage',        False),
    ('Llibre/Revista',   'webpage',        False),
    # Unknown type → never relevant
    ('DOI',              'nonexistent',    False),
    # Field with no Zotero correspondence
    ('CampPersonal',     'journalArticle', False),
])
def test_is_field_relevant_for_type(recursos_field, item_type, expected) -> None:
    from backend.services.recursos_zotero_mapping import is_field_relevant_for_type
    assert is_field_relevant_for_type(recursos_field, item_type) is expected


def test_zotero_field_to_recursos_inverse_is_well_formed() -> None:
    """Every Zotero field in the inverse mapping appears in some value of
    RECURSOS_TO_ZOTERO_FIELDS, and every value appears in the inverse."""
    from backend.services.recursos_zotero_mapping import (
        RECURSOS_TO_ZOTERO_FIELDS, ZOTERO_FIELD_TO_RECURSOS,
    )
    all_zotero_fields = {f for fs in RECURSOS_TO_ZOTERO_FIELDS.values() for f in fs}
    assert set(ZOTERO_FIELD_TO_RECURSOS) == all_zotero_fields
