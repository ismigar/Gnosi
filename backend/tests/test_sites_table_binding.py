"""Table configuration changes local sources; publishing remains a separate review."""
import json

import pytest
from fastapi import HTTPException

from backend.domains.sites import exporter, record_publication, table_binding
from backend.domains.sites.models import SiteSource
from backend.tests.test_sites import website  # noqa: F401


def request(website, **patch):
    return table_binding.TableBindingRequest(revision=website.site.revision, table_id='articles', section='/blog', enabled=True, include_body=True, field_ids=['public-summary'], **patch)


def test_new_table_source_is_explicit_selected_empty_and_does_not_publish(website):
    original = website.site.model_dump()
    result = table_binding.bind(website.store, website.site, request(website))
    assert result.sources[:-1] == website.site.sources
    source = result.sources[-1]
    assert source.kind == 'table' and source.source_id == 'articles'
    assert source.selection_mode == 'selected' and source.page_ids == []
    assert result.targets == website.site.targets and result.pages == website.site.pages
    assert result.revision == original['revision'] + 1
    with website.store.database() as db:
        assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM active').fetchone()[0] == 0


@pytest.mark.parametrize('change', ['revision', 'field', 'path', 'conflicting-source'])
def test_binding_rejects_stale_or_invalid_configuration_without_mutation(website, change):
    payload = request(website)
    if change == 'revision': payload.revision += 1
    if change == 'field': payload.field_ids = ['missing']
    if change == 'path': payload.section = '//external'
    if change == 'conflicting-source': payload.section = '/content'
    before = website.store.config_path(website.site.id).read_bytes()
    with pytest.raises(HTTPException): table_binding.bind(website.store, website.site, payload)
    assert website.store.config_path(website.site.id).read_bytes() == before


@pytest.mark.parametrize('missing_language', [True, False])
def test_replacing_imported_section_preserves_native_records_paths_and_requires_every_language(website, monkeypatch, missing_language):
    site = website.site.model_copy(deep=True)
    site.legacy_pilot = True
    site.sources = [SiteSource(id='imported-blog', kind='page', source_id='imported:blog', enabled=True, include_body=True, path_prefix='/blog')]
    from backend.domains.sites.models import identifier
    site.id = identifier()
    site = website.store.save(site, create=True)
    website.site = site
    directory = website.store.site_dir(site.id) / 'imported'; directory.mkdir()
    nodes = [{'uuid': 'public-one', 'nid': 1, 'lang': language, 'url': f'/{language}/stable', 'type': 'article', 'body_html': '<p>OLD-BASELINE-CONTENT</p>', 'title': 'Old'} for language in (['ca', 'es'] if missing_language else ['ca'])]
    (directory / 'baseline.json').write_text(json.dumps({'data': {'nodes': nodes, 'aliases': []}, 'assets': [], 'type_map': {}}))
    path = website.vault / 'BD/Articles/one.md'; path.write_text(path.read_text().replace('id: one', 'id: one\ndrupal_uuid: public-one\ndrupal_path: /ca/stable'))
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    before = website.store.config_path(site.id).read_bytes()
    if missing_language:
        with pytest.raises(HTTPException, match='Reconcile'): table_binding.bind(website.store, site, request(website))
        assert website.store.config_path(site.id).read_bytes() == before
        return
    result = table_binding.bind(website.store, site, request(website))
    assert len(result.sources) == 1
    source = result.sources[0]
    assert (source.id, source.kind, source.source_id, source.page_ids) == ('imported-blog', 'table', 'articles', ['one'])
    bundle = exporter.build_bundle(website.store, result, 'local')
    assert [(record.id, record.path) for record in bundle.records] == [('public-one', '/ca/stable')]
    assert 'Public body' in bundle.records[0].body_html
    assert 'OLD-BASELINE-CONTENT' not in bundle.records[0].body_html
    # Only the public renderer compatibility marker remains, never a data fallback.
    assert bundle.site.sources[0].source_id == 'imported:blog'
    assert website.store.load(site.id).sources[0].source_id == 'articles'


def test_moving_an_existing_binding_retains_its_identity_and_selection(website):
    site = website.site.model_copy(deep=True)
    site.sources.append(SiteSource(id='native', kind='table', source_id='articles', enabled=True, path_prefix='/blog', selection_mode='selected', page_ids=['one']))
    site = website.store.save(site); website.site = site
    payload = request(website); payload.source_id = 'native'; payload.section = '/news'
    result = table_binding.bind(website.store, site, payload)
    native = [source for source in result.sources if source.kind == 'table']
    assert len(native) == 1
    assert (native[0].id, native[0].path_prefix, native[0].page_ids) == ('native', '/news', ['one'])


def test_merging_imported_and_native_sources_preserves_filters_and_rebinds_layout(website, monkeypatch):
    from backend.domains.sites.models import SiteBlock, identifier
    site = website.site.model_copy(deep=True); site.id = identifier(); site.legacy_pilot = True
    native = SiteSource(id='native', kind='table', source_id='articles', enabled=True, path_prefix='/blog', selection_mode='selected', page_ids=['one'], filters=[{'field_id': 'status', 'value': 'published'}])
    site.sources = [SiteSource(id='imported-blog', kind='page', source_id='imported:blog', enabled=True, include_body=True, path_prefix='/blog'), native]
    site.pages[0].blocks.append(SiteBlock(type='collection', source_id='native'))
    site = website.store.save(site, create=True); website.site = site
    directory = website.store.site_dir(site.id) / 'imported'; directory.mkdir()
    (directory / 'baseline.json').write_text(json.dumps({'data': {'nodes': [{'uuid': 'public-one', 'lang': 'ca', 'type': 'article', 'url': '/ca/stable'}]}, 'assets': [], 'type_map': {}}))
    path = website.vault / 'BD/Articles/one.md'; path.write_text(path.read_text().replace('id: one', 'id: one\ndrupal_uuid: public-one\nweb_path: /ca/stable'))
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    payload = request(website); payload.source_id = 'native'
    result = table_binding.bind(website.store, site, payload)
    assert len(result.sources) == 1
    assert result.sources[0].id == 'imported-blog'
    assert result.sources[0].filters == native.filters
    assert result.sources[0].page_ids == ['one']
    assert result.pages[0].blocks[-1].source_id == 'imported-blog'


def test_merge_rejects_filters_that_would_drop_existing_public_identity(website, monkeypatch):
    from backend.domains.sites.models import identifier
    site = website.site.model_copy(deep=True); site.id = identifier(); site.legacy_pilot = True
    site.sources = [SiteSource(id='imported-blog', kind='page', source_id='imported:blog', enabled=True, include_body=True, path_prefix='/blog'), SiteSource(id='native', kind='table', source_id='articles', enabled=True, path_prefix='/blog', selection_mode='selected', page_ids=['one'], filters=[{'field_id': 'status', 'value': 'published'}])]
    site = website.store.save(site, create=True); website.site = site
    directory = website.store.site_dir(site.id) / 'imported'; directory.mkdir()
    nodes = [{'uuid': f'public-{name}', 'lang': 'ca', 'url': f'/ca/existing-{name}', 'type': 'article', 'title': name, 'body_html': '<p>Previously public</p>'} for name in ['one', 'two']]
    (directory / 'baseline.json').write_text(json.dumps({'data': {'nodes': nodes, 'aliases': []}, 'assets': [], 'type_map': {}}))
    for name in ['one', 'two']:
        path = website.vault / f'BD/Articles/{name}.md'
        raw = path.read_text().replace(f'id: {name}', f'id: {name}\ndrupal_uuid: public-{name}')
        if name == 'two': raw = raw.replace('Status: draft', 'Status: reviewed')
        path.write_text(raw)
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    before_bundle = exporter.build_bundle(website.store, site, 'local')
    assert {record.id for record in before_bundle.records} == {'public-one', 'public-two'}
    before = website.store.config_path(site.id).read_bytes()
    with pytest.raises(HTTPException, match='filters or privacy settings'):
        table_binding.bind(website.store, site, request(website))
    assert website.store.config_path(site.id).read_bytes() == before


def test_active_release_is_preservation_reference_instead_of_stale_snapshot(website, monkeypatch):
    from backend.domains.sites.models import identifier
    site = website.site.model_copy(deep=True); site.id = identifier(); site.legacy_pilot = True
    site.sources = [SiteSource(id='imported-blog', kind='page', source_id='imported:blog', enabled=True, include_body=True, path_prefix='/blog')]
    site = website.store.save(site, create=True); website.site = site
    directory = website.store.site_dir(site.id) / 'imported'; directory.mkdir()
    (directory / 'baseline.json').write_text(json.dumps({'data': {'nodes': [{'uuid': 'public-one', 'lang': 'es', 'type': 'article', 'url': '/es/stale'}]}, 'assets': [], 'type_map': {}}))
    path = website.vault / 'BD/Articles/one.md'; path.write_text(path.read_text().replace('id: one', 'id: one\ndrupal_uuid: public-one'))
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    monkeypatch.setattr(website.store, 'active_bundle', lambda *_: {'records': [{'id': 'public-one', 'language': 'ca', 'path': '/ca/active-stable', 'source_ids': ['imported-blog']}]})
    result = table_binding.bind(website.store, site, request(website))
    assert result.sources[0].page_ids == ['one']
    assert exporter.build_bundle(website.store, result, 'local').records[0].path == '/ca/active-stable'


def test_merge_rejects_language_withdrawal_without_losing_existing_public_version(website, monkeypatch):
    from backend.domains.sites.models import identifier
    site = website.site.model_copy(deep=True); site.id = identifier(); site.legacy_pilot = True
    site.sources = [SiteSource(id='imported-blog', kind='page', source_id='imported:blog', enabled=True, include_body=True, path_prefix='/blog'), SiteSource(id='native', kind='table', source_id='articles', enabled=True, path_prefix='/blog', selection_mode='selected', page_ids=['one'], withdrawn_versions={'one': ['ca']})]
    site = website.store.save(site, create=True); website.site = site
    directory = website.store.site_dir(site.id) / 'imported'; directory.mkdir()
    (directory / 'baseline.json').write_text(json.dumps({'data': {'nodes': [{'uuid': 'public-one', 'lang': 'ca', 'type': 'article', 'url': '/ca/existing-one', 'title': 'Previously public', 'body_html': '<p>Previously public</p>'}]}, 'assets': [], 'type_map': {}}))
    path = website.vault / 'BD/Articles/one.md'; path.write_text(path.read_text().replace('id: one', 'id: one\ndrupal_uuid: public-one'))
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    before = website.store.config_path(site.id).read_bytes()
    before_bundle = exporter.build_bundle(website.store, site, 'local')
    assert [(record.id, record.language, record.path) for record in before_bundle.records] == [('public-one', 'ca', '/ca/existing-one')]
    with pytest.raises(HTTPException, match='filters or privacy settings'):
        table_binding.bind(website.store, site, request(website, source_id='native'))
    assert website.store.config_path(site.id).read_bytes() == before
    after_bundle = exporter.build_bundle(website.store, website.store.load(site.id), 'local')
    assert after_bundle.records == before_bundle.records


def migration_site(website, monkeypatch, baseline_path, native_path):
    from backend.domains.sites.models import identifier
    site = website.site.model_copy(deep=True)
    site.id = identifier()
    site.legacy_pilot = True
    site.sources = [SiteSource(id='imported-blog', kind='page', source_id='imported:blog', enabled=True,
                               include_body=True, path_prefix='/blog')]
    site = website.store.save(site, create=True)
    website.site = site
    directory = website.store.site_dir(site.id) / 'imported'
    directory.mkdir()
    (directory / 'baseline.json').write_text(json.dumps({'data': {'nodes': [{
        'uuid': 'public-one', 'lang': 'ca', 'type': 'article', 'url': baseline_path,
        'title': 'Existing publication', 'body_html': '<p>Previously published body</p>',
    }], 'aliases': []}, 'assets': [], 'type_map': {}}))
    note = website.vault / 'BD/Articles/one.md'
    note.write_text(note.read_text().replace('id: one', 'id: one\ndrupal_uuid: public-one\nweb_path: ' + native_path))
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    return site


def test_first_release_binding_rejects_native_url_change_before_config_write(website, monkeypatch):
    site = migration_site(website, monkeypatch, '/ca/snapshot-stable', '/ca/native-conflict')
    assert website.store.active_bundle(site.id, 'local') is None
    before = website.store.config_path(site.id).read_bytes()
    before_bundle = exporter.build_bundle(website.store, site, 'local')
    with pytest.raises(HTTPException, match='native URLs') as error:
        table_binding.bind(website.store, site, request(website))
    assert error.value.status_code == 409
    assert website.store.config_path(site.id).read_bytes() == before
    after_bundle = exporter.build_bundle(website.store, website.store.load(site.id), 'local')
    assert [(r.id, r.language, r.path) for r in before_bundle.records] == [('public-one', 'ca', '/ca/snapshot-stable')]
    assert after_bundle.records == before_bundle.records
    assert '/ca/snapshot-stable' not in after_bundle.withdrawn_paths


def test_first_release_matching_native_url_keeps_before_and_after_public_path(website, monkeypatch):
    site = migration_site(website, monkeypatch, '/ca/existing-publication', '/ca/existing-publication')
    before = exporter.build_bundle(website.store, site, 'local')
    bound = table_binding.bind(website.store, site, request(website))
    after = exporter.build_bundle(website.store, bound, 'local')
    assert [(r.id, r.language, r.path) for r in after.records] == [(r.id, r.language, r.path) for r in before.records]
    assert after.records[0].path == '/ca/existing-publication'
    assert 'Public body' in after.records[0].body_html
    assert 'Previously published body' not in after.records[0].body_html
    assert '/ca/existing-publication' not in after.withdrawn_paths


def test_binding_rejects_ambiguous_active_target_paths_without_mutation(website, monkeypatch):
    from backend.domains.sites.models import SiteTarget
    site = migration_site(website, monkeypatch, '/ca/stale-snapshot', '/ca/native')
    site.targets.append(SiteTarget(id='second'))
    site = website.store.save(site)
    website.site = site
    monkeypatch.setattr(website.store, 'active_bundle', lambda _site, target: {'records': [{
        'id': 'public-one', 'language': 'ca', 'path': '/ca/' + target, 'source_ids': ['imported-blog'],
    }]})
    before = website.store.config_path(site.id).read_bytes()
    with pytest.raises(HTTPException, match='URLs differ between targets') as error:
        table_binding.bind(website.store, site, request(website))
    assert error.value.status_code == 409
    assert website.store.config_path(site.id).read_bytes() == before
