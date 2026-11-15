"""Cross-preview reuse retains fresh original identity and availability checks."""
import hashlib
import os
from pathlib import Path

import pytest

from backend.domains.sites import asset_files, preview_note_reads
from backend.platform.files import coordinated
from backend.utils import bounded_file_io

pytestmark = pytest.mark.skipif(os.name != 'posix', reason='Requires POSIX ctime edit tokens')


@pytest.fixture
def files(tmp_path, monkeypatch):
    root = tmp_path.resolve();vault = root/'vault';vault.mkdir()
    path = vault/'article.md';path.write_bytes(b'original')
    cache = root/'cache';reads = []
    monkeypatch.setattr(bounded_file_io, 'cloud_path', lambda path: True)
    def transfer(fd, maximum, *args, **kwargs):
        raw = os.read(fd, maximum+1);reads.append(raw)
        return raw, hashlib.sha256(raw).hexdigest(), len(raw)
    monkeypatch.setattr(bounded_file_io, 'transfer', transfer)
    return vault, path, cache, reads


def read(files, maximum=100):
    vault, path, cache, _ = files
    with asset_files.verified_request_reads(cache, vault), asset_files.read_session():
        return asset_files.read_selected_bytes(path, vault, maximum)


def test_unchanged_notes_reuse_across_previews_but_default_does_not(files):
    vault,path,cache,reads = files
    assert read(files)==read(files)==b'original'
    assert len(reads)==1
    assert cache.joinpath('notes.gz').stat().st_mode & 0o777 == 0o600
    with asset_files.verified_request_reads(), asset_files.read_session():
        assert asset_files.read_selected_bytes(path,vault,100)==b'original'
    assert len(reads)==2


def test_same_size_edit_restoring_mtime_and_inode_replacement_are_fresh(files):
    _,path,_,reads = files;read(files);old=path.stat()
    path.write_bytes(b'modified');os.utime(path,ns=(old.st_atime_ns,old.st_mtime_ns))
    assert read(files)==b'modified'
    replacement=path.with_suffix('.new');replacement.write_bytes(b'replaced');replacement.replace(path)
    assert read(files)==b'replaced' and len(reads)==3


@pytest.mark.parametrize('fault',['corrupt','mode','alias'])
def test_faulty_private_cache_falls_back_to_original(files,fault):
    _,_,cache,reads=files;read(files);p=cache/'notes.gz'
    if fault=='corrupt': p.write_bytes(p.read_bytes()[:-1]+b'!')
    elif fault=='mode': p.chmod(0o644)
    else:
        saved=cache/'other';p.rename(saved);p.symlink_to(saved)
    assert read(files)==b'original' and len(reads)==2


def test_cached_source_alias_and_smaller_limits_are_rejected(files):
    _,path,_,_=files;read(files)
    with pytest.raises(asset_files.AssetTooLarge):read(files,3)
    target=path.with_suffix('.new');path.rename(target);path.symlink_to(target)
    with pytest.raises(asset_files.AssetFileError):read(files)


def test_placeholder_evicts_prior_bytes_even_if_reported_version_matches(files,monkeypatch):
    _,_,_,reads=files;read(files)
    monkeypatch.setattr(coordinated,'is_cloud_placeholder',lambda *args:True)
    assert read(files)==b'original'
    monkeypatch.setattr(coordinated,'is_cloud_placeholder',lambda *args:False)
    assert read(files)==b'original' and len(reads)==3


def test_deleted_notes_are_pruned_and_unavailable_source_is_not_hidden(files):
    vault,path,cache,_=files;read(files);path.unlink()
    with pytest.raises(FileNotFoundError):read(files)
    with asset_files.verified_request_reads(cache,vault):pass
    assert preview_note_reads.load(cache,vault)=={}


def test_cache_has_vault_binding_and_bounds(files,monkeypatch):
    vault,path,cache,reads=files;read(files)
    assert preview_note_reads.load(cache,vault.parent/'different')=={}
    monkeypatch.setattr(preview_note_reads,'_ENCODED_MAXIMUM',8)
    assert read(files)==b'original' and len(reads)==2
    assert path.read_bytes()==b'original'


def test_non_posix_fallback_uses_no_posix_cache_calls(tmp_path,monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(preview_note_reads,'os',SimpleNamespace(name='nt'))
    assert preview_note_reads.load(tmp_path,tmp_path)=={}
    preview_note_reads.save(tmp_path,tmp_path,{})
    assert list(tmp_path.iterdir())==[]
