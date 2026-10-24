"""Website projection and durable publication behavior with disposable vaults."""
from __future__ import annotations

import json
import shutil
import shlex
import subprocess
import sqlite3
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.domains.sites import api, exporter, local_artifacts, publication, recovery, runtime
from backend.domains.sites.models import (
    FormDeliverySettings, ServiceSettings, SiteBlock, SiteConfig, SitePage, SitePublishRequest,
    SiteSource, SourceFilter, TargetConnection,
)
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


@pytest.fixture
def website(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    (vault / "BD" / "Articles").mkdir(parents=True)
    data = {"databases": [], "tables": [{"id": "articles", "name": "Articles", "folder": "Articles", "properties": [
        {"id": "public-summary", "name": "Summary", "type": "text"},
        {"id": "private-note", "name": "Private", "type": "text"},
        {"id": "status", "name": "Status", "type": "text"},
    ]}], "views": [{"id": "published", "name": "Published", "table_id": "articles", "filters": [{"field": "status", "operator": "equals", "value": "published"}]}]}
    (vault / "BD" / "vault_db_registry.json").write_text(json.dumps(data))
    (vault / "BD" / "Articles" / "one.md").write_text("---\nid: one\ntable_id: articles\ntitle: First article\nIdioma: ca\nSummary: Public introduction\nPrivate: NEVER-PUBLISH-PRIVATE\nStatus: published\n---\nPublic body\n")
    (vault / "BD" / "Articles" / "two.md").write_text("---\nid: two\ntable_id: articles\ntitle: Draft\nStatus: draft\n---\nNEVER-PUBLISH-DRAFT\n")
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "device"))
    context = WorkspaceContext("workspace", "operator", "owner", vault)
    monkeypatch.setattr(recovery, "authorized_context", lambda workspace_id, vault_path, user_id: context if workspace_id == context.workspace_id and vault_path == vault and user_id == context.user_id else None)
    store = SiteStore(context)
    site = SiteConfig(name="Example", pages=[SitePage(title="Home", path="/ca", enabled=True, blocks=[SiteBlock(title="Welcome")])])
    site.targets[0].enabled = True
    site.sources = [SiteSource(id="selected", kind="view", source_id="published", enabled=True, field_ids=["public-summary"], include_body=True)]
    site = store.save(site, create=True)
    return SimpleNamespace(store=store, site=site, context=context, vault=vault)


def test_projection_filters_saved_view_and_excludes_private_fields(website):
    bundle = exporter.build_bundle(website.store, website.site, "local")
    assert [r.id for r in bundle.records] == ["one"]
    record = bundle.records[0]
    assert record.fields == {"public-summary": "Public introduction"}
    assert "Public body" in record.body_html
    payload = bundle.model_dump_json()
    assert "NEVER-PUBLISH" not in payload
    assert "Private" not in payload


def test_only_selected_stable_field_ids_receive_public_friendly_labels(website):
    stable_id = "e52aa460-7ec7-4c4e-8050-f5906dbe3a5d"
    path = website.vault / "BD/vault_db_registry.json"
    data = json.loads(path.read_text())
    data["tables"][0]["properties"][0] = {"id": stable_id, "name": "Public introduction", "type": "text"}
    data["tables"][0]["properties"][1]["name"] = "DO-NOT-PUBLISH-PRIVATE-COLUMN-NAME"
    path.write_text(json.dumps(data))
    note = website.vault / "BD/Articles/one.md"
    note.write_text(note.read_text().replace("Summary: Public introduction", "Public introduction: Selected field value"))
    website.site.sources[0].field_ids = [stable_id]
    bundle = exporter.build_bundle(website.store, website.site, "local")
    assert bundle.records[0].fields == {stable_id: "Selected field value"}
    assert bundle.records[0].field_labels == {stable_id: "Public introduction"}
    assert "DO-NOT-PUBLISH-PRIVATE-COLUMN-NAME" not in bundle.model_dump_json()
    assert "NEVER-PUBLISH-PRIVATE" not in bundle.model_dump_json()


@pytest.mark.parametrize("legacy", [False, True])
def test_native_page_translation_metadata_publishes_selected_languages_and_one_group(website, monkeypatch, legacy):
    import yaml
    from backend.domains.vault.translation.page_service import _translation_metadata
    original_id = "123e4567-e89b-12d3-a456-426614174000"
    public_origin = "abcde123-4567-4000-8000-000000000001" if legacy else original_id
    identifiers = [original_id, "translated-es", "translated-en", "unselected-fr"]
    metadata = [{"id": original_id, "title": "Original", "Private": "NEVER-PUBLISH-NATIVE-SECRET", "web_path": "/ca/original-stable"}]
    if legacy:
        metadata[0]["drupal_uuid"] = public_origin
    for identifier, lang in zip(identifiers[1:], ("es", "en", "fr")):
        native = _translation_metadata(original_id.replace("-", "").upper(), "ca", lang, {"noop"})
        metadata.append({"id": identifier, "title": "Translated " + lang, "Private": "NEVER-PUBLISH-NATIVE-SECRET", **native})
    metadata[1]["web_path"] = "/es/traduccion-estable"
    metadata[2]["drupal_path"] = "/en-gb/retained-english-url"
    for item in metadata:
        (website.vault / (str(item["id"]) + ".md")).write_text("---\n" + yaml.safe_dump(item, allow_unicode=True) + "---\nPublic translated body\n")
    site = website.site.model_copy(deep=True)
    site.legacy_pilot = legacy
    if legacy:
        from backend.domains.sites.models import identifier
        site.id = identifier()
    site.sources = [SiteSource(id="source-" + str(index), kind="page", source_id=identifier, enabled=True, include_body=True) for index, identifier in enumerate(identifiers[:3])]
    if legacy:
        from backend.domains.sites.storage import private_json
        private_json(website.store.site_dir(site.id) / "imported/baseline.json", {"data": {"nodes": []}, "assets": [], "type_map": {}})
    site = website.store.save(site, create=legacy)
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    monkeypatch.setattr(runtime, "render_bundle", lambda bundle, output: (output / "index.html").write_text("Synthetic native translation publication"))
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    monkeypatch.setattr(publication, "require_activation_access", lambda *args: None)
    monkeypatch.setattr("backend.domains.sites.private_service.invoke", lambda *args, **kwargs: {})
    preview = publication.preview(website.store, site, "local")
    job = publication.enqueue(website.store, site, SitePublishRequest(preview_id=preview.id))
    publication._run(website.store, job)
    assert job.status == "completed"
    bundle = website.store.active_bundle(site.id, "local")
    records = {record["language"]: record for record in bundle["records"]}
    assert set(records) == {"ca", "es", "en-gb"}
    assert {record["translation_id"] for record in records.values()} == {public_origin}
    assert records["ca"]["path"] == "/ca/original-stable"
    assert records["es"]["path"] == "/es/traduccion-estable"
    assert records["en-gb"]["path"] == "/en-gb/retained-english-url"
    assert "NEVER-PUBLISH-NATIVE-SECRET" not in json.dumps(bundle)
    assert "unselected-fr" not in json.dumps(bundle)
    metadata[2]["title"] = "Renamed English translation"
    (website.vault / "translated-en.md").write_text("---\n" + yaml.safe_dump(metadata[2]) + "---\nUpdated public body\n")
    renamed = exporter.build_bundle(website.store, site, "local")
    assert next(record.path for record in renamed.records if record.language == "en-gb") == "/en-gb/retained-english-url"


@pytest.mark.parametrize("language_field,value,languages,expected", [
    ("translation_lang", "en", ["ca", "en-gb"], "en-gb"),
    ("translation_lang", "EN_GB", ["ca", "en-gb", "en-us"], "en-gb"),
    ("Idioma", ["Anglès"], ["ca", "en-gb"], "en-gb"),
    ("Idioma", ["Español"], ["ca", "es", "en-gb"], "es"),
    ("language", "EN-GB", ["ca", "en-gb", "en-us"], "en-gb"),
    ("translation_lang", "en", ["ca", "en", "en-gb", "en-us"], "en"),
    ("translation_lang", "en", ["ca", "en-gb", "en-us"], None),
    ("translation_lang", "en-us", ["ca", "en-gb"], None),
    ("translation_lang", "fr", ["ca", "es", "en-gb"], None),
    ("Idioma", "not a language", ["ca", "es", "en-gb"], None),
])
def test_content_language_preserves_regions_and_never_guesses_ambiguously(website, language_field, value, languages, expected):
    import yaml
    metadata = {"id": "language-record", "title": "Language case", language_field: value}
    (website.vault / "language-record.md").write_text("---\n" + yaml.safe_dump(metadata, allow_unicode=True) + "---\nBody\n")
    site = website.site.model_copy(deep=True)
    site.languages = languages
    site.sources = [SiteSource(id="language-source", kind="page", source_id="language-record", enabled=True)]
    if expected is None:
        with pytest.raises(HTTPException) as error:
            exporter.build_bundle(website.store, site, "local")
        assert error.value.status_code == 422
    else:
        record = exporter.build_bundle(website.store, site, "local").records[0]
        assert record.language == expected
        assert record.path.startswith("/" + expected + "/")


@pytest.mark.parametrize("explicit,source_languages,expected", [
    (None, ["en"], "en-gb"),
    (None, ["ca", "Català"], "ca"),
    (["Català"], ["en"], "ca"),
    (None, ["ca", "en"], None),
])
def test_native_translation_source_language_only_fills_an_implicit_original(website, explicit, source_languages, expected):
    import yaml
    from backend.domains.vault.translation.page_service import _translation_metadata
    original = {"id": "automatic-original", "title": "Automatic language source"}
    if explicit:
        original["Idioma"] = explicit
    (website.vault / "automatic-original.md").write_text("---\n" + yaml.safe_dump(original, allow_unicode=True) + "---\nSelected original body\n")
    for index, language in enumerate(source_languages):
        metadata = {"id": "unselected-native-" + str(index), "title": "Private unselected translation", **_translation_metadata("automatic-original", language, "es", {"noop"})}
        (website.vault / (metadata["id"] + ".md")).write_text("---\n" + yaml.safe_dump(metadata) + "---\nNEVER-EXPOSE-UNSELECTED-TRANSLATION\n")
    site = website.site.model_copy(deep=True)
    site.sources = [SiteSource(id="original-source", kind="page", source_id="automatic-original", enabled=True, include_body=True)]
    if expected is None:
        with pytest.raises(HTTPException) as error:
            exporter.build_bundle(website.store, site, "local")
        assert error.value.status_code == 422
    else:
        bundle = exporter.build_bundle(website.store, site, "local")
        assert [(record.id, record.language) for record in bundle.records] == [("automatic-original", expected)]
        assert "NEVER-EXPOSE-UNSELECTED-TRANSLATION" not in bundle.model_dump_json()


def test_native_selected_child_uses_original_identity_without_publishing_original_or_parent_relations(website):
    import yaml
    from backend.domains.vault.translation.page_service import _translation_metadata
    original = {"id": "native-origin", "title": "Unselected original", "Idioma": "Català", "Private": "NEVER-EXPOSE-ORIGIN-SECRET"}
    child = {"id": "selected-native", "title": "Selected child", "Idioma": "Català", **_translation_metadata("native-origin", "ca", "es", {"noop"})}
    related = {"id": "related-page", "title": "Ordinary subpage", "parent_id": "native-origin", "Idioma": "es"}
    for metadata in (original, child, related):
        (website.vault / (metadata["id"] + ".md")).write_text("---\n" + yaml.safe_dump(metadata, allow_unicode=True) + "---\nBody of " + metadata["id"] + "\n")
    site = website.site.model_copy(deep=True)
    site.sources = [SiteSource(id=identity, kind="page", source_id=identity, enabled=True, include_body=True) for identity in ("selected-native", "related-page")]
    bundle = exporter.build_bundle(website.store, site, "local")
    records = {record.id: record for record in bundle.records}
    assert set(records) == {"selected-native", "related-page"}
    assert records["selected-native"].language == "es"
    assert records["selected-native"].translation_id == "native-origin"
    assert records["related-page"].translation_id == "related-page"
    assert "NEVER-EXPOSE-ORIGIN-SECRET" not in bundle.model_dump_json()
    assert "Body of native-origin" not in bundle.model_dump_json()


def test_native_translation_origin_chains_are_stable_and_missing_or_cyclic_origins_fail(website):
    import yaml
    from backend.domains.vault.translation.page_service import _translation_metadata
    records = [
        {"id": "origin", "title": "Origin", "Idioma": "ca"},
        {"id": "spanish", "title": "Spanish", **_translation_metadata("origin", "ca", "es", {"noop"})},
        {"id": "english", "title": "English", **_translation_metadata("spanish", "es", "en", {"noop"})},
    ]
    def save(metadata):
        (website.vault / (metadata["id"] + ".md")).write_text("---\n" + yaml.safe_dump(metadata) + "---\nBody\n")
    for metadata in records:
        save(metadata)
    site = website.site.model_copy(deep=True)
    site.sources = [SiteSource(id="english-source", kind="page", source_id="english", enabled=True)]
    record = exporter.build_bundle(website.store, site, "local").records[0]
    assert (record.language, record.translation_id) == ("en-gb", "origin")
    for origin in ("unavailable-one-drive-origin", "english"):
        records[1]["translation_origin_id"] = origin
        save(records[1])
        with pytest.raises(HTTPException) as error:
            exporter.build_bundle(website.store, site, "local")
        assert error.value.status_code == 409


@pytest.mark.parametrize("private_language,retained", [("fr", {"ca", "en-gb"}), ("en", {"ca"})])
def test_native_private_translation_flags_preserve_other_imported_languages(website, private_language, retained):
    import yaml
    from backend.domains.sites.models import identifier
    from backend.domains.sites.storage import private_json
    public_identity = "abcdefgh-1234-4321-8765-000000000001"
    metadata = {"id": "private-translation", "title": "Private translated note", "Status": "private", "drupal_uuid": public_identity, "translation_lang": private_language}
    (website.vault / "private-translation.md").write_text("---\n" + yaml.safe_dump(metadata) + "---\nNEVER-PUBLISH-PRIVATE-TRANSLATION\n")
    unrelated = {"id": "unrelated-private", "title": "Internal unrelated page", "Status": "private"}
    hint = {"id": "unselected-french-hint", "translation_origin_id": "unrelated-private", "translation_lang": "es", "translation_source_lang": "fr"}
    for item in (unrelated, hint):
        (website.vault / (item["id"] + ".md")).write_text("---\n" + yaml.safe_dump(item) + "---\nNEVER-PUBLISH-UNRELATED-PAGE\n")
    site = website.site.model_copy(deep=True)
    site.id = identifier()
    site.legacy_pilot = True
    site.sources = [SiteSource(id="baseline-pages", kind="page", source_id="imported:pages", enabled=True, include_body=True)]
    site = website.store.save(site, create=True)
    nodes = [{"uuid": public_identity, "lang": lang, "url": "/" + lang + "/public-entry", "title": "Baseline " + lang, "type": "page", "body_html": "Public baseline body"} for lang in ("ca", "en-gb")]
    private_json(website.store.site_dir(site.id) / "imported/baseline.json", {"data": {"nodes": nodes}, "assets": [], "type_map": {}})
    bundle = exporter.build_bundle(website.store, site, "local")
    assert {record.language for record in bundle.records} == retained
    assert "NEVER-PUBLISH-PRIVATE-TRANSLATION" not in bundle.model_dump_json()
    assert "NEVER-PUBLISH-UNRELATED-PAGE" not in bundle.model_dump_json()


def test_shared_content_is_single_identity_and_source_removal_preserves_other(website):
    site = website.site
    site.sources.append(site.sources[0].model_copy(update={"id": "also-selected"}))
    bundle = exporter.build_bundle(website.store, site, "local")
    assert len(bundle.records) == 1
    assert bundle.records[0].source_ids == ["selected", "also-selected"]
    site.sources[0].enabled = False
    assert exporter.build_bundle(website.store, site, "local").records[0].source_ids == ["also-selected"]
    assert (website.vault / "BD" / "Articles" / "one.md").is_file()


def test_empty_explicit_selection_never_falls_back_to_entire_table(website):
    website.site.sources[0].selection_mode = "selected"
    website.site.sources[0].page_ids = []
    assert exporter.build_bundle(website.store, website.site, "local").records == []


def test_saved_view_multifield_numeric_order_and_explicit_override(website):
    registry_path = website.vault / "BD/vault_db_registry.json"
    registry = json.loads(registry_path.read_text())
    registry["tables"][0]["properties"].append({"id": "score-id", "name": "Score", "type": "number"})
    registry["views"][0]["sorts"] = [{"field": "score-id", "direction": "asc"}, {"field": "title", "direction": "asc"}]
    registry["views"][0]["sort"] = {"field": "score-id", "direction": "desc"}
    registry_path.write_text(json.dumps(registry))
    for identity, title, score in (("a", "Zebra", "2"), ("b", "Àngel", "2"), ("c", "Ten", "10"), ("d", "Missing", "null")):
        (website.vault / "BD/Articles" / (identity + ".md")).write_text(f"---\nid: {identity}\ntable_id: articles\ntitle: {title}\nIdioma: ca\nStatus: published\nScore: {score}\n---\nBody\n")
    source = website.site.sources[0]
    source.page_ids = ["a", "b", "c", "d"]
    bundle = exporter.build_bundle(website.store, website.site, "local")
    assert [record.id for record in bundle.records] == ["b", "a", "c", "d"]
    assert [record.source_order[source.id] for record in bundle.records] == [0, 1, 2, 3]
    source.sort_field_id = "score-id"
    source.sort_descending = True
    assert [record.id for record in exporter.build_bundle(website.store, website.site, "local").records] == ["c", "a", "b", "d"]
    source.sort_field_id = None
    registry["views"][0]["sorts"] = [{"field": "missing-field", "direction": "asc"}]
    registry_path.write_text(json.dumps(registry))
    with pytest.raises(HTTPException) as error:
        exporter.build_bundle(website.store, website.site, "local")
    assert error.value.status_code == 422


def test_server_stop_requires_target_scoped_argv_and_pid_creation_identity(website, monkeypatch):
    import psutil
    from backend.domains.sites.storage import private_json
    monkeypatch.setattr(runtime.shutil, "which", lambda command: "/test/php")
    output = website.store.site_dir(website.site.id) / "active/local"
    server_state = website.store.site_dir(website.site.id) / "servers/local/server.json"
    argv = ["/test/php", "-S", "127.0.0.1:4321", "-t", str(output), str(runtime.SERVICE_ROOT.parent / "public/router.php")]
    terminated = []
    class Process:
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
    monkeypatch.setattr(runtime.psutil, "Process", Process)
    state = {"pid": 1234, "port": 4321, "started_at": 123.0, "argv": argv, "output": str(output)}
    private_json(server_state, state)
    assert runtime.server_status(website.store, website.site, "local").running is True
    other = website.store.save(SiteConfig(name="Other website"), create=True)
    copied = website.store.site_dir(other.id) / "servers/local/server.json"
    private_json(copied, state)
    assert runtime.stop_server(website.store, other, "local").running is False
    assert terminated == []
    state["started_at"] = 122.0
    private_json(server_state, state)
    assert runtime.stop_server(website.store, website.site, "local").running is False
    assert terminated == []
    state["started_at"] = 123.0
    private_json(server_state, state)
    assert runtime.stop_server(website.store, website.site, "local").running is False
    assert terminated == [1234]


def test_startup_recovery_reauthorizes_queued_job_without_status_visit(website, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    monkeypatch.setattr(runtime, "render_bundle", lambda bundle, output: (output / "index.html").write_text("<p>Public</p>"))
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    reviewed = publication.preview(website.store, website.site, "local")
    queued = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=reviewed.id))
    resumed = []
    monkeypatch.setattr(publication, "dispatch", lambda store, job: resumed.append(job.id))
    monkeypatch.setattr(recovery, "plugins_enabled_now", lambda *args, **kwargs: True)
    result = recovery.recover_queued_jobs()
    assert result["resumed"] == 1
    assert resumed == [queued.id]
    monkeypatch.setattr(recovery, "authorized_context", lambda *args: None)
    resumed.clear()
    result = recovery.recover_queued_jobs()
    assert result["skipped"] == 1
    assert resumed == []


@pytest.mark.parametrize("revocation", ["during_wait", "during_build", "plugin_during_build"])
def test_delayed_publication_rechecks_access_at_activation(website, monkeypatch, revocation):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    revoked = [False]
    plugin_enabled = [True]
    def render(bundle, output):
        output.mkdir(parents=True, exist_ok=True)
        (output / "index.html").write_text("<p>Reviewed</p>")
    monkeypatch.setattr(runtime, "render_bundle", render)
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    monkeypatch.setattr(publication, "plugins_enabled_now", lambda *args, **kwargs: plugin_enabled[0])
    monkeypatch.setattr(recovery, "authorized_context", lambda *args: None if revoked[0] else website.context)
    reviewed = publication.preview(website.store, website.site, "local")
    due = datetime.now(timezone.utc) + timedelta(seconds=10)
    request = SitePublishRequest(preview_id=reviewed.id, scheduled_at=due.isoformat() if revocation == "during_wait" else None)
    queued = publication.enqueue(website.store, website.site, request)
    if revocation == "during_wait":
        clock = [due.timestamp() - 10]
        monkeypatch.setattr(publication.time, "time", lambda: clock[0])
        def change_access(delay):
            revoked[0] = True
            clock[0] = due.timestamp() + 1
        monkeypatch.setattr(publication.time, "sleep", change_access)
    else:
        def build_then_revoke(bundle, output):
            render(bundle, output)
            if revocation == "during_build":
                revoked[0] = True
            else:
                plugin_enabled[0] = False
        monkeypatch.setattr(runtime, "render_bundle", build_then_revoke)
    publication._run(website.store, queued)
    assert queued.status == "failed"
    assert website.store.active_bundle(website.site.id, "local") is None


def test_direct_page_status_and_explicit_missing_selections_fail_closed(website):
    website.site.sources = [SiteSource(id="direct", kind="page", source_id="two", enabled=True, include_body=True)]
    assert exporter.build_bundle(website.store, website.site, "local").records == []
    website.site.sources = [SiteSource(id="selected", kind="view", source_id="published", enabled=True, selection_mode="selected", page_ids=["one", "unavailable-onedrive-record"])]
    with pytest.raises(HTTPException) as error:
        exporter.build_bundle(website.store, website.site, "local")
    assert error.value.status_code == 409
    assert not list(website.store.site_dir(website.site.id).glob("releases/*"))


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
def test_remote_occupied_current_path_cannot_be_reported_as_activation_or_reversion(website, tmp_path, monkeypatch):
    from backend.domains.sites.models import SiteTarget
    remote = tmp_path / "account/public_html/_gnosi-test"
    target = SiteTarget(id="remote", adapter="ssh", environment="staging", base_url="https://example.invalid/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    runtime.save_connection(website.store, site.id, "remote", TargetConnection(host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent)))
    return_codes = []
    def local_ssh(settings, command, payload=None, timeout=45):
        if '$daemon=gnosi_service_script("daemon.php")' in command:
            return b'{"started":true}'
        if "$current=gnosi_current()" in command:
            (remote / "current").mkdir(exist_ok=True)
            (remote / "current/unrelated.txt").write_text("Preserve unrelated content")
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout, check=False)
        return_codes.append(result.returncode)
        if result.returncode:
            raise HTTPException(503, "Remote command failed")
        return result.stdout
    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    output = tmp_path / "build"
    output.mkdir()
    (output / "index.html").write_text("<p>Public</p>")
    with pytest.raises(HTTPException):
        runtime.upload_release(website.store, site, target, "release-one", output, None)
    assert return_codes[-1] != 0
    assert not (remote / "current").is_symlink()
    with pytest.raises(HTTPException):
        runtime.restore_remote_release(website.store, site, target, "release-one", None)
    assert return_codes[-1] != 0
    assert (remote / "current/unrelated.txt").read_text() == "Preserve unrelated content"


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
@pytest.mark.parametrize("pointer", ["foreign", "absolute-owned", "noncanonical", "loop", "release-symlink", "wrong-owner", "canonical"])
def test_remote_recovery_verifies_exact_owned_pointer_before_hashes(website, tmp_path, monkeypatch, pointer):
    import hashlib
    from backend.domains.sites.models import SiteTarget
    remote = tmp_path / "account/public_html/_gnosi-test"
    remote.mkdir(parents=True)
    target = SiteTarget(id="remote", adapter="ssh", environment="staging", base_url="https://example.invalid/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    settings = TargetConnection(host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent))
    runtime.save_connection(website.store, site.id, target.id, settings)
    private = Path(runtime.remote_private_root(website.store, site.id, settings))
    (private / "manifests").mkdir(parents=True)
    owner = json.dumps({"site_id": site.id, "scope": website.store.private_root.name}, sort_keys=True)
    (remote / ".gnosi-sites-owner").write_text(owner)
    (private / ".gnosi-sites-owner").write_text(owner)
    owned = remote / "releases/release-one"
    owned.mkdir(parents=True)
    (owned / "index.html").write_text("Reviewed website")
    (private / "manifests/release-one.json").write_text(json.dumps({"index.html": hashlib.sha256((owned / "index.html").read_bytes()).hexdigest()}))
    foreign = tmp_path / "unrelated/release-one"
    foreign.mkdir(parents=True)
    # Identical bytes cannot authorize a pointer outside the owned release tree.
    (foreign / "index.html").write_text("Reviewed website")
    link = "releases/release-one"
    if pointer == "foreign":
        link = str(foreign)
    elif pointer == "absolute-owned":
        link = str(owned)
    elif pointer == "noncanonical":
        link = "releases/../releases/release-one"
    elif pointer == "loop":
        link = "current"
    elif pointer == "release-symlink":
        shutil.rmtree(owned)
        owned.symlink_to(foreign)
    elif pointer == "wrong-owner":
        (private / ".gnosi-sites-owner").write_text("Another site")
    (remote / "current").symlink_to(link)
    def local_ssh(settings, command, payload=None, timeout=45):
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout, check=False)
        if result.returncode:
            raise HTTPException(503, "Remote verification rejected")
        return result.stdout
    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    if pointer == "canonical":
        assert runtime.active_release(website.store, site, target) == "release-one"
    else:
        with pytest.raises(HTTPException):
            runtime.active_release(website.store, site, target)


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
@pytest.mark.parametrize("operation", ["upload", "activate", "restore", "reconcile"])
@pytest.mark.parametrize("hostile", [
    "canonical", "public-root-link", "private-root-link", "releases-link", "release-link",
    "file-link", "file-parent-link", "manifests-link", "manifest-link", "owner-link",
    "wrong-owner", "absolute-pointer", "foreign-pointer", "looping-pointer", "unlisted-link", "unlisted-file",
])
def test_all_ssh_release_operations_share_namespace_policy(website, tmp_path, monkeypatch, operation, hostile):
    import hashlib
    from backend.domains.sites.models import SiteTarget
    remote = tmp_path / "account/public_html/_gnosi-test"
    remote.mkdir(parents=True)
    target = SiteTarget(id="remote", adapter="ssh", environment="staging", base_url="https://example.invalid/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    settings = TargetConnection(host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent))
    runtime.save_connection(website.store, site.id, target.id, settings)
    private = Path(runtime.remote_private_root(website.store, site.id, settings))
    (private / "manifests").mkdir(parents=True)
    owner = json.dumps({"site_id": site.id, "scope": website.store.private_root.name}, sort_keys=True)
    for directory in (remote, private):
        (directory / ".gnosi-sites-owner").write_text(owner)
    active = remote / "releases/active"
    active.mkdir(parents=True)
    (active / "index.html").write_text("Previous reviewed version")
    (private / "manifests/active.json").write_text(json.dumps({"index.html": hashlib.sha256((active / "index.html").read_bytes()).hexdigest()}))
    candidate = remote / "releases/candidate"
    output = tmp_path / "build"
    (output / "assets").mkdir(parents=True)
    (output / "index.html").write_text("Next reviewed version")
    (output / "assets/picture.txt").write_text("Reviewed asset")
    if operation != "upload":
        shutil.copytree(output, candidate)
        checks = {str(path.relative_to(output)): hashlib.sha256(path.read_bytes()).hexdigest() for path in output.rglob("*") if path.is_file()}
        (private / "manifests/candidate.json").write_text(json.dumps(checks))
    (remote / "current").symlink_to("releases/candidate" if operation == "reconcile" else "releases/active")
    foreign = tmp_path / "unrelated"
    foreign.mkdir()
    (foreign / "sentinel.txt").write_text("Unrelated files must remain unchanged")
    mutated = False
    pointer_before = None
    def mutate():
        nonlocal mutated, pointer_before
        if mutated:
            return
        mutated = True
        if hostile == "public-root-link":
            remote.rename(foreign / "public")
            remote.symlink_to(foreign / "public")
        elif hostile == "private-root-link":
            private.rename(foreign / "private")
            private.symlink_to(foreign / "private")
        elif hostile == "releases-link":
            (remote / "releases").rename(foreign / "releases")
            (remote / "releases").symlink_to(foreign / "releases")
        elif hostile == "release-link":
            candidate.rename(foreign / "candidate")
            candidate.symlink_to(foreign / "candidate")
        elif hostile == "file-link":
            (candidate / "index.html").rename(foreign / "index.html")
            (candidate / "index.html").symlink_to(foreign / "index.html")
        elif hostile == "file-parent-link":
            (candidate / "assets").rename(foreign / "assets")
            (candidate / "assets").symlink_to(foreign / "assets")
        elif hostile == "unlisted-link":
            (candidate / "unreviewed").symlink_to(foreign)
        elif hostile == "unlisted-file":
            (candidate / "unreviewed.php").write_text("Unreviewed public file")
        elif hostile == "manifests-link":
            (private / "manifests").rename(foreign / "manifests")
            (private / "manifests").symlink_to(foreign / "manifests")
        elif hostile == "manifest-link":
            (private / "manifests/candidate.json").rename(foreign / "manifest.json")
            (private / "manifests/candidate.json").symlink_to(foreign / "manifest.json")
        elif hostile == "owner-link":
            (private / ".gnosi-sites-owner").rename(foreign / "owner")
            (private / ".gnosi-sites-owner").symlink_to(foreign / "owner")
        elif hostile == "wrong-owner":
            (private / ".gnosi-sites-owner").write_text("A different site")
        elif hostile in {"absolute-pointer", "foreign-pointer", "looping-pointer"}:
            (remote / "current").unlink()
            link = str(candidate) if hostile == "absolute-pointer" else str(foreign / "candidate") if hostile == "foreign-pointer" else "current"
            (remote / "current").symlink_to(link)
        pointer_before = (remote / "current").readlink()
    def local_ssh(settings, command, payload=None, timeout=45):
        if '$daemon=gnosi_service_script("daemon.php")' in command:
            return b'{"started":true}'
        # For upload, sabotage only after the complete new release and manifest
        # exist, so the same filesystem matrix exercises the final atomic gate.
        if operation == "upload" and "$current=gnosi_current()" in command:
            mutate()
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout, check=False)
        if result.returncode:
            raise HTTPException(503, "Rejected unsafe namespace")
        return result.stdout
    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    if operation != "upload":
        mutate()
    def invoke():
        if operation == "upload":
            return runtime.upload_release(website.store, site, target, "candidate", output, "active")
        if operation == "restore":
            return runtime.restore_remote_release(website.store, site, target, "candidate", "active")
        if operation == "reconcile":
            return runtime.active_release(website.store, site, target)
        code = runtime.activation_program(str(remote), str(private), "candidate", "active", verify_manifest=True, ownership=owner, document_root=str(remote.parent))
        return local_ssh(settings, "php -r " + shlex.quote(code))
    if hostile == "canonical":
        invoke()
        assert (remote / "current").readlink() == Path("releases/candidate")
    else:
        with pytest.raises(HTTPException):
            invoke()
        assert mutated
        assert (remote / "current").readlink() == pointer_before
    assert (foreign / "sentinel.txt").read_text() == "Unrelated files must remain unchanged"


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
@pytest.mark.parametrize("linked", ["public", "private", "releases", "manifests"])
def test_ssh_upload_rejects_preexisting_namespace_links_before_writing(website, tmp_path, monkeypatch, linked):
    from backend.domains.sites.models import SiteTarget
    remote = tmp_path / "account/public_html/_gnosi-test"
    (remote / "releases").mkdir(parents=True)
    target = SiteTarget(id="remote", adapter="ssh", environment="staging", base_url="https://example.invalid/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    settings = TargetConnection(host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent))
    runtime.save_connection(website.store, site.id, target.id, settings)
    private = Path(runtime.remote_private_root(website.store, site.id, settings))
    (private / "manifests").mkdir(parents=True)
    owner = json.dumps({"site_id": site.id, "scope": website.store.private_root.name}, sort_keys=True)
    for directory in (remote, private):
        (directory / ".gnosi-sites-owner").write_text(owner)
    selected = {"public": remote, "private": private, "releases": remote / "releases", "manifests": private / "manifests"}[linked]
    foreign = tmp_path / "unrelated"
    selected.rename(foreign)
    selected.symlink_to(foreign)
    (foreign / "sentinel.txt").write_text("Do not modify")
    before = {str(path.relative_to(foreign)): path.read_bytes() for path in foreign.rglob("*") if path.is_file()}
    def local_ssh(settings, command, payload=None, timeout=45):
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout, check=False)
        if result.returncode:
            raise HTTPException(503, "Rejected unsafe namespace")
        return result.stdout
    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    output = tmp_path / "build"
    output.mkdir()
    (output / "index.html").write_text("Reviewed version")
    with pytest.raises(HTTPException):
        runtime.upload_release(website.store, site, target, "candidate", output, None)
    assert not (remote / "current").is_symlink()
    assert not (remote / "releases/candidate").exists()
    assert before == {str(path.relative_to(foreign)): path.read_bytes() for path in foreign.rglob("*") if path.is_file()}


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
@pytest.mark.parametrize("operation", ["settings", "worker", "cli"])
@pytest.mark.parametrize("hostile", [
    "canonical", "public-link", "private-link", "owner-link", "wrong-owner", "manifest-parent-link",
    "config-link", "pending-link", "log-link", "cli-link", "daemon-link", "library-link",
    "database-link", "wal-link", "spool-link", "spool-file-link", "escaped-config", "real-delivery-config", "log-hardlink",
])
def test_remote_service_operations_keep_files_inside_owned_private_namespace(website, tmp_path, monkeypatch, operation, hostile):
    from backend.domains.sites.models import SiteTarget
    remote = tmp_path / "account/public_html/_gnosi-test"
    (remote / "releases/active").mkdir(parents=True)
    (remote / "current").symlink_to("releases/active")
    target = SiteTarget(id="remote", adapter="ssh", environment="staging", base_url="https://example.invalid/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    settings = TargetConnection(host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent))
    runtime.save_connection(website.store, site.id, target.id, settings)
    private = Path(runtime.remote_private_root(website.store, site.id, settings))
    (private / "manifests").mkdir(parents=True)
    (private / "captures").mkdir()
    owner = json.dumps({"site_id": site.id, "scope": website.store.private_root.name}, sort_keys=True)
    for directory in (remote, private):
        (directory / ".gnosi-sites-owner").write_text(owner)
    config = {"site_id": site.id, "test_mode": True, "db_path": str(private / "state.sqlite"), "spool_path": str(private / "captures"), "library_path": str(private / "library.php")}
    (private / "config.json").write_text(json.dumps(config))
    (private / "library.php").write_text("<?php // Disposable owned library\n")
    (private / "cli.php").write_text('<?php echo json_encode(["test_mode"=>true,"ok"=>true]);')
    (private / "daemon.php").write_text('<?php echo "owned worker executed\\n";')
    (private / "worker.log").write_text("Previous worker log\n")
    (private / "state.sqlite").write_text("Synthetic private database")
    (private / "captures/message.json").write_text("Synthetic private message")
    foreign = tmp_path / "unrelated"
    foreign.mkdir()
    (foreign / "sentinel.txt").write_text("Preserve unrelated content")
    names = {"config-link": "config.json", "pending-link": "config.pending.json", "log-link": "worker.log", "cli-link": "cli.php", "daemon-link": "daemon.php", "library-link": "library.php", "database-link": "state.sqlite", "wal-link": "state.sqlite-wal", "spool-file-link": "captures/message.json"}
    if hostile in names:
        path = private / names[hostile]
        copy = foreign / path.name
        if path.exists():
            path.rename(copy)
        else:
            copy.write_text("Preserve unrelated pending state")
        path.symlink_to(copy)
    elif hostile in {"public-link", "private-link", "manifest-parent-link", "spool-link"}:
        path = {"public-link": remote, "private-link": private, "manifest-parent-link": private / "manifests", "spool-link": private / "captures"}[hostile]
        copy = foreign / path.name
        path.rename(copy)
        path.symlink_to(copy)
    elif hostile == "owner-link":
        (private / ".gnosi-sites-owner").rename(foreign / "owner")
        (private / ".gnosi-sites-owner").symlink_to(foreign / "owner")
    elif hostile == "wrong-owner":
        (private / ".gnosi-sites-owner").write_text("Another site owns this service")
    elif hostile == "escaped-config":
        config["db_path"] = str(foreign / "sentinel.txt")
        (private / "config.json").write_text(json.dumps(config))
    elif hostile == "real-delivery-config":
        config.update({"test_mode": False, "allow_delivery": True})
        (private / "config.json").write_text(json.dumps(config))
    elif hostile == "log-hardlink":
        (foreign / "worker.log").hardlink_to(private / "worker.log")
    before = {str(path.relative_to(foreign)): path.read_bytes() for path in foreign.rglob("*") if path.is_file()}
    pointer = (remote / "current").readlink()
    def local_ssh(settings, command, payload=None, timeout=45):
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout, check=False)
        if result.returncode:
            raise HTTPException(503, "Unsafe private service namespace")
        return result.stdout
    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    def invoke():
        if operation == "settings":
            return runtime.sync_service_settings(website.store, site, target, site)
        if operation == "worker":
            return runtime.start_remote_worker(website.store, site, target)
        result = runtime.remote_service(website.store, site, target.id, "status", {})
        assert result["ok"] is True
    # A new reviewed configuration can repair plain configuration values; an
    # unused log link is never opened by a settings write.
    safe = hostile == "canonical" or operation == "settings" and hostile in {"log-link", "log-hardlink", "escaped-config", "real-delivery-config"}
    if safe:
        invoke()
    else:
        with pytest.raises(HTTPException):
            invoke()
    assert (remote / "current").readlink() == pointer
    assert before == {str(path.relative_to(foreign)): path.read_bytes() for path in foreign.rglob("*") if path.is_file()}


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
def test_failed_worker_start_preserves_activated_website_and_visible_pending_job(website, tmp_path, monkeypatch):
    from backend.domains.sites.models import SiteTarget
    remote = tmp_path / "account/public_html/_gnosi-test"
    remote.mkdir(parents=True)
    target = SiteTarget(id="remote", adapter="ssh", environment="staging", base_url="https://example.invalid/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    settings = TargetConnection(host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent))
    runtime.save_connection(website.store, site.id, target.id, settings)
    private = Path(runtime.remote_private_root(website.store, site.id, settings))
    private.mkdir(parents=True)
    owner = json.dumps({"site_id": site.id, "scope": website.store.private_root.name}, sort_keys=True)
    for directory in (remote, private):
        (directory / ".gnosi-sites-owner").write_text(owner)
    foreign = tmp_path / "unrelated-log.txt"
    foreign.write_text("Unrelated log must survive")
    (private / "worker.log").symlink_to(foreign)
    def local_ssh(settings, command, payload=None, timeout=45):
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout, check=False)
        if result.returncode:
            raise HTTPException(503, "Rejected unsafe private log")
        return result.stdout
    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    def render(bundle, output):
        output.mkdir(parents=True, exist_ok=True)
        (output / "index.html").write_text("Reviewed synthetic website")
    monkeypatch.setattr(runtime, "render_bundle", render)
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    monkeypatch.setattr(publication, "plugins_enabled_now", lambda *args, **kwargs: True)
    preview = publication.preview(website.store, site, target.id)
    job = publication.enqueue(website.store, site, SitePublishRequest(preview_id=preview.id))
    publication._run(website.store, job)
    assert job.status == "completed"
    assert job.error == "worker_start_pending"
    assert runtime.active_release(website.store, site, target) == job.release_id
    assert website.store.active_bundle(site.id, target.id) is not None
    assert foreign.read_text() == "Unrelated log must survive"


def test_revision_compare_and_swap_prevents_lost_edits(website):
    first = website.site.model_copy(deep=True)
    other = website.site.model_copy(deep=True)
    first.name = "Saved name"
    assert website.store.save(first).revision == 2
    other.name = "Stale edit"
    with pytest.raises(HTTPException) as error:
        website.store.save(other)
    assert error.value.status_code == 409
    assert website.store.load(first.id).name == "Saved name"


def test_private_operations_are_outside_vault_and_cross_vault_isolated(website, tmp_path):
    assert not website.store.private_root.is_relative_to(website.vault)
    other_vault = tmp_path / "another-vault"
    other_vault.mkdir()
    other = SiteStore(WorkspaceContext("workspace", "operator", "owner", other_vault))
    assert other.private_root != website.store.private_root
    with pytest.raises(HTTPException) as error:
        other.load(website.site.id)
    assert error.value.status_code == 404


def test_unsupported_view_filter_fails_closed(website):
    path = website.vault / "BD" / "vault_db_registry.json"
    data = json.loads(path.read_text())
    data["views"][0]["filters"][0]["operator"] = "unsupported"
    path.write_text(json.dumps(data))
    with pytest.raises(HTTPException) as error:
        exporter.build_bundle(website.store, website.site, "local")
    assert error.value.status_code == 422


def test_missing_selected_source_does_not_become_withdrawal(website):
    (website.vault / "BD" / "vault_db_registry.json").unlink()
    with pytest.raises(HTTPException) as error:
        exporter.build_bundle(website.store, website.site, "local")
    assert error.value.status_code == 409


def test_css_is_validated_before_saving_and_theme_versions_are_retained(website):
    site = website.site
    site.theme.advanced_css = 'body {background: url("https://unreviewed.invalid/track")}'
    with pytest.raises(HTTPException):
        website.store.save(site)
    site.theme.advanced_css = ".card { color: red; }"
    saved = website.store.save(site)
    assert saved.revision == 2
    assert [theme.advanced_css for theme in website.store.themes(site.id)] == [site.theme.advanced_css, ""]


def test_previews_bind_content_and_user_and_are_single_use(website, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    monkeypatch.setattr(runtime, "render_bundle", lambda bundle, output: (output / "index.html").write_text("<p>Public</p>"))
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    preview = publication.preview(website.store, website.site, "local")
    other = SiteStore(WorkspaceContext("workspace", "another", "owner", website.vault))
    with pytest.raises(HTTPException):
        publication.enqueue(other, website.site, SitePublishRequest(preview_id=preview.id))
    job = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))
    assert job.status == "queued"
    with pytest.raises(HTTPException):
        publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))


def test_changed_source_invalidates_reviewed_preview(website, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    monkeypatch.setattr(runtime, "render_bundle", lambda bundle, output: (output / "index.html").write_text("<p>Public</p>"))
    preview = publication.preview(website.store, website.site, "local")
    path = website.vault / "BD" / "Articles" / "one.md"
    path.write_text(path.read_text() + "Changed after review")
    with pytest.raises(HTTPException) as error:
        publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))
    assert error.value.status_code == 409


def test_local_activation_and_rollback_do_not_touch_private_service_state(website, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    def render(bundle, output):
        output.mkdir(parents=True, exist_ok=True)
        (output / "index.html").write_text("<p>" + bundle["site"]["name"] + "</p>")
    monkeypatch.setattr(runtime, "render_bundle", render)
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    monkeypatch.setattr(publication, "plugins_enabled_now", lambda *args, **kwargs: True)
    monkeypatch.setattr("backend.domains.sites.private_service.invoke", lambda *args, **kwargs: {})
    state = website.store.site_dir(website.site.id) / "services" / "local"
    state.mkdir(parents=True)
    (state / "state.sqlite").write_bytes(b"PRIVATE-CONSENT-AND-MESSAGES")
    first = publication.preview(website.store, website.site, "local")
    job = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=first.id))
    publication._run(website.store, job)
    assert publication.jobs(website.store, website.site.id)[0].status == "completed"
    original = publication.releases(website.store, website.site.id)[0]
    site = website.site.model_copy(update={"name": "Changed"})
    site = website.store.save(site)
    second = publication.preview(website.store, site, "local")
    job2 = publication.enqueue(website.store, site, SitePublishRequest(preview_id=second.id))
    publication._run(website.store, job2)
    restored = publication.rollback(website.store, site, original.id)
    assert restored.id == original.id
    active = website.store.site_dir(site.id) / "active" / "local"
    assert active.resolve().parent.name == original.id
    assert (state / "state.sqlite").read_bytes() == b"PRIVATE-CONSENT-AND-MESSAGES"


@pytest.mark.parametrize("operation", ["activation", "rollback", "reconcile"])
@pytest.mark.parametrize("hostile", [
    "canonical", "releases-link", "release-link", "output-link", "file-link", "file-parent-link",
    "manifest-link", "extra-file", "extra-link", "manifest-traversal", "active-parent-link",
    "foreign-pointer", "relative-pointer", "looping-pointer", "occupied-pointer",
])
def test_local_activation_restore_and_reconcile_share_exact_artifact_policy(website, tmp_path, monkeypatch, operation, hostile):
    from backend.domains.sites.models import SiteRelease, timestamp
    monkeypatch.setattr("backend.domains.sites.private_service.invoke", lambda *args, **kwargs: {})
    monkeypatch.setattr(publication, "require_activation_access", lambda *args: None)
    bundle = exporter.build_bundle(website.store, website.site, "local")
    root = website.store.site_dir(website.site.id)
    for identity in ("active-version", "candidate"):
        output = local_artifacts.prepare(website.store, website.site.id, identity)
        (output / "assets").mkdir()
        (output / "index.html").write_text("Reviewed local version")
        (output / "assets/file.txt").write_text("Reviewed local asset")
        local_artifacts.seal(website.store, website.site.id, identity)
        release = SiteRelease(id=identity, site_id=website.site.id, target_id="local", created_at=timestamp(), fingerprint=bundle.fingerprint, current=False, url="http://127.0.0.1:4322")
        with website.store.database() as db:
            db.execute("INSERT INTO releases VALUES (?,?,?,?,?)", (release.id, website.site.id, "local", release.model_dump_json(), bundle.model_dump_json()))
    active_parent = root / "active"
    active_parent.mkdir()
    active = active_parent / "local"
    current_id = "candidate" if operation == "reconcile" else "active-version"
    active.symlink_to(root / "releases" / current_id / "public")
    with website.store.database() as db:
        db.execute("INSERT INTO active VALUES (?,?,?)", (website.site.id, "local", current_id))
    candidate = root / "releases/candidate"
    output = candidate / "public"
    foreign = tmp_path / "unrelated"
    foreign.mkdir()
    (foreign / "sentinel.txt").write_text("Unrelated private material")
    paths = {"releases-link": root / "releases", "release-link": candidate, "output-link": output, "file-link": output / "index.html", "file-parent-link": output / "assets", "manifest-link": candidate / "manifest.json", "active-parent-link": active_parent}
    if hostile in paths:
        path = paths[hostile]
        destination = foreign / path.name
        path.rename(destination)
        path.symlink_to(destination, target_is_directory=destination.is_dir())
    elif hostile == "extra-file":
        (output / "unreviewed.php").write_text("Unreviewed script")
    elif hostile == "extra-link":
        (output / "unreviewed").symlink_to(foreign)
    elif hostile == "manifest-traversal":
        (candidate / "manifest.json").write_text(json.dumps({"../outside.txt": "0" * 64}))
    elif hostile in {"foreign-pointer", "relative-pointer", "looping-pointer", "occupied-pointer"}:
        active.unlink()
        if hostile == "occupied-pointer":
            active.mkdir()
        else:
            target = foreign if hostile == "foreign-pointer" else Path("../releases") / current_id / "public" if hostile == "relative-pointer" else Path("local")
            active.symlink_to(target, target_is_directory=True)
    before = {str(path.relative_to(foreign)): path.read_bytes() for path in foreign.rglob("*") if path.is_file()}
    pointer = active.readlink() if active.is_symlink() else None
    def invoke():
        if operation == "rollback":
            publication.rollback(website.store, website.site, "candidate")
        elif operation == "activation":
            local_artifacts.activate(website.store, website.site.id, "local", "candidate", "active-version", lambda: None)
        else:
            assert runtime.active_release(website.store, website.site, website.site.targets[0]) == "candidate"
    if hostile == "canonical":
        invoke()
        assert active.readlink() == output
    else:
        with pytest.raises(HTTPException):
            invoke()
        assert (active.readlink() if active.is_symlink() else None) == pointer
    assert before == {str(path.relative_to(foreign)): path.read_bytes() for path in foreign.rglob("*") if path.is_file()}


def test_local_build_rejects_aliased_renderer_outputs_before_any_activation(website, tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    monkeypatch.setattr(publication, "require_activation_access", lambda *args: None)
    foreign = tmp_path / "foreign.txt"
    foreign.write_text("Private material must not be served")
    def render(bundle, output):
        output.mkdir(parents=True, exist_ok=True)
        (output / "index.html").write_text("Reviewed public content")
        (output / "unreviewed.txt").symlink_to(foreign)
    monkeypatch.setattr(runtime, "render_bundle", render)
    preview = publication.preview(website.store, website.site, "local")
    job = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))
    publication._run(website.store, job)
    assert job.status == "failed"
    assert not (website.store.site_dir(website.site.id) / "active/local").is_symlink()
    assert foreign.read_text() == "Private material must not be served"


def test_unknown_renderer_failure_finishes_task_and_receipt_recovers_interrupted_activation(website, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    def render(bundle, output):
        output.mkdir(parents=True, exist_ok=True)
        (output / "index.html").write_text("<p>Published</p>")
    monkeypatch.setattr(runtime, "render_bundle", render)
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    monkeypatch.setattr(publication, "plugins_enabled_now", lambda *args, **kwargs: True)
    monkeypatch.setattr("backend.domains.sites.private_service.invoke", lambda *args, **kwargs: {})
    first = publication.preview(website.store, website.site, "local")
    job = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=first.id))
    original_database = website.store.database
    inject_failure = [True]
    class InterruptedConnection:
        def __init__(self, db):
            self.db = db
        def execute(self, query, *args):
            if query.startswith("INSERT INTO active") and inject_failure[0]:
                inject_failure[0] = False
                raise sqlite3.OperationalError("simulated lost activation receipt acknowledgement")
            return self.db.execute(query, *args)
    @contextmanager
    def failing_database():
        with original_database() as db:
            yield InterruptedConnection(db)
    monkeypatch.setattr(website.store, "database", failing_database)
    publication._run(website.store, job)
    assert publication.jobs(website.store, website.site.id)[0].status == "completed"
    active = website.store.active_bundle(website.site.id, "local")
    assert active is not None and active["fingerprint"] == first.fingerprint
    old_path = exporter.build_bundle(website.store, website.site, "local").records[0].path
    note = website.vault / "BD/Articles/one.md"
    note.write_text(note.read_text().replace("First article", "Renamed article"))
    assert exporter.build_bundle(website.store, website.site, "local").records[0].path == old_path
    note.unlink()
    with pytest.raises(HTTPException) as missing:
        exporter.build_bundle(website.store, website.site, "local")
    assert missing.value.status_code == 409


def test_unexpected_build_exception_does_not_leave_running_job(website, monkeypatch):
    monkeypatch.setattr(runtime, "start_server", lambda *args, **kwargs: "http://127.0.0.1:4322")
    monkeypatch.setattr(runtime, "render_bundle", lambda bundle, output: (output / "index.html").write_text("<p>Preview</p>"))
    monkeypatch.setattr(publication, "dispatch", lambda *args: None)
    monkeypatch.setattr(publication, "plugins_enabled_now", lambda *args, **kwargs: True)
    reviewed = publication.preview(website.store, website.site, "local")
    job = publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=reviewed.id))
    def unavailable_renderer(*args):
        raise RuntimeError("renderer process unavailable")
    monkeypatch.setattr(runtime, "render_bundle", unavailable_renderer)
    publication._run(website.store, job)
    assert publication.jobs(website.store, website.site.id)[0].status == "failed"


def test_private_settings_never_enter_synchronized_config(website):
    from backend.domains.sites import private_service
    private_service.save_settings(website.store, website.site.id, ServiceSettings(forms={"contact": FormDeliverySettings(recipients=["operator@example.invalid"])}))
    public = website.store.config_path(website.site.id).read_text()
    assert "operator@example.invalid" not in public
    assert "smtp_password" not in public
    assert private_service.settings_response(website.store, website.site.id).forms["contact"].recipients == ["operator@example.invalid"]


def test_ssh_profile_rejects_root_paths_and_shell_injection(website):
    for settings in (TargetConnection(host="host;touch /tmp/bad"), TargetConnection(remote_root="/var/www/drupal")):
        with pytest.raises(HTTPException) as error:
            runtime.save_connection(website.store, website.site.id, "local", settings)
        assert error.value.status_code == 422


def test_http_roles_and_separate_private_operations(website, monkeypatch):
    app = FastAPI()
    app.include_router(api.router, prefix="/api/vault")
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    app.dependency_overrides[get_workspace_context] = lambda: website.context
    monkeypatch.setattr(api, "store_for", lambda context: SiteStore(context))
    with TestClient(app) as client:
        assert client.get("/api/vault/sites").status_code == 200
        website.context.role = "editor"
        assert client.get("/api/vault/sites/" + website.site.id).status_code == 200
        assert client.get("/api/vault/sites/" + website.site.id + "/service-settings").status_code == 403
        assert client.post("/api/vault/sites/" + website.site.id + "/service", json={"action": "status"}).status_code == 403
        payload = website.site.model_dump(mode="json")
        payload["targets"][0]["base_url"] = "https://example.invalid"
        assert client.put("/api/vault/sites/" + website.site.id, json=payload).status_code == 403


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
def test_real_private_cli_bridge_and_target_isolation(website):
    from backend.domains.sites import private_service
    result = private_service.invoke(website.store, website.site, "status", {})
    assert result["subscribers"]["active"] == 0
    assert result["messages"]["new"] == 0
    assert result["test_mode"] is True
    assert not list(website.vault.rglob("*.sqlite"))
    with pytest.raises(HTTPException):
        private_service.invoke(website.store, website.site, "status", {}, "another-destination")
    with pytest.raises(HTTPException):
        private_service.invoke(website.store, website.site, "arbitrary_admin_action", {})


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is not installed")
def test_generated_ssh_upload_program_verifies_and_activates_without_network(website, tmp_path, monkeypatch):
    from backend.domains.sites.models import SiteTarget
    remote = tmp_path / "account" / "public_html" / "_gnosi-test"
    target = SiteTarget(id="remote", adapter="ssh", environment="staging", base_url="https://example.invalid/_gnosi-test/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    runtime.save_connection(website.store, site.id, "remote", TargetConnection(host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent)))
    def local_ssh(settings, command, payload=None, timeout=45):
        if '$daemon=gnosi_service_script("daemon.php")' in command:
            return b'{"started":true}'
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout, check=False)
        assert result.returncode == 0, result.stderr.decode()
        return result.stdout
    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    output = tmp_path / "build"
    output.mkdir()
    (output / "index.html").write_text("<p>Public page</p>")
    assert runtime.upload_release(website.store, site, target, "release-one", output, None) == target.base_url
    assert (remote / "current").resolve() == remote / "releases" / "release-one"
    settings = runtime.connection(website.store, site.id, target.id)
    private = Path(runtime.remote_private_root(website.store, site.id, settings))
    assert not private.is_relative_to(remote.parent)
    assert (private / "config.json").is_file()
    assert (private / "library.php").is_file()
    assert not list((remote / "current").rglob("*.sqlite"))
    service_status = runtime.remote_service(website.store, site, target.id, "status", {})
    assert service_status["test_mode"] is True
    assert service_status["messages"]["new"] == 0
