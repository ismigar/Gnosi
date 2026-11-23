"""Home navigation, from the first request in a completely cold Vault."""

import os
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


@pytest.fixture
def home_vault(isolated_validation_runtime):
    from backend.api import vault_routes

    vault = isolated_validation_runtime / "vault"
    app = FastAPI()
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext("w", "reader", "viewer", vault)
    app.include_router(vault_routes.router, prefix="/api/vault")
    token = active_vault_path.set(vault)
    try:
        with TestClient(app) as client:
            yield vault, client
    finally:
        active_vault_path.reset(token)


def note(vault, name, page_id, body="", when=1700000000):
    path = vault / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\nid: {page_id}\ntitle: {path.stem}\ntags: [fixture]\n---\n{body}\n", encoding="utf-8")
    os.utime(path, (when, when))
    return path


@contextmanager
def source_reads(vault):
    from backend.api import vault_routes

    opened = []
    original = Path.open

    def record(path, *args, **kwargs):
        if path.is_relative_to(vault) and path.suffix == ".md":
            opened.append(path)
        return original(path, *args, **kwargs)

    with patch.object(Path, "open", record), patch.object(os, "walk", side_effect=AssertionError("Vault walk")), \
         patch.object(Path, "rglob", side_effect=AssertionError("Vault search")), \
         patch.object(vault_routes, "get_files_provider", side_effect=AssertionError("Unexpected materialization")):
        yield opened


def test_first_get_cold_partial_and_fully_indexed_empty_vault(home_vault):
    from backend.domains.vault.pages.index_service import get_cached_page_entries

    vault, client = home_vault
    local = note(vault, "Wiki/Local.md", "local")
    calendar = note(vault, "Calendar/Appointment.md", "appointment")
    with source_reads(vault) as opened:
        assert client.get("/api/vault/home-knowledge-catalog").json() == {"pages": [], "complete": False}
        assert not opened
    get_cached_page_entries(search_paths=[calendar.parent], force_refresh=True)
    with source_reads(vault) as opened:
        partial = client.get("/api/vault/home-knowledge-catalog").json()
        assert partial["complete"] is False and [row["id"] for row in partial["pages"]] == ["appointment"]
        assert not opened
    get_cached_page_entries(force_refresh=True)
    with source_reads(vault) as opened:
        full = client.get("/api/vault/home-knowledge-catalog").json()
        assert full["complete"] and {row["id"] for row in full["pages"]} == {"local", "appointment"}
        assert not opened
    local.unlink()
    calendar.unlink()
    get_cached_page_entries(force_refresh=True)
    with source_reads(vault) as opened:
        assert client.get("/api/vault/home-knowledge-catalog").json() == {"pages": [], "complete": True}
        assert not opened


def test_coverage_survives_restart_only_for_the_exact_full_vault_snapshot(home_vault):
    from backend.domains.vault.pages import index_service, runtime
    from backend.domains.vault.pages.disk_cache import coverage_path
    from backend.domains.vault.pages.state import page_state

    vault, client = home_vault
    key = str(vault)
    note(vault, "Wiki/Local.md", "local")
    folder = note(vault, "Calendar/Event.md", "event").parent
    def restart():
        page_state.index_initialized.pop(key, None)
        page_state.index_entries.pop(key, None)
        page_state.full_index_vaults.discard(key)
        with source_reads(vault) as opened:
            result = client.get("/api/vault/home-knowledge-catalog").json()
            assert not opened
            return result

    index_service.get_cached_page_entries(search_paths=[folder], force_refresh=True)
    assert restart()["complete"] is False
    index_service.get_cached_page_entries(force_refresh=True)
    assert restart()["complete"] is True
    path = runtime.get_page_index_cache_path(key)
    raw = path.read_text()
    path.write_text(raw + "\n")
    assert restart()["complete"] is False
    path.write_text(raw)
    marker = coverage_path(path)
    marker.write_text(marker.read_text().replace(str(vault), str(vault.parent / "other")))
    assert restart()["complete"] is False
    marker.unlink()
    assert restart()["complete"] is False
    for source in vault.rglob("*.md"):
        source.unlink()
    index_service.get_cached_page_entries(force_refresh=True)
    assert restart() == {"pages": [], "complete": True}


def test_local_pin_and_newest_duplicate_work_beside_an_offline_placeholder(home_vault, monkeypatch):
    from backend.domains.vault.pages import index_entries, index_service
    from backend.domains.vault.pages.runtime import _load_page_index_from_disk, _save_page_index_to_disk
    from backend.domains.vault.pages.state import page_state

    vault, client = home_vault
    newer = note(vault, "Wiki/Newer copy.md", "center", "[[target]]", when=1750000000)
    older = note(vault, "Wiki/Older copy.md", "center", "[[unrelated]]")
    note(vault, "Wiki/Target.md", "target")
    note(vault, "Wiki/Unrelated.md", "unrelated")
    offline = note(vault, "Wiki/Offline.md", "unavailable")
    monkeypatch.setattr(index_entries, "is_cloud_placeholder", lambda path, _stat: path == offline)
    index_service.get_cached_page_entries(force_refresh=True)
    rows = page_state.index_entries[str(vault)]
    rows[str(newer)] = rows.pop(str(newer))
    rows[str(older)] = rows.pop(str(older))

    def check():
        with source_reads(vault) as opened:
            response = client.get("/api/vault/home-knowledge-catalog").json()
            assert response["complete"] is False
            assert [row["title"] for row in response["pages"] if row["id"] == "center"] == ["Newer copy"]
            assert all(row["title"] != "Offline" for row in response["pages"])
            assert not opened
            graph = client.get("/api/vault/link-neighborhood", params={"page_id": "center"}).json()
            assert graph["outgoing"] == ["target"] and graph["incoming_complete"] is False
            assert opened == [newer]
        detail = client.get("/api/vault/pages/center")
        assert detail.status_code == 200 and "[[target]]" in detail.json()["content"]

    check()
    _save_page_index_to_disk(str(vault))
    assert _load_page_index_from_disk(str(vault))
    check()
