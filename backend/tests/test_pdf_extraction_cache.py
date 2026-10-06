"""Stable evidence reuse must never mask changed files or incomplete extraction."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from backend.domains.llm_wiki.pdf_extraction_cache import cache_path, extract_cached_pdf, file_digest

SEGMENTS = [{'text': 'Tomás Halik', 'locator': {'page': 1, 'paragraph': 1}}]


def source(tmp_path):
    path = tmp_path / 'source.pdf'
    path.write_bytes(b'first pdf')
    return path, tmp_path / 'cache'


def test_same_bytes_reuse_exact_ocr_across_independent_reads(tmp_path):
    path, root = source(tmp_path)
    first = extract_cached_pdf(path, root, lambda: json.loads(json.dumps(SEGMENTS)))
    first[0]['text'] = 'caller mutation'
    assert extract_cached_pdf(path, root, lambda: pytest.fail('Repeated OCR')) == SEGMENTS


def test_same_size_and_timestamp_do_not_hide_modified_file(tmp_path):
    path, root = source(tmp_path)
    extract_cached_pdf(path, root, lambda: SEGMENTS)
    saved = path.stat()
    path.write_bytes(b'other pdf')
    os.utime(path, ns=(saved.st_atime_ns, saved.st_mtime_ns))
    changed = [{'text': 'Different evidence.', 'locator': {'page': 1}}]
    assert extract_cached_pdf(path, root, lambda: changed) == changed


@pytest.mark.parametrize('damage', ['invalid_json', 'text', 'complete', 'version', 'hash'])
def test_corrupt_or_incompatible_cache_requires_new_extraction(tmp_path, damage):
    path, root = source(tmp_path)
    extract_cached_pdf(path, root, lambda: SEGMENTS)
    cached = cache_path(root, path, file_digest(path))
    data = json.loads(cached.read_text())
    if damage == 'text':
        data['segments'][0]['text'] = 'Unverified edit'
    else:
        data[{'complete': 'complete', 'version': 'version', 'hash': 'source_sha256'}.get(damage, 'ignored')] = None
    cached.write_text('{' if damage == 'invalid_json' else json.dumps(data))
    calls = []
    assert extract_cached_pdf(path, root, lambda: calls.append(True) or SEGMENTS) == SEGMENTS
    assert calls == [True]


def test_concurrent_estimate_and_worker_share_one_extraction(tmp_path):
    path, root = source(tmp_path)
    entered, release = Event(), Event()
    calls = []
    def extract():
        calls.append(True)
        entered.set()
        assert release.wait(5)
        return SEGMENTS
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(extract_cached_pdf, path, root, extract)
        assert entered.wait(5)
        second = pool.submit(extract_cached_pdf, path, root, extract)
        release.set()
        assert first.result() == second.result() == SEGMENTS
    assert calls == [True]


def test_failed_empty_or_changing_source_is_never_cached(tmp_path):
    path, root = source(tmp_path)
    def failure():
        raise RuntimeError('OCR failed on page 2')
    with pytest.raises(RuntimeError, match='OCR failed'):
        extract_cached_pdf(path, root, failure)
    assert extract_cached_pdf(path, root, lambda: []) == []
    def changed():
        path.write_bytes(b'changed during OCR')
        return SEGMENTS
    with pytest.raises(RuntimeError, match='changed during extraction'):
        extract_cached_pdf(path, root, changed)
    assert not list(root.rglob('*.json'))


@pytest.mark.parametrize('failure', [None, 'exception', 'empty', 'unavailable'])
def test_ocr_failure_cannot_drop_a_page_or_leave_native_resources_open(tmp_path, monkeypatch, failure):
    import logging
    from types import SimpleNamespace
    from backend.domains.llm_wiki import documents
    path, root = source(tmp_path)
    closed = []
    class Reader:
        outline = []
        def __init__(self, _):
            self.pages = [SimpleNamespace(extract_text=lambda: '', images=['cover'])]
    class Image:
        def save(self, _): pass
        def close(self): closed.append('image')
    class Bitmap:
        def to_pil(self): return Image()
        def close(self): closed.append('bitmap')
    class Page:
        def render(self, **_): return Bitmap()
        def close(self): closed.append('page')
    class Document:
        def __getitem__(self, _): return Page()
        def close(self): closed.append('document')
    monkeypatch.setattr('pypdf.PdfReader', Reader)
    monkeypatch.setattr('pypdfium2.PdfDocument', lambda _: Document())
    monkeypatch.setattr(documents.shutil, 'which', lambda _: None if failure == 'unavailable' else 'tesseract')
    def ocr(_):
        if failure == 'exception':
            raise RuntimeError('OCR process died')
        return '' if failure == 'empty' else 'Cover title'
    def extract():
        return documents.extract_pdf(path, run_tesseract=ocr, temporary_root=lambda: tmp_path,
                                     logger=logging.getLogger(__name__))
    if failure:
        with pytest.raises(RuntimeError, match='OCR'):
            extract_cached_pdf(path, root, extract)
        assert not list(root.rglob('*.json'))
    else:
        assert extract_cached_pdf(path, root, extract)[0]['text'] == 'Cover title'
    assert closed == ([] if failure == 'unavailable' else ['image', 'bitmap', 'page', 'document'])
