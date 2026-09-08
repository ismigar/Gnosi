"""Disposable Vault coverage of the real tables and canonical page mutations."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_validation_runtime, monkeypatch):
    from backend.api import vault_routes as vault
    from backend.services.context_vars import active_vault_path
    from backend.server import app
    root = isolated_validation_runtime / "vault"
    token = active_vault_path.set(root)
    monkeypatch.setattr(vault, "_load_plugins_state", lambda: {"schema_version": 2, "enabled_builtin": ["genograms"]})
    try:
        with TestClient(app, raise_server_exceptions=False) as api:
            yield api
    finally:
        active_vault_path.reset(token)


def test_setup_idempotent_and_canonical_mutations(client):
    first = client.post('/api/vault/genograms/prepare', json={'locale': 'ca'})
    assert first.status_code == 200, first.text
    setup = first.json()
    assert client.post('/api/vault/genograms/prepare', json={'locale': 'ca'}).json() == setup
    graph = client.post('/api/vault/genograms/graph', json={'table_id': setup['people_table_id']})
    assert graph.status_code == 200, graph.text
    fields = graph.json()['relations_fields']
    def person(title):
        result = client.post('/api/vault/pages', json={'title': title, 'content': '', 'metadata': {'table_id': setup['people_table_id']}})
        assert result.status_code == 200, result.text
        return result.json()['id']
    a, b = person('Mercè'), person('Mercè')
    assert a != b
    relation = client.post('/api/vault/pages', json={'title': 'Parent', 'content': '', 'metadata': {'table_id': setup['relations_table_id'], fields['kind']: 'parent', fields['source']: a, fields['target']: b}})
    assert relation.status_code == 200, relation.text
    rid = relation.json()['id']
    graph = client.post('/api/vault/genograms/graph', json={'table_id': setup['people_table_id'], 'view_id': setup['view_id'], 'config': {'root_id': b}})
    assert graph.status_code == 200, graph.text
    assert set(graph.json()['visible_ids']) == {a, b}
    assert not graph.json()['issues']
    cycle = client.post('/api/vault/pages', json={'title': 'Cycle', 'content': '', 'metadata': {'table_id': setup['relations_table_id'], fields['kind']: 'parent', fields['source']: b, fields['target']: a}})
    assert cycle.status_code == 422, cycle.text
    assert client.delete(f'/api/vault/pages/{a}').status_code == 409
    bad = client.patch(f'/api/vault/pages/{rid}', json={'metadata': {fields['target']: a}})
    assert bad.status_code == 422, bad.text
    assert client.delete(f'/api/vault/pages/{rid}').status_code == 200
    assert client.delete(f'/api/vault/pages/{a}').status_code == 200


def test_disabled_plugin_preserves_tables(client, monkeypatch):
    from backend.api import vault_routes as vault
    setup = client.post('/api/vault/genograms/prepare', json={}).json()
    monkeypatch.setattr(vault, '_load_plugins_state', lambda: {'schema_version': 2, 'enabled_builtin': []})
    assert client.post('/api/vault/genograms/graph', json={'table_id': setup['people_table_id']}).status_code == 409
    tables = client.get('/api/vault/tables').json()
    assert setup['people_table_id'] in {table['id'] for table in tables}


def test_renamed_fields_conversion_etags_and_saved_view_filter(client):
    from backend.domains.genograms.schema import field_id
    setup = client.post('/api/vault/genograms/prepare', json={'locale': 'ca'}).json()
    table = setup['people_table_id']
    graph = client.post('/api/vault/genograms/graph', json={'table_id': table}).json()
    fields = graph['people_fields']
    row = client.post('/api/vault/pages', json={'title': 'Gestació', 'metadata': {'table_id': table, fields['kind']: 'pregnancy'}, 'content': ''}).json()
    pid = row['id']
    old = client.post('/api/vault/genograms/graph', json={'table_id': table}).json()['people'][0]
    renamed = client.patch(f'/api/vault/tables/{table}/properties/{field_id("people", "birth_date")}', json={'name': 'Data personal'})
    assert renamed.status_code == 200, renamed.text
    changed = client.patch(f'/api/vault/pages/{pid}', json={'title': 'Mercè', 'metadata': {fields['kind']: 'person', 'Data personal': '2000'}, 'expected_etag': old['etag']})
    assert changed.status_code == 200, changed.text
    stale = client.patch(f'/api/vault/pages/{pid}', json={'title': 'Overwrite', 'expected_etag': old['etag']})
    assert stale.status_code == 409, stale.text
    updated = client.post('/api/vault/genograms/graph', json={'table_id': table}).json()['people'][0]
    assert updated['id'] == pid and updated['kind'] == 'person' and updated['birth_date'] == '2000'
    # Table selects use localized option labels even though the visual API uses codes.
    assert client.patch(f'/api/vault/pages/{pid}', json={'metadata': {fields['symbol']: 'Cercle'}}).status_code == 200
    current = client.post('/api/vault/genograms/graph', json={'table_id': table}).json()['people'][0]
    assert current['symbol'] == 'circle'
    view = {'id': setup['view_id'], 'table_id': table, 'name': 'Filtered', 'type': 'genogram', 'genogram': {'root_id': pid, 'positions': {pid: {'x': 23, 'y': 45}}}, 'filters': [{'field': 'title', 'operator': 'equals', 'value': 'Absent'}]}
    saved = client.post('/api/vault/views', json=view)
    assert saved.status_code == 200, saved.text
    filtered = client.post('/api/vault/genograms/graph', json={'table_id': table, 'view_id': setup['view_id']}).json()
    assert filtered['visible_ids'] == []
    assert filtered['config']['positions'][pid] == {'x': 23, 'y': 45}


def test_external_cycle_is_reported_without_rewriting_files(client):
    from backend.api import vault_routes as vault
    from backend.services.context_vars import active_vault_path
    from pathlib import Path
    import yaml
    setup = client.post('/api/vault/genograms/prepare', json={}).json()
    graph = client.post('/api/vault/genograms/graph', json={'table_id': setup['people_table_id']}).json()
    fields = graph['relations_fields']
    a, b = [client.post('/api/vault/pages', json={'title': title, 'metadata': {'table_id': setup['people_table_id']}, 'content': ''}).json()['id'] for title in ('A', 'B')]
    rows = []
    for source, target in ((a, b), (b, a)):
        # Create drafts through the API, then simulate a direct filesystem edit.
        rows.append(client.post('/api/vault/pages', json={'title': source, 'metadata': {'table_id': setup['relations_table_id']}, 'content': ''}).json()['id'])
    root = active_vault_path.get()
    originals = {}
    for rid, (source, target) in zip(rows, ((a, b), (b, a)), strict=True):
        paths = [p for p in Path(root).rglob('*.md') if f'id: {rid}' in p.read_text()]
        assert len(paths) == 1
        path = paths[0]
        meta, body = vault.parse_frontmatter(path.read_text(), path)
        meta.update({fields['kind']: 'parent', fields['source']: source, fields['target']: target})
        raw = '---\n' + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False) + '---\n' + body
        path.write_text(raw)
        originals[path] = raw
    result = client.post('/api/vault/genograms/graph', json={'table_id': setup['people_table_id'], 'config': {'root_id': a}})
    assert result.status_code == 200, result.text
    assert 'parent_cycle' in {issue['code'] for issue in result.json()['issues']}
    assert all(path.read_text() == raw for path, raw in originals.items())
