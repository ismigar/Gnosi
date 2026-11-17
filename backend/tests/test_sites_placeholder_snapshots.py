"""Evicted attachments need a content version, not another provider download."""
import json
import os
import shutil

import pytest

from backend.domains.sites import asset_files, asset_versions


@pytest.fixture
def versioned_source(tmp_path, monkeypatch):
    source = tmp_path / 'paper.pdf'
    source.write_bytes(b'Original')
    generation = [7]
    monkeypatch.setattr(asset_versions, 'content_generation', lambda _: generation[0], raising=False)
    return source, tmp_path / 'snapshots', generation


def test_evicted_unchanged_attachment_uses_verified_private_bytes(versioned_source, monkeypatch):
    source, directory, _ = versioned_source
    first = asset_files.snapshot_asset(source, source.parent, directory)
    monkeypatch.setattr(asset_versions, 'is_cloud_placeholder', lambda *_: True)
    monkeypatch.setattr(asset_files, '_stage', lambda *_args, **_kwargs: pytest.fail('Downloaded unchanged original'))
    assert asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=True) == first


def test_changed_generation_invalidates_even_with_matching_stat_version(versioned_source, monkeypatch):
    source, directory, generation = versioned_source
    first = asset_files.snapshot_asset(source, source.parent, directory)
    identity = asset_files._identity(source.stat())
    source.write_bytes(b'Modified')
    generation[0] += 1
    monkeypatch.setattr(asset_files, '_identity', lambda _: identity)
    second = asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=True)
    assert second[0] != first[0]
    assert second[1].read_bytes() == b'Modified'


def test_forged_snapshot_mapping_cannot_replace_source_content(versioned_source):
    source, directory, _ = versioned_source
    asset_files.snapshot_asset(source, source.parent, directory)
    other = source.parent / 'other.pdf'
    other.write_bytes(b'Unwanted')
    other_digest, _ = asset_files.snapshot_asset(other, source.parent, directory)
    record = asset_versions._entry(source, directory)
    value = json.loads(record.read_text())
    value['digest'] = other_digest
    record.write_text(json.dumps(value))
    _, snapshot = asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=True)
    assert snapshot.read_bytes() == b'Original'


@pytest.mark.parametrize('signature', ['é', None, 42, 'short', 'A' * 64])
def test_malformed_signature_falls_back_to_fresh_original(versioned_source, signature):
    source, directory, _ = versioned_source
    asset_files.snapshot_asset(source, source.parent, directory)
    record = asset_versions._entry(source, directory)
    value = json.loads(record.read_text())
    value['signature'] = signature
    record.write_text(json.dumps(value))
    _, snapshot = asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=True)
    assert snapshot.read_bytes() == b'Original'


@pytest.mark.parametrize('reuse', [False, True])
@pytest.mark.parametrize('fault', ['corrupt_key', 'empty_key', 'key_directory',
    'key_permissions', 'version_directory', 'versions_parent_file', 'write_failure'])
def test_optional_receipt_failure_preserves_fresh_verified_snapshot(versioned_source, monkeypatch, reuse, fault):
    source, directory, _ = versioned_source
    asset_files.snapshot_asset(source, source.parent, directory)
    key = directory / '.note-parse-cache-key'
    if fault == 'corrupt_key':
        key.write_bytes(b'corrupt')
    elif fault == 'empty_key':
        key.write_bytes(b'')
    elif fault == 'key_directory':
        key.unlink()
        key.mkdir()
    elif fault == 'key_permissions':
        key.chmod(0o644)
    elif fault == 'version_directory':
        entry = asset_versions._entry(source, directory)
        entry.unlink()
        entry.mkdir()
    elif fault == 'versions_parent_file':
        shutil.rmtree(directory / '.source-versions')
        (directory / '.source-versions').write_text('invalid')
    else:
        def unavailable(*_args):
            raise OSError('No space left for optional metadata')
        monkeypatch.setattr(asset_versions, 'private_json', unavailable)
    source.write_bytes(b'Modified')
    _, snapshot = asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=reuse)
    assert snapshot.read_bytes() == b'Modified'
    if fault == 'corrupt_key':
        assert key.read_bytes() == b'corrupt'


def test_content_change_during_cached_verification_is_rejected(versioned_source, monkeypatch):
    source, directory, generation = versioned_source
    asset_files.snapshot_asset(source, source.parent, directory)
    chunks = asset_files._chunks

    def changed(*args):
        result = chunks(*args)
        generation[0] += 1
        return result

    monkeypatch.setattr(asset_files, '_chunks', changed)
    with pytest.raises(asset_files.SourceChanged):
        asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=True)


def test_placeholder_without_content_generation_requires_fresh_bytes(versioned_source, monkeypatch):
    source, directory, generation = versioned_source
    generation[0] = None
    first = asset_files.snapshot_asset(source, source.parent, directory)
    source.write_bytes(b'Modified')
    monkeypatch.setattr(asset_versions, 'is_cloud_placeholder', lambda *_: True)
    second = asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=True)
    assert second[0] != first[0]


@pytest.mark.skipif(os.name != 'posix', reason='Preview versions require POSIX change tokens')
def test_replaced_source_does_not_reuse_same_generation(versioned_source):
    source, directory, _ = versioned_source
    first = asset_files.snapshot_asset(source, source.parent, directory)
    replacement = source.parent / 'new.pdf'
    replacement.write_bytes(b'Modified')
    replacement.replace(source)
    second = asset_files.snapshot_asset(source, source.parent, directory, reuse_source_version=True)
    assert second[0] != first[0]
