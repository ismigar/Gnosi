"""Website and hosting registration removal, using disposable storage."""
from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.domains.sites import api, publication, runtime
from backend.domains.sites.models import SiteConfig, SiteJob, SiteRelease, SiteTarget
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


@pytest.fixture
def managed(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "device"))
    context = WorkspaceContext("workspace", "operator", "owner", vault)
    store = SiteStore(context)
    site = store.save(SiteConfig(name="Synthetic site"), create=True)
    return store, site


@pytest.mark.parametrize("cached_site", [False, True])
def test_restoration_after_hosting_removal_is_controlled_and_has_no_effects(managed, monkeypatch, cached_site):
    from backend.domains.sites import local_artifacts

    store, site = managed
    release = SiteRelease(id="historical", site_id=site.id, target_id="local",
                          created_at="2026-11-01T10:00:00Z", fingerprint="retained", url="http://127.0.0.1:4321")
    with store.database() as db:
        db.execute("INSERT INTO releases VALUES (?,?,?,?,?)", (release.id, site.id, "local", release.model_dump_json(), "{}"))
    removed = store.save(site.model_copy(update={"targets": []}))
    monkeypatch.setattr(local_artifacts, "activate", lambda *a, **kw: pytest.fail("No local activation after hosting removal"))
    monkeypatch.setattr(runtime, "restore_remote_release", lambda *a, **kw: pytest.fail("No remote restoration after hosting removal"))
    with store.database() as db:
        original_active = list(db.execute("SELECT * FROM active"))
        original_releases = [tuple(row) for row in db.execute("SELECT * FROM releases")]
    with pytest.raises(HTTPException) as error:
        publication.rollback(store, site if cached_site else removed, release.id)
    assert error.value.status_code == 409
    assert store.load(site.id).targets == []
    with store.database() as db:
        assert list(db.execute("SELECT * FROM active")) == original_active
        assert [tuple(row) for row in db.execute("SELECT * FROM releases")] == original_releases
        assert not db.execute("SELECT * FROM locks").fetchall()


def test_remove_registration_preserves_vault_other_sites_and_private_history(managed, monkeypatch):
    store, site = managed
    other = store.save(SiteConfig(name="Other"), create=True)
    note = store.vault / "content.md"
    note.write_text("User content")
    artifact = store.site_dir(site.id) / "published.txt"
    artifact.write_text("Published content")
    stopped = []
    monkeypatch.setattr(runtime, "retire_target", lambda _, site_id, target_id: stopped.append((site_id, target_id)))
    monkeypatch.setattr(runtime, "_ssh", lambda *a, **kw: pytest.fail("Removal must not contact the remote server"))
    store.remove(site.id, site.revision)
    assert [item.id for item in store.list()] == [other.id]
    assert note.read_text() == "User content"
    assert artifact.read_text() == "Published content"
    assert stopped == [(site.id, "local")]
    with pytest.raises(HTTPException) as missing:
        store.load(site.id)
    assert missing.value.status_code == 404


@pytest.mark.parametrize("operation", ["site", "hosting"])
@pytest.mark.parametrize("pending", ["queued", "running", "lock"])
def test_removal_refuses_active_publication(managed, operation, pending):
    store, site = managed
    job = SiteJob(id="pending", site_id=site.id, target_id="local", status="queued" if pending == "lock" else pending)
    with store.database() as db:
        if pending == "lock":
            db.execute("INSERT INTO locks VALUES (?,?)", (site.id, "rollback"))
        else:
            db.execute("INSERT INTO jobs VALUES (?,?,?)", (job.id, site.id, job.model_dump_json()))
    with pytest.raises(HTTPException) as conflict:
        if operation == "site":
            store.remove(site.id, site.revision)
        else:
            store.save(site.model_copy(update={"targets": []}))
    assert conflict.value.status_code == 409
    assert store.load(site.id).targets[0].id == "local"


def test_stale_removal_and_path_traversal_do_not_remove_config(managed):
    store, site = managed
    current = store.save(site.model_copy(update={"name": "Updated"}))
    for identity, revision, status in [(site.id, site.revision, 409), ("../outside", 1, 404)]:
        with pytest.raises(HTTPException) as error:
            store.remove(identity, revision)
        assert error.value.status_code == status
    assert store.load(site.id) == current


def test_hosting_can_remove_last_target_and_create_another(managed, monkeypatch):
    store, site = managed
    stops = []
    monkeypatch.setattr(runtime, "retire_target", lambda _, site_id, target_id: stops.append(target_id))
    with store.database() as db:
        db.execute("INSERT INTO previews VALUES (?,?,?,?,?,?,?,?)", ("review", site.id, "operator", "local", "hash", 99999999999, "{}", 0))
    empty = store.save(site.model_copy(update={"targets": []}))
    assert store.load(site.id).targets == []
    assert stops == ["local"]
    with store.database() as db:
        assert not db.execute("SELECT 1 FROM previews WHERE site_id=?", (site.id,)).fetchone()
    saved = store.save(empty.model_copy(update={"targets": [SiteTarget(id="new-local")]}))
    assert saved.targets[0].id == "new-local"


def test_delete_http_requires_administrator_and_current_revision(managed, monkeypatch):
    store, site = managed
    app = FastAPI()
    app.include_router(api.router, prefix="/api/vault")
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    app.dependency_overrides[get_workspace_context] = lambda: store.context
    monkeypatch.setattr(api, "store_for", lambda _: store)
    url = "/api/vault/sites/" + site.id
    with TestClient(app) as client:
        store.context.role = "editor"
        assert client.delete(url, params={"revision": site.revision}).status_code == 403
        store.context.role = "owner"
        assert client.delete(url).status_code == 422
        assert client.delete(url, params={"revision": 0}).status_code == 422
        assert client.delete(url, params={"revision": site.revision + 1}).status_code == 409
        response = client.delete(url, params={"revision": site.revision})
        assert response.status_code == 204
        assert response.content == b""
        assert client.get("/api/vault/sites").json() == []


def test_remove_target_stops_its_preview_and_local_worker(managed, monkeypatch):
    store, site = managed
    captures = store.site_dir(site.id) / "services/local/captures"
    captures.mkdir(parents=True)
    stops = []
    monkeypatch.setattr(runtime, "stop_preview", lambda _, site_id, preview_id: stops.append((site_id, preview_id)))
    with store.database() as db:
        db.execute("INSERT INTO previews VALUES (?,?,?,?,?,?,?,?)", ("review", site.id, "operator", "local", "hash", 99999999999, "{}", 0))
    store.save(site.model_copy(update={"targets": []}))
    assert stops == [(site.id, "review")]
    assert (captures / ".daemon-stop").is_file()


def test_preview_started_before_removal_cannot_register_afterwards(managed, monkeypatch):
    from backend.domains.sites import publication
    store, site = managed
    site.targets[0].enabled = True
    site = store.save(site)
    stops = []
    def concurrent_start(*args, **kwargs):
        store.config_path(site.id).unlink()
        return "http://127.0.0.1:4321"
    monkeypatch.setattr(runtime, "start_server", concurrent_start)
    monkeypatch.setattr(runtime, "render_bundle", lambda *args: None)
    monkeypatch.setattr(runtime, "stop_preview", lambda _, site_id, preview_id: stops.append((site_id, preview_id)))
    with pytest.raises(HTTPException) as missing:
        publication.preview(store, site, "local")
    assert missing.value.status_code == 404
    assert len(stops) == 1 and stops[0][0] == site.id
    with store.database() as db:
        assert not db.execute("SELECT 1 FROM previews WHERE site_id=?", (site.id,)).fetchone()


@pytest.mark.parametrize("operation", ["site", "hosting"])
def test_removal_stops_owned_local_runtime_after_destination_changes_to_ssh(managed, monkeypatch, operation):
    import psutil
    from backend.domains.sites.storage import private_json
    store, site = managed
    output = store.site_dir(site.id) / "active/local"
    output.mkdir(parents=True)
    captures = store.site_dir(site.id) / "services/local/captures"
    captures.mkdir(parents=True)
    monkeypatch.setattr(runtime.shutil, "which", lambda name: "/synthetic/php")
    argv = ["/synthetic/php", "-S", "127.0.0.1:4321", "-t", str(output), str(runtime.SERVICE_ROOT.parent / "public/router.php")]
    terminated = []
    class OwnedProcess:
        def __init__(self, pid):
            self.pid = pid
        def create_time(self):
            return 123.0
        def cmdline(self):
            return argv
        def status(self):
            return psutil.STATUS_RUNNING
        def terminate(self):
            terminated.append(self.pid)
        def wait(self, timeout):
            return 0
    monkeypatch.setattr(runtime.psutil, "Process", OwnedProcess)
    receipt = store.site_dir(site.id) / "servers/local/server.json"
    private_json(receipt, {"pid": 1234, "port": 4321, "started_at": 123.0, "output": str(output), "argv": argv})
    site.targets[0].adapter = "ssh"
    site.targets[0].environment = "staging"
    changed = store.save(site)
    assert terminated == []
    if operation == "site":
        store.remove(changed.id, changed.revision)
    else:
        store.save(changed.model_copy(update={"targets": []}))
    assert terminated == [1234]
    assert not receipt.exists()
    assert (captures / ".daemon-stop").is_file()
