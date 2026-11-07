"""Editable stylesheet layers retain defaults, safety and publication cache identity."""
import json
import os
import subprocess
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from bs4 import BeautifulSoup
from fastapi import HTTPException
from pydantic import ValidationError

from backend.domains.sites.exporter import build_bundle
from backend.domains.sites.models import SiteBlock, SiteTheme
from backend.domains.sites.paths import extension_root
from backend.domains.sites.renderer import render_bundle
from backend.domains.sites.stylesheets import STYLESHEETS, website_stylesheet
from backend.domains.sites.validation import validate_site
from backend.tests.test_sites import website as website


def test_original_styles_are_available_without_writing_overrides():
    theme = SiteTheme()
    css = website_stylesheet(theme)
    for filename in STYLESHEETS.values():
        assert (extension_root() / 'renderer/src/lib' / filename).read_text() in css
    assert theme.stylesheet_overrides == {}


def test_stylesheet_edits_roundtrip_per_website_and_restore_to_defaults(website):
    original = website_stylesheet(website.site.theme)
    website.site.theme.stylesheet_overrides = {'base': '.custom { color: red; }', 'template': ''}
    restored = website.store.load(website.store.save(website.site).id)
    assert restored.theme.stylesheet_overrides == website.site.theme.stylesheet_overrides
    assert '.custom { color: red; }' in website_stylesheet(restored.theme)
    other = website.site.model_copy(deep=True)
    other.theme = SiteTheme()
    assert website_stylesheet(other.theme) == original
    restored.theme.stylesheet_overrides = {}
    assert website_stylesheet(restored.theme) == original


@pytest.mark.parametrize('css', ['@import "https://tracker.invalid/x.css";', 'body{background:url(https://tracker.invalid/pixel)}', '</style><script>bad()</script>', 'body { color: red;'])
def test_custom_layers_keep_the_existing_css_safety_policy(website, css):
    website.site.theme.stylesheet_overrides = {'layout': css}
    with pytest.raises(HTTPException):
        validate_site(website.site)


def test_stylesheet_contract_bounds_keys_and_sizes():
    with pytest.raises(ValidationError):
        SiteTheme.model_validate({'stylesheet_overrides': {'unknown': ''}})
    with pytest.raises(ValidationError):
        SiteTheme.model_validate({'stylesheet_overrides': {'base': 'x' * 100001}})


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_published_stylesheet_uses_the_edited_layer_and_content_hash(website, tmp_path):
    site = website.site
    site.theme.stylesheet_overrides = {'template': '@layer components { .css-proof { color: rgb(1, 2, 3); } }'}
    site.pages[0].blocks = [SiteBlock(body_format='html', body='<p class="css-proof">Styled content</p>')]
    output = tmp_path / 'public'
    bundle = build_bundle(website.store, site, 'local').model_dump(mode='json')
    render_bundle(bundle, output)
    document = BeautifulSoup((output / site.pages[0].path.strip('/') / 'index.html').read_text(), 'html.parser')
    href = document.select_one('link[rel=stylesheet]')['href']
    assert '/_astro/gnosi-styles-' in href
    css = (output / href.lstrip('/')).read_text()
    assert '.css-proof { color: rgb(1, 2, 3); }' in css
    assert '.temenos-site .temenos-home' not in css
    assert 'grid-template-columns' in css
    assert document.select_one('.css-proof').get_text() == 'Styled content'


@pytest.mark.skipif(os.environ.get('GNOSI_STYLESHEET_BROWSER_PROBE') != '1', reason='Required in browser acceptance with its Playwright/Chromium dependencies')
def test_edited_base_css_applies_in_chromium_to_actual_astro_output(website, tmp_path):
    assert (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), 'Browser acceptance requires pinned renderer dependencies'
    site = website.site
    original = (extension_root() / 'renderer/src/lib/styles.css').read_text()
    site.theme.stylesheet_overrides = {'base': original + '\n.page-title { color: rgb(1, 2, 3); }'}
    output = tmp_path / 'public'
    render_bundle(build_bundle(website.store, site, 'local').model_dump(mode='json'), output)
    # This probe serves only its temporary Astro output. It does not relax the
    # authenticated browser fixture's prohibition on PHP/child processes.
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(output)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        root = Path(__file__).resolve().parents[2]
        browser_script = """
const {chromium} = require(process.argv[1]);
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[2]);
    const color = await page.locator('.page-title').evaluate(node => getComputedStyle(node).color);
    console.log(JSON.stringify({color}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
"""
        result = subprocess.run([str(extension_root() / 'renderer/node_modules/node/bin/node'), '-e', browser_script,
                                 str(root / 'tests/e2e/node_modules/@playwright/test'),
                                 f'http://127.0.0.1:{server.server_port}/ca/'], capture_output=True, text=True, timeout=60, check=True)
        assert json.loads(result.stdout)['color'] == 'rgb(1, 2, 3)'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize('value', [
    'image-set("https://tracker.invalid/pixel.png" 1x)',
    '-webkit-image-set("https://tracker.invalid/pixel.png" 1x)',
    'IMAGE-SET ("/private.png" 1x)',
    'image-/**/set("relative.png" 1x)',
    'image("https://tracker.invalid/pixel.png")',
    'src("https://tracker.invalid/font.woff2")',
    'url /* whitespace */ ("https://tracker.invalid/pixel.png")',
    r'\69mage-set("https://tracker.invalid/pixel.png" 1x)',
])
def test_resource_functions_rejected_at_all_css_entry_points(website, value):
    css = '.probe { background-image: ' + value + '; }'
    for layer in ('base', 'template', 'layout'):
        theme = SiteTheme(stylesheet_overrides={layer: css})
        with pytest.raises(HTTPException):
            website_stylesheet(theme)
    for location in ('advanced', 'page', 'block', 'token'):
        site = website.site.model_copy(deep=True)
        if location == 'advanced':
            site.theme.advanced_css = css
        elif location == 'page':
            site.pages[0].css = css
        elif location == 'block':
            site.pages[0].blocks[0].css = css
        else:
            site.theme.tokens['surface'] = value
        with pytest.raises(HTTPException):
            validate_site(site)


def test_safe_stylesheet_functions_and_font_stacks_remain_editable(website):
    website.site.theme.advanced_css = '.probe:where(:not(.hidden)){width:clamp(1rem, calc(100% - var(--spacing)), 80rem);background:linear-gradient(45deg, rgb(1,2,3), #fff);}'
    website.site.theme.tokens['font-body'] = '"Inter", Georgia, serif'
    validate_site(website.site)
