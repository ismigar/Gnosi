"""Record actions use scoped bindings and reviewed whole-site releases, never real hosts."""
import json

import pytest
from fastapi import HTTPException

from backend.domains.sites import publication, record_publication as records, runtime
from backend.domains.sites.models import SitePublishRequest, SiteSource
from backend.tests.test_sites import website  # noqa: F401


@pytest.fixture
def reviewed(website, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:9999")
    monkeypatch.setattr(runtime, "render_bundle", lambda *args, **kwargs: None)
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    request = records.RecordPublicationReview(page_id="one", target_id="local", action="withdraw")
    return website, request


def test_review_is_non_mutating_and_confirm_queues_existing_pipeline(reviewed):
    website, request = reviewed
    before = website.store.config_path(website.site.id).read_bytes()
    preview = records.review(website.store, website.site, request)
    assert website.store.config_path(website.site.id).read_bytes() == before
    job = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))
    assert job.status == "queued"
    assert website.store.load(website.site.id).sources[0].withdrawn_ids == ["one"]
    # A queued job is not a completed publication.
    assert records.destinations(website.store, page_id="one")[0].published_page_ids == []
    with pytest.raises(HTTPException, match="409"):
        publication.enqueue(website.store, website.store.load(website.site.id), SitePublishRequest(preview_id=preview.id))


def test_selection_preserves_filters_siblings_and_other_sources(reviewed):
    website, request = reviewed
    website.site.sources[0].selection_mode = "selected"
    website.site.sources[0].page_ids = ["one", "two"]
    website.site.sources.append(SiteSource(id="other", source_id="two", kind="page", enabled=True))
    website.site = website.store.save(website.site)
    candidate = records.proposal(website.store, website.site, request)
    assert candidate.sources[0].page_ids == ["one", "two"]
    assert candidate.sources[0].filters == website.site.sources[0].filters
    assert candidate.sources[1] == website.site.sources[1]
    request.action = "publish"
    candidate = records.proposal(website.store, candidate, request)
    assert candidate.sources[0].withdrawn_ids == []
    assert candidate.sources[0].page_ids == ["one", "two"]


def test_draft_filter_and_unbound_record_fail_closed(reviewed):
    website, request = reviewed
    request.action = "publish"
    request.page_id = "two"
    with pytest.raises(HTTPException, match="409"):
        records.proposal(website.store, website.site, request)
    request.page_id = "missing"
    with pytest.raises(HTTPException, match="409"):
        records.review(website.store, website.site, request)
    request.page_id = "one"
    site = website.site.model_copy(update={"sources": []})
    with pytest.raises(HTTPException, match="409"):
        records.proposal(website.store, site, request)


@pytest.mark.parametrize("change", ["content", "config", "binding", "active"])
def test_stale_review_rejected_before_selection_changes(reviewed, change):
    website, request = reviewed
    preview = records.review(website.store, website.site, request)
    if change == "content":
        path = website.vault / "BD/Articles/one.md"
        path.write_text(path.read_text() + "Changed body\n")
    elif change == "binding":
        path = website.vault / "BD/vault_db_registry.json"
        data = json.loads(path.read_text())
        data["views"][0]["table_id"] = "other-table"
        path.write_text(json.dumps(data))
    elif change == "config":
        site = website.site.model_copy(update={"name": "Changed"})
        website.store.save(site)
    else:
        monkeypatch_bundle = {"fingerprint": "changed"}
        website.store.active_bundle = lambda *args: monkeypatch_bundle
    current = website.store.load(website.site.id)
    with pytest.raises(HTTPException, match="409"):
        publication.enqueue(website.store, current, SitePublishRequest(preview_id=preview.id))
    assert website.store.load(website.site.id).sources[0].withdrawn_ids == []


def test_queue_preparation_failure_restores_own_selection(reviewed, monkeypatch):
    website, request = reviewed
    preview = records.review(website.store, website.site, request)
    monkeypatch.setattr(publication, "private_json", lambda *args: (_ for _ in ()).throw(OSError("synthetic disk error")))
    with pytest.raises(OSError):
        publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))
    assert website.store.load(website.site.id).sources[0].withdrawn_ids == []


def test_destinations_are_table_bound_and_status_uses_active_receipt(reviewed):
    website, request = reviewed
    assert len(records.destinations(website.store, table_id="articles")) == 1
    preview = records.review(website.store, website.site, request.model_copy(update={"action": "publish"}))
    with website.store.database() as db:
        payload = json.loads(db.execute("SELECT payload FROM previews WHERE id=?", (preview.id,)).fetchone()["payload"])
        db.execute("INSERT INTO releases VALUES (?,?,?,?,?)", ("synthetic", website.site.id, "local", "{}", json.dumps(payload["bundle"])))
        db.execute("INSERT INTO active VALUES (?,?,?)", (website.site.id, "local", "synthetic"))
    assert records.destinations(website.store, page_id="one")[0].published_page_ids == ["one"]


def test_dispatch_failure_keeps_confirmed_durable_job_and_selection(reviewed, monkeypatch):
    website, request = reviewed
    preview = records.review(website.store, website.site, request)
    monkeypatch.setattr(publication, "dispatch", lambda *args: (_ for _ in ()).throw(RuntimeError("synthetic unavailable worker")))
    job = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))
    assert job.status == "queued"
    assert website.store.load(website.site.id).sources[0].withdrawn_ids == ["one"]
    with website.store.database() as db:
        assert db.execute("SELECT id FROM jobs WHERE id=?", (job.id,)).fetchone()


@pytest.mark.parametrize("binding", ["unbound", "ambiguous"])
def test_page_discovery_returns_no_destinations_without_an_unambiguous_table(website, binding):
    if binding == "unbound":
        page_id = "standalone-note"
        (website.vault / "standalone.md").write_text("---\nid: standalone-note\ntitle: Standalone\n---\nOrdinary note\n")
    else:
        page_id = "one"
        registry = website.vault / "BD/vault_db_registry.json"
        data = json.loads(registry.read_text())
        data["tables"].append(data["tables"][0])
        registry.write_text(json.dumps(data))

    assert records.destinations(website.store, page_id=page_id) == []
    request = records.RecordPublicationReview(page_id=page_id, target_id="local", action="publish")
    with pytest.raises(HTTPException, match="409.*unambiguous table binding"):
        records.proposal(website.store, website.site, request)
    with pytest.raises(HTTPException, match="409.*unambiguous table binding"):
        records.context_fingerprint(website.store, page_id)


def test_page_discovery_still_reports_registry_failure(website):
    (website.vault / "BD/vault_db_registry.json").write_text("invalid registry")
    with pytest.raises(HTTPException, match="409.*registry is unavailable"):
        records.destinations(website.store, page_id="one")


def test_menu_discovery_uses_scoped_inventory_without_exporting_every_body(website, monkeypatch, isolated_validation_runtime):
    from backend.api import vault_routes  # noqa: F401
    from backend.domains.vault.links import runtime as links
    from backend.services.context_vars import active_vault_path
    notes = records.exporter.notes(website.store)
    seen = []
    def inventory():
        seen.append(active_vault_path.get())
        return [(note.path, note.metadata, note.body, False) for note in notes]
    monkeypatch.setattr(links, "_iter_linkable_page_documents", inventory)
    monkeypatch.setattr(records.exporter, "notes", lambda *_: pytest.fail("menu must not export/hash full vault bodies"))
    prior = active_vault_path.get()
    by_page = records.destinations(website.store, page_id="one")
    by_table = records.destinations(website.store, table_id="articles")
    assert [item.site_id for item in by_page] == [website.site.id]
    assert by_page == by_table
    assert seen == [website.vault, website.vault]
    assert active_vault_path.get() == prior
