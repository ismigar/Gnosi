#!/usr/bin/env python3
"""Genera els fitxers de constants Py + JS a partir de `schema.json`.

Llegeix `pipeline/skills/zotero_schema/schema.json` (pinned, mai de la xarxa
en aquest script — vegis `refresh_schema.py` per actualitzar-lo) i emet:

  - `backend/services/zotero_schema.py`
  - `frontend/src/components/Vault/zoteroSchema.js`

Tots dos amb header "GENERATED — DO NOT EDIT". Sortida determinista
(claus ordenades alfabèticament) perquè el test de regeneració pugui
comparar contra el fitxer commitat.

Constants generades (mateixos noms a Py i JS):
  - SCHEMA_VERSION           — versió de schema.json (camp `version`)
  - SCHEMA_SOURCE_SHA        — primers 16 chars de SHA-256 del schema.json
  - ALL_ITEM_TYPES           — llista alfabètica de tots els itemType
  - ZOTERO_TO_CSL_TYPE       — {zoteroType: cslType}  (1:1; primer CSL pare)
  - ZOTERO_TYPE_LABELS       — {locale: {zoteroType: label_traduit}}
  - LABEL_TO_ZOTERO_TYPE     — {locale: {label_traduit: zoteroType}}
                               (per compat amb frontmatter que desa labels)

L'invers `csl.types` del schema és CSL→[Zotero]; aquí l'invertim a
Zotero→CSL agafant el PRIMER tipus CSL pare per a cada Zotero (ordre
estable: ordenació alfabètica dels CSL types, primer hit guanya).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, List

# Locales que Gnosi exposa (han d'existir a schema.locales).
LOCALES = ("ca-AD", "es-ES", "en-GB", "en-US")

ROOT = Path(__file__).resolve().parents[4]  # monorepo/apps/gnosi
SCHEMA_PATH = ROOT / "pipeline/skills/zotero_schema/schema.json"
OUT_PY = ROOT / "backend/services/zotero_schema.py"
OUT_JS = ROOT / "frontend/src/components/Vault/zoteroSchema.js"

WARN_HEADER = (
    "GENERATED — DO NOT EDIT. Source: pipeline/skills/zotero_schema/schema.json. "
    "Regenerate with `pipeline/skills/zotero_schema/scripts/build_constants.py`."
)


def load_schema() -> tuple[dict, str]:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    sha16 = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return json.loads(raw), sha16


def derive_zotero_to_csl(csl_types: Dict[str, List[str]]) -> Dict[str, str]:
    """csl.types al schema és CSL→[Zotero]. L'invertim a Zotero→CSL.

    Cada Zotero key apareix sota un sol CSL type. Validem aquesta
    assumpció: si un zoteroType apareix sota més d'un CSL, agafem el
    primer en ordre alfabètic de CSL i emetem un warning per stderr.
    """
    inverse: Dict[str, str] = {}
    multi: Dict[str, List[str]] = {}
    for csl in sorted(csl_types):
        for zot in csl_types[csl]:
            if zot in inverse:
                multi.setdefault(zot, [inverse[zot]]).append(csl)
            else:
                inverse[zot] = csl
    if multi:
        for zot, csls in multi.items():
            print(f"WARNING: zoteroType '{zot}' apareix sota CSL types {csls}; "
                  f"emetem '{inverse[zot]}' (primer alfabètic).", file=sys.stderr)
    return inverse


def derive_labels(schema: dict, all_types: List[str]) -> Dict[str, Dict[str, str]]:
    """{locale: {zoteroType: label}}. Cau a la clau original si manca."""
    out: Dict[str, Dict[str, str]] = {}
    for loc in LOCALES:
        it = schema.get("locales", {}).get(loc, {}).get("itemTypes", {})
        out[loc] = {t: it.get(t, t) for t in all_types}
    return out


def invert_labels(labels: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, str]]:
    """{locale: {label: zoteroType}}. Si un mateix label apunta a múltiples
    types al mateix locale, conservem el primer alfabètic (estable)."""
    out: Dict[str, Dict[str, str]] = {}
    for loc, pairs in labels.items():
        inv: Dict[str, str] = {}
        for zot in sorted(pairs):  # ordre estable
            label = pairs[zot]
            inv.setdefault(label, zot)
        out[loc] = inv
    return out


# ---------- Emissors Python / JavaScript ----------

def _py_dict(d: dict, indent: int = 4) -> str:
    """Emet un dict Python amb claus ordenades, valors string, indent fix."""
    pad = " " * indent
    lines = ["{"]
    for k in sorted(d):
        v = d[k]
        if isinstance(v, dict):
            inner = _py_dict(v, indent + 4)
            lines.append(f"{pad}{k!r}: {inner},")
        elif isinstance(v, list):
            inner = "[" + ", ".join(repr(x) for x in v) + "]"
            lines.append(f"{pad}{k!r}: {inner},")
        else:
            lines.append(f"{pad}{k!r}: {v!r},")
    lines.append(" " * (indent - 4) + "}")
    return "\n".join(lines)


def emit_python(schema_ver: int, sha16: str, all_types: List[str],
                z2csl: Dict[str, str], labels: Dict[str, Dict[str, str]],
                inv_labels: Dict[str, Dict[str, str]]) -> str:
    body = [
        f'"""{WARN_HEADER}"""',
        "",
        f"SCHEMA_VERSION: int = {schema_ver}",
        f"SCHEMA_SOURCE_SHA: str = {sha16!r}",
        "",
        "ALL_ITEM_TYPES: list[str] = [",
        *(f"    {t!r}," for t in all_types),
        "]",
        "",
        f"ZOTERO_TO_CSL_TYPE: dict[str, str] = {_py_dict(z2csl)}",
        "",
        f"ZOTERO_TYPE_LABELS: dict[str, dict[str, str]] = {_py_dict(labels)}",
        "",
        f"LABEL_TO_ZOTERO_TYPE: dict[str, dict[str, str]] = {_py_dict(inv_labels)}",
        "",
    ]
    return "\n".join(body)


def _js_value(v) -> str:
    if isinstance(v, dict):
        parts = [f"    {json.dumps(k)}: {_js_value(val)}" for k, val in sorted(v.items())]
        return "{\n" + ",\n".join(parts) + ",\n}"
    if isinstance(v, list):
        return "[" + ", ".join(json.dumps(x) for x in v) + "]"
    return json.dumps(v)


def _js_export(name: str, value) -> str:
    return f"export const {name} = {_js_value(value)};"


def emit_javascript(schema_ver: int, sha16: str, all_types: List[str],
                    z2csl: Dict[str, str], labels: Dict[str, Dict[str, str]],
                    inv_labels: Dict[str, Dict[str, str]]) -> str:
    body = [
        f"// {WARN_HEADER}",
        "",
        f"export const SCHEMA_VERSION = {schema_ver};",
        f"export const SCHEMA_SOURCE_SHA = {json.dumps(sha16)};",
        "",
        _js_export("ALL_ITEM_TYPES", all_types),
        "",
        _js_export("ZOTERO_TO_CSL_TYPE", z2csl),
        "",
        _js_export("ZOTERO_TYPE_LABELS", labels),
        "",
        _js_export("LABEL_TO_ZOTERO_TYPE", inv_labels),
        "",
    ]
    return "\n".join(body)


def main() -> int:
    schema, sha16 = load_schema()
    schema_ver = schema["version"]
    all_types = sorted(it["itemType"] for it in schema["itemTypes"])

    missing = [loc for loc in LOCALES if loc not in schema.get("locales", {})]
    if missing:
        print(f"ERROR: locales esperats no trobats al schema: {missing}", file=sys.stderr)
        return 1

    z2csl = derive_zotero_to_csl(schema["csl"]["types"])
    labels = derive_labels(schema, all_types)
    inv_labels = invert_labels(labels)

    OUT_PY.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_PY.write_text(emit_python(schema_ver, sha16, all_types, z2csl, labels, inv_labels),
                      encoding="utf-8")
    OUT_JS.write_text(emit_javascript(schema_ver, sha16, all_types, z2csl, labels, inv_labels),
                      encoding="utf-8")

    print(f"OK schema v{schema_ver} (sha:{sha16}) → {OUT_PY.relative_to(ROOT)}")
    print(f"OK schema v{schema_ver} (sha:{sha16}) → {OUT_JS.relative_to(ROOT)}")
    print(f"   {len(all_types)} itemTypes · {len(z2csl)} Zotero→CSL · {len(LOCALES)} locales")
    return 0


if __name__ == "__main__":
    sys.exit(main())
