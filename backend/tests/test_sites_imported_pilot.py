"""Public pilot fidelity, encoded assets and reversible translated withdrawals."""
from __future__ import annotations

import json
import hashlib
from pathlib import Path
from urllib.parse import quote
import xml.etree.ElementTree as ET

import pytest
from bs4 import BeautifulSoup

from backend.domains.sites.exporter import build_bundle, catalogue
from backend.domains.sites.importer import seed_import
from backend.domains.sites.models import SiteConfig
from backend.domains.sites.paths import extension_root
from backend.domains.sites.renderer import render_bundle
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext


LANGUAGES = ('ca', 'es', 'en-gb')
ARTICLE = '11111111-1111-4111-8111-111111111111'
DESIGN = '22222222-2222-4222-8222-222222222222'
SHARED = '33333333-3333-4333-8333-333333333333'
COLLABORATOR = '44444444-4444-4444-8444-444444444444'


@pytest.fixture
def imported_pilot(tmp_path, monkeypatch):
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path / 'device'))
    vault = tmp_path / 'vault'
    (vault / 'BD').mkdir(parents=True)
    (vault / 'BD/vault_db_registry.json').write_text('{"tables":[],"views":[]}')
    pilot = tmp_path / 'pilot'
    for directory in ('src/data', 'src/styles', 'scripts', 'config', 'public/brand', 'public/sites/default/files', 'public/icons/social'):
        (pilot / directory).mkdir(parents=True)
    nodes = []
    for language in LANGUAGES:
        nodes.append({'nid': 1, 'uuid': ARTICLE, 'type': 'article', 'lang': language, 'title': 'Translated article ' + language, 'url': '/' + language + '/articles/translated', 'body_html': '<p>Complete public article in ' + language + '</p>', 'created': 1700000000, 'tags': [{'tid': 9, 'label': 'Public theme'}], 'fields': {}})
        nodes.append({'nid': 4, 'uuid': COLLABORATOR, 'type': 'col_laboradora', 'lang': language, 'title': 'Public collaborator', 'url': '/' + language + '/collaborators/public', 'body_html': '', 'fields': {'field_image': [{'url': '/sites/default/files/photo.png', 'alt': 'Public collaborator'}], 'field_enllac': [{'uri': 'https://collaborator.example.invalid/'}] if language == 'ca' else []}})
    # Selected readings intentionally differ from file order and need language fallback.
    for nid in (7, 8):
        nodes.append({'nid': nid, 'uuid': f'00000000-0000-4000-8000-{nid:012d}', 'type': 'article', 'lang': 'ca', 'title': 'Reading ' + str(nid), 'url': '/ca/articles/reading-' + str(nid), 'body_html': '<p>Complete reading body.</p>', 'created': 1700000000 + nid, 'fields': {}})
    pdf = "Report d’ètica d'ús.pdf"
    nodes.append({'nid': 2, 'uuid': DESIGN, 'type': 'disseny', 'lang': 'ca', 'title': 'Public design', 'url': '/ca/dissenys/public', 'body_html': '<p>Design description.</p>', 'fields': {'field_materials': [{'value': 'ABS'}], 'field_fitxer': [{'url': '/sites/default/files/' + quote(pdf), 'name': pdf}]}})
    nodes.append({'nid': 3, 'uuid': SHARED, 'type': 'recurs', 'lang': 'ca', 'title': 'Shared public entry', 'url': '/ca/shared', 'body_html': '<p>Shared body.</p>', 'fields': {'field_any': [{'value': 2025}], 'field_tipus': [{'value': 'report'}, {'value': 'story'}]}})
    routes = [{'kind': 'redirect', 'path': '/' + language + '/node/1', 'target': '/' + language + '/articles/translated'} for language in LANGUAGES]
    routes += [{'kind': 'tag', 'path': '/' + language + '/taxonomy/term/9', 'tid': 9, 'lang': language, 'title': 'Public theme'} for language in LANGUAGES]
    routes += [{'kind': 'tag', 'path': '/' + language + '/taxonomy/term/10', 'tid': 10, 'lang': language, 'title': 'Empty public theme'} for language in LANGUAGES]
    data = {'aliases': [{'alias': '/es/relatos.xml', 'path': '/ca/relats.xml', 'langcode': 'es'}], 'origin': 'https://example.invalid', 'languages': list(LANGUAGES), 'nodes': nodes, 'routes': routes, 'home_content': {language: {'tagline': 'Public home ' + language, 'intro': 'Warm public introduction.'} for language in LANGUAGES}}
    (pilot / 'src/data/site.json').write_text(json.dumps(data))
    (pilot / 'src/styles/brand.css').write_text('')
    (pilot / 'scripts/web_publish_driver.py').write_text('')
    (pilot / 'config/homepage.json').write_text(json.dumps({'reading_ids': [8, 1, 7], 'photograph': '/sites/default/files/photo.png'}))
    (pilot / 'config/resource-types.json').write_text('{"report":"research","story":"stories"}')
    (pilot / 'public/sites/default/files' / pdf).write_bytes(b'%PDF-1.7 public synthetic fixture')
    (pilot / 'public/sites/default/files/photo.png').write_bytes(b'Synthetic public image')
    (pilot / 'public/brand/temenos-ismael-horizontal-transparent.png').write_bytes(b'Synthetic transparent logo')
    for name in ('mastodon', 'linkedin-in', 'facebook-f', 'telegram'):
        (pilot / 'public/icons/social' / (name + '.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    store = SiteStore(WorkspaceContext('test-workspace', 'owner', 'owner', vault))
    site = SiteConfig(name='Imported pilot', legacy_pilot=True)
    seed_import(store, site, pilot)
    site = store.save(site, create=True)
    return store, site, pilot, pdf


def test_import_keeps_encoded_pdf_materials_link_fallback_and_public_record_catalogue(imported_pilot):
    store, site, _, pdf = imported_pilot
    bundle = build_bundle(store, site, 'local')
    assert '/sites/default/files/' + pdf in {asset.path for asset in bundle.assets}
    design = next(record for record in bundle.records if record.id == DESIGN)
    assert '<p>ABS</p>' in design.body_html
    assert quote(pdf) in design.body_html
    collaborators = [record for record in bundle.records if record.id == COLLABORATOR]
    assert len(collaborators) == 3
    assert all(record.presentation['href'] == 'https://collaborator.example.invalid/' for record in collaborators)
    assert all('<a href="https://collaborator.example.invalid/"><img ' in record.body_html for record in collaborators)
    items = [item for item in catalogue(store) if item.kind == 'record' and item.id == ARTICLE]
    assert len(items) == 1
    assert items[0].languages == list(LANGUAGES)
    assert items[0].source_ids == ['imported:blog']
    assert not any('/private/' in asset.path for asset in bundle.assets)
    assert bundle.feed_aliases == {'/es/relatos.xml': '/es/relats.xml', '/es/es/relatos.xml': '/es/relats.xml'}


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_actual_imported_homes_and_articles_keep_public_features(imported_pilot, tmp_path):
    store, site, _, pdf = imported_pilot
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    bundle['deployment_url'] = 'https://example.invalid/_gnosi-proof/current'
    output = tmp_path / 'public'
    render_bundle(bundle, output)
    for language in LANGUAGES:
        home = BeautifulSoup((output / language / 'index.html').read_text(), 'html.parser')
        readings = home.select('[data-reading-id]')
        assert [item['data-reading-id'] for item in readings] == ['00000000-0000-4000-8000-000000000008', ARTICLE, '00000000-0000-4000-8000-000000000007']
        collaborator = home.select_one('.collaborators a')
        assert collaborator['href'] == 'https://collaborator.example.invalid/'
        assert collaborator['target'] == '_blank' and 'noopener' in collaborator['rel']
        assert collaborator.img['alt'] == 'Public collaborator' and collaborator.img['width'] == '180'
        assert home.select_one('.temenos-hero-photo')
        assert home.select_one('.staging-subscription')['action'] == '/_gnosi-proof/current/api/newsletter.php'
        article = BeautifulSoup((output / language / 'articles/translated/index.html').read_text(), 'html.parser')
        links = article.select('.entry-sharing a')
        assert [link['class'][0] for link in links] == ['a2a_button_' + name for name in ('whatsapp', 'telegram', 'mastodon', 'bluesky', 'facebook', 'linkedin', 'email')]
        assert all(link['target'] == '_blank' and 'noreferrer' in link['rel'] for link in links)
    design = BeautifulSoup((output / 'ca/dissenys/public/index.html').read_text(), 'html.parser')
    assert design.select_one('.materials').get_text(' ', strip=True) == 'Materials ABS'
    listing = BeautifulSoup((output / 'ca/investigacio/index.html').read_text(), 'html.parser')
    assert listing.select_one('.resource-year').get_text(strip=True) == '2025'
    ca_home = BeautifulSoup((output / 'ca/index.html').read_text(), 'html.parser')
    assert ca_home.select_one('.resource-year').get_text(strip=True) == '2025'
    assert (output / 'sites/default/files' / pdf).is_file()
    assert 'https://example.invalid/_gnosi-proof/current/ca/articles/translated' in (output / 'ca/rss.xml').read_text()
    assert 'https://example.invalid/_gnosi-proof/current/ca/articles/translated' in (output / 'sitemap.xml').read_text()
    assert design.select_one('link[rel="canonical"]')['href'] == 'https://example.invalid/ca/dissenys/public'
    for language in LANGUAGES:
        tagged = ET.fromstring((output / language / 'taxonomy/term/9/feed').read_bytes())
        item = tagged.find('channel/item')
        assert not ET.fromstring((output / language / 'taxonomy/term/10/feed').read_bytes()).findall('channel/item')
        empty_page = BeautifulSoup((output / language / 'taxonomy/term/10/index.html').read_text(), 'html.parser')
        assert not empty_page.select('.reading-card')
        assert item.findtext('guid') == ARTICLE + ':' + language
        assert item.findtext('pubDate')
        assert 'Complete public article in ' + language in item.findtext('description')
        assert item.findtext('link').startswith('https://example.invalid/_gnosi-proof/current/')
        listing = BeautifulSoup((output / language / 'taxonomy/term/9/index.html').read_text(), 'html.parser')
        assert listing.select_one('.listing-rss a')['href'].endswith('/taxonomy/term/9/feed')
    assert (output / 'taxonomy/term/9/feed').read_bytes() == (output / 'ca/taxonomy/term/9/feed').read_bytes()
    for section in ('blog', 'investigacio', 'relats', 'dissenys'):
        assert (output / (section + '.xml')).read_bytes() == (output / 'ca' / (section + '.xml')).read_bytes()
    for alias in ('es/relatos.xml', 'es/es/relatos.xml'):
        assert (output / alias).read_bytes() == (output / 'es/relats.xml').read_bytes()
    collection = ET.fromstring((output / 'ca/blog.xml').read_bytes())
    assert all(item.findtext('description') and item.findtext('pubDate') for item in collection.findall('channel/item'))
    aggregate = ET.fromstring((output / 'ca/rss.xml').read_bytes())
    assert all(COLLABORATOR not in item.findtext('guid') for item in aggregate.findall('channel/item'))
    assert 'ForceType application/rss+xml' in (output / '.htaccess').read_text()


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_translated_withdrawal_retires_aliases_then_restores_every_version(imported_pilot, monkeypatch, tmp_path):
    store, site, _, _ = imported_pilot
    full = build_bundle(store, site, 'local')
    active = [full.model_dump(mode='json')]
    monkeypatch.setattr(store, 'active_bundle', lambda *_: active[0])
    blog = next(source for source in site.sources if source.id == 'imported-blog')
    blog.withdrawn_versions = {ARTICLE: ['es']}
    withdrawn = build_bundle(store, site, 'local')
    assert {record.language for record in withdrawn.records if record.id == ARTICLE} == {'ca', 'en-gb'}
    assert '/es/articles/translated' in withdrawn.withdrawn_paths
    assert '/es/node/1' in withdrawn.withdrawn_paths
    assert '/es/node/1' not in withdrawn.site.redirects
    assert withdrawn.site.redirects['/ca/node/1'] == '/ca/articles/translated'
    output = tmp_path / 'withdrawn'
    render_bundle(withdrawn.model_dump(mode='json'), output)
    assert not (output / 'es/articles/translated/index.html').exists()
    assert not (output / 'es/node/1/index.html').exists()
    assert 'es/node/1/?$ - [G,L]' in (output / '.htaccess').read_text()
    assert 'Translated article es' not in (output / 'es/rss.xml').read_text()
    assert not ET.fromstring((output / 'es/taxonomy/term/9/feed').read_bytes()).findall('channel/item')
    assert ET.fromstring((output / 'ca/taxonomy/term/9/feed').read_bytes()).find('channel/item/guid').text == ARTICLE + ':ca'
    active[0] = withdrawn.model_dump(mode='json')
    site.theme.tokens['accent'] = '#aa5522'
    assert set(build_bundle(store, site, 'local').withdrawn_paths) == set(withdrawn.withdrawn_paths)
    blog.withdrawn_versions = {}
    restored = build_bundle(store, site, 'local')
    assert not restored.withdrawn_paths
    assert restored.site.redirects['/es/node/1'] == '/es/articles/translated'
    assert [record.model_dump() for record in restored.records] == [record.model_dump() for record in full.records]
    assert len(json.loads((store.site_dir(site.id) / 'imported/baseline.json').read_text())['data']['nodes']) == len(full.records)


def test_shared_imported_entry_survives_removing_one_appearance(imported_pilot):
    store, site, _, _ = imported_pilot
    research = next(source for source in site.sources if source.id == 'imported-research')
    research.withdrawn_ids = [SHARED]
    bundle = build_bundle(store, site, 'local')
    shared = [record for record in bundle.records if record.id == SHARED]
    assert len(shared) == 1 and shared[0].source_ids == ['imported-stories']
    assert '/ca/shared' not in bundle.withdrawn_paths


def test_native_private_translation_never_exports_its_unique_baseline_asset(imported_pilot):
    store, site, _, _ = imported_pilot
    path = store.site_dir(site.id) / 'imported/baseline.json'
    payload = json.loads(path.read_text())
    spanish = next(node for node in payload['data']['nodes'] if node['uuid'] == ARTICLE and node['lang'] == 'es')
    spanish['body_html'] += '<img src="/sites/default/files/retired-only.png" alt="Retired image">'
    image = store.site_dir(site.id) / 'imported/assets/sites/default/files/retired-only.png'
    image.write_bytes(b'Synthetic asset belonging only to the private version')
    payload['assets'].append({'path': '/sites/default/files/retired-only.png', 'private_source': str(image), 'sha256': hashlib.sha256(image.read_bytes()).hexdigest()})
    path.write_text(json.dumps(payload))
    note = store.vault / 'Draft.md'
    note.write_text('---\nid: native-draft\ndrupal_uuid: ' + ARTICLE + '\ntranslation_lang: es\nEstat: Esborrany\n---\nNever publish this native draft body.\n')
    bundle = build_bundle(store, site, 'local')
    assert {record.language for record in bundle.records if record.id == ARTICLE} == {'ca', 'en-gb'}
    assert '/sites/default/files/retired-only.png' not in {asset.path for asset in bundle.assets}
    assert 'Never publish' not in bundle.model_dump_json()
    assert '/es/articles/translated' in bundle.withdrawn_paths


def test_unsafe_feed_alias_cannot_escape_public_root(imported_pilot):
    from backend.domains.sites.models import SiteBundle
    _, site, _, _ = imported_pilot
    with pytest.raises(ValueError):
        SiteBundle(site=site, feed_aliases={'/../outside.xml': '/ca/blog.xml'})
    with pytest.raises(ValueError):
        SiteBundle(site=site, feed_aliases={'/ca/feed.php': '/ca/blog.xml'})
