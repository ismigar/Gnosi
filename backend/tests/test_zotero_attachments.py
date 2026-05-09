"""Unit tests for the Phase 6 attachment helpers.

Covers:
  - resolve_attachment_path() against the four Zotero path conventions:
    `attachments:`, `storage:`, absolute, and unresolvable.
  - pick_main_attachment() preference order (PDF that exists → PDF resolvable → any).

The standalone subprocess script lives outside the `backend/` package, so we
add its dir to sys.path to import the pure helpers directly.

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_zotero_attachments.py -v
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = _BACKEND_DIR.parent / "pipeline" / "skills" / "zotero_sync" / "scripts"
sys.path.insert(0, str(_SCRIPTS_DIR))

import zotero_to_vault as ztv  # noqa: E402


# --- resolve_attachment_path ------------------------------------------------


def test_resolve_attachments_prefix_uses_linked_base():
    att = {"path": "attachments:foo.pdf", "att_key": "AAA"}
    out = ztv.resolve_attachment_path(att, "/Users/me/Biblioteca", "/Users/me/Zotero/storage")
    assert out == "/Users/me/Biblioteca/foo.pdf"


def test_resolve_attachments_prefix_expands_user():
    att = {"path": "attachments:foo.pdf"}
    out = ztv.resolve_attachment_path(att, "~/Biblioteca", "/anything")
    home = os.path.expanduser("~")
    assert out == os.path.join(home, "Biblioteca", "foo.pdf")


def test_resolve_storage_prefix_uses_attachment_key():
    att = {"path": "storage:Fallacies.pdf", "att_key": "ABC123XX"}
    out = ztv.resolve_attachment_path(att, "/anything", "/Users/me/Zotero/storage")
    assert out == "/Users/me/Zotero/storage/ABC123XX/Fallacies.pdf"


def test_resolve_absolute_path_passes_through():
    att = {"path": "/Users/me/Documents/legacy.pdf"}
    out = ztv.resolve_attachment_path(att, "", "")
    assert out == "/Users/me/Documents/legacy.pdf"


def test_resolve_returns_none_when_path_missing():
    assert ztv.resolve_attachment_path({"path": ""}, "/b", "/s") is None
    assert ztv.resolve_attachment_path({}, "/b", "/s") is None
    assert ztv.resolve_attachment_path(None, "/b", "/s") is None


def test_resolve_attachments_prefix_returns_none_without_base():
    att = {"path": "attachments:foo.pdf"}
    assert ztv.resolve_attachment_path(att, "", "/s") is None


def test_resolve_storage_prefix_returns_none_without_key_or_storage():
    att_no_key = {"path": "storage:foo.pdf"}
    assert ztv.resolve_attachment_path(att_no_key, "/b", "/s") is None
    att_no_storage = {"path": "storage:foo.pdf", "att_key": "K"}
    assert ztv.resolve_attachment_path(att_no_storage, "/b", "") is None


def test_resolve_unknown_scheme_returns_none():
    att = {"path": "weird://something"}
    assert ztv.resolve_attachment_path(att, "/b", "/s") is None


# --- pick_main_attachment ---------------------------------------------------


def test_pick_prefers_existing_pdf_over_resolvable_pdf(tmp_path):
    existing = tmp_path / "AA" / "real.pdf"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"%PDF-1.4")

    atts = [
        # Resolvable but file doesn't exist on disk (storage:ghost)
        {"path": "storage:ghost.pdf", "att_key": "BB", "contentType": "application/pdf"},
        # Resolvable AND exists
        {"path": "storage:real.pdf", "att_key": "AA", "contentType": "application/pdf"},
    ]
    out = ztv.pick_main_attachment(atts, "", str(tmp_path))
    assert out == str(existing)


def test_pick_falls_back_to_resolvable_pdf_if_none_exists(tmp_path):
    atts = [
        {"path": "storage:foo.pdf", "att_key": "K", "contentType": "application/pdf"},
    ]
    out = ztv.pick_main_attachment(atts, "", str(tmp_path))
    # File doesn't exist but path is resolvable → still returned so user can investigate.
    assert out == str(tmp_path / "K" / "foo.pdf")


def test_pick_prefers_pdf_over_other_content_types(tmp_path):
    atts = [
        {"path": "storage:image.png", "att_key": "K1", "contentType": "image/png"},
        {"path": "storage:paper.pdf", "att_key": "K2", "contentType": "application/pdf"},
    ]
    out = ztv.pick_main_attachment(atts, "", str(tmp_path))
    assert out.endswith("paper.pdf")


def test_pick_returns_other_kind_when_no_pdf(tmp_path):
    atts = [
        {"path": "storage:image.png", "att_key": "K1", "contentType": "image/png"},
    ]
    out = ztv.pick_main_attachment(atts, "", str(tmp_path))
    assert out is not None and out.endswith("image.png")


def test_pick_returns_none_when_nothing_resolvable():
    atts = [
        {"path": "weird://x", "contentType": "application/pdf"},
        {"path": "", "contentType": "application/pdf"},
    ]
    assert ztv.pick_main_attachment(atts, "/b", "/s") is None


def test_pick_returns_none_for_empty_list():
    assert ztv.pick_main_attachment([], "/b", "/s") is None
