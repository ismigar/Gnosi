"""Real renderer reuse must match a full rebuild and preserve fresh review checks."""
import json
import os
from pathlib import Path

import pytest

from backend.domains.sites import preview_render_cache as cache
from backend.domains.sites.models import PublicRecord, SiteBlock, SiteBundle, SiteConfig, SitePage, SiteSource
from backend.domains.sites.paths import extension_root
from backend.domains.sites.renderer import render_bundle

pytestmark = pytest.mark.skipif(os.name != 'posix' or not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer and POSIX private-cache guards required')


def bundle():
    site = SiteConfig(name='Incremental example', origin='https://example.invalid', languages=['ca'])
    site.pages = [SitePage(id='home', path='/ca', title='Home', enabled=True)]
    site.sources = [SiteSource(id='articles', source_id='articles', title='Articles', enabled=True, path_prefix='/articles')]
    records = [PublicRecord(id=name, language='ca', title=name, path='/ca/articles/'+name,
                            source_ids=['articles'], body_html='<p>'+name+' original body</p>') for name in ['one', 'two']]
    result = SiteBundle(site=site, records=records).model_dump(mode='json')
    result['deployment_url'] = 'http://127.0.0.1:40001'
    result['deployment_environment'] = 'staging'
    return result


def render(payload, output, root):
    token = cache.preview_cache_root.set(root)
    try:
        render_bundle(payload, output)
    finally:
        cache.preview_cache_root.reset(token)
    log = output.parent / (output.name+'.build.log')
    stats = next(json.loads(line)['incremental'] for line in log.read_text().splitlines() if line.startswith('{"incremental":'))
    return stats


def documents(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*')
            if p.is_file() and (p.suffix in {'.html', '.xml'} or p.name in {'robots.txt', '.htaccess'})}


def test_no_change_skips_astro_and_search_while_origin_feeds_are_fresh(tmp_path):
    payload = bundle(); root = tmp_path/'private'
    first = render(payload, tmp_path/'first', root)
    payload['deployment_url'] = 'http://127.0.0.1:40002'
    second = render(payload, tmp_path/'second', root)
    assert first['rendered'] > 0 and first['search_rebuilt']
    assert second == dict(rendered=0, reused=first['rendered'], search_rebuilt=False)
    assert (tmp_path/'first/ca/articles/one/index.html').read_bytes() == (tmp_path/'second/ca/articles/one/index.html').read_bytes()
    assert '40002' in (tmp_path/'second/sitemap.xml').read_text()
    assert '40001' not in (tmp_path/'second/ca/rss.xml').read_text()
    assert (tmp_path/'first/pagefind/pagefind.js').read_bytes() == (tmp_path/'second/pagefind/pagefind.js').read_bytes()
    assert len([p for p in root.iterdir() if p.is_dir()]) == 1


def test_one_body_edit_rebuilds_dependents_and_matches_full_render(tmp_path):
    payload = bundle(); root = tmp_path/'private'
    initial = render(payload, tmp_path/'first', root)
    payload['records'][0]['body_html'] = '<p>Fresh uniquely changed article content</p>'
    changed = render(payload, tmp_path/'changed', root)
    assert 0 < changed['rendered'] < initial['rendered'] and changed['reused'] > 0 and changed['search_rebuilt']
    assert (tmp_path/'first/ca/articles/two/index.html').read_bytes() == (tmp_path/'changed/ca/articles/two/index.html').read_bytes()
    assert 'Fresh uniquely changed' in (tmp_path/'changed/ca/articles/one/index.html').read_text()
    render(payload, tmp_path/'full', None)
    assert documents(tmp_path/'changed') == documents(tmp_path/'full')


@pytest.mark.parametrize('change', ['withdraw', 'translation', 'chrome', 'fallback-label'])
def test_cross_route_dependencies_match_full_output(tmp_path, change):
    payload = bundle(); root = tmp_path/'private'
    render(payload, tmp_path/'first', root)
    if change == 'withdraw':
        payload['records'].pop(); payload['withdrawn_paths'] = ['/ca/articles/two']
    elif change == 'translation':
        payload['records'].append({**payload['records'][0], 'language':'es', 'path':'/es/articles/one'})
    elif change == 'chrome':
        payload['site']['footer_blocks'] = [SiteBlock(type='selected', page_ids=['one']).model_dump(mode='json')]
        payload['records'][0]['body_html'] = '<p>New footer selection body</p>'
    else:
        payload['records'][0]['fields'] = {'summary':'Value'}
        payload['records'][1]['field_labels'] = {'summary':'Changed fallback label'}
    render(payload, tmp_path/'changed', root)
    render(payload, tmp_path/'full', None)
    assert documents(tmp_path/'changed') == documents(tmp_path/'full')
    if change == 'withdraw':
        assert not (tmp_path/'changed/ca/articles/two/index.html').exists()


@pytest.mark.parametrize('fault', ['html', 'manifest', 'symlink', 'missing'])
def test_corrupt_or_unavailable_cache_falls_back_without_leaking_private_data(tmp_path, fault):
    payload = bundle(); root = tmp_path/'private'
    first = render(payload, tmp_path/'first', root)
    manifest = json.loads(json.loads((root/'manifest.json').read_text())['payload'])
    html = root/manifest['generation']/'ca/articles/one/index.html'
    if fault == 'html': html.write_text('CORRUPTED PRIVATE CACHE')
    elif fault == 'manifest': (root/'manifest.json').write_text('{broken')
    elif fault == 'missing': html.unlink()
    else:
        html.unlink(); html.symlink_to(tmp_path/'outside')
        (tmp_path/'outside').write_text('OUTSIDE PRIVATE CONTENT')
    second = render(payload, tmp_path/'second', root)
    assert second['rendered'] == first['rendered'] and second['reused'] == 0
    assert 'CORRUPTED' not in (tmp_path/'second/ca/articles/one/index.html').read_text()
    assert 'OUTSIDE' not in (tmp_path/'second/ca/articles/one/index.html').read_text()
    assert not (tmp_path/'second/bundle.json').exists()
