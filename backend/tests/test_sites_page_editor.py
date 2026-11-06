"""Imported static layouts remain reversible and explicit editorial overrides stay scoped."""
import json

import pytest
from bs4 import BeautifulSoup
from fastapi import HTTPException
from pydantic import ValidationError

from backend.domains.sites.exporter import build_bundle
from backend.domains.sites.models import SiteBlock
from backend.domains.sites.page_editor import imported_static_pages, static_blocks
from backend.domains.sites.renderer import render_bundle
from backend.domains.sites.theme_assets import read_asset
from backend.tests.test_sites_imported_pilot import imported_pilot


def add_static(store):
    path = store.site_dir(store.list()[0].id) / 'imported/baseline.json'
    payload = json.loads(path.read_text())
    body = '<main><div class="content-extra"><div class="layout layout--twocol-section layout--twocol-section--50-50"><div class="layout__region"><h2>Heading</h2><p>Keep <strong>bold</strong> and <a href="/ca/blog">link</a>.</p></div><div class="layout__region"><img src="/sites/default/files/photo.png" alt="Portrait"></div></div></div></main>'
    payload['data']['nodes'].append({'uuid': 'static-public', 'nid': 5, 'type': 'page', 'lang': 'ca', 'title': 'Profile', 'url': '/ca/profile', 'body_html': body, 'fields': {}})
    path.write_text(json.dumps(payload))
    return path, path.read_bytes(), body


def test_static_projection_preserves_snapshot_and_replaces_only_selected_language(imported_pilot):
    store, site, _, _ = imported_pilot
    path, original, body = add_static(store)
    before = build_bundle(store, site, 'local')
    assert next(record for record in before.records if record.id == 'static-public').body_html == body
    page = imported_static_pages(store, site)[0]
    assert page.imported_record_id == 'static-public'
    assert len(page.blocks) == 1 and page.blocks[0].type == 'split'
    assert '<strong>bold</strong>' in page.blocks[0].body
    assert page.blocks[0].image.endswith('photo.png') and page.blocks[0].image_position == 'right'
    page.blocks[0].body += '<p>Edited introduction.</p>'
    site.pages.append(page)
    store.save(site)
    after = build_bundle(store, site, 'local')
    assert not any(record.id == 'static-public' for record in after.records)
    assert len({record.path for record in after.records} | {page.path for page in after.site.pages if page.enabled}) == len(after.records) + len([page for page in after.site.pages if page.enabled])
    assert any(asset.path.endswith('photo.png') for asset in after.assets)
    assert path.read_bytes() == original
    site.pages.remove(page)
    restored = build_bundle(store, site, 'local')
    assert next(record for record in restored.records if record.id == 'static-public').body_html == body


def test_editor_cannot_override_an_article_or_hijack_another_url(imported_pilot):
    store, site, _, _ = imported_pilot
    add_static(store)
    page = imported_static_pages(store, site)[0]
    site.pages.append(page)
    page.path = '/ca/hijacked'
    with pytest.raises(HTTPException, match='') as error:
        build_bundle(store, site, 'local')
    assert error.value.status_code == 422
    page.path = '/ca/profile'
    site.sources[0].withdrawn_ids.append('static-public')
    with pytest.raises(HTTPException):
        build_bundle(store, site, 'local')


def test_complex_imports_and_surrounding_content_are_never_silently_flattened():
    body = '<p>Before</p><div class="content-extra"><div class="layout"><p>Inside</p></div></div><p>After</p>'
    assert static_blocks(body)[0].body == body
    body = '<div class="content-extra"><div class="layout"><div class="layout__region"><p>Caption</p><img src="/image.png"></div><div class="layout__region"><p>Text</p></div></div></div>'
    assert static_blocks(body)[0].type == 'text'
    assert 'Caption' in static_blocks(body)[0].body
    with pytest.raises(ValidationError):
        SiteBlock(width=101)
    with pytest.raises(ValidationError):
        SiteBlock(alignment='url(javascript:alert(1))')


def test_imported_image_frames_survive_conversion_and_preview_respects_withdrawals(imported_pilot):
    from pathlib import Path
    store, site, _, _ = imported_pilot
    path, _, body = add_static(store)
    payload = json.loads(path.read_text())
    original = next(asset for asset in payload['assets'] if asset['path'].endswith('/photo.png'))
    asset = {**original, 'path': '/sites/default/files/portrait2.png'}
    copy = Path(original['private_source']).with_name('portrait2.png')
    copy.write_bytes(Path(original['private_source']).read_bytes())
    asset['private_source'] = str(copy)
    payload['assets'].append(asset)
    node = payload['data']['nodes'][-1]
    node['body_html'] = body.replace('<img ', '<div class="img-coneix-me"><img ').replace('alt="Portrait">', 'alt="Portrait"></div>').replace('/photo.png', '/portrait2.png')
    path.write_text(json.dumps(payload))
    page = imported_static_pages(store, site)[0]
    assert page.blocks[0].image_width == 80 and page.blocks[0].image_frame == 'inset'
    assert page.blocks[0].alignment == 'center'
    assert read_asset(store, site, asset['path']) == copy.read_bytes()
    site.sources[0].withdrawn_ids.append('static-public')
    with pytest.raises(HTTPException) as failure:
        read_asset(store, site, asset['path'])
    assert failure.value.status_code == 404


def test_rendered_html_blocks_keep_layout_and_strip_executable_content(imported_pilot, tmp_path):
    store, site, _, _ = imported_pilot
    add_static(store)
    page = imported_static_pages(store, site)[0]
    page.blocks[0].width = 80
    page.blocks[0].alignment = 'center'
    page.blocks[0].body += '<script>BAD_EXECUTION()</script><img src="javascript:bad()" onerror="BAD_HANDLER()">'
    site.pages.append(page)
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    bundle['deployment_url'] = 'https://example.invalid/staging/current'
    output = tmp_path / 'render'
    render_bundle(bundle, output)
    result = BeautifulSoup((output / 'ca/profile/index.html').read_text(), 'html.parser')
    block = result.select_one('[data-block-id]')
    assert block['data-align'] == 'center' and '--block-width:80%' in block['style']
    assert result.select_one('.split figure img')['src'].startswith('/staging/current/')
    assert result.select_one('strong').text == 'bold'
    assert 'BAD_EXECUTION' not in str(result) and 'BAD_HANDLER' not in str(result)
    assert 'javascript:' not in str(result)


@pytest.mark.parametrize("attributes", [
    'class="layout layout--twocol-section layout--twocol-section--33-67"',
    'class="layout layout--twocol-section layout--twocol-section--67-33"',
    'class="layout layout--twocol-section" id="destination"',
    'class="layout layout--twocol-section custom-composition"',
])
def test_unrepresented_row_semantics_remain_lossless(attributes):
    body = f'<div class="content-extra"><div {attributes}><div class="layout__region"><p>Text</p></div><div class="layout__region"><img src="/portrait.png" alt="Portrait"></div></div></div>'
    block = static_blocks(body)[0]
    assert block.type == 'text' and block.body_format == 'html'
    original = BeautifulSoup(body, 'html.parser').select_one('.layout')
    preserved = BeautifulSoup(block.body, 'html.parser').select_one('.layout')
    assert preserved == original


@pytest.mark.parametrize("image_region", [
    '<div class="layout__region" id="destination"><img src="/portrait.png" alt="Portrait"></div>',
    '<div class="layout__region custom-image"><img src="/portrait.png" alt="Portrait"></div>',
    '<div class="layout__region" style="padding:20px"><img src="/portrait.png" alt="Portrait"></div>',
    '<div class="layout__region"><div id="destination"><img src="/portrait.png" alt="Portrait"></div></div>',
    '<div class="layout__region"><img src="/portrait.png" alt="Portrait" width="200" class="custom-image"></div>',
])
def test_unrepresented_image_region_semantics_remain_lossless(image_region):
    body = f'<div class="content-extra"><div class="layout layout--twocol-section"><div class="layout__region"><p>Text</p></div>{image_region}</div></div>'
    block = static_blocks(body)[0]
    assert block.type == 'text' and block.body_format == 'html'
    assert BeautifulSoup(block.body, 'html.parser').select_one('.layout') == BeautifulSoup(body, 'html.parser').select_one('.layout')


def test_outer_anchor_is_preserved_when_projecting_independent_blocks():
    body = '<div class="content-extra" id="section"><div class="layout layout--twocol-section"><div class="layout__region"><p>Text</p></div><div class="layout__region"><img src="/portrait.png" alt="Portrait"></div></div></div>'
    block = static_blocks(body)[0]
    assert block.type == 'text' and block.body == body


@pytest.mark.parametrize("sibling", ['<a id="destination"></a>', '<hr>', '<div class="decoration"></div>'])
def test_empty_nonlayout_siblings_remain_in_original_position(sibling):
    body = f'<div class="content-extra">{sibling}<div class="layout layout--twocol-section"><div class="layout__region"><p><a href="#destination">Text</a></p></div><div class="layout__region"><img src="/portrait.png" alt="Portrait"></div></div></div>'
    block = static_blocks(body)[0]
    assert block.type == 'text' and block.body == body


def test_empty_layout_anchor_survives_projection():
    body = '<div class="content-extra"><div class="layout" id="destination"></div><div class="layout"><p><a href="#destination">Text</a></p></div></div>'
    blocks = static_blocks(body)
    assert BeautifulSoup(''.join(block.body for block in blocks), 'html.parser').select_one('#destination') is not None


@pytest.mark.parametrize("extra", ['<a id="destination"></a>', '<hr>', '<p>Important introduction</p>', 'Important introduction'])
def test_extra_row_children_are_not_dropped_by_split_conversion(extra):
    body = f'<div class="content-extra"><div class="layout layout--twocol-section">{extra}<div class="layout__region"><p>Text</p></div><div class="layout__region"><img src="/portrait.png" alt="Portrait"></div></div></div>'
    block = static_blocks(body)[0]
    assert block.type == 'text'
    assert BeautifulSoup(block.body, 'html.parser').select_one('.layout') == BeautifulSoup(body, 'html.parser').select_one('.layout')
