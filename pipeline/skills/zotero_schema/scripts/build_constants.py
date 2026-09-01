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
from collections.abc import Mapping
from pathlib import Path
from typing import TypeAlias

ConstantValue: TypeAlias = "str | list[str] | Mapping[str, ConstantValue]"

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


def _mapping(value: object, location: str) -> Mapping[object, object]:
    """Validate only a traversed container; leave unrelated metadata opaque."""
    if not isinstance(value, dict):
        raise ValueError(f"{location}: expected an object")
    return value


def _list(value: object, location: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{location}: expected an array")
    return value


def _string(value: object, location: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{location}: expected a string")
    return value


def load_schema() -> tuple[Mapping[object, object], str]:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    sha16 = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    schema: object = json.loads(raw)
    return _mapping(schema, "schema"), sha16


def derive_zotero_to_csl(csl_types: object) -> dict[str, str]:
    """csl.types in the schema is CSL→[Zotero]. We invert it to Zotero→CSL.

    Each Zotero key appears under a single CSL type. We validate this
    assumption: if a zoteroType appears under more than one CSL, we take the
    alphabetically first CSL and emit a warning to stderr.
    
    """
    types = _mapping(csl_types, "csl.types")
    keys = [_string(key, "csl.types key") for key in types]
    inverse: dict[str, str] = {}
    multi: dict[str, list[str]] = {}
    for csl in sorted(keys):
        for value in _list(types[csl], f"csl.types.{csl}"):
            zot = _string(value, f"csl.types.{csl} entry")
            if zot in inverse:
                multi.setdefault(zot, [inverse[zot]]).append(csl)
            else:
                inverse[zot] = csl
    if multi:
        for zot, csls in multi.items():
            print(f"WARNING: zoteroType '{zot}' apareix sota CSL types {csls}; "
                  f"emetem '{inverse[zot]}' (primer alfabètic).", file=sys.stderr)
    return inverse


def derive_item_type_fields(schema: object) -> dict[str, list[str]]:
    """{zoteroType: [zoteroField, ...]} with the official fields of each type.

    The fields are presented in the schema's order (which is Zotero's
    canonical order — most-used fields first, according to its own UI heuristics).
    
    """
    out: dict[str, list[str]] = {}
    source = _mapping(schema, "schema")
    for value in _list(source["itemTypes"], "itemTypes"):
        it = _mapping(value, "itemTypes entry")
        fields: list[str] = []
        for value in _list(it.get("fields", []), "itemTypes.fields"):
            field = _mapping(value, "itemTypes.fields entry")
            # Fieldless descriptors were intentionally omitted by the original
            # generator. A present but malformed field must never be dropped.
            if "field" in field:
                fields.append(_string(field["field"], "itemTypes.fields.field"))
        out[_string(it["itemType"], "itemTypes.itemType")] = fields
    return out


def derive_labels(schema: object, all_types: list[str]) -> dict[str, dict[str, str]]:
    """{locale: {zoteroType: label}}. Falls back to the original key if missing."""
    out: dict[str, dict[str, str]] = {}
    source = _mapping(schema, "schema")
    locales = _mapping(source.get("locales", {}), "locales")
    for loc in LOCALES:
        locale = _mapping(locales.get(loc, {}), f"locales.{loc}")
        it = _mapping(locale.get("itemTypes", {}), f"locales.{loc}.itemTypes")
        out[loc] = {
            t: _string(it.get(t, t), f"locales.{loc}.itemTypes.{t}") for t in all_types
        }
    return out


def invert_labels(labels: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """{locale: {label: zoteroType}}. If the same label points to multiple
    types in the same locale, we keep the alphabetically first one (stable)."""
    out: dict[str, dict[str, str]] = {}
    for loc, pairs in labels.items():
        inv: dict[str, str] = {}
        for zot in sorted(pairs):  # stable order
            label = pairs[zot]
            inv.setdefault(label, zot)
        out[loc] = inv
    return out


# ---------- Emissors Python / TypeScript ----------

def _py_dict(d: Mapping[str, ConstantValue], indent: int = 4) -> str:
    """Emits a Python dict with sorted keys, string values, fixed indent."""
    pad = " " * indent
    lines = ["{"]
    for k in sorted(d):
        v = d[k]
        if isinstance(v, Mapping):
            inner = _py_dict(v, indent + 4)
            lines.append(f"{pad}{k!r}: {inner},")
        elif isinstance(v, list):
            inner = "[" + ", ".join(repr(x) for x in v) + "]"
            lines.append(f"{pad}{k!r}: {inner},")
        else:
            lines.append(f"{pad}{k!r}: {v!r},")
    lines.append(" " * (indent - 4) + "}")
    return "\n".join(lines)


def emit_python(schema_ver: int, sha16: str, all_types: list[str],
                z2csl: dict[str, str], labels: dict[str, dict[str, str]],
                inv_labels: dict[str, dict[str, str]],
                fields: dict[str, list[str]]) -> str:
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


def _ts_value(v: ConstantValue) -> str:
    if isinstance(v, Mapping):
        parts = [
            f"    {json.dumps(k)}: {_ts_value(val)}"
            for k, val in sorted(v.items())
        ]
        return "{\n" + ",\n".join(parts) + ",\n}"
    if isinstance(v, list):
        return "[" + ", ".join(json.dumps(x) for x in v) + "]"
    return json.dumps(v)


def _ts_export(name: str, annotation: str, value: ConstantValue) -> str:
    return f"export const {name}: {annotation} = {_ts_value(value)};"


def emit_typescript(schema_ver: int, sha16: str, all_types: list[str],
                    z2csl: dict[str, str], labels: dict[str, dict[str, str]],
                    inv_labels: dict[str, dict[str, str]],
                    fields: dict[str, list[str]]) -> str:
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
    if not isinstance(schema_ver, int) or isinstance(schema_ver, bool):
        raise ValueError("version: expected an integer")
    all_types = sorted(
        _string(_mapping(it, "itemTypes entry")["itemType"], "itemTypes.itemType")
        for it in _list(schema["itemTypes"], "itemTypes")
    )

    locales = _mapping(schema.get("locales", {}), "locales")
    missing = [loc for loc in LOCALES if loc not in locales]
    if missing:
        print(f"ERROR: locales esperats no trobats al schema: {missing}", file=sys.stderr)
        return 1

    z2csl = derive_zotero_to_csl(_mapping(schema["csl"], "csl")["types"])
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
