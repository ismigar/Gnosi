"""Within-request reuse keeps named-file and full POSIX version validation."""
import hashlib
import os
from pathlib import Path

import pytest

from backend.domains.sites import asset_files
from backend.platform.files import coordinated
from backend.utils import bounded_file_io

pytestmark = pytest.mark.skipif(os.name != 'posix', reason='Reuse requires POSIX ctime edit tokens')


@pytest.fixture
def source(tmp_path, monkeypatch):
    path = tmp_path/'note.md';path.write_bytes(b'original note bytes')
    reads = []
    monkeypatch.setattr(bounded_file_io, 'cloud_path', lambda path: True)
    def transfer(fd, maximum, *args, **kwargs):
        raw = os.read(fd, maximum+1);reads.append(raw)
        return raw, hashlib.sha256(raw).hexdigest(), len(raw)
    monkeypatch.setattr(bounded_file_io, 'transfer', transfer)
    return path, reads


def test_unchanged_read_is_reused_only_until_request_ends(source):
    path, reads = source
    for _ in range(2):
        with asset_files.verified_request_reads(), asset_files.read_session():
            assert asset_files.read_selected_bytes(path,path.parent,100)==b'original note bytes'
            assert asset_files.read_selected_bytes(path,path.parent,100)==b'original note bytes'
    assert len(reads)==2
    assert asset_files._verified_reads.get() is None


@pytest.mark.parametrize('change', ['same-size-mtime-restored', 'replace-inode', 'permissions'])
def test_version_changes_force_original_read_even_when_size_matches(source, change):
    path, reads = source
    with asset_files.verified_request_reads(), asset_files.read_session():
        asset_files.read_selected_bytes(path,path.parent,100)
        info=path.stat()
        if change=='replace-inode':
            replacement=path.with_suffix('.new');replacement.write_bytes(b'updated! note bytes');replacement.replace(path)
        elif change=='permissions': path.chmod(0o600 if info.st_mode&0o077 else 0o644)
        else:
            path.write_bytes(b'updated! note bytes');os.utime(path,ns=(info.st_atime_ns,info.st_mtime_ns))
        raw=asset_files.read_selected_bytes(path,path.parent,100)
        assert raw==path.read_bytes()
    assert len(reads)==2


def test_placeholder_is_never_served_from_verified_memory(source,monkeypatch):
    path,reads=source
    with asset_files.verified_request_reads(),asset_files.read_session():
        asset_files.read_selected_bytes(path,path.parent,100)
        monkeypatch.setattr(coordinated,'is_cloud_placeholder',lambda path,info:True)
        asset_files.read_selected_bytes(path,path.parent,100)
    assert len(reads)==2


def test_cached_file_cannot_bypass_smaller_limit_or_symlink_confinement(source,tmp_path):
    path,reads=source
    with asset_files.verified_request_reads(),asset_files.read_session():
        asset_files.read_selected_bytes(path,path.parent,100)
        with pytest.raises(asset_files.AssetTooLarge):asset_files.read_selected_bytes(path,path.parent,2)
        outside=tmp_path.parent/(tmp_path.name+'-outside');outside.write_bytes(b'private outside bytes')
        try:
            path.unlink();path.symlink_to(outside)
            with pytest.raises(asset_files.AssetFileError):asset_files.read_selected_bytes(path,path.parent,100)
        finally:outside.unlink()
    assert len(reads)==1


def test_cache_capacity_does_not_turn_into_unbounded_request_memory(source,monkeypatch):
    path,reads=source
    monkeypatch.setattr(asset_files,'_VERIFIED_READ_MAXIMUM',2)
    with asset_files.verified_request_reads(),asset_files.read_session():
        asset_files.read_selected_bytes(path,path.parent,100)
        asset_files.read_selected_bytes(path,path.parent,100)
        assert asset_files._verified_reads.get().size==0
    assert len(reads)==2


def test_unsupported_render_cache_platform_uses_full_build_without_posix_calls(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from backend.domains.sites import preview_render_cache
    monkeypatch.setattr(preview_render_cache, 'os', SimpleNamespace(name='nt'))
    root=tmp_path/'private';work=tmp_path/'work';work.mkdir()
    preview_render_cache.restore(root,work,'renderer')
    preview_render_cache.save(root,work,'renderer')
    assert not root.exists() and not (work/'prior-index.json').exists()
