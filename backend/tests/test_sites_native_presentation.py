"""Migrated collection presentation follows selected native fields end to end."""
import json
import hashlib
import subprocess
from pathlib import Path

import pytest
import yaml
from bs4 import BeautifulSoup

from backend.domains.sites import exporter, record_publication, table_binding
from backend.domains.sites.models import SitePage, SiteSource, identifier
from backend.tests.test_sites import website  # noqa: F401


@pytest.fixture
def native_site(website, monkeypatch):
    w = website
    site = w.site.model_copy(deep=True)
    site.id = identifier()
    site.legacy_pilot = True
    site.sources = [SiteSource(id='imported-blog', kind='page', source_id='imported:blog',
                               enabled=True, include_body=True, path_prefix='/blog')]
    site = w.store.save(site, create=True)
    baseline = w.store.site_dir(site.id) / 'imported/baseline.json'
    baseline.parent.mkdir()
    old_image = baseline.parent / 'old-snapshot.png'
    old_image.write_bytes(b'OLD SNAPSHOT IMAGE MUST NOT LEAK')
    baseline.write_text(json.dumps({'data': {'nodes': [{
        'uuid': 'public-one', 'nid': 1, 'lang': 'ca', 'url': '/ca/native-stable',
        'type': 'article', 'title': 'OLD TITLE', 'summary': 'OLD SNAPSHOT SUMMARY',
        'created': 946684800, 'tags': [{'tid': 9, 'label': 'OLD TAG'}],
        'fields': {'field_image': [{'url': '/sites/default/files/OLD-image.png', 'alt': 'OLD ALT'}],
                   'field_any': [{'value': '2000'}]}, 'body_html': '<p>OLD BODY</p>',
    }], 'aliases': []}, 'assets': [{'path': '/sites/default/files/OLD-image.png', 'private_source': str(old_image), 'sha256': hashlib.sha256(old_image.read_bytes()).hexdigest()}], 'type_map': {}}))
    registry = w.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    data['tables'][0]['properties'] += [
        {'id': 'image', 'name': 'Imatge', 'type': 'files'},
        {'id': 'alt', 'name': 'Imatge Alt Text', 'type': 'text'},
        {'id': 'written', 'name': "Data d'escriptura", 'type': 'date'},
        {'id': 'created', 'name': 'Data de creació', 'type': 'created_time'},
        {'id': 'year', 'name': 'Any', 'type': 'number'},
        {'id': 'tags', 'name': 'Tags', 'type': 'multi_select', 'config': {
            'options': [{'id': 'option-public', 'name': 'NATIVE TAG'}]}},
        {'id': 'href', 'name': 'URL', 'type': 'url'},
        {'id': 'drupal', 'name': 'Drupal URL', 'type': 'url'},
    ]
    registry.write_text(json.dumps(data))
    assets = w.vault / 'Assets'
    assets.mkdir()
    (assets / 'one.png').write_bytes(b'first selected native image')
    (assets / 'two.png').write_bytes(b'changed selected native image')
    w.note = w.vault / 'BD/Articles/one.md'
    w.metadata = {'id': 'one', 'table_id': 'articles', 'drupal_uuid': 'public-one',
                  'web_path': '/ca/native-stable', 'title': 'First native title', 'Status': 'published',
                  'Summary': 'NATIVE SUMMARY', 'Imatge': ['Assets/one.png'], 'Imatge Alt Text': 'NATIVE ALT',
                  "Data d'escriptura": {'start': '2027-02-03', 'end': None, 'withTime': False},
                  'Data de creació': '2026-01-01T00:00:00Z', 'Any': 2027,
                  'Tags': ['option-public'], 'URL': 'https://native.invalid/',
                  'Drupal URL': 'https://DO-NOT-USE.invalid/node/1', 'Private': '/private/NEVER-PUBLISH'}
    w.write = lambda body='Native body': w.note.write_text('---\n' + yaml.safe_dump(w.metadata, allow_unicode=True) + '---\n' + body)
    w.write()
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    w.bound = table_binding.bind(w.store, site, table_binding.TableBindingRequest(
        revision=site.revision, table_id='articles', section='/blog', enabled=True, include_body=True,
        field_ids=['public-summary', 'alt', 'written', 'created', 'year', 'tags', 'href', 'drupal'],
        attachment_field_ids=['image']))
    return w


def renderer(record):
    module = Path(__file__).resolve().parents[2] / 'extensions/web-publishing/renderer/src/lib/temenos.mjs'
    code = "import {excerpt,publishedDate,splitArticleImage} from " + json.dumps(module.as_uri()) + ";let raw='';for await(const x of process.stdin)raw+=x;const r=JSON.parse(raw);console.log(JSON.stringify({excerpt:excerpt(r),date:publishedDate(r,'ca'),image:splitArticleImage(r.body_html)}));"
    return json.loads(subprocess.run(['node', '--input-type=module', '-e', code], input=record.model_dump_json(),
                                    text=True, capture_output=True, check=True, timeout=15).stdout)


def test_after_binding_native_edits_reach_export_cards_and_article_renderer(native_site, monkeypatch):
    w = native_site
    assert [(s.kind, s.source_id) for s in w.bound.sources] == [('table', 'articles')]
    first = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert first.path == '/ca/native-stable'
    assert first.presentation['summary'] == 'NATIVE SUMMARY'
    assert first.presentation['tags'] == [{'tid': 'option-public', 'label': 'NATIVE TAG'}]
    first_image = first.presentation['image']['url']
    w.metadata.update(title='Edited native title', Summary='EDITED NATIVE SUMMARY', Imatge='Assets/two.png',
                      **{'Imatge Alt Text': 'EDITED ALT', "Data d'escriptura": '2028-04-05', 'Any': 2028,
                         'Tags': ['NEW NATIVE TAG'], 'URL': 'https://changed.invalid/'})
    w.write('Edited native body')
    monkeypatch.setattr(w.store, 'active_bundle', lambda *_: {'records': [{'id': 'public-one', 'language': 'ca', 'path': '/ca/active-stable'}]})
    bundle = exporter.build_bundle(w.store, w.bound, 'local')
    record = bundle.records[0]
    assert record.path == '/ca/active-stable'
    assert record.title == 'Edited native title'
    assert record.presentation['image']['url'] != first_image
    assert record.presentation['image']['url'] in {a.path for a in bundle.assets}
    assert '/sites/default/files/OLD-image.png' not in {a.path for a in bundle.assets}
    assert record.presentation['image']['alt'] == 'EDITED ALT'
    assert record.presentation['year'] == '2028'
    assert record.presentation['href'] == 'https://changed.invalid/'
    assert record.presentation['tags'][0]['label'] == 'NEW NATIVE TAG'
    assert 'OLD' not in record.model_dump_json() and '/private/' not in record.model_dump_json()
    rendered = renderer(record)
    assert rendered['excerpt'] == 'EDITED NATIVE SUMMARY'
    assert rendered['date']['iso'].startswith('2028-04-05')
    assert 'EDITED ALT' in rendered['image']['image']
    assert 'Edited native body' in rendered['image']['body']
    assert len(BeautifulSoup(record.body_html, 'html.parser').find_all('img')) == 1


def test_cleared_or_unselected_native_fields_do_not_resurrect_snapshot_values(native_site):
    w = native_site
    w.metadata.update(Summary='', Imatge=[], Tags=[], Any=None, URL='', **{'Imatge Alt Text': '', "Data d'escriptura": None, 'Data de creació': None})
    w.write()
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation == {'kind': 'article', 'tags': []}
    assert '<img' not in record.body_html
    assert renderer(record)['date'] is None
    w.metadata.update(Summary='UNSELECTED SUMMARY', Imatge=['Assets/one.png'], Tags=['UNSELECTED TAG'], URL='https://unselected.invalid/')
    w.write()
    w.bound.sources[0].field_ids = []
    w.bound.sources[0].attachment_field_ids = []
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation == {'kind': 'article'}
    assert 'UNSELECTED' not in record.model_dump_json() and 'OLD' not in record.model_dump_json()


def test_selected_image_already_in_native_body_is_not_duplicated(native_site):
    w = native_site
    w.write('![Existing native picture](Assets/one.png)\n\nNative body')
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    images = BeautifulSoup(record.body_html, 'html.parser').find_all('img')
    assert len(images) == 1 and images[0]['src'] == record.presentation['image']['url']


def test_native_resource_and_collaborator_use_selected_semantics_only(native_site):
    w = native_site
    registry = w.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    w.bound.sources[0].id = 'imported-research'
    data['tables'][0]['name'] = 'Recursos'
    registry.write_text(json.dumps(data))
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation['kind'] == 'recurs'
    assert record.presentation['year'] == '2027'
    assert record.presentation['href'] == 'https://native.invalid/'
    assert not record.body_html.startswith('<figure>')
    w.bound.sources[0].id = 'imported-collaborators'
    data['tables'][0]['name'] = 'Col·laboradores'
    image_field = next(p for p in data['tables'][0]['properties'] if p['id'] == 'image')
    image_field['name'] = 'Logo'
    alt_field = next(p for p in data['tables'][0]['properties'] if p['id'] == 'alt')
    alt_field['name'] = 'Logo Alt Text'
    registry.write_text(json.dumps(data))
    w.metadata['Logo'] = w.metadata.pop('Imatge')
    w.metadata['Logo Alt Text'] = w.metadata.pop('Imatge Alt Text')
    w.write()
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation['kind'] == 'col_laboradora'
    assert record.presentation['image']['url'].startswith('/assets/')
    assert record.presentation['image']['alt'] == 'NATIVE ALT'
    logo = BeautifulSoup(record.body_html, 'html.parser').select_one('figure a img')
    assert logo and logo.parent['href'] == 'https://native.invalid/'
    assert logo['src'] == record.presentation['image']['url']
    w.bound.sources[0].field_ids.remove('href')
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert 'href' not in record.presentation  # Selected Drupal URL is identity, not collaborator URL.
    assert BeautifulSoup(record.body_html, 'html.parser').select_one('figure img')
    assert not BeautifulSoup(record.body_html, 'html.parser').select_one('figure a')


def test_unselected_alt_and_unknown_tag_option_id_are_not_projected(native_site):
    w = native_site
    w.metadata['Tags'] = ['option-private-unknown']
    w.write()
    w.bound.sources[0].field_ids.remove('alt')
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation['image']['alt'] == ''
    assert record.presentation['tags'] == []
    assert 'NATIVE ALT' not in record.body_html


def test_selected_tag_labels_reuse_only_matching_configured_public_route(native_site):
    w = native_site
    w.bound.pages.append(SitePage(id='tag-9-ca', title='NATIVE TAG', path='/ca/native-tag', language='ca', enabled=True))
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation['tags'] == [{'tid': '9', 'label': 'NATIVE TAG'}]
    assert any(page.id == 'tag-' + record.presentation['tags'][0]['tid'] + '-ca' for page in w.bound.pages)


def test_dictionary_registry_fields_and_renamed_table_keep_selected_article_presentation(native_site):
    w = native_site
    registry = w.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    table = data['tables'][0]
    table['name'] = 'Renamed collection'
    table['properties'] = {p['id']: {k: v for k, v in p.items() if k != 'id'} for p in table['properties']}
    registry.write_text(json.dumps(data))
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert record.presentation['kind'] == 'article'
    assert record.presentation['summary'] == 'NATIVE SUMMARY'
    assert record.presentation['tags'][0]['label'] == 'NATIVE TAG'
    assert record.body_html.startswith('<figure>')


def test_native_design_detail_uses_selected_image_once_and_clears_on_deselection(native_site):
    w = native_site
    w.bound.sources[0].id = 'imported-design'
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    image = BeautifulSoup(record.body_html, 'html.parser').select_one('figure img')
    assert record.presentation['kind'] == 'disseny'
    assert image and image['src'] == record.presentation['image']['url']
    assert image['alt'] == 'NATIVE ALT'
    w.write('![Native design](Assets/one.png)\n\nDesign body')
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert len(BeautifulSoup(record.body_html, 'html.parser').find_all('img')) == 1
    w.write('Design body')
    w.bound.sources[0].attachment_field_ids = []
    record = exporter.build_bundle(w.store, w.bound, 'local').records[0]
    assert 'image' not in record.presentation
    assert '<img' not in record.body_html
