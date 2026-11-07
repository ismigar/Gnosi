"""Imported fonts are local assets; provider input never becomes executable CSS."""
import struct
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.domains.sites import font_catalogue as fonts
from backend.domains.sites.font_metadata import describe_font
from backend.domains.sites.public_http import PublicResponse, PublicFetchError
from backend.domains.sites.theme_assets import read_asset
from backend.tests.test_sites import website as website


def font_file():
    # A genuine checked-in font exercises metadata and the upload validator.
    root = Path(__file__).resolve().parents[2]
    return (root / 'frontend/node_modules/@blocknote/core/src/fonts/inter-v12-latin/inter-v12-latin-regular.woff').read_bytes()


def test_upload_describes_real_woff_without_typing_family_or_weight():
    detected = describe_font(font_file(), 'opaque-download.woff', '/local.woff')
    assert detected.family == 'Inter'
    assert detected.weight == '400'
    assert detected.style == 'normal'
    assert detected.src == '/local.woff'


def test_filename_fallback_and_bounded_malformed_metadata():
    raw = bytearray(font_file())
    struct.pack_into('>H', raw, 12, 65535)
    assert describe_font(raw, 'Àgora-BoldItalic.woff', '/font.woff').family == 'Àgora'
    assert describe_font(raw, 'Àgora-BoldItalic.woff', '/font.woff').weight == '700'
    assert describe_font(raw, 'Àgora-BoldItalic.woff', '/font.woff').style == 'italic'


@pytest.mark.parametrize('url', ['https://fonts.google.com/specimen/Open+Sans', 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700', 'https://fonts.google.com/selection/embed?family=Open+Sans', 'https://fonts.google.com/share?selection.family=Open+Sans'])
def test_google_family_urls(url):
    assert fonts._google_families(url) == ['Open Sans']


@pytest.mark.parametrize('url', ['http://fonts.google.com/specimen/Roboto', 'https://evil.invalid/specimen/Roboto', 'https://fonts.google.com@127.0.0.1/specimen/Roboto', 'https://fonts.google.com/specimen/Roboto/../../bad', 'https://fonts.googleapis.com/css2?family=Roboto;@import(bad)', 'https://fonts.google.com:8443/specimen/Roboto'])
def test_remote_font_input_is_not_a_general_fetcher(website, url):
    with pytest.raises(HTTPException):
        fonts.import_fonts(website.store, website.site.id, fonts.FontImportRequest(url=url))


def test_source_is_unambiguous():
    for values in ({}, {'url': 'x', 'catalogue_id': 'y'}):
        with pytest.raises(ValidationError):
            fonts.FontImportRequest(**values)


def test_google_import_downloads_and_uploads_without_changing_site(website, monkeypatch):
    before = website.store.load(website.site.id).model_dump()
    requests = []
    css = b"@font-face { font-family:'Inter'; font-style:normal; font-weight:400; src:url(https://fonts.gstatic.com/s/inter/font.woff); }"
    raw = font_file()
    def fetch(url, budget, *, maximum):
        requests.append((url, maximum, budget))
        return PublicResponse(url, css if 'googleapis' in url else raw, 'text/css')
    monkeypatch.setattr(fonts.public_http, 'fetch', fetch)
    result = fonts.import_fonts(website.store, website.site.id, fonts.FontImportRequest(url='https://fonts.google.com/specimen/Inter'))
    assert len(result) == 1 and result[0].family == 'Inter'
    assert read_asset(website.store, website.site, result[0].src) == raw
    assert website.store.load(website.site.id).model_dump() == before
    assert 'family=Inter:400,700' in requests[0][0]
    assert requests[0][2] is requests[1][2]


def test_fontsource_catalogue_downloads_two_local_weights(website, monkeypatch):
    # Valid upload bytes rather than remote CSS or HTML, even if provider lies.
    raw = font_file()
    monkeypatch.setattr(fonts.public_http, 'fetch', lambda *args, **kwargs: PublicResponse(args[0], raw, 'font/woff'))
    # This provider promises WOFF2; a WOFF body must be rejected.
    with pytest.raises(HTTPException):
        fonts.import_fonts(website.store, website.site.id, fonts.FontImportRequest(catalogue_id='fontsource:inter'))


@pytest.mark.parametrize('body', [b'<html>not CSS</html>', b"@font-face{font-family:'Inter';font-weight:400;src:url(http://127.0.0.1/font.woff)}", b"@font-face{font-family:'Inter';font-weight:400;src:url(https://fonts.gstatic.com/font.woff);unicode-range:U+0020-007F}"])
def test_remote_css_is_parsed_and_never_stored_or_executed(website, monkeypatch, body):
    monkeypatch.setattr(fonts.public_http, 'fetch', lambda *args, **kwargs: PublicResponse(args[0], body, 'text/css'))
    with pytest.raises(HTTPException):
        fonts.import_fonts(website.store, website.site.id, fonts.FontImportRequest(url='https://fonts.google.com/specimen/Inter'))


def test_public_fetch_failures_do_not_modify_configuration(website, monkeypatch):
    before = website.store.load(website.site.id).model_dump()
    def fail(*args, **kwargs):
        raise PublicFetchError('Private or reserved network addresses cannot be imported')
    monkeypatch.setattr(fonts.public_http, 'fetch', fail)
    with pytest.raises(HTTPException, match='422'):
        fonts.import_fonts(website.store, website.site.id, fonts.FontImportRequest(url='https://fonts.google.com/specimen/Inter'))
    assert website.store.load(website.site.id).model_dump() == before


def test_catalogue_preview_is_bounded_cached_and_does_not_import(monkeypatch):
    fonts.catalogue_preview.cache_clear()
    raw = font_file()
    requests = []
    def fetch(url, budget, *, maximum):
        requests.append((url, maximum))
        body = b"@font-face{src:url(https://fonts.gstatic.com/font.woff)}" if 'googleapis' in url else raw
        return PublicResponse(url, body, 'text/css')
    monkeypatch.setattr(fonts.public_http, 'fetch', fetch)
    try:
        assert fonts.catalogue_preview('google:Roboto') == (raw, 'font/woff')
        assert fonts.catalogue_preview('google:Roboto') == (raw, 'font/woff')
        assert len(requests) == 2
        assert requests[1][1] == 500_000
        with pytest.raises(HTTPException):
            fonts.catalogue_preview('https://127.0.0.1/private')
        assert len(requests) == 2
    finally:
        fonts.catalogue_preview.cache_clear()
