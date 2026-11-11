"""Explicit native file fields keep their scoped Library/Assets identities."""
import hashlib

import pytest
from fastapi import HTTPException
from backend.domains.sites.exporter import AssetExporter
from backend.tests.test_sites import website  # noqa: F401


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
