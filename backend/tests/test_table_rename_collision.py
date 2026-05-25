"""Tests for the case-insensitive flat-folder collision helpers in
backend/api/vault_routes.py.

Covers the two safety-critical pieces added for the macOS/APFS table-rename
collision fix (see docs/dev_memory/directives/table_rename_flat_folder_collision.md):
- `_asset_segments_collide`: branch selection (case/whitespace-insensitive).
- `_rewrite_inline_asset_refs`: rewriting encoded vs raw inline asset URLs.
"""
from __future__ import annotations

import urllib.parse

from backend.api.vault_routes import _asset_segments_collide, _rewrite_inline_asset_refs


# --- _asset_segments_collide -----------------------------------------------

def test_collide_case_only_difference():
    # APFS treats these as the same physical folder.
    assert _asset_segments_collide("Cervell Digital", "Cervell digital") is True


def test_collide_ignores_surrounding_whitespace():
    assert _asset_segments_collide("  Cervell Digital ", "cervell digital") is True


def test_collide_distinct_names():
    assert _asset_segments_collide("Cervell", "Cervell Digital") is False


def test_collide_handles_empty_and_none():
    assert _asset_segments_collide("", "") is True
    assert _asset_segments_collide(None, None) is True
    assert _asset_segments_collide("", "x") is False


# --- _rewrite_inline_asset_refs --------------------------------------------

OLD = "Old Table"   # quote → "Old%20Table"
NEW = "New Table"   # quote → "New%20Table"
NEW_URL = f"/api/vault/assets/{urllib.parse.quote(NEW)}/"


def test_rewrites_raw_and_encoded_refs(tmp_path):
    page = tmp_path / "page.md"
    page.write_text(
        "Imatge solta raw: ![](/api/vault/assets/Old Table/a.png)\n"
        "Imatge solta encoded: ![](/api/vault/assets/Old%20Table/b.png)\n",
        encoding="utf-8",
    )

    changed = _rewrite_inline_asset_refs(tmp_path, OLD, NEW)

    assert changed == 1
    text = page.read_text(encoding="utf-8")
    assert f"{NEW_URL}a.png" in text
    assert f"{NEW_URL}b.png" in text
    assert "/api/vault/assets/Old" not in text  # cap referència antiga (raw ni encoded)


def test_rewrites_nested_pages(tmp_path):
    sub = tmp_path / "subfolder"
    sub.mkdir()
    nested = sub / "nested.md"
    nested.write_text("![](/api/vault/assets/Old%20Table/c.png)", encoding="utf-8")

    changed = _rewrite_inline_asset_refs(tmp_path, OLD, NEW)

    assert changed == 1
    assert f"{NEW_URL}c.png" in nested.read_text(encoding="utf-8")


def test_leaves_unrelated_refs_untouched(tmp_path):
    page = tmp_path / "page.md"
    original = "![](/api/vault/assets/Other Table/x.png)"
    page.write_text(original, encoding="utf-8")

    changed = _rewrite_inline_asset_refs(tmp_path, OLD, NEW)

    assert changed == 0
    assert page.read_text(encoding="utf-8") == original


def test_noop_when_segment_unchanged(tmp_path):
    page = tmp_path / "page.md"
    original = "![](/api/vault/assets/Old%20Table/a.png)"
    page.write_text(original, encoding="utf-8")

    changed = _rewrite_inline_asset_refs(tmp_path, OLD, OLD)

    assert changed == 0
    assert page.read_text(encoding="utf-8") == original
