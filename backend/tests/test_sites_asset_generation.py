"""A content token is usable only when the native query explicitly supports it."""
import ctypes
import os
import sys
from types import SimpleNamespace

import pytest

from backend.domains.sites import asset_generation


@pytest.mark.skipif(sys.platform != 'darwin', reason='Darwin content generations')
def test_real_generation_tracks_content_even_with_restored_mtime(tmp_path):
    source = tmp_path / 'file.pdf'
    source.write_bytes(b'Original')
    descriptor = os.open(source, os.O_RDONLY)
    try:
        first = asset_generation.content_generation(descriptor)
        if first is None:
            pytest.skip('Temporary volume does not support write generations')
        info = source.stat()
        assert source.read_bytes() == b'Original'
        assert asset_generation.content_generation(descriptor) == first
        source.write_bytes(b'Modified')
        os.utime(source, ns=(info.st_atime_ns, info.st_mtime_ns))
        assert asset_generation.content_generation(descriptor) != first
    finally:
        os.close(descriptor)


@pytest.mark.parametrize('length,returned,status,expected', [
    (28, 0x80080000, 0, 0), (28, 0x80000000, 0, None),
    (24, 0x80080000, 0, None), (28, 0x80080000, -1, None),
])
def test_unsupported_or_malformed_native_result_is_not_a_version(monkeypatch, length, returned, status, expected):
    class Query:
        def __call__(self, _descriptor, _attributes, output, size, options):
            assert size == 28 and options == 0x20
            output[0], output[1], output[6] = length, returned, 0
            return status

    monkeypatch.setattr(asset_generation.sys, 'platform', 'darwin')
    monkeypatch.setattr(ctypes, 'CDLL', lambda *a, **k: SimpleNamespace(fgetattrlist=Query()))
    assert asset_generation.content_generation(7) == expected


def test_other_platforms_do_not_attempt_native_query(monkeypatch):
    monkeypatch.setattr(asset_generation.sys, 'platform', 'linux')
    monkeypatch.setattr(ctypes, 'CDLL', lambda *a, **k: pytest.fail('Darwin query on another platform'))
    assert asset_generation.content_generation(7) is None
