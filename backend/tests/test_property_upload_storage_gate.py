"""Tests for which `storage_folder` an upload is allowed to resolve to.

`upload_property_file` takes `storage_folder` from the property's registry
config and falls back to the request value when the property has none. The
'free' mode is special: it lets the caller name an arbitrary absolute host
directory (`dest_folder`) to write into, so it must NOT be reachable through
that fallback — only a property genuinely configured as Lliure may use it.

What we cover:
    - request asking for 'free' on a property with NO configured storage
      → downgraded to assets (the write-anywhere primitive is not handed out)
    - request asking for 'free' on a property configured for something else
      → downgraded to assets
    - property genuinely configured as 'free' → stays free (feature still works)
    - configured value keeps winning over the request (existing invariant)
    - legacy 'biblioteca' alias still maps to Library (regression, PR #880)
    - `_resolve_storage_dir` validation of dest_folder for 'free'

Run:
    cd Gnosi
    GNOSI_DATA_DIR=local_data .venv/bin/python -m pytest \
        backend/tests/test_property_upload_storage_gate.py -v
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.api.vault_routes import (
    _effective_storage_folder,
    _normalize_storage_folder,
    _resolve_storage_dir,
)


# --- the gate: 'free' may only come from the registry config -----------------

@pytest.mark.parametrize("requested", ["free", "FREE", " free "])
def test_request_cannot_select_free_when_property_has_no_config(requested: str):
    """The implicit-Assets default must not be upgradable to 'free' by the client."""
    assert _effective_storage_folder("", requested) == "assets"


def test_request_cannot_select_free_when_property_configured_otherwise():
    """A field configured for the Library cannot be redirected to an arbitrary dir."""
    assert _effective_storage_folder("library", "free") == "library"
    assert _effective_storage_folder("assets", "free") == "assets"


@pytest.mark.parametrize("configured", ["free", "FREE", " free "])
def test_property_configured_as_free_still_works(configured: str):
    """The legitimate Lliure flow is untouched — this is the whole point of the mode."""
    assert _normalize_storage_folder(_effective_storage_folder(configured, "assets")) == "free"


# --- pre-existing invariants that must not regress ---------------------------

def test_configured_value_wins_over_request():
    assert _effective_storage_folder("library", "assets") == "library"


def test_request_is_used_only_as_fallback():
    assert _effective_storage_folder("", "library") == "library"
    assert _effective_storage_folder("", "") == ""


def test_legacy_biblioteca_alias_maps_to_library():
    """Regression for PR #880: 'biblioteca' is the pre-rename name of Library."""
    assert _normalize_storage_folder(_effective_storage_folder("biblioteca", "assets")) == "library"


# --- dest_folder validation for a genuinely-free field -----------------------

def test_free_requires_an_absolute_existing_dest_folder(tmp_path: Path):
    """A free field resolves to exactly the directory the user picked."""
    target, url_type = _resolve_storage_dir(
        "free", table=None, database=None, property_name="Arxiu", dest_folder=str(tmp_path)
    )
    assert target == tmp_path
    assert url_type == "absolute"


@pytest.mark.parametrize(
    "dest, reason",
    [
        ("", "empty"),
        ("relative/path", "not absolute"),
        ("/definitely/does/not/exist/anywhere", "missing"),
    ],
)
def test_free_rejects_bad_dest_folder(dest: str, reason: str):
    with pytest.raises(HTTPException) as exc:
        _resolve_storage_dir(
            "free", table=None, database=None, property_name="Arxiu", dest_folder=dest
        )
    assert exc.value.status_code == 400, reason
