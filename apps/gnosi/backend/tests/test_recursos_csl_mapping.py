"""Tests for the Recursos → CSL-JSON mapping used by Word / LibreOffice.

These cover the two regressions that made the citation system silently produce
wrong output while every endpoint still answered 200:

  - `_recursos_metadata_to_csl` read only the legacy free-form `Authors` string,
    so a record whose author lives in the structured `Autoría` field was cited
    by title ("(Zombie University 2018)") instead of by author.
  - `_resolve_csl_path` only knew the Docker-image paths, so in NATIVE mode
    `--csl` was never passed to pandoc and every style silently degraded to
    pandoc's own default.
"""
from __future__ import annotations

import pytest

from backend.api import vault_routes
from backend.api.vault_routes import (
    _ensure_recursos_citation_key,
    _extract_csl_entries,
    _find_structured_authors,
    _recursos_metadata_to_csl,
    _resolve_csl_path,
    _structured_authors_to_csl,
)


# ---------- structured authors ----------

def test_structured_authors_found_by_shape_not_key_name():
    """The field is stored under the field NAME, which the user can rename
    (`Authors` → `Autoría`), so lookup must be by shape."""
    meta = {"Autoría": [{"nom": "Sinéad", "cognom1": "Murphy", "cognom2": ""}]}
    assert _find_structured_authors(meta) == meta["Autoría"]
    assert _find_structured_authors({"Tags": ["a", "b"]}) == []
    assert _find_structured_authors({}) == []


def test_double_surname_collapses_into_family():
    """CSL has no second surname: cognom1+cognom2 merge into `family`."""
    out = _structured_authors_to_csl([
        {"nom": "Ismael", "cognom1": "García", "cognom2": "Fernández"},
    ])
    assert out == [{"family": "García Fernández", "given": "Ismael"}]


def test_author_without_surname_becomes_literal():
    """Organizations and mononyms carry no family name."""
    out = _structured_authors_to_csl([{"nom": "Diversos autors", "cognom1": "", "cognom2": ""}])
    assert out == [{"literal": "Diversos autors"}]


# ---------- full mapping ----------

def test_structured_autoria_wins_over_legacy_authors_string():
    item = _recursos_metadata_to_csl("Zombie University", {
        "Citation Key": "murphy2018",
        "Item Type": "Llibre",
        "Any": "2018",
        "Authors": "",
        "Autoría": [{"nom": "Sinéad", "cognom1": "Murphy", "cognom2": ""}],
    })
    assert item["author"] == [{"family": "Murphy", "given": "Sinéad"}]
    assert item["issued"] == {"date-parts": [[2018]]}


def test_legacy_authors_string_still_used_when_no_structured_field():
    item = _recursos_metadata_to_csl("Amor líquido", {
        "Citation Key": "bauman2007",
        "Any": "2007",
        "Authors": "Bauman, Zigmunt",
    })
    assert item["author"] == [{"family": "Bauman", "given": "Zigmunt"}]


def test_year_without_digits_is_kept_literal():
    """A year like 'en premsa' must survive as-is rather than degrade to 'n.d.'."""
    item = _recursos_metadata_to_csl("T", {"Citation Key": "k", "Any": "en premsa"})
    assert item["issued"] == {"literal": "en premsa"}


def test_missing_year_omits_issued_so_citeproc_renders_nd():
    item = _recursos_metadata_to_csl("T", {"Citation Key": "k", "Any": ""})
    assert "issued" not in item


def test_no_citation_key_is_not_citable():
    assert _recursos_metadata_to_csl("T", {"Any": "2020"}) is None


# ---------- style resolution ----------

def test_csl_styles_resolve_outside_docker():
    """In NATIVE mode there is no /app; the repo-relative path must resolve or
    pandoc silently falls back to its own default style."""
    for style in ("apa", "chicago-author-date", "mla", "ieee"):
        path = _resolve_csl_path(style)
        assert path is not None and path.exists(), f"{style} did not resolve"


def test_unknown_style_falls_back_to_apa():
    assert _resolve_csl_path("does-not-exist").name == "apa.csl"


def test_uploaded_style_id_resolves_to_its_file():
    """User-uploaded styles land in the same catalog dir as the canonical four;
    the hardcoded map used to send every unknown id to apa.csl, so the picker
    showed the uploaded style as active while everything rendered as APA."""
    from backend.services.csl_styles import STYLES_DIR
    f = STYLES_DIR / "zztest-uploaded-style.csl"
    f.write_text("<style/>", encoding="utf-8")
    try:
        assert _resolve_csl_path("zztest-uploaded-style") == f
        # A path component in the query param must not escape the catalog dir.
        assert _resolve_csl_path("../../../etc/passwd").name == "apa.csl"
    finally:
        f.unlink()


# ---------- automatic key on create/save ----------

TABLE_ID = "1aa31b10-d42d-554a-a318-434cc4f26ff2"


@pytest.fixture
def as_reference_table(monkeypatch):
    """Puts the page inside the designated references table and isolates the
    uniqueness check from the real vault."""
    monkeypatch.setattr(vault_routes, "get_reference_table_id", lambda: TABLE_ID)
    monkeypatch.setattr(vault_routes, "_table_by_id", lambda _id: {"properties": [{"name": "Citation Key"}]})
    monkeypatch.setattr(vault_routes, "_existing_citation_keys", set)


def test_new_resource_keys_off_structured_autoria(as_reference_table):
    """The resource editor writes the author to `Autoría`, not to the legacy
    `Authors` string. Reading only `Authors` made every resource created from
    the UI fall through to the title branch (`zztest2026`, `ref2024`)."""
    meta = _ensure_recursos_citation_key({
        "table_id": TABLE_ID,
        "Title": "ZZTest citation key A",
        "Any": "2026",
        "Autoría": [{"nom": "Ismael", "cognom1": "García", "cognom2": "Fernández"}],
    })
    assert meta["Citation Key"] == "garciafernandez2026"


def test_existing_key_is_never_overwritten(as_reference_table):
    meta = _ensure_recursos_citation_key({
        "table_id": TABLE_ID, "Title": "T", "Any": "2026",
        "Autoría": [{"nom": "", "cognom1": "Murphy", "cognom2": ""}],
        "Citation Key": "keepme2018",
    })
    assert meta["Citation Key"] == "keepme2018"


def test_row_with_only_an_author_still_gets_a_key(as_reference_table):
    """The 'is there any bibliographic data' gate also ignored the structured
    field, so an author-only row stayed uncitable."""
    meta = _ensure_recursos_citation_key({
        "table_id": TABLE_ID,
        "Autoría": [{"nom": "Zygmunt", "cognom1": "Bauman", "cognom2": ""}],
    })
    assert meta["Citation Key"] == "baumannd"


def test_empty_row_gets_no_junk_key(as_reference_table):
    meta = _ensure_recursos_citation_key({"table_id": TABLE_ID})
    assert "Citation Key" not in meta


# ---------- hand-typed key uniqueness (grid PATCH) ----------

@pytest.fixture
def dedupe_index(monkeypatch, as_reference_table):
    """Simulated cite key index: bauman2007 and bauman2007a already taken."""
    idx = {
        "bauman2007": {"id": "page-bauman"},
        "bauman2007a": {"id": "page-other"},
    }
    monkeypatch.setattr(
        "backend.services.context_vars.get_active_vault_path", lambda: "/tmp/v"
    )
    monkeypatch.setattr(vault_routes, "_ensure_cite_key_index", lambda v: idx)
    return idx


def test_typed_duplicate_key_gets_suffixed(dedupe_index):
    """Typing another record's key into the grid silently shadowed one of the
    two in citeproc; it must come out suffixed instead."""
    meta = vault_routes._dedupe_citation_key(
        {"table_id": TABLE_ID, "Citation Key": "bauman2007"}, "page-x")
    # 'bauman2007' and 'bauman2007a' are taken by other pages → 'b'.
    assert meta["Citation Key"] == "bauman2007b"


def test_own_key_is_not_suffixed(dedupe_index):
    """Re-saving a page with its own key must be a no-op, not b/c/d… drift."""
    meta = vault_routes._dedupe_citation_key(
        {"table_id": TABLE_ID, "Citation Key": "bauman2007"}, "page-bauman")
    assert meta["Citation Key"] == "bauman2007"


def test_free_key_passes_through(dedupe_index):
    meta = vault_routes._dedupe_citation_key(
        {"table_id": TABLE_ID, "Citation Key": "weber2016"}, "page-x")
    assert meta["Citation Key"] == "weber2016"


def test_non_reference_table_is_ignored(dedupe_index):
    meta = vault_routes._dedupe_citation_key(
        {"table_id": "una-altra-taula", "Citation Key": "bauman2007"}, "page-x")
    assert meta["Citation Key"] == "bauman2007"


# ---------- bibliography HTML parsing ----------

def test_nested_entry_divs_are_not_truncated():
    """`second-field-align` styles (IEEE) nest divs inside every csl-entry; a
    non-greedy regex cut each entry down to its `[1]` label."""
    out = (
        '<div id="refs" class="references csl-bib-body">\n'
        '<div id="ref-turkle2011" class="csl-entry" role="listitem">\n'
        '<div class="csl-left-margin">[1] </div>'
        '<div class="csl-right-inline">S. Turkle, <em>Alone Together</em>. Basic Books, 2011.</div>\n'
        '</div>\n</div>'
    )
    entries = _extract_csl_entries(out)
    assert len(entries) == 1
    assert "Alone Together" in entries[0]
    assert "Basic Books" in entries[0]


def test_flat_entry_still_parses():
    out = (
        '<div id="refs" class="references csl-bib-body">\n'
        '<div id="ref-bauman2007" class="csl-entry" role="listitem">Bauman, Z. (2007). '
        '<em>Amor líquido</em>. FCE.</div>\n</div>'
    )
    entries = _extract_csl_entries(out)
    assert entries == ['Bauman, Z. (2007). <em>Amor líquido</em>. FCE.']


def test_no_bibliography_yields_no_entries():
    assert _extract_csl_entries("<p>Res.</p>") == []
