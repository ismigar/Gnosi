"""Tests for the `csl_styles` service.

Covers:
  - `_extract_csl_title`: extracts title from XML with and without namespace, regex fallback.
  - `list_styles`: integration with the real directory (non-empty validation).
  - `save_uploaded_style`: validates size, extension, XML, root element.
"""
from __future__ import annotations

import pytest

from backend.services.csl_styles import (
    STYLES_DIR,
    _extract_csl_title,
    list_styles,
    save_uploaded_style,
)


def _make_csl_xml(title: str = "Test Style") -> bytes:
    return (
        f'<?xml version="1.0" encoding="utf-8"?>\n'
        f'<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">\n'
        f'  <info>\n'
        f'    <title>{title}</title>\n'
        f'    <id>http://example.com/test</id>\n'
        f'  </info>\n'
        f'  <citation><layout><text variable="title"/></layout></citation>\n'
        f'</style>\n'
    ).encode("utf-8")


# ---------- list_styles ----------

def test_list_styles_returns_known_entries():
    """The 4 canonical styles must be committed to the repo."""
    styles = list_styles()
    ids = {s["id"] for s in styles}
    expected_canonical = {"apa", "chicago-author-date", "ieee", "modern-language-association"}
    missing = expected_canonical - ids
    assert not missing, f"Falten estils canònics esperats: {missing}"


def test_list_styles_each_has_required_keys():
    for s in list_styles():
        assert set(s.keys()) >= {"id", "file", "title"}
        assert s["id"]
        assert s["file"].endswith(".csl")


# ---------- _extract_csl_title ----------

def test_extract_csl_title_with_namespace(tmp_path):
    f = tmp_path / "x.csl"
    f.write_bytes(_make_csl_xml("My Custom Style"))
    assert _extract_csl_title(f) == "My Custom Style"


def test_extract_csl_title_regex_fallback(tmp_path):
    """Truncated XML → ParseError → falls back to regex (which still finds the title)."""
    f = tmp_path / "truncated.csl"
    f.write_bytes(b'<?xml version="1.0"?><style><info><title>Truncated Title</title></info>')
    assert _extract_csl_title(f) == "Truncated Title"


def test_extract_csl_title_no_title(tmp_path):
    """CSL without a title → None, doesn't crash."""
    f = tmp_path / "untitled.csl"
    f.write_bytes(
        b'<?xml version="1.0"?>\n'
        b'<style xmlns="http://purl.org/net/xbiblio/csl"><info></info></style>'
    )
    assert _extract_csl_title(f) is None


def test_extract_csl_title_nonexistent_path(tmp_path):
    assert _extract_csl_title(tmp_path / "missing.csl") is None


# ---------- save_uploaded_style ----------

def test_save_uploaded_style_happy_path(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.csl_styles.STYLES_DIR", tmp_path)
    raw = _make_csl_xml("Vancouver")
    meta = save_uploaded_style(raw, "vancouver.csl")
    assert meta == {"id": "vancouver", "file": "vancouver.csl", "title": "Vancouver"}
    assert (tmp_path / "vancouver.csl").exists()


def test_save_uploaded_style_sanitizes_filename(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.csl_styles.STYLES_DIR", tmp_path)
    meta = save_uploaded_style(_make_csl_xml(), "../../../evil name!@#$.csl")
    # No slashes, no dangerous characters.
    assert "/" not in meta["file"]
    assert "\\" not in meta["file"]
    assert meta["file"].endswith(".csl")


def test_save_uploaded_style_rejects_oversize(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.csl_styles.STYLES_DIR", tmp_path)
    big = b"x" * (1024 * 1024 + 1)
    with pytest.raises(ValueError, match="massa gran"):
        save_uploaded_style(big, "big.csl")


def test_save_uploaded_style_rejects_wrong_extension(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.csl_styles.STYLES_DIR", tmp_path)
    with pytest.raises(ValueError, match="extensió"):
        save_uploaded_style(_make_csl_xml(), "style.xml")


def test_save_uploaded_style_rejects_invalid_xml(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.csl_styles.STYLES_DIR", tmp_path)
    with pytest.raises(ValueError, match="XML invàlid"):
        save_uploaded_style(b"not xml at all", "broken.csl")


def test_save_uploaded_style_rejects_wrong_root(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.csl_styles.STYLES_DIR", tmp_path)
    raw = b'<?xml version="1.0"?><foo/>'
    with pytest.raises(ValueError, match="Root XML esperat"):
        save_uploaded_style(raw, "wrong.csl")
