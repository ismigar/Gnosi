"""Private preview reuse cannot weaken fresh publication verification."""
import hashlib
import json
import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.domains.sites import asset_files, asset_versions, exporter, publication, record_publication, runtime
from backend.tests.test_sites import website  # noqa: F401


def test_preview_reuses_verified_bytes_but_strict_build_reads_original(tmp_path, monkeypatch):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"reviewed source")
    directory = tmp_path / "snapshots"
    first = asset_files.snapshot_asset(source, tmp_path, directory)
    stage = asset_files._stage
    reads = []

    def counted(path, *args, **kwargs):
        reads.append(path)
        return stage(path, *args, **kwargs)

    monkeypatch.setattr(asset_files, "_stage", counted)
    assert asset_files.snapshot_asset(source, tmp_path, directory, reuse_source_version=True) == first
    assert not reads
    assert asset_files.snapshot_asset(source, tmp_path, directory) == first
    assert reads == [source]


def test_same_size_rewrite_with_restored_mtime_invalidates_preview_version(tmp_path):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"Original")
    directory = tmp_path / "snapshots"
    original = asset_files.snapshot_asset(source, tmp_path, directory)
    info = source.stat()
    source.write_bytes(b"Modified")
    os.utime(source, ns=(info.st_atime_ns, info.st_mtime_ns))
    changed = asset_files.snapshot_asset(source, tmp_path, directory, reuse_source_version=True)
    assert changed[0] != original[0]
    assert changed[1].read_bytes() == b"Modified"


def test_tampered_private_bytes_are_rejected_on_cache_hit(tmp_path):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"original")
    directory = tmp_path / "snapshots"
    _, snapshot = asset_files.snapshot_asset(source, tmp_path, directory)
    snapshot.write_bytes(b"tampered")
    with pytest.raises(asset_files.AssetFileError):
        asset_files.snapshot_asset(source, tmp_path, directory, reuse_source_version=True)


def test_placeholder_metadata_cannot_reuse_a_prior_local_version(tmp_path, monkeypatch):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"original")
    directory = tmp_path / "snapshots"
    asset_files.snapshot_asset(source, tmp_path, directory)
    monkeypatch.setattr(asset_versions, "is_cloud_placeholder", lambda *args:True)
    stage = asset_files._stage
    reads = []

    def counted(path, *args, **kwargs):
        reads.append(path)
        return stage(path, *args, **kwargs)

    monkeypatch.setattr(asset_files, "_stage", counted)
    asset_files.snapshot_asset(source, tmp_path, directory, reuse_source_version=True)
    assert reads == [source]


def test_source_changes_while_verifying_cache_are_rejected(tmp_path, monkeypatch):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"original")
    directory = tmp_path / "snapshots"
    asset_files.snapshot_asset(source, tmp_path, directory)
    chunks = asset_files._chunks

    def changed(*args):
        result = chunks(*args)
        source.write_bytes(b"changed!")
        return result

    monkeypatch.setattr(asset_files, "_chunks", changed)
    with pytest.raises(asset_files.SourceChanged):
        asset_files.snapshot_asset(source, tmp_path, directory, reuse_source_version=True)


def test_request_memo_does_not_allow_an_inside_vault_file_symlink(website):
    source = website.vault / "source.pdf"
    source.write_bytes(b"public")
    asset = exporter.AssetExporter(website.store, {}, website.site.id, reuse_source_versions=True)
    asset(str(source))
    alias = website.vault / "alias.pdf"
    alias.symlink_to(source)
    with pytest.raises(HTTPException):
        asset(str(alias))


def test_confirmation_rehashes_source_after_cached_preview(website, monkeypatch):
    registry = website.vault / "BD/vault_db_registry.json"
    data = json.loads(registry.read_text())
    data['tables'][0]['properties'].append({'id':'paper','name':'Paper','type':'files'})
    registry.write_text(json.dumps(data))
    source = website.vault / "source.pdf"
    source.write_bytes(b"original")
    note = website.vault / "BD/Articles/one.md"
    note.write_text(note.read_text().replace('Status: published', f'Status: published\npaper: {source}'))
    website.site.sources[0].field_ids.append('paper')
    website.site = website.store.save(website.site)
    before = website.store.config_path(website.site.id).read_bytes()
    monkeypatch.setattr(runtime, 'start_server', lambda *a, **k:'http://127.0.0.1:9999')
    monkeypatch.setattr(runtime, 'render_bundle', lambda *a, **k:None)
    request = record_publication.RecordPublicationReview(page_id='one',target_id='local',action='publish')
    record_publication.review(website.store, website.site, request)
    preview = record_publication.review(website.store, website.site, request)
    source.write_bytes(b"modified")
    with pytest.raises(HTTPException):
        publication.enqueue(website.store, website.site,
                            publication.SitePublishRequest(preview_id=preview.id))
    assert website.store.config_path(website.site.id).read_bytes() == before
    with website.store.database() as db:
        assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0
