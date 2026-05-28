"""Tests de contracte per a la skill `zotero_schema`.

Cobreix:
  1. **Idempotència del build:** regenerar amb `schema.json` actual produeix
     EXACTAMENT el mateix output que els fitxers commitats. Si peta, vol
     dir que el build no és determinista, o que algú ha editat un fitxer
     generat a mà, o que `schema.json` ha canviat sense regenerar.
  2. **Coherència Py↔JS:** `ALL_ITEM_TYPES` i `ZOTERO_TO_CSL_TYPE` són
     idèntics als dos fitxers generats.
  3. **Resolver:** clau canònica, label traduït (ca-AD), alies legacy,
     tipus nous (preprint/dataset) i fallback es resolen com cal.

Executar:
    docker exec gnosi_backend python -m pytest backend/tests/test_zotero_schema.py -v
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

# El test viu a backend/tests/, el repo arrel és quatre nivells amunt:
# monorepo/apps/gnosi/backend/tests/test_zotero_schema.py
GNOSI_ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = GNOSI_ROOT / "pipeline/skills/zotero_schema"
BUILD_SCRIPT = SKILL_DIR / "scripts/build_constants.py"
SCHEMA_JSON = SKILL_DIR / "schema.json"
OUT_PY = GNOSI_ROOT / "backend/services/zotero_schema.py"
OUT_JS = GNOSI_ROOT / "frontend/src/components/Vault/zoteroSchema.js"


@pytest.fixture(scope="module")
def js_constants() -> dict:
    """Extreu les constants principals del fitxer JS generat via regex.

    Les constants vénen com a `export const NAME = <json-literal>;`.
    El build emet ALL_ITEM_TYPES en una línia i ZOTERO_TO_CSL_TYPE
    multi-línia; capturem fins al `};` final o `];` final.
    """
    js = OUT_JS.read_text(encoding="utf-8")

    def capture(name: str) -> object:
        m = re.search(rf'export const {name} = (.+?);\s*\n(?:export|$|\Z)', js, re.DOTALL)
        if not m:
            raise AssertionError(f"No s'ha trobat l'export {name} al JS generat")
        # JS accepta trailing commas, JSON no. Netegem-les abans del parse.
        literal = re.sub(r',(\s*[}\]])', r'\1', m.group(1))
        return json.loads(literal)

    return {
        "ALL_ITEM_TYPES": capture("ALL_ITEM_TYPES"),
        "ZOTERO_TO_CSL_TYPE": capture("ZOTERO_TO_CSL_TYPE"),
        "SCHEMA_VERSION": int(re.search(r"SCHEMA_VERSION = (\d+);", js).group(1)),
        "SCHEMA_SOURCE_SHA": re.search(r'SCHEMA_SOURCE_SHA = "([^"]+)";', js).group(1),
    }


# ---------- 1. Idempotència del build ----------

def test_build_is_deterministic(tmp_path: Path) -> None:
    """Regenerar amb el schema actual emet exactament el mateix output."""
    py_before = OUT_PY.read_text(encoding="utf-8")
    js_before = OUT_JS.read_text(encoding="utf-8")

    r = subprocess.run(
        [sys.executable, str(BUILD_SCRIPT)],
        capture_output=True, text=True, timeout=15,
    )
    assert r.returncode == 0, f"build_constants.py va fallar:\n{r.stderr}"

    py_after = OUT_PY.read_text(encoding="utf-8")
    js_after = OUT_JS.read_text(encoding="utf-8")
    assert py_before == py_after, (
        "Output Python ha canviat al regenerar — build no determinista o "
        "fitxer editat a mà. Re-executa build_constants.py i commiteja."
    )
    assert js_before == js_after, (
        "Output JS ha canviat al regenerar — vegis test Python anàleg."
    )


# ---------- 2. Coherència Py ↔ JS ----------

def test_py_and_js_have_same_item_types(js_constants: dict) -> None:
    from backend.services.zotero_schema import ALL_ITEM_TYPES
    assert sorted(ALL_ITEM_TYPES) == sorted(js_constants["ALL_ITEM_TYPES"])


def test_py_and_js_have_same_csl_mapping(js_constants: dict) -> None:
    from backend.services.zotero_schema import ZOTERO_TO_CSL_TYPE
    assert ZOTERO_TO_CSL_TYPE == js_constants["ZOTERO_TO_CSL_TYPE"]


def test_py_and_js_have_same_schema_version(js_constants: dict) -> None:
    from backend.services.zotero_schema import SCHEMA_VERSION, SCHEMA_SOURCE_SHA
    assert SCHEMA_VERSION == js_constants["SCHEMA_VERSION"]
    assert SCHEMA_SOURCE_SHA == js_constants["SCHEMA_SOURCE_SHA"]


# ---------- 3. Resolver ----------

@pytest.mark.parametrize("raw,expected", [
    # Claus canòniques Zotero
    ("journalArticle", "article-journal"),
    ("book", "book"),
    ("bookSection", "chapter"),
    ("thesis", "thesis"),
    ("webpage", "webpage"),
    # Tipus NOUS que abans queien al fallback 'document'
    ("preprint", "article"),
    ("dataset", "dataset"),
    ("standard", "standard"),
    # Labels traduïts (ca-AD oficial del schema)
    ("Llibre", "book"),
    ("Article de revista acadèmica", "article-journal"),
    ("Tesi", "thesis"),
    ("Pàgina web", "webpage"),
    # Alies legacy (sinònims catalans pre-schema)
    ("Article científic", "article-journal"),
    ("Manual", "book"),
    ("Ponència", "paper-conference"),
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
    """El SHA-256 que es desa al fitxer Python correspon al schema.json real."""
    import hashlib
    from backend.services.zotero_schema import SCHEMA_SOURCE_SHA
    actual = hashlib.sha256(SCHEMA_JSON.read_bytes()).hexdigest()[:16]
    assert SCHEMA_SOURCE_SHA == actual, (
        "SCHEMA_SOURCE_SHA al fitxer generat no coincideix amb el SHA del "
        "schema.json pinned. Regenera amb build_constants.py."
    )


def test_all_csl_types_are_strings() -> None:
    """Cada Zotero key apunta a un únic CSL type (string, no llista)."""
    from backend.services.zotero_schema import ZOTERO_TO_CSL_TYPE
    for zot, csl in ZOTERO_TO_CSL_TYPE.items():
        assert isinstance(csl, str), f"{zot} → {csl!r} no és str"
        assert csl, f"{zot} té un CSL type buit"
