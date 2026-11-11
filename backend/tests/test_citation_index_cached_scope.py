"""Citation indexing must not hydrate pages from known unrelated tables."""
from pathlib import Path

import pytest

from backend.domains.vault.citations import search
from backend.domains.vault.citations.state import CitationIndexState

REFERENCE = 'reference-table'


def dependencies(entries, reference=REFERENCE):
    return search.CitationSearchDependencies(
        page_entry_count=lambda _vault: len(entries),
        page_entries=lambda _vault: entries,
        resolve_reference_table_id=lambda: reference,
        canonicalize_id=lambda value: str(value).strip().lower().replace('-', ''),
        active_vault_path=lambda: '/fixture',
        resolve_ensure_index=lambda: lambda _vault: {},
    )


def index(entries, reference=REFERENCE):
    return search.ensure_citation_index('fixture', CitationIndexState(), dependencies(entries, reference))


@pytest.mark.parametrize('table_key', ['table_id', 'database_table_id'])
@pytest.mark.parametrize('has_key', [False, True])
def test_known_unrelated_scope_never_checks_or_opens_cloud_path(monkeypatch, table_key, has_key):
    def forbidden(*_args, **_kwargs):
        raise AssertionError('An unrelated cloud document must not be touched')

    monkeypatch.setattr(Path, 'exists', forbidden)
    monkeypatch.setattr(Path, 'open', forbidden)
    metadata = {table_key: 'tasks-table'}
    if has_key:
        metadata['Citation Key'] = 'not-a-reference'
    assert index([{'id': 'task', 'path': '/unavailable/task.md', 'metadata': metadata}]) == {}


def test_known_reference_without_cached_key_still_reads_legacy_frontmatter(tmp_path):
    path = tmp_path / 'reference.md'
    path.write_text('---\ntable_id: reference-table\nCitation Key: recovered2026\n---\nBody')
    result = index([{'id': 'resource', 'path': str(path), 'metadata': {'table_id': 'REFERENCE-TABLE'}}])
    assert result['recovered2026']['id'] == 'resource'


@pytest.mark.parametrize('metadata', [{}, {'table_id': ''}, {'database_table_id': '   '}])
def test_unknown_scope_falls_back_to_disk_and_checks_the_actual_table(tmp_path, metadata):
    reference = tmp_path / 'reference.md'
    unrelated = tmp_path / 'task.md'
    reference.write_text('---\ndatabase_table_id: reference-table\nCitation Key: legacy2024\n---\n')
    unrelated.write_text('---\ntable_id: tasks-table\nCitation Key: excluded2024\n---\n')
    result = index([
        {'id': 'legacy', 'path': str(reference), 'metadata': metadata},
        {'id': 'task', 'path': str(unrelated), 'metadata': metadata},
    ])
    assert set(result) == {'legacy2024'}
    assert result['legacy2024']['id'] == 'legacy'


def test_absent_reference_configuration_keeps_legacy_unscoped_indexing(tmp_path):
    path = tmp_path / 'legacy.md'
    path.write_text('---\ntable_id: tasks-table\nCitation Key: legacy-key\n---\n')
    assert 'legacy-key' in index([{'id': 'legacy', 'path': str(path), 'metadata': {'table_id': 'tasks-table'}}], reference=None)


def test_mixed_3535_entry_inventory_keeps_reference_keys_and_first_duplicate(tmp_path, monkeypatch):
    # 3500 unrelated pages need no disk access. The remaining35 include cached
    # keys, duplicates and legacy files with both known and unknown table scope.
    unrelated = [{'id': f'task-{i}', 'path': f'/cloud/task-{i}.md',
                  'metadata': {'table_id': 'tasks-table'}} for i in range(3500)]
    cached = [{'id': f'ref-{i}', 'path': '/never-needed.md',
               'metadata': {'table_id': REFERENCE, 'Citation Key': f'key-{i}'}} for i in range(30)]
    legacy = tmp_path / 'legacy.md'
    legacy.write_text('---\ntable_id: reference-table\nCitation Key: legacy-key\n---\n')
    excluded = tmp_path / 'excluded.md'
    excluded.write_text('---\ntable_id: tasks-table\nCitation Key: excluded-key\n---\n')
    rest = [
        {'id': 'duplicate', 'metadata': {'table_id': REFERENCE, 'Citation Key': 'key-0'}},
        {'id': 'known-legacy', 'path': str(legacy), 'metadata': {'table_id': REFERENCE}},
        {'id': 'unknown-legacy', 'path': str(legacy), 'metadata': {}},
        {'id': 'unknown-task', 'path': str(excluded), 'metadata': {}},
        {'id': 'sparse', 'metadata': {}},
    ]
    original_exists, original_open = Path.exists, Path.open

    def exists(path):
        assert not str(path).startswith('/cloud/'), 'Known unrelated path was checked'
        return original_exists(path)

    def opened(path, *args, **kwargs):
        assert not str(path).startswith('/cloud/'), 'Known unrelated path was opened'
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'exists', exists)
    monkeypatch.setattr(Path, 'open', opened)
    entries = unrelated + cached + rest
    assert len(entries) == 3535
    result = index(entries)
    assert set(result) == {f'key-{i}' for i in range(30)} | {'legacy-key'}
    assert result['key-0']['id'] == 'ref-0'
    assert result['legacy-key']['id'] == 'known-legacy'
