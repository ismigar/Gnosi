"""Explicit native file fields keep their scoped Library/Assets identities."""
import hashlib
import tracemalloc
from pathlib import Path

import pytest
from fastapi import HTTPException
from backend.domains.sites.exporter import AssetExporter
from backend.tests.test_sites import website  # noqa: F401

from backend.domains.sites import asset_files


@pytest.mark.parametrize('reference', ['absolute', 'served-library', 'served-assets'])
def test_native_upload_reference_exports_exact_reviewed_bytes(website, reference):
    folder = website.vault / ('Assets' if reference == 'served-assets' else 'Library'); folder.mkdir()
    path = folder / 'paper.pdf'; path.write_bytes(b'Synthetic reviewed public PDF')
    raw = str(path) if reference == 'absolute' else ('/api/vault/assets/' if reference == 'served-assets' else '/api/vault/library/') + path.name
    asset = AssetExporter(website.store, {}, website.site.id)
    public = asset(raw)
    assert public.startswith('/assets/') and public.endswith('.pdf')
    assert asset.assets[public].sha256 == hashlib.sha256(path.read_bytes()).hexdigest()
    assert str(path.relative_to(website.vault)) in asset.hashes


@pytest.mark.parametrize('reference', ['traversal', 'outside-symlink', 'absolute-outside'])
def test_native_attachment_reference_never_escapes_its_scope(website, tmp_path, reference):
    library = website.vault / 'Library'; library.mkdir()
    outside = tmp_path / 'private.pdf'; outside.write_bytes(b'NEVER PUBLISH')
    if reference == 'outside-symlink':
        (library / 'linked.pdf').symlink_to(outside); raw = '/api/vault/library/linked.pdf'
    elif reference == 'traversal':
        (website.vault / 'private.pdf').write_bytes(b'NEVER PUBLISH'); raw = '/api/vault/library/../private.pdf'
    else: raw = str(outside)
    asset = AssetExporter(website.store, {}, website.site.id)
    with pytest.raises(HTTPException): asset(raw)
    assert not asset.assets


def test_selected_file_field_never_exports_native_machine_path_as_text(website):
    import json
    from backend.domains.sites.exporter import build_bundle
    registry = website.vault / 'BD/vault_db_registry.json'; data = json.loads(registry.read_text())
    data['tables'][0]['properties'].append({'id': 'paper', 'name': 'Paper', 'type': 'files'})
    registry.write_text(json.dumps(data))
    library = website.vault / 'Library'; library.mkdir(); path = library / 'paper.pdf'; path.write_bytes(b'Explicit public PDF')
    note = website.vault / 'BD/Articles/one.md'; note.write_text(note.read_text().replace('Status: published', f'Status: published\npaper: {path}'))
    website.site.sources[0].field_ids.append('paper')
    bundle = build_bundle(website.store, website.site, 'local')
    assert bundle.records[0].fields['paper'].startswith('/assets/')
    assert str(website.vault) not in json.dumps(bundle.records[0].model_dump())


def test_large_public_pdf_snapshot_and_construction_use_bounded_memory(website, tmp_path):
    source = website.vault / 'large.pdf'
    with source.open('wb') as stream:
        stream.write(b'%PDF-1.7\n')
        stream.seek(40_000_000)
        stream.write(b'EOF')
    exporter = AssetExporter(website.store, {}, website.site.id)
    target = tmp_path / 'constructed.pdf'
    tracemalloc.start()
    try:
        public = exporter(str(source))
        reviewed = exporter.assets[public]
        asset_files.copy_reviewed_asset(Path(reviewed.private_source), target, reviewed.sha256)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 8 * 1024 * 1024
    assert target.stat().st_size == source.stat().st_size
    with target.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == reviewed.sha256


def test_actual_renderer_retains_large_reviewed_pdf(website, tmp_path):
    from backend.domains.sites.models import SiteBundle, SiteConfig
    from backend.domains.sites.renderer import render_bundle

    source = website.vault / 'public.pdf'
    with source.open('wb') as stream:
        stream.seek(33_000_000)
        stream.write(b'Public PDF end')
    exporter = AssetExporter(website.store, {}, website.site.id)
    public = exporter(str(source))
    reviewed = exporter.assets[public]
    output = tmp_path / 'public'
    render_bundle(SiteBundle(site=SiteConfig(name='Public files'), assets=[reviewed]).model_dump(mode='json'), output)
    constructed = output / public.lstrip('/')
    assert constructed.stat().st_size == source.stat().st_size
    with constructed.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == reviewed.sha256


@pytest.mark.parametrize('suffix,size', [('.pdf', asset_files.PUBLIC_PDF_MAX_BYTES + 1),
                                        ('.png', asset_files.PUBLIC_ATTACHMENT_MAX_BYTES + 1)])
def test_asset_limits_still_fail_before_publishing_a_partial_snapshot(website, suffix, size):
    source = website.vault / ('oversized' + suffix)
    with source.open('wb') as stream:
        stream.seek(size - 1)
        stream.write(b'x')
    exporter = AssetExporter(website.store, {}, website.site.id)
    with pytest.raises(HTTPException) as error:
        exporter(str(source))
    assert error.value.status_code == 422
    assert not exporter.assets
    assert not list((website.store.site_dir(website.site.id) / 'asset-snapshots').iterdir())


@pytest.mark.parametrize('change', ['replace', 'rewrite'])
def test_selected_attachment_changes_are_rejected_without_partial_artifacts(website, monkeypatch, change):
    source = website.vault / 'changing.pdf'
    source.write_bytes(b'Original reviewed bytes')
    copy = asset_files._chunks

    def mutate(reader, writer, maximum):
        result = copy(reader, writer, maximum)
        if change == 'replace':
            replacement = source.with_suffix('.new')
            replacement.write_bytes(b'Original reviewed bytes')
            replacement.replace(source)
        else:
            source.write_bytes(b'Altered content')
        return result

    monkeypatch.setattr(asset_files, '_chunks', mutate)
    exporter = AssetExporter(website.store, {}, website.site.id)
    with pytest.raises(HTTPException) as error:
        exporter(str(source))
    assert error.value.status_code == 409
    assert not exporter.assets
    assert not list((website.store.site_dir(website.site.id) / 'asset-snapshots').iterdir())


def test_cached_snapshot_tampering_cannot_become_a_new_reviewed_asset(website):
    source = website.vault / 'source.pdf'
    source.write_bytes(b'Original reviewed bytes')
    first = AssetExporter(website.store, {}, website.site.id)
    public = first(str(source))
    snapshot = Path(first.assets[public].private_source)
    snapshot.write_bytes(b'Corrupt snapshot')
    second = AssetExporter(website.store, {}, website.site.id)
    with pytest.raises(HTTPException):
        second(str(source))
    assert not second.assets
    assert not list(snapshot.parent.glob('.gnosi-asset-*'))


def test_renderer_hash_mismatch_leaves_no_public_copy(tmp_path):
    source = tmp_path / 'reviewed.pdf'
    source.write_bytes(b'Changed after review')
    target = tmp_path / 'public.pdf'
    with pytest.raises(asset_files.AssetFileError, match='changed before construction'):
        asset_files.copy_reviewed_asset(source, target, hashlib.sha256(b'Reviewed bytes').hexdigest())
    assert not target.exists()
    assert not list(tmp_path.glob('.gnosi-asset-*'))


def test_parent_symlink_race_cannot_redirect_a_selected_attachment(website, tmp_path, monkeypatch):
    folder = website.vault / 'selected'
    folder.mkdir()
    source = folder / 'public.pdf'
    source.write_bytes(b'Public selection')
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / source.name).write_bytes(b'PRIVATE NEVER PUBLISH')
    open_file = asset_files._open_resolved

    def redirect(path):
        folder.rename(folder.with_name('original'))
        folder.symlink_to(outside, target_is_directory=True)
        return open_file(path)

    monkeypatch.setattr(asset_files, '_open_resolved', redirect)
    exporter = AssetExporter(website.store, {}, website.site.id)
    with pytest.raises(HTTPException):
        exporter(str(source))
    assert not exporter.assets
    assert not list((website.store.site_dir(website.site.id) / 'asset-snapshots').iterdir())


def test_selected_odp_and_non_openat_file_access_keep_exact_bytes(website, monkeypatch):
    monkeypatch.setattr(asset_files.os, 'supports_dir_fd', set())
    source = website.vault / 'slides.odp'
    source.write_bytes(b'Explicitly selected ODP presentation')
    exporter = AssetExporter(website.store, {}, website.site.id)
    public = exporter(str(source))
    assert public.endswith('.odp')
    assert Path(exporter.assets[public].private_source).read_bytes() == source.read_bytes()
