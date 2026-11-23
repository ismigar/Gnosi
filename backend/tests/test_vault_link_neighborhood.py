"""The Home graph can read one real note without borrowing another Vault's edges."""

import json
import threading
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from backend.domains.vault.links import index_service
from backend.domains.vault.links.state import LinkIndexState
from backend.domains.vault.pages.state import page_state
from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import WorkspaceContext, get_workspace_context

CENTER = "4f2ad2a9-72a9-4c7b-a928-d33445a5c001"
TARGET = "4f2ad2a9-72a9-4c7b-a928-d33445a5c002"
SOURCE = "4f2ad2a9-72a9-4c7b-a928-d33445a5c003"


@pytest.fixture
def vaults(isolated_validation_runtime, monkeypatch):
    from backend.api import vault_routes  # Initialize the same page and link adapters as the app.
    from backend.domains.vault.links import document_cache, runtime
    from backend.domains.vault.links.api import neighborhood
    from backend.domains.vault.pages.index_entries import build_page_cache_entry
    from backend.domains.vault.pages.index_service import _merge_index

    roots = {key: isolated_validation_runtime / key for key in ("alpha", "beta")}
    state = LinkIndexState()
    monkeypatch.setattr(neighborhood, "link_index_state", state)
    monkeypatch.setattr(document_cache, "_schedule", lambda *args: None)
    monkeypatch.setattr(index_service, "schedule_link_index_persist", lambda *args: None)
    for key, root in roots.items():
        folder = root / "Wiki"
        folder.mkdir(parents=True)
        token = active_vault_path.set(root)
        try:
            entries = {}
            for file, page_id, title, body in (
                ("Center.md", CENTER, "Center", "[[Target title#section|read]]" if key == "alpha" else ""),
                ("Target filename.md", TARGET, "Target title", ""),
                ("Source.md", SOURCE, "Source", f"[[{CENTER}]]" if key == "alpha" else ""),
                ("Unrelated.md", "unrelated", "Unrelated", "Ordinary text"),
            ):
                path = folder / file
                path.write_text(f"---\nid: {page_id}\ntitle: {title}\n---\n{body}\n", encoding="utf-8")
                entries[str(path)] = build_page_cache_entry(path, path.stat())
            monkeypatch.setitem(page_state.index_entries, str(root), entries)
            _merge_index(root, entries, None)
        finally:
            active_vault_path.reset(token)

    def scope(x_vault_id: str = Header()) -> WorkspaceContext:
        return WorkspaceContext("workspace", "reader", "viewer", roots[x_vault_id])

    app = FastAPI()
    app.dependency_overrides[get_workspace_context] = scope
    app.include_router(vault_routes.router, prefix="/api/vault")
    with TestClient(app) as client:
        yield roots, state, runtime._LINK_INDEX_DEPENDENCIES, client
    for root in roots.values():
        page_state.full_index_vaults.discard(str(root))


def _get(client, vault):
    response = client.get("/api/vault/link-neighborhood", params={"page_id": CENTER}, headers={"X-Vault-ID": vault})
    assert response.status_code == 200, response.text
    return response.json()


def _rebuild(root, state, dependencies):
    token = active_vault_path.set(root)
    try:
        index_service.rebuild_link_index(state, dependencies, persist=False)
    finally:
        active_vault_path.reset(token)


def test_cold_neighborhood_reads_only_the_center_and_preserves_live_outgoing(vaults, monkeypatch):
    roots, _state, _dependencies, client = vaults
    center = roots["alpha"] / "Wiki/Center.md"
    opened = []
    original = Path.open

    def record(path, *args, **kwargs):
        if path.suffix.lower() == ".md":
            opened.append(path)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", record)
    monkeypatch.setattr(Path, "rglob", lambda *args: pytest.fail("Home traversed the Vault"))
    assert _get(client, "alpha") == {"incoming": [], "outgoing": [TARGET], "incoming_complete": False}
    assert opened == [center]
    assert _get(client, "beta") == {"incoming": [], "outgoing": [], "incoming_complete": False}
    assert opened == [center, roots["beta"] / "Wiki/Center.md"]


def test_warmed_reverse_index_stays_in_its_vault_even_with_identical_ids(vaults):
    roots, state, dependencies, client = vaults
    _rebuild(roots["alpha"], state, dependencies)
    assert _get(client, "alpha") == {"incoming": [SOURCE], "outgoing": [TARGET], "incoming_complete": True}
    assert _get(client, "beta") == {"incoming": [], "outgoing": [], "incoming_complete": False}

    center = roots["alpha"] / "Wiki/Center.md"
    center.write_text(f"---\nid: {CENTER}\ntitle: Center\nrelation: {SOURCE}\n---\n[[Target filename]]\n", encoding="utf-8")
    assert _get(client, "alpha")["outgoing"] == sorted([TARGET, SOURCE])
    new_note = roots["alpha"] / "Wiki/Added.md"
    new_note.write_text(f"[[{CENTER}]]", encoding="utf-8")
    page_state.index_entries[str(roots["alpha"])][str(new_note)] = {
        "path": str(new_note), "id": "Added", "title": "Added",
    }
    assert _get(client, "alpha") == {"incoming": [SOURCE], "outgoing": sorted([TARGET, SOURCE]), "incoming_complete": False}
    _rebuild(roots["beta"], state, dependencies)
    assert _get(client, "beta") == {"incoming": [], "outgoing": [], "incoming_complete": True}
    assert _get(client, "alpha") == {"incoming": [], "outgoing": sorted([TARGET, SOURCE]), "incoming_complete": False}


def test_existing_scoped_indexes_work_without_an_in_memory_navigation_catalog(vaults, monkeypatch):
    from backend.domains.vault.pages.runtime import _save_page_index_to_disk

    roots, state, dependencies, client = vaults
    _rebuild(roots["alpha"], state, dependencies)
    _save_page_index_to_disk(str(roots["beta"]))
    center = roots["beta"] / "Wiki/Center.md"
    center.write_text(f"---\nid: {CENTER}\ntitle: Center\n---\n[Source](/vault/page/{SOURCE})\n", encoding="utf-8")
    for root in roots.values():
        monkeypatch.setitem(page_state.index_initialized, str(root), False)
        monkeypatch.setitem(page_state.index_entries, str(root), {})
    monkeypatch.setattr(Path, "rglob", lambda *args: pytest.fail("Home traversed the Vault"))
    assert client.get("/api/vault/link-neighborhood", params={"page_id": CENTER}, headers={"X-Vault-ID": "alpha"}).status_code == 503
    assert _get(client, "beta") == {"incoming": [], "outgoing": [SOURCE], "incoming_complete": False}


def test_background_rebuild_keeps_the_requesting_vault_even_with_a_fresh_foreign_index(vaults, tmp_path):
    roots, state, dependencies, client = vaults
    _rebuild(roots["alpha"], state, dependencies)
    saved = threading.Event()

    def write(path, payload, *, indent, ensure_ascii):
        dependencies.write_json(path, payload, indent=indent, ensure_ascii=ensure_ascii)
        saved.set()

    ports = replace(dependencies, get_cache_path=lambda: tmp_path / "index.json", write_json=write)
    token = active_vault_path.set(roots["beta"])
    try:
        index_service.kickoff_link_index_rebuild(state, ports)
    finally:
        active_vault_path.reset(token)
    assert saved.wait(5)
    assert _get(client, "beta") == {"incoming": [], "outgoing": [], "incoming_complete": True}
    assert _get(client, "alpha")["incoming_complete"] is False


def test_persisted_ownership_and_foreign_mutations_do_not_publish_unverified_incoming(vaults, tmp_path):
    roots, state, dependencies, client = vaults
    _rebuild(roots["alpha"], state, dependencies)
    cache = tmp_path / "reverse-index.json"
    ports = replace(dependencies, get_cache_path=lambda: cache)
    index_service.save_link_index(state, ports)
    state.vault_key = None
    assert index_service.load_link_index(state, ports)
    assert _get(client, "alpha")["incoming"] == [SOURCE]
    assert _get(client, "beta")["incoming"] == []

    token = active_vault_path.set(roots["beta"])
    try:
        index_service.update_link_index_for_page(roots["beta"] / "Wiki/Source.md", state, ports)
    finally:
        active_vault_path.reset(token)
    assert _get(client, "alpha") == {"incoming": [], "outgoing": [TARGET], "incoming_complete": False}
    legacy = json.loads(cache.read_text())
    del legacy["vault_key"]
    cache.write_text(json.dumps(legacy))
    assert index_service.load_link_index(state, ports)
    assert _get(client, "alpha")["incoming_complete"] is False
    assert _get(client, "beta")["incoming_complete"] is False


def test_foreign_catalog_path_or_symlink_cannot_select_another_vault_note(vaults):
    roots, _state, _dependencies, client = vaults
    local = roots["alpha"] / "Wiki/Center.md"
    foreign = roots["beta"] / "Wiki/Center.md"
    local.unlink()
    local.symlink_to(foreign)
    params = {"page_id": CENTER}
    headers = {"X-Vault-ID": "alpha"}
    assert client.get("/api/vault/link-neighborhood", params=params, headers=headers).status_code == 404
    entries = page_state.index_entries[str(roots["alpha"])]
    entries[str(foreign)] = {**entries.pop(str(local)), "path": str(foreign)}
    assert client.get("/api/vault/link-neighborhood", params=params, headers=headers).status_code == 503
