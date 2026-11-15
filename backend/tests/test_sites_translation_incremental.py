"""Translation changes invalidate their rendered dependents, preserving other articles."""
import json

from bs4 import BeautifulSoup

from backend.domains.sites.models import SiteBlock, SitePage
from backend.tests.test_sites_incremental_preview import bundle, documents, render
from backend.tests.test_sites_incremental_preview import pytestmark as pytestmark


def keys(root):
    return json.loads(json.loads((root / 'manifest.json').read_text())['payload'])['index']['routes']


def test_translation_publish_and_withdraw_reuse_unrelated_articles(tmp_path):
    payload = bundle()
    payload['site']['languages'] = ['ca', 'es']
    payload['site']['pages'].append(SitePage(id='es-home', language='es', path='/es', title='Inicio', enabled=True).model_dump(mode='json'))
    root = tmp_path / 'cache'
    render(payload, tmp_path / 'initial', root)
    previous = keys(root)
    original = payload['records'][0]
    translation = {**original, 'language': 'es', 'path': '/es/articles/one', 'title': 'Traducción'}
    payload['records'].append(translation)
    added = render(payload, tmp_path / 'added', root)
    published = keys(root)
    unrelated = '/ca/articles/two'
    assert published[unrelated] == previous[unrelated]
    assert published[original['path']] != previous[original['path']]
    assert added['reused'] > 0 and added['rendered'] < len(published)
    original_html = (tmp_path / 'added/ca/articles/one/index.html').read_text()
    assert 'hreflang="es"' in original_html and translation['path'] in original_html
    assert translation['path'] in (tmp_path / 'added/sitemap.xml').read_text()
    assert 'Traducción' in (tmp_path / 'added/es/rss.xml').read_text()
    render(payload, tmp_path / 'added-full', None)
    assert documents(tmp_path / 'added') == documents(tmp_path / 'added-full')

    payload['records'].pop()
    payload['withdrawn_paths'] = [translation['path']]
    removed = render(payload, tmp_path / 'removed', root)
    withdrawn = keys(root)
    assert removed['reused'] > 0
    assert withdrawn[unrelated] == published[unrelated]
    assert withdrawn[original['path']] != published[original['path']]
    assert (tmp_path / 'removed/ca/articles/one/index.html').is_file()
    assert not (tmp_path / 'removed/es/articles/one/index.html').exists()
    html = BeautifulSoup((tmp_path / 'removed/ca/articles/one/index.html').read_text(), 'html.parser')
    assert not html.select('link[hreflang="es"]')
    assert html.select_one('.header-tools a[lang="es"]')['href'] == '/es'
    assert translation['path'] not in (tmp_path / 'removed/sitemap.xml').read_text()
    assert 'Traducción' not in (tmp_path / 'removed/es/rss.xml').read_text()
    render(payload, tmp_path / 'removed-full', None)
    assert documents(tmp_path / 'removed') == documents(tmp_path / 'removed-full')


def test_configured_navigation_tracks_route_membership(tmp_path):
    payload = bundle()
    payload['deployment_url'] += '/preview'
    path = '/ca/articles/later'
    payload['site']['navigation'] = [{'label': 'Later', 'href': 'https://example.invalid' + path}]
    payload['records'][0]['body_html'] = '<p><a href="' + path + '">Private after withdrawal</a></p>'
    root = tmp_path / 'cache'
    render(payload, tmp_path / 'initial', root)
    assert 'target="_blank"' in str(BeautifulSoup((tmp_path / 'initial/ca/articles/two/index.html').read_text(), 'html.parser').select_one('#site-navigation a'))
    previous = keys(root)
    payload['records'].append({**payload['records'][0], 'id': 'later', 'path': path})
    render(payload, tmp_path / 'changed', root)
    assert keys(root)['/ca/articles/two'] != previous['/ca/articles/two']
    link = BeautifulSoup((tmp_path / 'changed/ca/articles/two/index.html').read_text(), 'html.parser').select_one('#site-navigation a')
    assert link['href'] == '/preview' + path and not link.has_attr('target')
    render(payload, tmp_path / 'full', None)
    assert documents(tmp_path / 'changed') == documents(tmp_path / 'full')
    payload['records'].pop()
    payload['withdrawn_paths'] = [path]
    render(payload, tmp_path / 'withdrawn', root)
    article = BeautifulSoup((tmp_path / 'withdrawn/ca/articles/one/index.html').read_text(), 'html.parser')
    assert article.select_one('.record-body a') is None
    assert article.select_one('.record-body span').text == 'Private after withdrawal'
    assert not (tmp_path / 'withdrawn/ca/articles/later/index.html').exists()
    render(payload, tmp_path / 'withdrawn-full', None)
    assert documents(tmp_path / 'withdrawn') == documents(tmp_path / 'withdrawn-full')


def test_legacy_home_translation_fallback_tracks_selected_record(tmp_path):
    payload = bundle()
    payload['site'].update(legacy_pilot=True, languages=['ca', 'es'])
    payload['site']['sources'][0]['source_id'] = 'imported:blog'
    payload['site']['pages'] = [SitePage(id='home-' + lang, language=lang, path='/' + lang, title='Home', template='home', enabled=True,
        blocks=[SiteBlock(id='featured-' + lang, type='selected', page_ids=['one'], limit=1)]).model_dump(mode='json') for lang in ['ca', 'es']]
    root = tmp_path / 'cache'
    render(payload, tmp_path / 'initial', root)
    previous = keys(root)
    assert '/ca/articles/one' in (tmp_path / 'initial/es/index.html').read_text()
    payload['records'].append({**payload['records'][0], 'language': 'es', 'path': '/es/articles/one', 'title': 'Traducción'})
    stats = render(payload, tmp_path / 'changed', root)
    assert keys(root)['/ca/articles/two'] == previous['/ca/articles/two']
    assert stats['reused'] > 0
    assert '/es/articles/one' in (tmp_path / 'changed/es/index.html').read_text()
    render(payload, tmp_path / 'full', None)
    assert documents(tmp_path / 'changed') == documents(tmp_path / 'full')
