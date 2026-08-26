"""Regression tests for OneDrive/Windows-safe filename generation.

cf. docs/dev_memory/directives/onedrive_filename_safety.md. OneDrive rejects:
    - reserved chars `< > : " / \\ | ? *` and control chars (\\x00-\\x1f)
    - names that END in a dot or a space (also per FOLDER segment)
    - Windows reserved device names (CON, PRN, AUX, NUL, COM0-9, LPT0-9),
      with ANY extension (`CON.md` is also blocked)

These helpers must NEVER slugify: accents, case and interior spaces are
preserved (cf. test_pipeline_naming.py).
"""
from __future__ import annotations

import pytest

from backend.utils.safe_io import (
    guard_windows_reserved,
    sanitize_filename_component,
    sanitize_path_segment,
    sanitize_rel_folder,
    sanitize_vault_title,
)


# ───────────────────────── guard_windows_reserved ─────────────────────────

@pytest.mark.parametrize("bad", ["CON", "con", "Nul", "COM1", "lpt9", "CON.md",
                                 "nul.json", "com1.contact.md", "CON .md"])
def test_reserved_names_are_prefixed(bad):
    guarded = guard_windows_reserved(bad)
    assert guarded == "_" + bad
    stem = guarded.split(".", 1)[0].rstrip(" ")
    assert stem.upper() not in {"CON", "NUL", "COM1", "LPT9"}


@pytest.mark.parametrize("ok", ["CONTACTE", "console.md", "Confitura", "L'aux del cor",
                                "communa", "", "Nota normal.md"])
def test_non_reserved_names_untouched(ok):
    assert guard_windows_reserved(ok) == ok


# ───────────────────────── sanitize_vault_title ─────────────────────────

def test_title_removes_onedrive_forbidden_chars():
    out = sanitize_vault_title('Q: "review" <draft>? *2|3\\4/5*')
    for ch in '<>:"/\\|?*':
        assert ch not in out
    assert out == "Q review draft 2345"


def test_title_preserves_accents_case_and_spaces():
    # NEVER slugify (cf. test_pipeline_naming)
    assert sanitize_vault_title("Projectes i àrees") == "Projectes i àrees"
    assert sanitize_vault_title("Última edició (v2), OK!") == "Última edició (v2), OK!"


def test_title_collapses_interior_control_whitespace():
    # A Notion/mail title with \n or \t must not produce a control char in the name
    assert sanitize_vault_title("Línia u\nlínia dos\tfi") == "Línia u línia dos fi"


def test_title_strips_trailing_dots_and_spaces():
    assert sanitize_vault_title("Informe final.") == "Informe final"
    assert sanitize_vault_title("Informe final... ") == "Informe final"


def test_title_truncation_cannot_expose_trailing_space_or_dot():
    long = ("a" * 118) + " .b"          # cut at 120 lands right after " ."
    out = sanitize_vault_title(long, max_len=120)
    assert not out.endswith((" ", "."))


def test_title_fallback_and_reserved():
    assert sanitize_vault_title("") == "Sense títol"
    assert sanitize_vault_title('<>:"/\\|?*') == "Sense títol"
    assert sanitize_vault_title("CON") == "_CON"


# ───────────────────────── sanitize_rel_folder ─────────────────────────

def test_rel_folder_sanitizes_each_segment():
    # Intermediate segment ending in space/dot would break OneDrive
    assert sanitize_rel_folder("Carpeta1 /Carpeta2.") == "Carpeta1/Carpeta2"


def test_rel_folder_drops_traversal_and_empty_segments():
    assert sanitize_rel_folder("../../etc") == "etc"
    assert sanitize_rel_folder("a//b/./c") == "a/b/c"
    assert sanitize_rel_folder("..", fallback="Notion") == "Notion"


def test_rel_folder_preserves_accents_and_nesting():
    assert sanitize_rel_folder("Clon Notion/Àrees") == "Clon Notion/Àrees"


def test_rel_folder_guards_reserved_segments():
    assert sanitize_rel_folder("BD/CON/coses") == "BD/_CON/coses"


def test_rel_folder_fallback_when_empty():
    assert sanitize_rel_folder("", fallback="Importades") == "Importades"
    assert sanitize_rel_folder(None, fallback="Importades") == "Importades"


# ───────────────────────── sanitize_path_segment ─────────────────────────

def test_path_segment_strips_trailing_dot():
    assert sanitize_path_segment("Informe final.", "x") == "Informe final"


def test_path_segment_guards_reserved():
    assert sanitize_path_segment("CON", "x") == "_CON"
    assert sanitize_path_segment("CON.jpg", "x") == "_CON.jpg"


def test_path_segment_truncation_then_strip():
    long = ("a" * 118) + " .b"
    out = sanitize_path_segment(long, "x")
    assert len(out) <= 120
    assert not out.endswith((" ", "."))


def test_path_segment_keeps_existing_behaviour():
    # Interior spaces collapsed, separators to space, fallback on dots-only
    assert sanitize_path_segment("Àlbum  d estiu", "x") == "Àlbum d estiu"
    assert sanitize_path_segment("a/b", "x") == "a b"
    assert sanitize_path_segment("...", "x") == "x"
    assert sanitize_path_segment("", "x") == "x"


# ───────────────────────── sanitize_filename_component ─────────────────────────

def test_filename_component_guards_reserved():
    assert sanitize_filename_component("CON") == "_CON"


def test_filename_component_keeps_existing_behaviour():
    assert sanitize_filename_component(" <abc@host>\r\n ") == "abc@host"
    assert sanitize_filename_component(None) == ""


# ───────────────────────── integration points ─────────────────────────

def test_vault_routes_filename_base_delegates():
    from backend.api.vault_routes import _sanitize_filename_base
    assert _sanitize_filename_base("Nota: final.") == "Nota final"
    assert _sanitize_filename_base("") == "Untitled"
    assert _sanitize_filename_base("CON") == "_CON"


def test_public_routes_filename_delegates():
    from backend.api.public_routes import _sanitize_filename
    assert _sanitize_filename('Títol "públic"?') == "Títol públic"
    assert _sanitize_filename("") == "Sense títol"
