"""Newsletter publication isolation, safe composition and private autosave."""
from __future__ import annotations

import json
import shutil
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.domains.sites import api, newsletter, private_service
from backend.domains.sites.models import PublicRecord, ServiceSettings, SiteBundle, SiteConfig, SiteRelease, SiteTarget
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


@pytest.fixture
def published_site(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "device"))
    vault = tmp_path / "vault"
    vault.mkdir()
    context = WorkspaceContext("workspace", "operator", "owner", vault)
    store = SiteStore(context)
    site = store.save(SiteConfig(name="Synthetic newsletter", targets=[SiteTarget(id="local", enabled=True)], languages=["ca", "es"]), create=True)
    records = [
        PublicRecord(id="one", language="ca", path="/ca/first", title='First <img src="https://tracker.invalid/pixel">', body_html="<p>Public introduction</p><script>HIDDEN-SCRIPT</script>", fields={"unexpected": "NEVER-COPY-FIELDS"}),
        PublicRecord(id="two", language="ca", path="/ca/segon article", title="Second article", body_html="<p>Another published introduction</p>"),
        PublicRecord(id="es", language="es", path="/es/primero", title="Primero", body_html="<p>Publicado</p>"),
    ]
    bundle = SiteBundle(site=site, records=records, fingerprint="published-one")
    release = SiteRelease(id="release", site_id=site.id, target_id="local", created_at="2026-10-25T12:00:00+00:00", fingerprint=bundle.fingerprint, current=True, url="https://example.invalid/_gnosi-proves/current")
    def activate(value):
        with store.database() as db:
            db.execute("INSERT OR REPLACE INTO releases VALUES (?,?,?,?,?)", (release.id, site.id, "local", release.model_dump_json(), value.model_dump_json()))
            db.execute("INSERT OR REPLACE INTO active VALUES (?,?,?)", (site.id, "local", release.id))
    activate(bundle)
    return SimpleNamespace(store=store, site=site, context=context, bundle=bundle, activate=activate)


def test_catalogue_uses_only_active_public_snapshot_and_never_current_vault(published_site):
    value = published_site
    (value.store.vault / "draft.md").write_text("PRIVATE-DRAFT-NEVER-PUBLISH")
    value.site.origin = "https://unpublished-origin.invalid"
    value.bundle.records.append(value.bundle.records[0].model_copy(update={"source_ids": ["other-view"]}))
    value.activate(value.bundle)
    state = newsletter.state(value.store, value.site, "local")
    assert len(state.contents) == 3
    assert state.contents[0].summary == "Public introduction"
    assert "NEVER-COPY-FIELDS" not in state.model_dump_json()
    assert "HIDDEN-SCRIPT" not in state.model_dump_json()
    assert "PRIVATE-DRAFT" not in state.model_dump_json()
    assert newsletter.state(value.store, value.site, "local").draft.revision == 0


@pytest.mark.parametrize("template", ["digest", "featured"])
def test_composition_escapes_content_preserves_order_and_published_url(published_site, template):
    value = published_site
    draft = newsletter.SiteNewsletterDraft(subject="News", paths=["/ca/segon article", "/ca/first"], introduction='<img src="https://tracker.invalid/intro">', template=template)
    result = newsletter.compose(value.store, value.site, "local", newsletter.SiteNewsletterReview(draft=draft, fingerprint=value.bundle.fingerprint))
    body = result["body_html"]
    assert '<img' not in body
    assert '&lt;img' in body
    assert body.index("Second article") < body.index("First &lt;img")
    assert "https://example.invalid/_gnosi-proves/current/ca/segon%20article" in body
    assert "https://example.invalid/_gnosi-proves/current/ca/first" in result["body_text"]
    assert "NEVER-COPY-FIELDS" not in json.dumps(result)
    assert ("<h1>Second article</h1>" in body) is (template == "featured")


@pytest.mark.parametrize("paths", [["/ca/unpublished"], ["/es/primero"], []])
def test_unpublished_unknown_and_other_language_selections_fail_closed(published_site, paths):
    value = published_site
    draft = newsletter.SiteNewsletterDraft(subject="News", paths=paths)
    with pytest.raises(HTTPException) as error:
        newsletter.compose(value.store, value.site, "local", newsletter.SiteNewsletterReview(draft=draft, fingerprint=value.bundle.fingerprint))
    assert error.value.status_code == 409


def test_withdrawal_or_new_release_invalidates_content_review(published_site):
    value = published_site
    request = newsletter.SiteNewsletterReview(draft=newsletter.SiteNewsletterDraft(subject="News", paths=["/ca/first"]), fingerprint=value.bundle.fingerprint)
    value.bundle.fingerprint = "published-two"
    value.bundle.records = [item for item in value.bundle.records if item.path != "/ca/first"]
    value.activate(value.bundle)
    with pytest.raises(HTTPException) as error:
        newsletter.compose(value.store, value.site, "local", request)
    assert error.value.status_code == 409
    assert "/ca/first" not in [item.path for item in newsletter.state(value.store, value.site, "local").contents]


def test_no_publication_offers_no_contents_but_manual_mode_still_works(published_site):
    value = published_site
    with value.store.database() as db:
        db.execute("DELETE FROM active")
    assert newsletter.state(value.store, value.site, "local").contents == []
    manual = newsletter.SiteNewsletterReview(draft=newsletter.SiteNewsletterDraft(mode="manual", subject="Manual", body_html="<p>News</p>", interests="first,second\nthird"), fingerprint="")
    assert newsletter.compose(value.store, value.site, "local", manual)["interests"] == ["first", "second", "third"]


def test_drafts_autosave_privately_with_conflict_detection_and_destination_isolation(published_site):
    value = published_site
    draft = newsletter.SiteNewsletterDraft(subject="Private editorial draft", paths=["/ca/first"])
    saved = newsletter.save_draft(value.store, value.site, "local", draft)
    assert saved.revision == 1
    assert newsletter.load_draft(value.store, value.site, "local") == saved
    with pytest.raises(HTTPException) as error:
        newsletter.save_draft(value.store, value.site, "local", draft)
    assert error.value.status_code == 409
    value.site.targets.append(SiteTarget(id="other"))
    assert newsletter.load_draft(value.store, value.site, "other").subject == ""
    assert "Private editorial draft" not in value.store.config_path(value.site.id).read_text()
    assert "Private editorial draft" not in value.bundle.model_dump_json()
    assert not value.store.private_root.is_relative_to(value.store.vault)


def test_duplicate_paths_are_rejected_without_silently_changing_selection():
    with pytest.raises(ValidationError):
        newsletter.SiteNewsletterDraft(paths=["/ca/a", "/ca/a"])


def test_queue_rechecks_the_server_bound_review_after_publication_changes(published_site, monkeypatch):
    value = published_site
    calls = []
    def invoke(store, site, action, payload, target_id, **kwargs):
        calls.append(action)
        return {"preview_id": "reviewed"} if action == "campaign_preview" else {"queued": 1}
    monkeypatch.setattr(private_service, "invoke", invoke)
    review = newsletter.SiteNewsletterReview(draft=newsletter.SiteNewsletterDraft(subject="News", paths=["/ca/first"]), fingerprint=value.bundle.fingerprint)
    newsletter.preview(value.store, value.site, "local", review)
    request = newsletter.SiteNewsletterQueue(preview_id="reviewed")
    assert newsletter.queue(value.store, value.site, "local", request) == {"queued": 1}
    value.bundle.fingerprint = "withdrawn-after-review"
    value.bundle.records = []
    value.activate(value.bundle)
    with pytest.raises(HTTPException) as error:
        newsletter.queue(value.store, value.site, "local", request)
    assert error.value.status_code == 409
    assert calls == ["campaign_preview", "campaign_queue"]
    with pytest.raises(HTTPException):
        newsletter.queue(value.store, value.site, "local", newsletter.SiteNewsletterQueue(preview_id="not-reviewed"))


def test_queue_refuses_an_in_progress_publication(published_site, monkeypatch):
    value = published_site
    monkeypatch.setattr(private_service, "invoke", lambda *args: {"preview_id": "reviewed"})
    review = newsletter.SiteNewsletterReview(draft=newsletter.SiteNewsletterDraft(subject="News", paths=["/ca/first"]), fingerprint=value.bundle.fingerprint)
    newsletter.preview(value.store, value.site, "local", review)
    with value.store.database() as db:
        db.execute("INSERT INTO locks VALUES (?,?)", (value.site.id, "publishing"))
    with pytest.raises(HTTPException) as error:
        newsletter.queue(value.store, value.site, "local", newsletter.SiteNewsletterQueue(preview_id="reviewed"))
    assert error.value.status_code == 409


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
def test_generated_template_reaches_real_php_sanitizer_and_email_theme(published_site):
    value = published_site
    private_service.save_settings(value.store, value.site.id, ServiceSettings(sender_email="sender@example.invalid"))
    request = newsletter.SiteNewsletterReview(draft=newsletter.SiteNewsletterDraft(subject="Published reading", paths=["/ca/first"], template="featured", introduction="A shared introduction"), fingerprint=value.bundle.fingerprint)
    result = newsletter.preview(value.store, value.site, "local", request)
    assert result["test_mode"] is True
    assert result["recipient_count"] == 0
    assert '<h1>First &lt;img' in result["body_html"]
    assert '<img src=' not in result["body_html"]
    assert 'background:' in result["body_html"]
    assert "https://example.invalid/_gnosi-proves/current/ca/first" in result["body_text"]
    assert private_service.invoke(value.store, value.site, "campaigns_list", {})["items"] == []
    queued = newsletter.queue(value.store, value.site, "local", newsletter.SiteNewsletterQueue(preview_id=result["preview_id"]))
    assert queued["queued"] == 0
    assert len(private_service.invoke(value.store, value.site, "campaigns_list", {})["items"]) == 1


def test_authenticated_admin_routes_keep_draft_private_and_review_before_queue(published_site, monkeypatch):
    value = published_site
    app = FastAPI()
    app.include_router(api.router, prefix="/api/vault")
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    app.dependency_overrides[get_workspace_context] = lambda: value.context
    monkeypatch.setattr(api, "store_for", lambda context: value.store)
    requests = []
    def invoke(store, site, action, payload, target_id, **kwargs):
        requests.append((action, payload, target_id))
        return {"preview_id": "reviewed", "body_html": payload["body_html"], "body_text": payload["body_text"]}
    monkeypatch.setattr(private_service, "invoke", invoke)
    url = "/api/vault/sites/" + value.site.id + "/newsletter"
    with TestClient(app) as client:
        response = client.get(url)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        draft = response.json()["draft"]
        draft.update(subject="News", paths=["/ca/first"])
        saved = client.put(url, json=draft)
        assert saved.status_code == 200
        assert saved.json()["revision"] == 1
        result = client.post(url + "/preview", json={"draft": saved.json(), "fingerprint": value.bundle.fingerprint})
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        assert [request[0] for request in requests] == ["campaign_preview"]
        app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext("workspace", "editor", "editor", value.store.vault)
        assert client.get(url).status_code == 403
        assert client.put(url, json=saved.json()).status_code == 403
        assert client.post(url + "/preview", json={"draft": saved.json(), "fingerprint": value.bundle.fingerprint}).status_code == 403
        assert client.post(url + "/queue", json={"preview_id": "reviewed"}).status_code == 403
