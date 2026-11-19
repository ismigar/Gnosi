"""Clean English article routes generated from native content and static archives."""
import json
import yaml
import pytest
from bs4 import BeautifulSoup

from backend.domains.sites.exporter import build_bundle
from backend.domains.sites.renderer import render_bundle
from backend.domains.sites.models import NavigationLink, SiteBlock
from backend.tests.test_sites import website  # noqa: F401
from backend.tests.test_sites_imported_pilot import ARTICLE, imported_pilot  # noqa: F401
from backend.tests.test_sites_native_presentation import native_site  # noqa: F401


TITLE = 'Emotions hijacked: recovering the bond between feeling and thinking'
LEGACY = '/en-gb/node/2985'
CANONICAL = '/en/emotions-hijacked-recovering-the-bond-between-feeling-and-thinking'


def english_baseline(store, site):
    path = store.site_dir(site.id) / 'imported/baseline.json'
    payload = json.loads(path.read_text())
    node = next(node for node in payload['data']['nodes'] if node['uuid'] == ARTICLE and node['lang'] == 'en-gb')
    original = node['url']
    node.update(url=LEGACY, title=TITLE)
    site.redirects = {origin: LEGACY if target == original else target for origin, target in site.redirects.items()}
    path.write_text(json.dumps(payload))
    return path


def test_imported_numeric_url_is_replaced_and_stays_stable_after_title_edit(imported_pilot, monkeypatch):
    store, site, _, _ = imported_pilot
    baseline = english_baseline(store, site)
    site.redirects['/en-gb/old-article'] = LEGACY
    bundle = build_bundle(store, site, 'local')
    english = next(record for record in bundle.records if record.id == ARTICLE and record.language == 'en-gb')
    assert english.path == CANONICAL
    assert LEGACY not in bundle.site.redirects
    assert '/en-gb/old-article' not in bundle.site.redirects
    assert LEGACY not in bundle.withdrawn_paths
    assert next(record.path for record in bundle.records if record.id == ARTICLE and record.language == 'ca') == '/ca/articles/translated'
    monkeypatch.setattr(store, 'active_bundle', lambda *_: bundle.model_dump(mode='json'))
    payload = json.loads(baseline.read_text())
    next(node for node in payload['data']['nodes'] if node.get('url') == LEGACY)['title'] = 'Edited title'
    baseline.write_text(json.dumps(payload))
    updated = build_bundle(store, site, 'local')
    assert next(record.path for record in updated.records if record.id == ARTICLE and record.language == 'en-gb') == CANONICAL
    assert LEGACY not in updated.site.redirects
    assert site.redirects['/en-gb/old-article'] == LEGACY


@pytest.mark.parametrize('preferred', [None, LEGACY, '/en-gb/retained-english-url', '/en/existing-title'])
def test_native_article_defaults_and_legacy_metadata_keep_stable_urls(native_site, monkeypatch, preferred):
    w = native_site
    w.metadata.update(title=TITLE, Idioma='en')
    w.metadata.pop('web_path')
    if preferred:
        w.metadata['web_path'] = preferred
    w.write()
    first = build_bundle(w.store, w.bound, 'local')
    expected = preferred if preferred and preferred.startswith('/en/') else CANONICAL
    assert first.records[0].path == expected
    if preferred and preferred != expected:
        assert preferred not in first.site.redirects
    monkeypatch.setattr(w.store, 'active_bundle', lambda *_: first.model_dump(mode='json'))
    w.metadata.update(title='Later title')
    w.metadata.pop('web_path', None)
    w.write()
    updated = build_bundle(w.store, w.bound, 'local')
    assert updated.records[0].path == expected
    if preferred and preferred != expected:
        assert preferred not in updated.site.redirects


@pytest.mark.parametrize('previously_published', [False, True])
def test_duplicate_titles_receive_distinct_stable_routes(imported_pilot, monkeypatch, previously_published):
    store, site, _, _ = imported_pilot
    baseline = english_baseline(store, site)
    if previously_published:
        previous = build_bundle(store, site, 'local').model_dump(mode='json')
        monkeypatch.setattr(store, 'active_bundle', lambda *_: previous)
    payload = json.loads(baseline.read_text())
    other = dict(next(node for node in payload['data']['nodes'] if node.get('url') == LEGACY))
    other.update(uuid='00000000-0000-4000-8000-000000000001', nid=2986, url='/en-gb/node/2986')
    payload['data']['nodes'].append(other)
    baseline.write_text(json.dumps(payload))
    first = build_bundle(store, site, 'local')
    paths = {record.id: record.path for record in first.records if record.language == 'en-gb' and record.presentation['kind'] == 'article'}
    assert len(set(paths.values())) == 2
    assert all(path.startswith('/en/emotions-hijacked-') for path in paths.values())
    if previously_published:
        assert paths[ARTICLE] == CANONICAL
    monkeypatch.setattr(store, 'active_bundle', lambda *_: first.model_dump(mode='json'))
    payload['data']['nodes'].reverse()
    baseline.write_text(json.dumps(payload))
    second = build_bundle(store, site, 'local')
    assert {record.id: record.path for record in second.records if record.id in paths and record.language == 'en-gb'} == paths


def test_rendered_links_metadata_feeds_and_withdrawal_follow_new_route(imported_pilot, monkeypatch, tmp_path):
    store, site, _, _ = imported_pilot
    baseline = english_baseline(store, site)
    bundle = build_bundle(store, site, 'local')
    active = [bundle.model_dump(mode='json')]
    monkeypatch.setattr(store, 'active_bundle', lambda *_: active[0])
    output = tmp_path / 'public'
    render_bundle(active[0], output)
    article = BeautifulSoup((output / (CANONICAL.lstrip('/') + '/index.html')).read_text(), 'html.parser')
    assert article.html['lang'] == 'en-gb'
    assert article.select_one('link[rel="canonical"]')['href'] == 'https://example.invalid' + CANONICAL
    original = BeautifulSoup((output / 'ca/articles/translated/index.html').read_text(), 'html.parser')
    assert original.select_one('link[hreflang="en-gb"]')['href'] == 'https://example.invalid' + CANONICAL
    home = BeautifulSoup((output / 'en-gb/index.html').read_text(), 'html.parser')
    assert home.select_one('a[href="' + CANONICAL + '"]')
    for filename in ('en-gb/rss.xml', 'sitemap.xml'):
        xml = (output / filename).read_text()
        assert 'https://example.invalid' + CANONICAL in xml
        assert LEGACY not in xml
    assert 'en-gb/node/2985' not in (output / '.htaccess').read_text()
    assert not (output / 'en-gb/node/2985/index.html').exists()
    blog = next(source for source in site.sources if source.id == 'imported-blog')
    blog.withdrawn_versions = {ARTICLE: ['en-gb']}
    withdrawn = build_bundle(store, site, 'local')
    assert CANONICAL in withdrawn.withdrawn_paths
    assert LEGACY not in withdrawn.withdrawn_paths
    assert LEGACY not in withdrawn.site.redirects
    active[0] = withdrawn.model_dump(mode='json')
    blog.withdrawn_versions = {}
    restored = build_bundle(store, site, 'local')
    assert next(record.path for record in restored.records if record.id == ARTICLE and record.language == 'en-gb') == CANONICAL
    assert LEGACY not in restored.site.redirects
    assert not ({LEGACY, CANONICAL} & set(restored.withdrawn_paths))


@pytest.mark.parametrize('url_key', ['URL', 'href', 'Former content URL'])
def test_table_url_owns_route_over_old_local_metadata_and_release(native_site, monkeypatch, url_key):
    w = native_site
    registry = w.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    next(p for p in data['tables'][0]['properties'] if p['id'] == 'href')['aliases'] = ['Former content URL']
    registry.write_text(json.dumps(data))
    w.metadata.pop('URL')
    w.metadata.update({url_key: w.bound.origin + CANONICAL, 'Idioma': 'en', 'title': TITLE,
                       'web_path': LEGACY, 'drupal_path': '/en-gb/incorrect-copy'})
    w.write('[Read](' + w.bound.origin + LEGACY + '?q=1#part)')
    monkeypatch.setattr(w.store, 'active_bundle', lambda *_: {'records': [
        {'id': 'public-one', 'language': 'en-gb', 'path': LEGACY,
         'presentation': {'kind': 'article'}, 'source_ids': ['imported-blog']}]})
    (w.store.site_dir(w.bound.id) / 'imported/baseline.json').unlink()
    before = w.note.read_bytes()
    bundle = build_bundle(w.store, w.bound, 'local')
    assert bundle.records[0].path == CANONICAL
    assert 'href="' + CANONICAL + '?q=1#part"' in bundle.records[0].body_html
    assert not bundle.site.redirects
    assert LEGACY not in bundle.withdrawn_paths
    assert 'record_paths' not in bundle.model_dump()
    assert w.note.read_bytes() == before


def test_unregistered_url_on_public_and_private_rows_does_not_claim_a_route(website):
    original = build_bundle(website.store, website.site, 'local')
    folder = website.vault / 'BD/Articles'
    for name in ('one.md', 'two.md'):
        path = folder / name
        path.write_text(path.read_text().replace('\n---\n', '\nURL: /ca/local-only\n---\n', 1))

    result = build_bundle(website.store, website.site, 'local')
    assert [record.path for record in result.records] == [record.path for record in original.records]
    assert '/ca/local-only' not in {record.path for record in result.records}


def test_editorial_links_and_foreign_links_are_projected_to_correct_destinations(imported_pilot, tmp_path):
    store, site, _, _ = imported_pilot
    english_baseline(store, site)
    site.navigation.append(NavigationLink(label='English article', href=LEGACY, language='en-gb'))
    site.forms[0].privacy_urls['en-gb'] = LEGACY + '/'
    home = next(page for page in site.pages if page.id == 'home-en-gb')
    home.blocks += [SiteBlock(type='text', body='[Read](' + site.origin + LEGACY + '?q=1#part)'),
                    SiteBlock(type='text', body_format='html', body='<a href="https://foreign.invalid' + LEGACY + '">Foreign</a>')]
    bundle = build_bundle(store, site, 'local')
    assert bundle.site.navigation[-1].href == CANONICAL
    assert site.navigation[-1].href == LEGACY
    output = tmp_path / 'editorial'
    render_bundle(bundle.model_dump(mode='json'), output)
    page = BeautifulSoup((output / 'en-gb/index.html').read_text(), 'html.parser')
    assert page.select_one('a[href="' + CANONICAL + '"]')
    assert page.select_one('a[href="' + CANONICAL + '?q=1#part"]')
    assert page.select_one('a[href="https://foreign.invalid' + LEGACY + '"]')
    assert not page.select_one('a[href="' + LEGACY + '"]')
    contact = BeautifulSoup((output / 'en-gb/form/contact/index.html').read_text(), 'html.parser')
    assert contact.select_one('a[href="' + CANONICAL + '"]')
    assert not contact.select_one('a[href="' + LEGACY + '/"]')


def test_table_url_survives_title_edits_and_withdrawal_without_local_state(native_site, monkeypatch):
    w = native_site
    w.metadata.update(title=TITLE, Idioma='en', URL=w.bound.origin + CANONICAL)
    w.metadata.pop('web_path')
    w.write()
    active = [build_bundle(w.store, w.bound, 'local').model_dump(mode='json')]
    monkeypatch.setattr(w.store, 'active_bundle', lambda *_: active[0])
    w.bound.sources[0].withdrawn_versions = {'one': ['en-gb']}
    active[0] = build_bundle(w.store, w.bound, 'local').model_dump(mode='json')
    assert CANONICAL in active[0]['withdrawn_paths']
    w.metadata['title'] = 'Edited while withdrawn'
    w.write()
    w.bound.sources[0].withdrawn_versions = {}
    restored = build_bundle(w.store, w.bound, 'local')
    assert restored.records[0].path == CANONICAL
    assert CANONICAL not in restored.withdrawn_paths
    assert w.metadata['URL'] == w.bound.origin + CANONICAL


def test_duplicate_table_url_is_rejected_even_if_original_is_withdrawn(native_site):
    from fastapi import HTTPException
    w = native_site
    w.metadata.update(title=TITLE, Idioma='en', URL=w.bound.origin + CANONICAL)
    w.metadata.pop('web_path')
    w.write()
    w.bound.sources[0].withdrawn_versions = {'one': ['en-gb']}
    duplicate = {**w.metadata, 'id': 'copy', 'drupal_uuid': 'public-copy'}
    (w.note.parent / 'copy.md').write_text('---\n' + yaml.safe_dump(duplicate) + '---\nNew article\n')
    w.bound.sources[0].page_ids.append('copy')
    with pytest.raises(HTTPException, match='same URL') as error:
        build_bundle(w.store, w.bound, 'local')
    assert error.value.status_code == 422


def test_old_aliases_stay_absent_across_repeated_withdrawals(imported_pilot, monkeypatch):
    store, site, _, _ = imported_pilot
    english_baseline(store, site)
    site.redirects['/en-gb/old-article'] = CANONICAL
    active = [build_bundle(store, site, 'local').model_dump(mode='json')]
    monkeypatch.setattr(store, 'active_bundle', lambda *_: active[0])
    next(s for s in site.sources if s.id == 'imported-blog').withdrawn_versions = {ARTICLE: ['en-gb']}
    for _ in range(3):
        bundle = build_bundle(store, site, 'local')
        assert CANONICAL in bundle.withdrawn_paths
        assert '/en-gb/old-article' not in bundle.withdrawn_paths
        assert '/en-gb/old-article' not in bundle.site.redirects
        active[0] = bundle.model_dump(mode='json')


@pytest.mark.parametrize('path', [LEGACY, '/en-gb/previous-title', '/ca/node/12'])
def test_retired_address_in_declared_url_requires_table_correction(native_site, path):
    from fastapi import HTTPException
    w = native_site
    w.metadata.update(URL=w.bound.origin + path, Idioma='en')
    w.write()
    with pytest.raises(HTTPException, match='URL field'):
        build_bundle(w.store, w.bound, 'local')


def test_generated_duplicate_respects_url_field_of_withdrawn_record(native_site, monkeypatch):
    w = native_site
    w.metadata.update(title=TITLE, Idioma='en', URL=w.bound.origin + CANONICAL)
    w.metadata.pop('web_path')
    w.write()
    active = [build_bundle(w.store, w.bound, 'local').model_dump(mode='json')]
    monkeypatch.setattr(w.store, 'active_bundle', lambda *_: active[0])
    w.bound.sources[0].withdrawn_versions = {'one': ['en-gb']}
    active[0] = build_bundle(w.store, w.bound, 'local').model_dump(mode='json')
    duplicate = {**w.metadata, 'id': 'copy', 'drupal_uuid': 'public-copy', 'URL': ''}
    (w.note.parent / 'copy.md').write_text('---\n' + yaml.safe_dump(duplicate) + '---\nNew article\n')
    w.bound.sources[0].page_ids.append('copy')
    bundle = build_bundle(w.store, w.bound, 'local')
    assert bundle.records[0].path != CANONICAL
    active[0] = bundle.model_dump(mode='json')
    w.bound.sources[0].withdrawn_versions = {}
    restored = build_bundle(w.store, w.bound, 'local')
    assert next(r.path for r in restored.records if r.id == 'public-one') == CANONICAL
    assert next(r.path for r in restored.records if r.id == 'public-copy') == bundle.records[0].path


def test_nonarticle_english_page_can_keep_its_declared_url(native_site):
    w = native_site
    registry = w.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    data['tables'][0]['name'] = 'Pages'
    registry.write_text(json.dumps(data))
    w.bound.sources[0].id = 'native-pages'
    w.metadata.update(title='Privacy policy', Idioma='en', URL=w.bound.origin + '/en-gb/privacy')
    w.metadata.pop('web_path')
    w.write()
    record = build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation['kind'] == 'page'
    assert record.path == '/en-gb/privacy'


@pytest.mark.parametrize('value', ['www.megustaleer.com', '<https://dle.rae.es/>', 'www.zetaeme.com]'])
def test_unrelated_external_resource_url_does_not_become_a_local_route(native_site, value):
    w = native_site
    w.bound.sources[0].id = 'imported-research'
    w.metadata['URL'] = value
    w.write()
    record = build_bundle(w.store, w.bound, 'local').records[0]
    assert record.path == '/ca/native-stable'
    assert record.fields['href'] == value


def test_declared_resource_url_cleans_previous_links_without_preserving_old_route(native_site, monkeypatch):
    w = native_site
    w.bound.sources[0].id = 'imported-research'
    old = '/en-gb/recursos/old-resource'
    target = '/en/current-resource'
    w.metadata.update(title='Resource', Idioma='en', URL=w.bound.origin + target)
    w.metadata.pop('web_path')
    w.write('[Resource](' + old + '#reference)')
    monkeypatch.setattr(w.store, 'active_bundle', lambda *_: {'records': [{
        'id': 'public-one', 'language': 'en-gb', 'path': old, 'source_ids': ['imported-research'],
        'presentation': {'kind': 'recurs'}}]})
    bundle = build_bundle(w.store, w.bound, 'local')
    assert bundle.records[0].path == target
    assert 'href="' + target + '#reference"' in bundle.records[0].body_html
    assert old not in bundle.withdrawn_paths and old not in bundle.site.redirects


@pytest.mark.parametrize('active', [False, True])
def test_nonarticle_english_page_preserves_implicit_existing_path(native_site, monkeypatch, active):
    w = native_site
    registry = w.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    data['tables'][0]['name'] = 'Pages'
    registry.write_text(json.dumps(data))
    w.bound.sources[0].id = 'native-pages'
    w.metadata.update(title='Privacy policy', Idioma='en', URL='')
    if active:
        w.metadata.pop('web_path')
        monkeypatch.setattr(w.store, 'active_bundle', lambda *_: {'records': [{
            'id': 'public-one', 'language': 'en-gb', 'path': '/en-gb/privacy',
            'source_ids': ['native-pages'], 'presentation': {'kind': 'page'}}]})
    else:
        w.metadata['web_path'] = '/en-gb/privacy'
    w.write()
    record = build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation['kind'] == 'page'
    assert record.path == '/en-gb/privacy'
