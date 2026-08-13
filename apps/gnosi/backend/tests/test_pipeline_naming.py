"""Regression tests for the property-naming bug we fixed in:
    - pipeline/sandbox/import_from_export.py  (normalize_key → identity)
    - pipeline/sandbox/sync_sections.py        (property_name_to_frontmatter_key → identity)
    - backend/api/virtual_fields.py            (_frontmatter_key → identity)
    - frontend ... (covered by frontend tests/manual)

Symptom of the bug: properties showed up duplicated in the UI — once empty
under the schema name, once flattened-as-string under a slug name.

If any of these helpers ever drift back to slugifying, these tests will fail.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


def _load_sandbox_module(name: str):
    """Load a script from pipeline/sandbox/ as a module without polluting sys.path."""
    sandbox = Path(__file__).resolve().parents[2] / "pipeline" / "sandbox"
    spec_path = sandbox / f"{name}.py"
    if not spec_path.exists():
        pytest.skip(f"{spec_path} not found")
    spec = importlib.util.spec_from_file_location(f"_sandbox_{name}", spec_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_import_normalize_key_is_identity():
    mod = _load_sandbox_module("import_from_export")
    fn = mod.normalize_key
    assert fn("Projectes i àrees") == "Projectes i àrees"
    assert fn("Última edició") == "Última edició"
    assert fn("Arxivar") == "Arxivar"
    # Must NOT lowercase, NOT replace spaces, NOT strip apostrophes
    assert fn("Camp d'autor") == "Camp d'autor"


def test_sync_sections_property_name_is_identity():
    mod = _load_sandbox_module("sync_sections")
    fn = mod.property_name_to_frontmatter_key
    assert fn("Projectes i àrees") == "Projectes i àrees"
    assert fn("Categoria especial") == "Categoria especial"


def test_virtual_fields_frontmatter_key_is_identity():
    from backend.api.virtual_fields import _frontmatter_key
    assert _frontmatter_key("Projectes i àrees") == "Projectes i àrees"
    assert _frontmatter_key("Centralitat") == "Centralitat"
    assert _frontmatter_key("Extractes i notes") == "Extractes i notes"
