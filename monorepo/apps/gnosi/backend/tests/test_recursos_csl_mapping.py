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

from backend.api.vault_routes import (
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
