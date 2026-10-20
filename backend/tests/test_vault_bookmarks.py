"""Temporary-only bookmark migration, scoping and persistence regression tests."""
from __future__ import annotations

import json
import shutil
from concurrent.futures import ProcessPoolExecutor
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from backend.domains.vault.bookmarks import api
from backend.domains.vault.bookmarks.schemas import BookmarkEntry, BookmarkImport, BookmarkPage, BookmarkRoute
from backend.domains.vault.bookmarks.storage import BookmarkStore
from backend.services.workspace_service import WorkspaceContext, get_workspace_context
from backend.utils.metadata_io import MetadataUnavailable


def entry(key="one", **updates):
    return {"id": key, "label": "A note", "group": "", "kind": "page", "target": key, **updates}


def context(vault, user="owner", workspace="workspace", role="owner"):
    return WorkspaceContext(workspace, user, role, vault)


@pytest.fixture
def client(tmp_path, monkeypatch):
    real_discovery = api.discover_favorites
    monkeypatch.setattr(api, "discover_favorites", lambda _context: [])
    app = FastAPI()
    router = APIRouter(prefix="/api/vault")
    api.register_routes(router)
    app.include_router(router)
    scope = context(tmp_path)
    app.dependency_overrides[get_workspace_context] = lambda: scope
    with TestClient(app) as instance:
        instance.scope = scope
        instance.real_discovery = real_discovery
        yield instance


def test_all_kinds_and_dates_survive_edits_reordering_and_restart(client):
    entries = [entry(), entry("section", kind="section", target="one#^block", group="Work"),
        entry("search", kind="search", target="tag:reading"),
        entry("graph", kind="graph", target="/@main/graph?mode=notes"),
        entry("url", kind="url", target="https://example.org/path?q=1")]
    for item in entries:
        response = client.put("/api/vault/bookmarks/items/" + item["id"], json=item)
        assert response.status_code == 200, response.text
    before = response.json()["entries"]
    updated = entry(label="Renamed", group="Pinned")
    response = client.put("/api/vault/bookmarks/items/one", json=updated)
    assert response.json()["entries"][0]["created_at"] == before[0]["created_at"]
    response = client.post("/api/vault/bookmarks/reorder", json={"ids": ["url", "one"]})
    assert [item["id"] for item in response.json()["entries"]] == ["url", "one", "section", "search", "graph"]
    assert client.put("/api/vault/bookmarks/sort", json={"mode": "recent"}).json()["sort_mode"] == "recent"
    assert client.get("/api/vault/bookmarks").json() == client.put("/api/vault/bookmarks/sort", json={"mode": "recent"}).json()
    with BookmarkStore(client.scope).transaction() as state:
        assert len(state.entries) == 5
        assert state.entries["one"].group == "Pinned"


def test_route_identity_and_authenticated_scope_are_authoritative(client, tmp_path):
    assert client.put("/api/vault/bookmarks/items/other", json=entry()).status_code == 422
    assert client.put("/api/vault/bookmarks/items/one", json=entry()).status_code == 200
    assert len(client.get("/api/vault/bookmarks", headers={"X-User-ID": "spoofed"}).json()["entries"]) == 1
    client.scope.user_id = "viewer"
    client.scope.role = "viewer"
    assert client.get("/api/vault/bookmarks").json()["entries"] == []
    assert client.put("/api/vault/bookmarks/items/two", json=entry("two")).status_code == 200
    client.scope.user_id = "owner"
    assert [item["id"] for item in client.get("/api/vault/bookmarks").json()["entries"]] == ["one"]
    client.scope.workspace_id = "different"
    assert client.get("/api/vault/bookmarks").json()["entries"] == []
    second = tmp_path / "another-vault"
    second.mkdir()
    client.scope.vault_path = second
    assert client.get("/api/vault/bookmarks").json()["entries"] == []


@pytest.mark.parametrize("changes", [
    {"id": "../escape"}, {"target": "../escape"}, {"target": "."},
    {"kind": "section", "target": "one"}, {"label": "   "},
    {"kind": "section", "target": "one#x]] {{query}} ![[x"},
    {"kind": "section", "target": "one#heading|alias"},
    {"kind": "url", "target": "javascript:alert(1)"},
    {"kind": "url", "target": "https://name:secret@example.org"},
    {"kind": "url", "target": "https://example.org\\evil"},
    {"kind": "graph", "target": "//evil.org/graph"},
    {"kind": "graph", "target": "/graph/../settings"},
    {"kind": "graph", "target": "/graph%2f..%2fsettings"},
    {"kind": "graph", "target": "/@vault/graph/../../settings"},
    {"kind": "graph", "target": "/graph\n"}, {"target": "a" * 2001},
])
def test_unsafe_or_unbounded_targets_are_rejected(client, changes):
    assert client.put("/api/vault/bookmarks/items/one", json=entry(**changes)).status_code == 422
    assert client.get("/api/vault/bookmarks").json()["entries"] == []


def test_favorite_discovery_is_complete_retries_cloud_metadata_and_never_rewrites_pages(client, monkeypatch):
    from backend.domains.vault.api import pages_queries
    from backend.services.context_vars import active_vault_path

    page = SimpleNamespace(id="late-page", title="Late favorite", metadata={}, path="", folder="")
    other_page = SimpleNamespace(id="ordinary", title="Ordinary", metadata={"favorite": True}, path="", folder="", last_modified="2025-01-01T00:00:00+00:00")
    pages = [page, other_page]
    observed = []

    def snapshot():
        assert active_vault_path.get() == client.scope.vault_path
        return pages

    def hydrate(all_pages):
        observed.append(list(all_pages))

    monkeypatch.setattr(api, "discover_favorites", client.real_discovery)
    monkeypatch.setattr(pages_queries, "_deps", lambda: SimpleNamespace(get_pages_snapshot=snapshot, refresh_pages_metadata=hydrate))
    first = client.get("/api/vault/bookmarks").json()["entries"]
    assert [item["target"] for item in first] == ["ordinary"]
    assert first[0]["created_at"] == 1735689600
    assert observed[0] == pages
    page.metadata["favorite"] = "true"
    both = client.get("/api/vault/bookmarks").json()["entries"]
    assert {item["target"] for item in both} == {"ordinary", "late-page"}
    assert client.delete("/api/vault/bookmarks/items/" + first[0]["id"]).status_code == 200
    assert [item["target"] for item in client.get("/api/vault/bookmarks").json()["entries"]] == ["late-page"]
    assert other_page.metadata == {"favorite": True}


def test_migration_retains_aliases_and_groups_does_not_resurrect_and_imports_new_items(client, monkeypatch):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [BookmarkEntry(**entry("fav", target="page"))])
    payload = {"entries": [entry("old", label="My alias", group="Work", target="page")], "sort_mode": "alpha-desc", "page_order": ["page"]}
    response = client.post("/api/vault/bookmarks/import", json=payload)
    assert response.status_code == 200, response.text
    assert len(response.json()["entries"]) == 1
    item = response.json()["entries"][0]
    assert (item["label"], item["group"]) == ("My alias", "Work")
    assert response.json()["sort_mode"] == "alpha-desc"
    client.delete("/api/vault/bookmarks/items/" + item["id"])
    assert client.post("/api/vault/bookmarks/import", json=payload).json()["entries"] == []
    client.put("/api/vault/bookmarks/sort", json={"mode": "manual"})
    payload["entries"].append(entry("later"))
    result = client.post("/api/vault/bookmarks/import", json=payload).json()
    assert [item["target"] for item in result["entries"]] == ["later"]
    assert result["sort_mode"] == "manual"


def test_import_after_initial_get_replaces_only_untouched_favorite_defaults(client, monkeypatch):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [BookmarkEntry(**entry("fav", target="page"))])
    default = client.get("/api/vault/bookmarks").json()["entries"][0]
    assert default["label"] == "A note"
    result = client.post("/api/vault/bookmarks/import", json={"entries": [entry("alias", label="Alias", group="Work", target="page")]}).json()
    assert [(item["label"], item["group"]) for item in result["entries"]] == [("Alias", "Work")]
    assert len(client.get("/api/vault/bookmarks").json()["entries"]) == 1
    client.delete("/api/vault/bookmarks/items/" + result["entries"][0]["id"])
    assert client.get("/api/vault/bookmarks").json()["entries"] == []


def test_edited_default_favorite_is_preserved_alongside_imported_alias(client, monkeypatch):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [BookmarkEntry(**entry("fav", target="page"))])
    default = client.get("/api/vault/bookmarks").json()["entries"][0]
    default.pop("created_at")
    default["group"] = "Personal"
    client.put("/api/vault/bookmarks/items/" + default["id"], json=default)
    result = client.post("/api/vault/bookmarks/import", json={"entries": [entry("alias", label="Alias", group="Work", target="page")]}).json()
    assert {item["group"] for item in result["entries"]} == {"Personal", "Work"}


def test_import_and_order_bounds_are_enforced(client):
    assert client.post("/api/vault/bookmarks/import", json={"entries": [entry()] * 501}).status_code == 422
    assert client.post("/api/vault/bookmarks/reorder", json={"ids": ["one"] * 10001}).status_code == 422
    assert client.put("/api/vault/bookmarks/sort", json={"mode": "unknown"}).status_code == 422


def test_unavailable_favorite_metadata_returns_retryable_error_without_creating_store(client, monkeypatch):
    def unavailable(_scope):
        raise MetadataUnavailable("downloading")

    monkeypatch.setattr(api, "discover_favorites", unavailable)
    assert client.get("/api/vault/bookmarks").status_code == 503
    assert not BookmarkStore(client.scope).directory.exists()


def test_page_star_membership_removes_all_whole_page_aliases_preserves_sections(client):
    for item in [entry("alias-a", target="page", group="A"), entry("alias-b", target="page", group="B"),
                 entry("section", kind="section", target="page#Heading")]:
        client.put("/api/vault/bookmarks/items/" + item["id"], json=item)
    response = client.put("/api/vault/bookmarks/pages/page", json={"enabled": True, "label": "Page"})
    assert len(response.json()["entries"]) == 3
    response = client.put("/api/vault/bookmarks/pages/page", json={"enabled": False, "label": "Page"})
    assert [item["id"] for item in response.json()["entries"]] == ["section"]
    response = client.put("/api/vault/bookmarks/pages/page", json={"enabled": True, "label": "Page"})
    assert len(response.json()["entries"]) == 2


def test_legacy_preferences_only_apply_once_and_reorder_preserves_additions(client):
    payload = {"entries": [entry("a"), entry("b")], "sort_mode": "oldest", "page_order": ["b", "a"]}
    result = client.post("/api/vault/bookmarks/import", json=payload).json()
    assert [item["target"] for item in result["entries"]] == ["b", "a"]
    client.put("/api/vault/bookmarks/items/new", json=entry("new"))
    first_id = result["entries"][1]["id"]
    result = client.post("/api/vault/bookmarks/reorder", json={"ids": [first_id]}).json()
    assert [item["target"] for item in result["entries"]] == ["a", "b", "new"]
    payload["sort_mode"] = "recent"
    assert client.post("/api/vault/bookmarks/import", json=payload).json()["sort_mode"] == "oldest"


def test_corrupt_journal_is_never_treated_as_empty_or_overwritten(client):
    client.put("/api/vault/bookmarks/items/one", json=entry())
    store = BookmarkStore(client.scope)
    path = next(store.directory.glob("*.json"))
    path.write_text("broken", encoding="utf-8")
    original_files = {file.name: file.read_bytes() for file in store.directory.iterdir()}
    assert client.get("/api/vault/bookmarks").status_code == 409
    assert client.put("/api/vault/bookmarks/items/two", json=entry("two")).status_code == 409
    assert original_files == {file.name: file.read_bytes() for file in store.directory.iterdir()}


@pytest.mark.parametrize("relative", [".gnosi", ".gnosi/bookmarks"])
def test_symlinked_metadata_is_rejected_without_touching_destination(client, tmp_path, relative):
    elsewhere = tmp_path / "outside"
    elsewhere.mkdir()
    link = tmp_path / relative
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(elsewhere, target_is_directory=True)
    assert client.put("/api/vault/bookmarks/items/one", json=entry()).status_code == 409
    assert list(elsewhere.iterdir()) == []


def test_cloud_placeholder_is_not_replaced(client, monkeypatch):
    from backend.domains.vault.bookmarks import storage

    client.put("/api/vault/bookmarks/items/one", json=entry())
    path = next(BookmarkStore(client.scope).directory.glob("*.json"))
    original = path.read_bytes()

    def unavailable(target):
        if target == path:
            raise MetadataUnavailable("provider unavailable")

    monkeypatch.setattr(storage, "ensure_metadata_local", unavailable)
    assert client.put("/api/vault/bookmarks/items/two", json=entry("two")).status_code == 503
    assert path.read_bytes() == original
    assert len(list(path.parent.glob("*.json"))) == 1


def _process_add(vault, number):
    store = BookmarkStore(context(vault))
    with store.transaction() as state:
        store.append(state, entries=[BookmarkEntry(**entry("page-" + str(number)))])


def test_process_lock_keeps_concurrent_additions(tmp_path):
    with ProcessPoolExecutor(max_workers=4) as pool:
        list(pool.map(_process_add, [tmp_path] * 12, range(12)))
    with BookmarkStore(context(tmp_path)).transaction() as state:
        assert len(state.entries) == 12


def test_independent_device_journals_merge_conflicting_legacy_ids_without_loss(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [])
    devices = [tmp_path / "device-a", tmp_path / "device-b"]
    for device in devices:
        device.mkdir()
    scopes = [context(device) for device in devices]
    a = api.import_bookmarks(BookmarkImport(entries=[BookmarkEntry(**entry("same", label="First device"))]), scopes[0])
    b = api.import_bookmarks(BookmarkImport(entries=[BookmarkEntry(**entry("same", label="Second device"))]), scopes[1])
    assert a.entries[0].id != b.entries[0].id
    stores = [BookmarkStore(scope) for scope in scopes]
    for source, destination in [(stores[0], stores[1]), (stores[1], stores[0])]:
        for path in source.directory.glob("*.json"):
            if not (destination.directory / path.name).exists():
                shutil.copy2(path, destination.directory / path.name)
    merged = api.list_bookmarks(scopes[0])
    assert {item.label for item in merged.entries} == {"First device", "Second device"}
    assert merged == api.list_bookmarks(scopes[1])
    api.delete_bookmark(a.entries[0].id, scopes[0])
    for path in stores[0].directory.glob("*.json"):
        if not (stores[1].directory / path.name).exists():
            shutil.copy2(path, stores[1].directory / path.name)
    result = api.import_bookmarks(BookmarkImport(entries=[BookmarkEntry(**entry("same", label="First device"))]), scopes[1])
    assert [item.label for item in result.entries] == ["Second device"]


@pytest.mark.parametrize("target", [
    "/knowledge/table/table-id/view/view-id?filter=active#rows",
    "/knowledge/drawing/drawing-id",
    "/knowledge/document?src=%2Fnotes%2Fbook%20one.pdf&page=3#annotation",
    "/notebooks/notebook-id", "/calendar", "/planning", "/resources",
    "/contacts", "/mail/inbox?account=one", "/reader", "/automations",
    "/social/compose", "/media?collection=images", "/graph?mode=pages",
])
def test_route_shortcuts_preserve_exact_vault_relative_targets(client, target):
    response = client.put("/api/vault/bookmarks/route", json={"label": "App shortcut", "target": target, "enabled": True})
    assert response.status_code == 200, response.text
    item = response.json()["entries"][0]
    assert (item["kind"], item["target"]) == ("route", target)
    assert client.get("/api/vault/bookmarks").json()["entries"][0] == item
    with BookmarkStore(client.scope).transaction() as state:
        assert state.entries[item["id"]].target == target


@pytest.mark.parametrize("target", [
    "https://example.org/calendar", "//example.org/calendar", "/@other/calendar",
    "/settings", "/dashboard", "calendar", "/calendar/../mail",
    "/knowledge/table/./view", "/knowledge/%2e%2e/mail", "/knowledge/%252e%252e/mail",
    "/knowledge/%2e%2e%2fmail", "/knowledge/%252e%252e%252fmail",
    "/knowledge\\..\\mail", "/knowledge/%5cmail", "/knowledge/%255cmail",
    "/knowledge/%0amail", "/knowledge/%250amail", "/knowledge/document?src=%0dsecret",
    "/knowledge//other", " /calendar", "/calendar ", "/%6bnowledge/table/id",
])
def test_unsafe_routes_fail_both_entry_and_shortcut_schemas(client, target):
    assert client.put("/api/vault/bookmarks/route", json={"label": "Bad route", "target": target, "enabled": True}).status_code == 422
    assert client.put("/api/vault/bookmarks/items/route-id", json=entry("route-id", kind="route", target=target)).status_code == 422
    assert client.get("/api/vault/bookmarks").json()["entries"] == []


def test_route_membership_preserves_aliases_and_only_removes_matching_route_shortcuts(client):
    target = "/knowledge/table/table-id/view/view-id"
    items = [entry("alias-a", kind="route", target=target, label="My view", group="Work"),
             entry("alias-b", kind="route", target=target, label="Another name", group="Projects"),
             entry("other-view", kind="route", target="/knowledge/table/table-id/view/other"),
             entry("page-id", target="table-id")]
    for item in items:
        assert client.put("/api/vault/bookmarks/items/" + item["id"], json=item).status_code == 200
    response = client.put("/api/vault/bookmarks/route", json={"label": "Default name", "target": target, "enabled": True})
    assert [(item["id"], item["group"]) for item in response.json()["entries"]] == [("alias-a", "Work"), ("alias-b", "Projects"), ("other-view", ""), ("page-id", "")]
    response = client.put("/api/vault/bookmarks/route", json={"label": "Default name", "target": target, "enabled": False})
    assert [item["id"] for item in response.json()["entries"]] == ["other-view", "page-id"]


def test_viewers_can_manage_their_own_route_shortcuts_without_cross_user_leak(client):
    client.scope.role = "viewer"
    payload = {"label": "Calendar", "target": "/calendar", "enabled": True}
    assert len(client.put("/api/vault/bookmarks/route", json=payload).json()["entries"]) == 1
    client.scope.user_id = "other-user"
    assert client.get("/api/vault/bookmarks").json()["entries"] == []
    assert client.put("/api/vault/bookmarks/route", json={**payload, "enabled": False}).json()["entries"] == []
    client.scope.user_id = "owner"
    assert len(client.get("/api/vault/bookmarks").json()["entries"]) == 1


def test_dashboard_favorites_are_discovered_like_other_complete_index_pages(client, monkeypatch):
    from backend.domains.vault.api import pages_queries

    page = SimpleNamespace(id="dashboard-id", title="My dashboard", metadata={"favorite": True, "is_dashboard": True}, path="", folder=".gnosi/dashboards")
    monkeypatch.setattr(api, "discover_favorites", client.real_discovery)
    monkeypatch.setattr(pages_queries, "_deps", lambda: SimpleNamespace(get_pages_snapshot=lambda: [page], refresh_pages_metadata=lambda _pages: None))
    result = client.get("/api/vault/bookmarks").json()
    assert [(item["kind"], item["target"]) for item in result["entries"]] == [("page", "dashboard-id")]
    assert page.metadata == {"favorite": True, "is_dashboard": True}


def test_independent_device_route_additions_and_same_item_edit_delete_converge(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [])
    devices = [tmp_path / "device-a", tmp_path / "device-b"]
    for device in devices:
        device.mkdir()
    scopes = [context(device) for device in devices]
    stores = [BookmarkStore(scope) for scope in scopes]
    api.put_bookmark("shared", BookmarkEntry(**entry("shared")), scopes[0])
    stores[1].directory.mkdir(parents=True)
    for path in stores[0].directory.glob("*.json"):
        shutil.copy2(path, stores[1].directory / path.name)
    api.toggle_route_bookmark(BookmarkRoute(label="Calendar", target="/calendar?view=month", enabled=True), scopes[0])
    api.put_bookmark("shared", BookmarkEntry(**entry("shared", label="Edited on A")), scopes[0])
    api.toggle_route_bookmark(BookmarkRoute(label="Notebook", target="/notebooks/id", enabled=True), scopes[1])
    api.delete_bookmark("shared", scopes[1])
    for source, destination in [(stores[0], stores[1]), (stores[1], stores[0])]:
        for path in source.directory.glob("*.json"):
            if not (destination.directory / path.name).exists():
                shutil.copy2(path, destination.directory / path.name)
    left, right = [api.list_bookmarks(scope) for scope in scopes]
    assert left == right
    assert {item.target for item in left.entries if item.kind == "route"} == {"/calendar?view=month", "/notebooks/id"}


@pytest.mark.parametrize("route", ["/knowledge/page/note", "/knowledge/page/note/",
                                   "/knowledge/dashboard/note", "/knowledge/dashboard/note/"])
def test_plain_page_and_dashboard_route_toggles_share_star_membership(client, route):
    result = client.put("/api/vault/bookmarks/route", json={"label": "My page", "target": route, "enabled": True})
    assert result.status_code == 200, result.text
    item = result.json()["entries"][0]
    assert (item["kind"], item["target"]) == ("page", "note")
    result = client.put("/api/vault/bookmarks/pages/note", json={"label": "Star name", "enabled": True})
    assert result.json()["entries"] == [item]
    result = client.put("/api/vault/bookmarks/route", json={"label": "My page", "target": route, "enabled": False})
    assert result.json()["entries"] == []


@pytest.mark.parametrize("route", ["/knowledge/page/note", "/knowledge/dashboard/note/"])
def test_generic_page_route_save_retains_custom_entry_identity_label_and_group(client, route):
    item = entry("custom-alias", kind="route", target=route, label="My custom alias", group="Projects")
    result = client.put("/api/vault/bookmarks/items/custom-alias", json=item)
    assert result.status_code == 200, result.text
    saved = result.json()["entries"][0]
    assert {key: saved[key] for key in item} == {**item, "kind": "page", "target": "note"}
    result = client.put("/api/vault/bookmarks/route", json={"label": "Default", "target": route, "enabled": True})
    assert result.json()["entries"] == [saved]


@pytest.mark.parametrize("target", ["/knowledge/page/note?view=one", "/knowledge/dashboard/note#part",
                                    "/knowledge/page/note?", "/knowledge/dashboard/note#"])
def test_query_and_fragment_specific_page_routes_remain_distinct_routes(client, target):
    result = client.put("/api/vault/bookmarks/route", json={"label": "Specific view", "target": target, "enabled": True})
    assert result.status_code == 200, result.text
    assert [(item["kind"], item["target"]) for item in result.json()["entries"]] == [("route", target)]
    result = client.put("/api/vault/bookmarks/pages/note", json={"label": "Whole page", "enabled": True})
    assert {(item["kind"], item["target"]) for item in result.json()["entries"]} == {("route", target), ("page", "note")}


def test_existing_journal_page_routes_canonicalize_on_replay_and_star_removes_equivalents(client):
    store = BookmarkStore(client.scope)
    store.directory.mkdir(parents=True)
    operation_id = "a" * 32
    payload = {"version": 1, "id": operation_id, "clock": 1, "created_at": 1700000000,
               "entries": [entry("old-page-route", kind="route", target="/knowledge/page/note", label="Page alias", group="Work"),
                           entry("old-dashboard-route", kind="route", target="/knowledge/dashboard/note/", label="Dashboard alias", group="Home"),
                           entry("old-specific-route", kind="route", target="/knowledge/page/note#part", label="Section view")]}
    path = store.directory / (operation_id + ".json")
    original = json.dumps(payload)
    path.write_text(original, encoding="utf-8")
    result = client.get("/api/vault/bookmarks")
    assert result.status_code == 200, result.text
    items = result.json()["entries"]
    assert [(item["id"], item["kind"], item["target"], item["group"]) for item in items] == [
        ("old-page-route", "page", "note", "Work"), ("old-dashboard-route", "page", "note", "Home"),
        ("old-specific-route", "route", "/knowledge/page/note#part", "")]
    assert {item["created_at"] for item in items} == {1700000000}
    assert client.put("/api/vault/bookmarks/pages/note", json={"label": "Page", "enabled": True}).json()["entries"] == items
    result = client.put("/api/vault/bookmarks/pages/note", json={"label": "Page", "enabled": False})
    assert [item["id"] for item in result.json()["entries"]] == ["old-specific-route"]
    assert path.read_text(encoding="utf-8") == original


def test_deleted_legacy_page_alias_never_resurrects_as_late_favorite(client, monkeypatch):
    result = client.post("/api/vault/bookmarks/import", json={"entries": [entry("old-alias", target="note", label="My alias", group="Work")]})
    bookmark_id = result.json()["entries"][0]["id"]
    assert client.delete("/api/vault/bookmarks/items/" + bookmark_id).json()["entries"] == []
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [BookmarkEntry(**entry("favorite", target="note"))])
    assert client.get("/api/vault/bookmarks").json()["entries"] == []


def test_page_off_suppresses_first_unseen_legacy_alias_but_allows_explicit_readd(client, monkeypatch):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [BookmarkEntry(**entry("favorite", target="note"))])
    client.get("/api/vault/bookmarks")
    assert client.put("/api/vault/bookmarks/pages/note", json={"label": "Note", "enabled": False}).json()["entries"] == []
    payload = {"entries": [entry("unseen", target="note", label="Old alias", group="Old group")]}
    assert client.post("/api/vault/bookmarks/import", json=payload).json()["entries"] == []
    result = client.put("/api/vault/bookmarks/pages/note", json={"label": "Deliberately restored", "enabled": True})
    restored = result.json()["entries"][0]
    payload["entries"].append(entry("another-unseen", target="note", label="Different old alias", group="Other group"))
    assert client.post("/api/vault/bookmarks/import", json=payload).json()["entries"] == [restored]
    explicit = entry("manual-alias", target="note", label="Explicit alias", group="New group")
    assert len(client.put("/api/vault/bookmarks/items/manual-alias", json=explicit).json()["entries"]) == 2
    assert len(client.get("/api/vault/bookmarks").json()["entries"]) == 2


def test_last_alias_edit_away_tombstones_old_page_and_retains_edit_date(client, monkeypatch):
    result = client.post("/api/vault/bookmarks/import", json={"entries": [entry("old", target="note", group="Work")]})
    old = result.json()["entries"][0]
    changed = {key: value for key, value in old.items() if key != "created_at"}
    changed.update(kind="url", target="https://example.org/edited", label="Edited destination")
    result = client.put("/api/vault/bookmarks/items/" + old["id"], json=changed)
    edited = result.json()["entries"][0]
    assert edited["created_at"] == old["created_at"]
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [BookmarkEntry(**entry("favorite", target="note"))])
    assert client.get("/api/vault/bookmarks").json()["entries"] == [edited]
    payload = {"entries": [entry("different-old-device", target="note", label="Another alias", group="Home")]}
    assert client.post("/api/vault/bookmarks/import", json=payload).json()["entries"] == [edited]


def test_deleting_one_alias_preserves_other_aliases_until_last_removal(client, monkeypatch):
    aliases = [entry("first", target="note", label="First", group="Work"),
               entry("second", target="note", label="Second", group="Home"), entry("unrelated", target="other")]
    result = client.post("/api/vault/bookmarks/import", json={"entries": aliases}).json()["entries"]
    first, second, unrelated = result
    assert len(client.delete("/api/vault/bookmarks/items/" + first["id"]).json()["entries"]) == 2
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [BookmarkEntry(**entry("favorite", target="note"))])
    assert client.get("/api/vault/bookmarks").json()["entries"] == [second, unrelated]
    # Removing one alias is not an instruction to disable the whole page.
    new_alias = entry("third", target="note", label="Third", group="Other")
    result = client.post("/api/vault/bookmarks/import", json={"entries": [new_alias]}).json()["entries"]
    third = next(item for item in result if item["label"] == "Third")
    client.delete("/api/vault/bookmarks/items/" + second["id"])
    assert len(client.get("/api/vault/bookmarks").json()["entries"]) == 2
    client.delete("/api/vault/bookmarks/items/" + third["id"])
    unseen = entry("unseen-fourth", target="note", label="Fourth", group="Other")
    assert client.post("/api/vault/bookmarks/import", json={"entries": [unseen]}).json()["entries"] == [unrelated]


@pytest.mark.parametrize("kind,target", [("url", "https://example.org/path"), ("search", "tag:reading"),
                                         ("section", "note#Heading"), ("route", "/calendar?view=month")])
def test_deleted_semantic_legacy_alias_does_not_return_with_different_device_id(client, kind, target):
    original = entry("device-a", kind=kind, target=target, label="Shared alias", group="Work")
    item = client.post("/api/vault/bookmarks/import", json={"entries": [original]}).json()["entries"][0]
    client.delete("/api/vault/bookmarks/items/" + item["id"])
    other_device = {**original, "id": "device-b"}
    assert client.post("/api/vault/bookmarks/import", json={"entries": [other_device]}).json()["entries"] == []
    distinct = [{**original, "id": "device-c", "label": "Different name"}, {**original, "id": "device-d", "group": "Home"}]
    assert len(client.post("/api/vault/bookmarks/import", json={"entries": distinct}).json()["entries"]) == 2
    manual = {**original, "id": "manual"}
    assert len(client.put("/api/vault/bookmarks/items/manual", json=manual).json()["entries"]) == 3


@pytest.mark.parametrize("tombstone_later", [False, True])
def test_independent_device_page_off_suppresses_unseen_alias_in_both_replay_orders(tmp_path, monkeypatch, tombstone_later):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [])
    devices = [tmp_path / "off-device", tmp_path / "import-device"]
    for device in devices:
        device.mkdir()
    scopes = [context(device) for device in devices]
    stores = [BookmarkStore(scope) for scope in scopes]
    api.put_bookmark("unrelated", BookmarkEntry(**entry("unrelated")), scopes[int(not tombstone_later)])
    api.toggle_page_bookmark("note", BookmarkPage(label="Note", enabled=False), scopes[0])
    api.import_bookmarks(BookmarkImport(entries=[BookmarkEntry(**entry("unseen", target="note", label="Old device alias", group="Work"))]), scopes[1])
    for source, destination in [(stores[0], stores[1]), (stores[1], stores[0])]:
        for path in source.directory.glob("*.json"):
            if not (destination.directory / path.name).exists():
                shutil.copy2(path, destination.directory / path.name)
    left, right = [api.list_bookmarks(scope) for scope in scopes]
    assert left == right
    assert [item.target for item in left.entries] == ["unrelated"]
    # A direct action remains possible while old aliases stay permanently suppressed.
    api.put_bookmark("manual-note", BookmarkEntry(**entry("manual-note", target="note", group="New")), scopes[0])
    api.import_bookmarks(BookmarkImport(entries=[BookmarkEntry(**entry("another-old-device", target="note", label="Still old"))]), scopes[0])
    assert {item.id for item in api.list_bookmarks(scopes[0]).entries} == {"unrelated", "manual-note"}


@pytest.mark.parametrize("tombstone_later", [False, True])
def test_independent_semantic_legacy_deletion_purges_other_device_equivalent(tmp_path, monkeypatch, tombstone_later):
    monkeypatch.setattr(api, "discover_favorites", lambda _scope: [])
    devices = [tmp_path / "delete-device", tmp_path / "import-device"]
    for device in devices:
        device.mkdir()
    scopes = [context(device) for device in devices]
    stores = [BookmarkStore(scope) for scope in scopes]
    original = entry("device-a", kind="url", target="https://example.org/shared", group="Work")
    imported = api.import_bookmarks(BookmarkImport(entries=[BookmarkEntry(**original)]), scopes[0])
    if tombstone_later:
        api.put_bookmark("filler-a", BookmarkEntry(**entry("filler-a")), scopes[0])
    else:
        for key in ("filler-b", "filler-c", "filler-d"):
            api.put_bookmark(key, BookmarkEntry(**entry(key)), scopes[1])
    api.delete_bookmark(imported.entries[0].id, scopes[0])
    api.import_bookmarks(BookmarkImport(entries=[BookmarkEntry(**{**original, "id": "device-b"})]), scopes[1])
    for source, destination in [(stores[0], stores[1]), (stores[1], stores[0])]:
        for path in source.directory.glob("*.json"):
            if not (destination.directory / path.name).exists():
                shutil.copy2(path, destination.directory / path.name)
    left, right = [api.list_bookmarks(scope) for scope in scopes]
    assert left == right
    assert not any(item.kind == "url" for item in left.entries)


@pytest.mark.parametrize("page_id", ["Cafè Notes.v2", "研究 ノート", "Research #2", "Notes [draft] | A?", "x" * 300])
def test_supported_non_uuid_page_identities_survive_import_routes_star_and_tombstones(client, page_id):
    payload = {"entries": [entry("legacy", target=page_id, label="Custom alias", group="Work")], "page_order": [page_id]}
    result = client.post("/api/vault/bookmarks/import", json=payload)
    assert result.status_code == 200, result.text
    original = result.json()["entries"][0]
    assert original["target"] == page_id
    path = "/api/vault/bookmarks/pages/" + quote(page_id, safe="")
    result = client.put(path, json={"label": "Page", "enabled": True})
    assert result.status_code == 200, result.text
    assert result.json()["entries"] == [original]
    route = "/knowledge/page/" + quote(page_id, safe="")
    result = client.put("/api/vault/bookmarks/route", json={"label": "Page", "target": route, "enabled": True})
    assert result.status_code == 200, result.text
    assert result.json()["entries"] == [original]
    assert client.put(path, json={"label": "Page", "enabled": False}).json()["entries"] == []
    unseen = {**payload["entries"][0], "id": "unseen", "label": "Another old alias"}
    assert client.post("/api/vault/bookmarks/import", json={"entries": [unseen]}).json()["entries"] == []


def test_complete_legacy_favorite_discovery_preserves_supported_non_uuid_ids(client, monkeypatch):
    from backend.domains.vault.api import pages_queries

    identifiers = ["Cafè Notes.v2", "研究 ノート", "Research #2", "Notes [draft] | A?", "x" * 300]
    pages = [SimpleNamespace(id=page_id, title="Favorite", metadata={"favorite": True}, path="", folder="") for page_id in identifiers]
    monkeypatch.setattr(api, "discover_favorites", client.real_discovery)
    monkeypatch.setattr(pages_queries, "_deps", lambda: SimpleNamespace(get_pages_snapshot=lambda: pages, refresh_pages_metadata=lambda _pages: None))
    result = client.get("/api/vault/bookmarks")
    assert result.status_code == 200, result.text
    assert [item["target"] for item in result.json()["entries"]] == identifiers


def test_section_bookmarks_accept_safe_legacy_page_names_without_allowing_wiki_injection(client):
    safe = entry("section", kind="section", target="Cafè Notes.v2#Heading", label="Section")
    assert client.put("/api/vault/bookmarks/items/section", json=safe).status_code == 200
    for page_id in ("note[alias]", "note|alias", "../note", "note\\other", ".."):
        assert client.put("/api/vault/bookmarks/items/unsafe", json=entry("unsafe", kind="section", target=page_id + "#Heading")).status_code == 422
