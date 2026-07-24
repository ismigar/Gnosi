"""Hermetic tests: soft-deleted pages (`.trash/`) must not be linkable.

`_iter_linkable_page_documents` feeds `/global-index`, which the frontend
uses to build the `[[` wikilink autocomplete. Pages moved to `.trash/`
(soft-delete) must be excluded — otherwise trashed pages keep appearing as
link suggestions until the 90-day purge.

No live server needed: the vault root is a `tmp_path`, and the trash entry
is crafted on disk mirroring the `_move_page_to_trash` layout.
"""
from __future__ import annotations

from pathlib import Path

import pytest


def _write_page(path: Path, page_id: str, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\nid: {page_id}\ntitle: {title}\n---\nBody of {title}\n",
        encoding="utf-8",
    )


@pytest.fixture()
def vault(tmp_path, monkeypatch):
    """Isolated vault root with the module caches reset, so the linkable-docs
    walk hits the rglob fallback (the path where `.trash` filtering lives)."""
    from backend.api import vault_routes

    vault_root = tmp_path / "vault"
    vault_root.mkdir()
    real_get_p = vault_routes.get_p

    def fake_get_p(key):
        if key == "VAULT":
            return vault_root
        if key == "DASHBOARDS":
            return None
        return real_get_p(key)

    monkeypatch.setattr(vault_routes, "get_p", fake_get_p)
    # Reset per-vault caches for the "" key (no active-vault contextvar in
    # tests) so previous runs can't leak documents into this one.
    vault_routes._iter_docs_cache.pop("", None)
    vault_routes._id_title_cache.pop("", None)
    yield vault_root
    vault_routes._iter_docs_cache.pop("", None)
    vault_routes._id_title_cache.pop("", None)


def test_linkable_documents_exclude_trash(vault):
    from backend.api import vault_routes

    _write_page(vault / "Alive.md", "page-alive", "Alive page")
    _write_page(
        vault / ".trash" / "page-trashed" / "page.md", "page-trashed", "Trashed page"
    )
    _write_page(
        vault / ".history" / "page-alive" / "2026-01-01.md",
        "page-alive",
        "Old snapshot",
    )

    docs = vault_routes._iter_linkable_page_documents()
    paths = {str(doc[0]) for doc in docs}

    assert any(p.endswith("Alive.md") for p in paths)
    assert not any(".trash" in p for p in paths)
    assert not any(".history" in p for p in paths)


def test_id_title_index_excludes_trash(vault):
    from backend.api import vault_routes

    _write_page(vault / "Alive.md", "page-alive", "Alive page")
    _write_page(
        vault / ".trash" / "page-trashed" / "page.md", "page-trashed", "Trashed page"
    )

    index = vault_routes._compute_id_title_index()

    assert index.get("page-alive") == "Alive page"
    assert "page-trashed" not in index
