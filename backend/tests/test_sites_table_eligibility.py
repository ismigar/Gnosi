"""The table capability cannot reset a website selection or leak private properties."""
import json

import pytest
from fastapi import HTTPException

from backend.domains.sites import exporter, table_eligibility
from backend.domains.sites.models import SiteSource
from backend.tests.test_sites import website  # noqa: F401


def test_existing_native_bindings_remain_eligible_and_new_tables_start_private(website):
    data, _ = exporter.registry(website.store)
    table = data['tables'][0]
    assert table_eligibility.eligible(table, data, website.store.list())
    assert not table_eligibility.eligible(table, data, [])
    assert table_eligibility.eligible({**table, 'web_publishable': True}, data, [])
    assert not table_eligibility.eligible({**table, 'web_publishable': False}, data, website.store.list())


def test_disabled_capability_blocks_export_and_reenable_preserves_fields_and_selection(website):
    path = website.vault / 'BD/vault_db_registry.json'
    data = json.loads(path.read_text()); data['tables'][0]['web_publishable'] = False
    path.write_text(json.dumps(data))
    before = website.store.config_path(website.site.id).read_bytes()
    with pytest.raises(HTTPException, match='disabled for this table'):
        exporter.build_bundle(website.store, website.site, 'local')
    with pytest.raises(HTTPException, match='Enable website publication'):
        table_eligibility.validate_sources(website.store, website.site)
    data['tables'][0]['web_publishable'] = True; path.write_text(json.dumps(data))
    assert exporter.build_bundle(website.store, website.site, 'local').records[0].fields == {'public-summary': 'Public introduction'}
    assert website.store.config_path(website.site.id).read_bytes() == before
    with website.store.database() as db:
        assert db.execute('select count(*) from jobs').fetchone()[0] == 0


def test_new_enabled_source_requires_table_opt_in(website):
    site = website.site.model_copy(update={'sources': []}, deep=True)
    website.store.save(site)
    site.sources = [SiteSource(kind='table', source_id='articles', enabled=True)]
    with pytest.raises(HTTPException, match='Enable website publication'):
        table_eligibility.validate_sources(website.store, site)


def test_public_body_property_lists_respect_selected_field_ids_without_changing_notes(website):
    registry = website.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text()); data['tables'][0]['properties'].append({'id': 'areas', 'name': 'Àrees', 'type': 'relation'});registry.write_text(json.dumps(data))
    note = website.vault / 'BD/Articles/one.md'
    note.write_text(note.read_text() + '\n## Àrees\n\n- PRIVATE-AREA\n\n## Article\n\nAuthored prose.\n')
    original = note.read_bytes()
    bundle = exporter.build_bundle(website.store, website.site, 'local')
    assert 'PRIVATE-AREA' not in bundle.model_dump_json()
    assert 'Authored prose.' in bundle.records[0].body_html
    assert note.read_bytes() == original
    website.site.sources[0].field_ids.append('areas')
    assert 'PRIVATE-AREA' in exporter.build_bundle(website.store, website.site, 'local').records[0].body_html


def test_shared_record_body_uses_union_of_explicit_public_fields(website):
    registry = website.vault / 'BD/vault_db_registry.json';data=json.loads(registry.read_text());data['tables'][0]['properties'].append({'id':'areas','name':'Àrees','type':'relation'});registry.write_text(json.dumps(data))
    note=website.vault/'BD/Articles/one.md';note.write_text(note.read_text()+'\n## Àrees\n\n- PUBLIC-AREA\n')
    website.site.sources.append(website.site.sources[0].model_copy(update={'id':'other','field_ids':['areas'],'include_body':False}))
    assert 'PUBLIC-AREA' in exporter.build_bundle(website.store,website.site,'local').records[0].body_html


def test_capability_update_changes_only_its_own_registry_field_and_preserves_sites(website):
    path=website.vault/'BD/vault_db_registry.json';before=json.loads(path.read_text())
    sites=website.store.config_path(website.site.id).read_bytes()
    result=table_eligibility.update(website.store,'articles',table_eligibility.TablePublicationUpdate(publishable=False))
    after=json.loads(path.read_text());expected=json.loads(json.dumps(before));expected['tables'][0]['web_publishable']=False
    assert result.publishable is False and after==expected
    assert website.store.config_path(website.site.id).read_bytes()==sites
    assert table_eligibility.read(website.store,'articles').publishable is False
    table_eligibility.update(website.store,'articles',table_eligibility.TablePublicationUpdate(publishable=True))
    assert exporter.build_bundle(website.store,website.site,'local').records[0].fields=={'public-summary':'Public introduction'}


def test_unavailable_registry_never_writes_a_capability(website,monkeypatch):
    from backend.domains.vault.registry import runtime
    def unavailable():raise HTTPException(503,'Registry unavailable')
    monkeypatch.setattr(runtime,'load_registry_for_write',unavailable)
    saved=[];monkeypatch.setattr(runtime,'save_registry',saved.append)
    with pytest.raises(HTTPException,match='Registry unavailable'):
        table_eligibility.update(website.store,'articles',table_eligibility.TablePublicationUpdate(publishable=True))
    assert not saved


def test_schema_autosave_cannot_reset_a_newer_table_capability(website):
    import asyncio
    from backend.api import vault_routes  # noqa: F401
    from backend.domains.vault.tables.routes import create_table_from_registry
    from backend.services.context_vars import active_vault_path
    path=website.vault/'BD/vault_db_registry.json';stale=json.loads(path.read_text())['tables'][0]
    stale['web_publishable']=False
    table_eligibility.update(website.store,'articles',table_eligibility.TablePublicationUpdate(publishable=True))
    token=active_vault_path.set(website.vault)
    try:
        asyncio.run(create_table_from_registry(stale))
    finally:
        active_vault_path.reset(token)
    assert json.loads(path.read_text())['tables'][0]['web_publishable'] is True


@pytest.mark.parametrize('position',['before','after','only'])
def test_direct_page_source_cannot_bypass_property_privacy(website,position):
    registry=website.vault/'BD/vault_db_registry.json';data=json.loads(registry.read_text());data['tables'][0]['properties'].append({'id':'areas','name':'Àrees','type':'relation'});registry.write_text(json.dumps(data))
    note=website.vault/'BD/Articles/one.md';note.write_text(note.read_text()+'\n## Àrees\n\n- PRIVATE-AREA\n');original=note.read_bytes()
    direct=SiteSource(kind='page',source_id='one',enabled=True,include_body=True)
    website.site.sources=([direct]+website.site.sources if position=='before' else website.site.sources+[direct] if position=='after' else [direct])
    bundle=exporter.build_bundle(website.store,website.site,'local')
    assert 'PRIVATE-AREA' not in bundle.model_dump_json() and 'Àrees' not in bundle.records[0].body_html
    assert note.read_bytes()==original


@pytest.mark.parametrize('metadata_id',[True,False])
def test_table_disabled_cannot_be_bypassed_via_direct_page_or_catalogue(website,monkeypatch,metadata_id,indexed_pages):
    from backend.domains.sites import record_publication
    from backend.domains.vault.pages import index_service
    monkeypatch.setattr(record_publication,'_discovery_notes',exporter.notes)
    registry=website.vault/'BD/vault_db_registry.json';data=json.loads(registry.read_text());data['tables'][0]['web_publishable']=False;data['tables'][0]['folder']='BD/Articles';registry.write_text(json.dumps(data))
    path=website.vault/'BD/Articles/one.md'
    if not metadata_id:path.write_text(path.read_text().replace('table_id: articles\n',''))
    direct=SiteSource(kind='page',source_id='one',enabled=True,include_body=True)
    website.site.sources=[direct]
    with pytest.raises(HTTPException,match='Enable website publication'):
        table_eligibility.validate_sources(website.store,website.site)
    with pytest.raises(HTTPException,match='disabled for this table'):
        exporter.build_bundle(website.store,website.site,'local')
    items=exporter.catalogue(website.store)
    assert not next(item for item in items if item.id=='one').publishable
    note=next(note for note in exporter.notes(website.store) if note.metadata['id']=='one')
    monkeypatch.setattr(index_service,'get_available_page_entries',lambda vault:[{'path':str(note.path),'metadata':note.metadata,'title':'One'}])
    assert not next(item for item in exporter.catalogue_snapshot(website.store).items if item.id=='one').publishable


def test_direct_table_page_requires_opt_in_but_existing_page_bindings_survive_upgrade(website,monkeypatch,indexed_pages):
    from backend.domains.sites import record_publication
    monkeypatch.setattr(record_publication,'_discovery_notes',exporter.notes)
    site=website.site.model_copy(update={'sources':[]},deep=True);site=website.store.save(site)
    direct=SiteSource(kind='page',source_id='one',enabled=True,include_body=True)
    site.sources=[direct]
    with pytest.raises(HTTPException,match='Enable website publication'):
        table_eligibility.validate_sources(website.store,site)
    # A persisted pre-upgrade binding is preserved as an existing opt-in.
    website.store.save(site)
    assert table_eligibility.read(website.store,'articles').publishable is True
    table_eligibility.validate_sources(website.store,site)
    assert next(item for item in exporter.catalogue(website.store) if item.id=='one').publishable


def test_unavailable_direct_page_cannot_be_misclassified_as_standalone(website,monkeypatch):
    from backend.domains.sites import record_publication
    from backend.domains.vault.pages import index_service
    monkeypatch.setattr(index_service,'get_available_page_entries',lambda vault:None)
    website.site.sources=[SiteSource(kind='page',source_id='one',enabled=True,include_body=True)]
    with pytest.raises(HTTPException,match='selected page is unavailable'):
        table_eligibility.validate_sources(website.store,website.site)


@pytest.mark.parametrize('value',['false',None,0,1])
def test_malformed_explicit_capability_is_not_a_legacy_opt_in(website,value):
    registry=website.vault/'BD/vault_db_registry.json';data=json.loads(registry.read_text());data['tables'][0]['web_publishable']=value;registry.write_text(json.dumps(data))
    assert not table_eligibility.eligible(data['tables'][0],data,website.store.list())
    with pytest.raises(HTTPException,match='disabled for this table'):
        exporter.build_bundle(website.store,website.site,'local')


@pytest.fixture
def indexed_pages(website,monkeypatch):
    from backend.domains.vault.pages import index_service
    monkeypatch.setattr(index_service,'get_available_page_entries',lambda vault:[{'path':str(note.path),'metadata':note.metadata,'title':note.metadata.get('title')} for note in exporter.notes(website.store)])


def test_capability_catalogue_does_not_start_discovery_for_existing_direct_pages(website,monkeypatch):
    from backend.domains.sites import record_publication
    from backend.domains.vault.pages import index_service
    def forbidden(store):raise AssertionError('Catalogue started discovery')
    monkeypatch.setattr(record_publication,'_discovery_notes',forbidden)
    monkeypatch.setattr(index_service,'get_available_page_entries',lambda vault:None)
    site=website.site.model_copy(update={'sources':[SiteSource(kind='page',source_id='one',enabled=True)]},deep=True);website.store.save(site)
    assert exporter.catalogue_snapshot(website.store).pages_ready is False
