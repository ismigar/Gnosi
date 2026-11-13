"""Cloud metadata races restart reads without accepting unstable public content."""
from contextlib import contextmanager
import hashlib
import os

import pytest
from fastapi import HTTPException

from backend.domains.sites import asset_files, exporter, publication, record_publication, runtime
from backend.domains.sites.models import SitePublishRequest
from backend.tests.test_sites import website  # noqa: F401


def mutate_after_read(monkeypatch, selected, change):
    original = asset_files._source
    attempts = []

    @contextmanager
    def source(path, maximum, root=None):
        with original(path, maximum, root) as opened:
            yield opened
            if path == selected:
                attempts.append(path)
                change(len(attempts))

    monkeypatch.setattr(asset_files, '_source', source)
    return attempts


def touch(path):
    info = path.stat()
    os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000))


@pytest.mark.parametrize('kind', ['markdown', 'registry', 'pdf'])
def test_hydration_metadata_race_restarts_the_complete_read(tmp_path, monkeypatch, kind):
    path = tmp_path / {'markdown': 'page.md', 'registry': 'registry.json', 'pdf': 'paper.pdf'}[kind]
    content = b'Exact selected bytes'
    path.write_bytes(content)
    attempts = mutate_after_read(monkeypatch, path, lambda attempt: touch(path) if attempt == 1 else None)
    if kind == 'pdf':
        digest, snapshot = asset_files.snapshot_asset(path, tmp_path, tmp_path / 'snapshots')
        assert snapshot.read_bytes() == content
        assert digest == hashlib.sha256(content).hexdigest()
        assert not list(snapshot.parent.glob('.gnosi-asset-*'))
    else:
        assert exporter.bounded_read(path, tmp_path) == content
    assert len(attempts) == 2


@pytest.mark.parametrize('kind', ['markdown', 'pdf'])
def test_continuously_changing_source_remains_unavailable(tmp_path, monkeypatch, kind):
    path = tmp_path / ('page.md' if kind == 'markdown' else 'paper.pdf')
    path.write_bytes(b'Selected bytes')
    attempts = mutate_after_read(monkeypatch, path, lambda _: touch(path))
    if kind == 'pdf':
        with pytest.raises(asset_files.SourceChanged):
            asset_files.snapshot_asset(path, tmp_path, tmp_path / 'snapshots')
        assert not list((tmp_path / 'snapshots').iterdir())
    else:
        with pytest.raises(HTTPException) as error:
            exporter.bounded_read(path, tmp_path)
        assert error.value.status_code == 409
    assert len(attempts) == 3


def test_text_retry_does_not_follow_a_replacement_symlink(tmp_path, monkeypatch):
    vault = tmp_path / 'vault'; vault.mkdir()
    selected = vault / 'page.md'; selected.write_bytes(b'Public bytes')
    outside = tmp_path / 'private.md'; outside.write_bytes(b'Never publish')

    def replace(_):
        selected.unlink()
        selected.symlink_to(outside)

    mutate_after_read(monkeypatch, selected, replace)
    with pytest.raises(HTTPException) as error:
        exporter.bounded_read(selected, vault)
    assert error.value.status_code == 409


@pytest.mark.parametrize('replacement', [b'Now larger than the original PDF', b'x'])
def test_pdf_size_change_restarts_copy_before_exposing_snapshot(tmp_path, monkeypatch, replacement):
    selected = tmp_path / 'paper.pdf'; selected.write_bytes(b'Original PDF')
    original = asset_files._chunks
    attempts = []

    def chunks(source, target, maximum):
        attempts.append(selected)
        if len(attempts) == 1:
            selected.write_bytes(replacement)
        return original(source, target, maximum)

    monkeypatch.setattr(asset_files, '_chunks', chunks)
    digest, snapshot = asset_files.snapshot_asset(selected, tmp_path, tmp_path / 'snapshots')
    assert len(attempts) == 2
    assert snapshot.read_bytes() == replacement
    assert digest == hashlib.sha256(replacement).hexdigest()
    assert not list(snapshot.parent.glob('.gnosi-asset-*'))


def test_real_content_edit_during_confirmation_still_rejects_review(website, monkeypatch):
    monkeypatch.setattr(runtime, 'start_server', lambda *args, **kwargs: 'http://127.0.0.1:9999')
    monkeypatch.setattr(runtime, 'render_bundle', lambda *args, **kwargs: None)
    monkeypatch.setattr(publication, 'dispatch', lambda *args: None)
    selected = website.vault / 'BD/Articles/one.md'
    request = record_publication.RecordPublicationReview(page_id='one', target_id='local', action='withdraw')
    preview = record_publication.review(website.store, website.site, request)

    def edit(attempt):
        if attempt == 1:
            selected.write_text(selected.read_text() + '\nEdited after review\n')

    mutate_after_read(monkeypatch, selected, edit)
    with pytest.raises(HTTPException) as error:
        publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id))
    assert error.value.status_code == 409
    assert website.store.load(website.site.id).sources[0].withdrawn_ids == []
    with website.store.database() as db:
        assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0
