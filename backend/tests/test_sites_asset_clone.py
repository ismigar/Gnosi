"""A reused attachment remains independent and fully hash verified."""
import hashlib
import sys

import pytest

from backend.domains.sites import asset_clone, asset_files


@pytest.mark.skipif(sys.platform != 'darwin', reason='APFS clone implementation')
def test_real_clone_is_independent_and_still_verified(tmp_path):
    root=tmp_path.resolve();source=root/'source.pdf';source.write_bytes(b'%PDF original')
    target=root/'target.pdf';expected=hashlib.sha256(source.read_bytes()).hexdigest()
    asset_files.copy_reviewed_asset(source,target,expected)
    assert source.stat().st_ino!=target.stat().st_ino and source.stat().st_nlink==target.stat().st_nlink==1
    target.write_bytes(b'changed preview')
    assert source.read_bytes()==b'%PDF original'
    with pytest.raises(asset_files.AssetFileError):
        asset_files.copy_reviewed_asset(source,root/'bad.pdf','0'*64)
    assert not (root/'bad.pdf').exists()
    assert not list(root.glob('.gnosi-*'))


def test_unavailable_clone_falls_back_to_verified_stream(tmp_path,monkeypatch):
    monkeypatch.setattr(asset_clone,'clone',lambda *args:None)
    source=tmp_path/'source';source.write_bytes(b'bytes');target=tmp_path/'target'
    asset_files.copy_reviewed_asset(source,target,hashlib.sha256(b'bytes').hexdigest())
    assert target.read_bytes()==b'bytes'


def test_non_macos_uses_streaming_fallback(tmp_path,monkeypatch):
    monkeypatch.setattr(asset_clone.sys,'platform','linux')
    assert asset_clone.clone(-1,tmp_path) is None and list(tmp_path.iterdir())==[]
