"""Hermetic unit tests for `purge_expired_trash` (the `purge_trash` cron helper).

Unlike `test_vault_trash.py` (E2E against a running backend), these tests
need no live server and no real vault: the vault root is a `tmp_path` and
trash entries are crafted directly on disk. This removes the flakiness the
old E2E version had — it mixed live-server HTTP state with an in-process
helper, so the two could resolve *different* vaults depending on the
environment and test order.

Coverage:
- entries older than TRASH_RETENTION_DAYS are purged, fresh ones survive.
- corrupt sidecars are skipped (counted in `skipped`), never purged.
- entries without a sidecar are skipped.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


def _make_trash_entry(trash_root: Path, page_id: str, deleted_at: datetime) -> Path:
    """Create a `.trash/{page_id}/` entry with page.md + _trash.json sidecar,
    mirroring the layout `_move_page_to_trash` produces."""
    entry = trash_root / page_id
    entry.mkdir(parents=True)
    (entry / "page.md").write_text(
        f"---\ntitle: {page_id}\n---\nbody\n", encoding="utf-8"
    )
    sidecar = {
        "id": page_id,
        "title": page_id,
        "deleted_at": deleted_at.isoformat(),
        "original_path": f"{page_id}.md",
        "original_parent_id": None,
        "table_id": None,
        "size_bytes": 5,
        "extension": ".md",
    }
    (entry / "_trash.json").write_text(json.dumps(sidecar), encoding="utf-8")
    return entry


@pytest.fixture()
def vault(tmp_path, monkeypatch):
    """Isolated vault root: redirect `get_p("VAULT")` inside vault_routes so
    every trash helper (purge included) operates on a throwaway directory."""
    from backend.api import vault_routes

    vault_root = tmp_path / "vault"
    vault_root.mkdir()
    real_get_p = vault_routes.get_p
    monkeypatch.setattr(
        vault_routes,
        "get_p",
        lambda key: vault_root if key == "VAULT" else real_get_p(key),
    )
    return vault_root


def test_purge_expired_helper_respects_retention_days(vault):
    from backend.api.vault_routes import TRASH_RETENTION_DAYS, purge_expired_trash

    now = datetime.now(timezone.utc)
    trash_root = vault / ".trash"
    old = _make_trash_entry(
        trash_root,
        "unit-trash-expired",
        now - timedelta(days=TRASH_RETENTION_DAYS + 10),
    )
    fresh = _make_trash_entry(trash_root, "unit-trash-fresh", now)

    result = purge_expired_trash(now=now)

    assert result["purged_count"] == 1
    assert not old.exists()
    assert fresh.exists()


def test_purge_expired_helper_skips_corrupt_sidecar(vault):
    from backend.api.vault_routes import TRASH_RETENTION_DAYS, purge_expired_trash

    now = datetime.now(timezone.utc)
    trash_root = vault / ".trash"
    corrupt = _make_trash_entry(
        trash_root,
        "unit-trash-corrupt",
        now - timedelta(days=TRASH_RETENTION_DAYS + 10),
    )
    (corrupt / "_trash.json").write_text("{not json", encoding="utf-8")

    result = purge_expired_trash(now=now)

    assert result["purged_count"] == 0
    assert result["skipped"] == 1
    assert corrupt.exists()


def test_purge_expired_helper_skips_entry_without_sidecar(vault):
    from backend.api.vault_routes import purge_expired_trash

    trash_root = vault / ".trash"
    orphan = trash_root / "unit-trash-no-sidecar"
    orphan.mkdir(parents=True)
    (orphan / "page.md").write_text("body\n", encoding="utf-8")

    result = purge_expired_trash()

    assert result["purged_count"] == 0
    assert result["skipped"] == 1
    assert orphan.exists()
