"""Generic public HTML import has an explicit, owner-scoped creation boundary."""
from io import BytesIO
import json

import pytest
from fastapi import HTTPException
from PIL import Image

from backend.domains.sites import url_import
from backend.domains.sites.public_http import PublicFetchError, PublicResponse
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext


@pytest.fixture
def store(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "device"))
    return SiteStore(WorkspaceContext("workspace", "owner", "owner", vault))


def responses(monkeypatch):
    output = BytesIO()
    Image.new("RGB", (2, 2), "red").save(output, format="PNG")
    data = {
        "https://example.org/": (b'<html lang="fr"><title>Bonjour</title><nav><a href="/suite">Suite</a></nav><main><h1>Hello</h1><p>A <strong>public</strong> page. <a href="/suite">Next</a></p><img src="/photo.png" alt="A photo"><script>evil()</script><form action="/send"><input name="secret"></form></main></html>', "text/html"),
        "https://example.org/suite": (b'<html lang="en"><title>Next</title><main><p>Second page</p></main></html>', "text/html"),
        "https://example.org/photo.png": (output.getvalue(), "image/png"),
    }
    calls = []

    def fetch(url, budget, **kw):
        calls.append(url)
        if url not in data:
            raise PublicFetchError("Unavailable")
        body, kind = data[url]
        return PublicResponse(url, body, kind)

    monkeypatch.setattr(url_import.public_http, "fetch", fetch)
    return calls


def test_preview_is_private_and_creation_preserves_editable_content_without_publication(store, monkeypatch):
    calls = responses(monkeypatch)
    review = url_import.preview(store, "https://example.org/", 5)
    assert not store.list()
    assert not list(store.vault.rglob("*.png"))
    assert review["assets_count"] == 1
    assert [page["path"] for page in review["pages"]] == ["/", "/suite"]
    assert any("forms were omitted" in warning for warning in review["warnings"])
    before = list(calls)
    selected = [page["id"] for page in review["pages"]]
    site = url_import.create(store, review["id"], "Imported", selected)
    assert calls == before  # Creation consumes the reviewed snapshot, without refetching.
    assert site.languages == ["fr", "en"]
    assert site.origin == "https://example.org/"
    assert len(site.targets) == 1 and site.targets[0].adapter == "local"
    assert not site.legacy_pilot and not site.forms
    assert site.navigation[0].href == "/suite"
    assert "**public**" in site.pages[0].blocks[0].body
    assert "[Next](/suite)" in site.pages[0].blocks[0].body
    image = next(block for block in site.pages[0].blocks if block.type == "image")
    assert image.alt == "A photo"
    assert (store.vault / image.image.lstrip("/")).is_file()
    assert "evil" not in site.model_dump_json() and "secret" not in site.model_dump_json()
    with store.database() as db:
        assert db.execute("SELECT count(*) FROM jobs").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM active").fetchone()[0] == 0
    assert url_import.create(store, review["id"], "Imported", selected).id == site.id


def test_unknown_selection_and_other_owner_are_rejected(store, monkeypatch):
    responses(monkeypatch)
    review = url_import.preview(store, "https://example.org/", 1)
    with pytest.raises(HTTPException, match="Select available"):
        url_import.create(store, review["id"], "Imported", ["unknown"])
    store.context.user_id = "different-owner"
    with pytest.raises(HTTPException, match="unavailable or changed"):
        url_import.create(store, review["id"], "Imported", [review["pages"][0]["id"]])
    assert not store.list()


def test_expired_preview_rejected(store, monkeypatch):
    responses(monkeypatch)
    review = url_import.preview(store, "https://example.org/", 1)
    monkeypatch.setattr(url_import.time, "time", lambda: 10**12)
    with pytest.raises(HTTPException) as caught:
        url_import.create(store, review["id"], "Imported", [review["pages"][0]["id"]])
    assert caught.value.status_code == 410


def test_image_changed_after_review_is_rejected(store, monkeypatch):
    responses(monkeypatch)
    review = url_import.preview(store, "https://example.org/", 1)
    root = url_import._directory(store, review["id"])
    next(root.glob("*.png")).write_bytes(b"changed")
    with pytest.raises(HTTPException, match="changed after review"):
        url_import.create(store, review["id"], "Imported", [review["pages"][0]["id"]])
    assert not store.list()


def test_partial_limits_are_disclosed_and_unselected_links_keep_original_origin(store, monkeypatch):
    responses(monkeypatch)
    review = url_import.preview(store, "https://example.org/", 1)
    assert len(review["pages"]) == 1
    assert any("additional pages" in warning for warning in review["warnings"])
    site = url_import.create(store, review["id"], "Imported", [review["pages"][0]["id"]])
    assert site.navigation[0].href == "https://example.org/suite"


def test_query_routes_are_disclosed_instead_of_silently_colliding(store, monkeypatch):
    def fetch(url, budget, **kw):
        return PublicResponse(url, b'<html><title>Site</title><main><p>Public</p><a href="/?page=2">More</a></main></html>', "text/html")
    monkeypatch.setattr(url_import.public_http, "fetch", fetch)
    review = url_import.preview(store, "https://example.org/", 3)
    assert len(review["pages"]) == 1
    assert any("Query-dependent" in warning for warning in review["warnings"])


def test_preview_snapshot_tampering_is_rejected(store, monkeypatch):
    responses(monkeypatch)
    review = url_import.preview(store, "https://example.org/", 1)
    path = url_import._directory(store, review["id"]) / "snapshot.json"
    envelope = json.loads(path.read_text())
    envelope["snapshot"]["pages"][0]["title"] = "Changed"
    path.write_text(json.dumps(envelope))
    with pytest.raises(HTTPException, match="unavailable or changed"):
        url_import.create(store, review["id"], "Imported", [review["pages"][0]["id"]])


def test_untrusted_image_marker_and_malformed_link_remain_data(store, monkeypatch):
    def fetch(url, budget, **kw):
        body = b'<html><main><p>GNOSIIMPORTIMAGE0TOKEN</p><a href="http://[">Invalid</a></main></html>'
        return PublicResponse(url, body, "text/html")
    monkeypatch.setattr(url_import.public_http, "fetch", fetch)
    review = url_import.preview(store, "https://example.org/", 1)
    site = url_import.create(store, review["id"], "Imported", [review["pages"][0]["id"]])
    assert "GNOSIIMPORTIMAGE0TOKEN" in site.pages[0].blocks[0].body


@pytest.mark.parametrize("contents", [b"{", b"\xff", b'{"snapshot":[],"digest":"x"}', b"null"])
def test_malformed_private_snapshot_fails_with_http_conflict(store, monkeypatch, contents):
    responses(monkeypatch)
    review = url_import.preview(store, "https://example.org/", 1)
    path = url_import._directory(store, review["id"]) / "snapshot.json"
    path.write_bytes(contents)
    with pytest.raises(HTTPException) as caught:
        url_import.create(store, review["id"], "Imported", [review["pages"][0]["id"]])
    assert caught.value.status_code == 409


def test_concurrent_identical_creation_consumes_one_snapshot_once(store, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    responses(monkeypatch)
    review = url_import.preview(store, 'https://example.org/', 1)
    selected = [review['pages'][0]['id']]
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(url_import.create, store, review['id'], 'Imported', selected) for _ in range(2)]
        sites = [job.result(timeout=10) for job in jobs]
    assert sites[0].id == sites[1].id
    assert [site.id for site in store.list()] == [sites[0].id]
