#!/usr/bin/env python3
"""Generates the Python + TypeScript constants files from `schema.json`.

Reads `pipeline/skills/zotero_schema/schema.json` (pinned, never from the network
in this script — see `refresh_schema.py` to update it) and emits:

  - `backend/services/zotero_schema.py`
  - `frontend/src/generated/zoteroSchema.ts`

Both with header "GENERATED — DO NOT EDIT". Deterministic output
(keys sorted alphabetically) so the regeneration test can
compare against the committed file.

Generated constants (same names in Python and TypeScript):
  - SCHEMA_VERSION           — schema.json version (`version` field)
  - SCHEMA_SOURCE_SHA        — first 16 chars of schema.json's SHA-256
  - ALL_ITEM_TYPES           — alphabetical list of all itemType values
  - ZOTERO_TO_CSL_TYPE       — {zoteroType: cslType}  (1:1; first CSL parent)
  - ZOTERO_TYPE_LABELS       — {locale: {zoteroType: translated_label}}
  - LABEL_TO_ZOTERO_TYPE     — {locale: {translated_label: zoteroType}}
                               (for compat with frontmatter that stores labels)
  - ITEM_TYPE_FIELDS         — {zoteroType: [zoteroField, ...]} with the
                               official fields of each type (for L2: the
                               creation modal groups "relevant" vs "other")

The schema's `csl.types` inverse is CSL→[Zotero]; here we invert it to
Zotero→CSL by taking the FIRST parent CSL type for each Zotero type (stable
order: alphabetical sort of CSL types, first hit wins).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, List

# Locales that Gnosi exposes (must exist in schema.locales). They must cover all
# the UI languages (frontend/src/i18n.js: ca/es/en/fr) so components that show
# Zotero-type labels (e.g. MetadataLookupModal) can follow the active language.
# `fr-FR` added 2026-07-11 (the French UI fell back to ca-AD labels).
LOCALES = ("ca-AD", "es-ES", "en-GB", "en-US", "fr-FR")

ROOT = Path(__file__).resolve().parents[4]  # Gnosi
SCHEMA_PATH = ROOT / "pipeline/skills/zotero_schema/schema.json"
OUT_PY = ROOT / "backend/services/zotero_schema.py"
OUT_TS = ROOT / "frontend/src/generated/zoteroSchema.ts"

WARN_HEADER = (
    "GENERATED — DO NOT EDIT. Source: pipeline/skills/zotero_schema/schema.json. "
    "Regenerate with `pipeline/skills/zotero_schema/scripts/build_constants.py`."
)


def load_schema() -> tuple[dict, str]:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    sha16 = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return json.loads(raw), sha16


def derive_zotero_to_csl(csl_types: Dict[str, List[str]]) -> Dict[str, str]:
    """csl.types in the schema is CSL→[Zotero]. We invert it to Zotero→CSL.

    Each Zotero key appears under a single CSL type. We validate this
    assumption: if a zoteroType appears under more than one CSL, we take the
    alphabetically first CSL and emit a warning to stderr.
    
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


def derive_item_type_fields(schema: dict) -> Dict[str, List[str]]:
    """{zoteroType: [zoteroField, ...]} with the official fields of each type.

    The fields are presented in the schema's order (which is Zotero's
    canonical order — most-used fields first, according to its own UI heuristics).
    
    """
    out: Dict[str, List[str]] = {}
    for it in schema["itemTypes"]:
        fields = [f["field"] for f in it.get("fields", []) if "field" in f]
        out[it["itemType"]] = fields
    return out


def derive_labels(schema: dict, all_types: List[str]) -> Dict[str, Dict[str, str]]:
    """{locale: {zoteroType: label}}. Falls back to the original key if missing."""
    out: Dict[str, Dict[str, str]] = {}
    for loc in LOCALES:
        it = schema.get("locales", {}).get(loc, {}).get("itemTypes", {})
        out[loc] = {t: it.get(t, t) for t in all_types}
    return out


def invert_labels(labels: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, str]]:
    """{locale: {label: zoteroType}}. If the same label points to multiple
    types in the same locale, we keep the alphabetically first one (stable)."""
    out: Dict[str, Dict[str, str]] = {}
    for loc, pairs in labels.items():
        inv: Dict[str, str] = {}
        for zot in sorted(pairs):  # stable order
            label = pairs[zot]
            inv.setdefault(label, zot)
        out[loc] = inv
    return out


# ---------- Emissors Python / TypeScript ----------

def _py_dict(d: dict, indent: int = 4) -> str:
    """Emits a Python dict with sorted keys, string values, fixed indent."""
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
                inv_labels: Dict[str, Dict[str, str]],
                fields: Dict[str, List[str]]) -> str:
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
        f"ITEM_TYPE_FIELDS: dict[str, list[str]] = {_py_dict(fields)}",
        "",
    ]
    return "\n".join(body)


def _ts_value(v: object) -> str:
    if isinstance(v, dict):
        parts = [
            f"    {json.dumps(k)}: {_ts_value(val)}"
            for k, val in sorted(v.items())
        ]
        return "{\n" + ",\n".join(parts) + ",\n}"
    if isinstance(v, list):
        return "[" + ", ".join(json.dumps(x) for x in v) + "]"
    return json.dumps(v)


def _ts_export(name: str, annotation: str, value: object) -> str:
    return f"export const {name}: {annotation} = {_ts_value(value)};"


def emit_typescript(schema_ver: int, sha16: str, all_types: List[str],
                    z2csl: Dict[str, str], labels: Dict[str, Dict[str, str]],
                    inv_labels: Dict[str, Dict[str, str]],
                    fields: Dict[str, List[str]]) -> str:
    string_map = "Readonly<Record<string, string>>"
    localized_map = f"Readonly<Record<string, {string_map}>>"
    body = [
        f"// {WARN_HEADER}",
        "",
        f"export const SCHEMA_VERSION: number = {schema_ver};",
        f"export const SCHEMA_SOURCE_SHA: string = {json.dumps(sha16)};",
        "",
        _ts_export("ALL_ITEM_TYPES", "readonly string[]", all_types),
        "",
        _ts_export("ZOTERO_TO_CSL_TYPE", string_map, z2csl),
        "",
        _ts_export("ZOTERO_TYPE_LABELS", localized_map, labels),
        "",
        _ts_export("LABEL_TO_ZOTERO_TYPE", localized_map, inv_labels),
        "",
        _ts_export(
            "ITEM_TYPE_FIELDS",
            "Readonly<Record<string, readonly string[]>>",
            fields,
        ),
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
    fields = derive_item_type_fields(schema)

    OUT_PY.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_PY.write_text(
        emit_python(schema_ver, sha16, all_types, z2csl, labels, inv_labels, fields),
        encoding="utf-8")
    OUT_TS.write_text(
        emit_typescript(schema_ver, sha16, all_types, z2csl, labels, inv_labels, fields),
        encoding="utf-8")

    total_fields = sum(len(v) for v in fields.values())
    print(f"OK schema v{schema_ver} (sha:{sha16}) → {OUT_PY.relative_to(ROOT)}")
    print(f"OK schema v{schema_ver} (sha:{sha16}) → {OUT_TS.relative_to(ROOT)}")
    print(f"   {len(all_types)} itemTypes · {len(z2csl)} Zotero→CSL · "
          f"{len(LOCALES)} locales · {total_fields} field-occurrences")
    return 0


if __name__ == "__main__":
    sys.exit(main())
