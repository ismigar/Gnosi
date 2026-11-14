"""Preview work stays bounded without sharing stale source data across requests."""
import json
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from fastapi import HTTPException

from backend.domains.sites import exporter, publication, record_publication, runtime
from backend.tests.test_sites import website  # noqa: F401
from backend.tests.test_sites_record_publication import reviewed  # noqa: F401


def test_record_preview_reads_each_source_twice_and_builds_one_exact_bundle(reviewed, monkeypatch):
    website, request = reviewed
    request.action = "publish"
    config = website.store.config_path(website.site.id).read_bytes()
    reads = Counter()
    builds = []
    rendered = []
    real_read, real_build = exporter.bounded_read, exporter.build_bundle

    def read(path, root, maximum=4_000_000):
        reads[path.relative_to(root)] += 1
        return real_read(path, root, maximum)

    def build(*args, **kwargs):
        bundle = real_build(*args, **kwargs)
        builds.append(bundle)
        return bundle

    monkeypatch.setattr(exporter, "bounded_read", read)
    monkeypatch.setattr(exporter, "build_bundle", build)
    monkeypatch.setattr(publication, "build_bundle", build)
    monkeypatch.setattr(runtime, "render_bundle", lambda bundle, output: rendered.append(bundle))
    preview = record_publication.review(website.store, website.site, request)

    assert reads and set(reads.values()) == {2}
    assert len(builds) == len(rendered) == 1
    with website.store.database() as db:
        payload = json.loads(db.execute("SELECT payload FROM previews WHERE id=?", (preview.id,)).fetchone()["payload"])
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
    assert payload["bundle"] == builds[0].model_dump(mode="json")
    for key in ("records", "assets", "source_hashes", "fingerprint"):
        assert rendered[0][key] == payload["bundle"][key]
    assert website.store.config_path(website.site.id).read_bytes() == config
    assert website.store.active_bundle(website.site.id, "local") is None


@pytest.mark.parametrize("change", ["record", "registry", "duplicate", "unavailable"])
@pytest.mark.parametrize("cleanup_failure", [False, True])
def test_fresh_scan_after_render_rejects_changes_and_cleans_unbound_preview(reviewed, monkeypatch, change, cleanup_failure):
    website, request = reviewed
    config = website.store.config_path(website.site.id).read_bytes()
    stopped = []
    real_read = exporter.bounded_read
    rendered = False

    def read(path, root, maximum=4_000_000):
        if rendered and change == "unavailable" and path.name == "one.md":
            raise OSError("Synthetic unavailable source")
        return real_read(path, root, maximum)

    def render(bundle, output):
        nonlocal rendered
        note = website.vault / "BD/Articles/one.md"
        if change == "record":
            note.write_text(note.read_text() + "Changed during rendering\n")
        elif change == "registry":
            path = website.vault / "BD/vault_db_registry.json"
            data = json.loads(path.read_text())
            data["changed_during_review"] = True
            path.write_text(json.dumps(data))
        elif change == "duplicate":
            (website.vault / "duplicate.md").write_text(note.read_text())
        rendered = True

    def stop(store, site, preview):
        stopped.append(preview)
        if cleanup_failure:
            raise HTTPException(503, "Synthetic preview server cleanup failure")

    monkeypatch.setattr(exporter, "bounded_read", read)
    monkeypatch.setattr(runtime, "render_bundle", render)
    monkeypatch.setattr(runtime, "stop_preview", stop)
    with pytest.raises(HTTPException, match="503" if cleanup_failure else "409"):
        record_publication.review(website.store, website.site, request)
    assert len(stopped) == 1
    with website.store.database() as db:
        assert db.execute("SELECT COUNT(*) FROM previews").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
    assert website.store.config_path(website.site.id).read_bytes() == config


def test_later_review_reads_new_content_without_reusing_prior_snapshot(reviewed):
    website, request = reviewed
    request.action = "publish"
    first = record_publication.review(website.store, website.site, request)
    note = website.vault / "BD/Articles/one.md"
    note.write_text(note.read_text() + "Fresh second review body\n")
    second = record_publication.review(website.store, website.site, request)
    with website.store.database() as db:
        payload = json.loads(db.execute("SELECT payload FROM previews WHERE id=?", (second.id,)).fetchone()["payload"])
    assert first.fingerprint != second.fingerprint
    assert "Fresh second review body" in payload["bundle"]["records"][0]["body_html"]


def test_request_snapshot_cannot_be_used_for_another_vault(reviewed, tmp_path):
    website, _ = reviewed
    snapshot = exporter.source_snapshot(website.store)
    other = tmp_path / "other-vault"
    other.mkdir()
    with pytest.raises(HTTPException, match="409.*another vault"):
        exporter.build_bundle(SimpleNamespace(vault=other), website.site, "local", snapshot=snapshot)


@pytest.mark.parametrize("fallback", [False, True])
def test_accelerated_and_fallback_loaders_preserve_safe_metadata(tmp_path, monkeypatch, fallback):
    if fallback:
        monkeypatch.delattr(yaml, "CSafeLoader", raising=False)
    metadata = "id: safe\ntitle: 'A: title'\ndate: 2026-11-13\nflag: true\ntags: &tags [one, two]\ncopy: *tags\n"
    path = tmp_path / "safe.md"
    path.write_text("---\n" + metadata + "---\nPublic body\n")
    note = exporter.notes(SimpleNamespace(vault=tmp_path))[0]
    assert note.metadata == json.loads(json.dumps(yaml.safe_load(metadata), default=str))
    path.write_text("---\nid: unsafe\nvalue: !!python/tuple [1, 2]\n---\nBody\n")
    with pytest.raises(HTTPException, match="409"):
        exporter.notes(SimpleNamespace(vault=tmp_path))


def test_note_walk_prunes_private_indexes_before_enumerating_them(tmp_path, monkeypatch):
    hidden = tmp_path / ".gnosi"
    hidden.mkdir()
    (hidden / "private.md").write_text("---\nid: duplicate\n---\nPrivate\n")
    (tmp_path / "public.md").write_text("---\nid: public\n---\nPublic\n")
    original = exporter.os.scandir

    def scandir(path):
        assert Path(path) != hidden, "Private sidecar directories must not be enumerated"
        return original(path)

    monkeypatch.setattr(exporter.os, "scandir", scandir)
    assert [note.metadata["id"] for note in exporter.notes(SimpleNamespace(vault=tmp_path))] == ["public"]


def test_unreadable_directory_does_not_produce_an_incomplete_preview(tmp_path, monkeypatch):
    def unavailable(path):
        raise PermissionError("Synthetic unavailable directory")

    monkeypatch.setattr(exporter.os, "scandir", unavailable)
    with pytest.raises(HTTPException, match="409.*directory is unavailable"):
        exporter.notes(SimpleNamespace(vault=tmp_path))
