"""Scoped discovery removes deleted pages and cannot include prefix siblings."""
from dataclasses import MISSING, fields
from unittest.mock import Mock
from threading import Lock
from backend.domains.vault.pages import index_service as index


def test_search_scope_uses_path_components_instead_of_string_prefixes(tmp_path):
    root=tmp_path/'table'
    entries=[{'path':str(root/'one.md'),'id':'one'}, {'path':str(tmp_path/'table-other'/'private.md'),'id':'other'}]
    assert [entry['id'] for entry in index._filter_by_search_paths(entries,[root])] == ['one']


def test_partial_refresh_removes_deleted_ids_and_keeps_sibling_tables(monkeypatch,tmp_path):
    arguments={field.name:Mock() for field in fields(index.PageIndexDependencies) if field.default is MISSING and field.default_factory is MISSING}
    arguments.update(index_entries={}, index_initialized={}, id_to_path={}, index_lock=Lock())
    dependencies=index.PageIndexDependencies(**arguments)
    monkeypatch.setattr(index,'_dependencies',dependencies)
    monkeypatch.setattr(index,'bump_page_index_version',Mock())
    key=str(tmp_path)
    root=tmp_path/'table'
    deleted=str(root/'deleted.md');updated=str(root/'updated.md');sibling=str(tmp_path/'table-other'/'other.md')
    dependencies.index_entries[key]={deleted:{'path':deleted,'id':'deleted'},updated:{'path':updated,'id':'updated'},sibling:{'path':sibling,'id':'other'}}
    dependencies.id_to_path[key]={'deleted':deleted,'updated':updated,'other':sibling}
    index._merge_index(tmp_path,{updated:{'path':updated,'id':'updated'}},[root])
    assert set(dependencies.index_entries[key]) == {updated,sibling}
    assert dependencies.id_to_path[key] == {'updated':updated,'other':sibling}
    dependencies.update_path_resolver.assert_called_once()


def test_explicit_required_refresh_refuses_a_stale_snapshot_while_other_refresh_is_busy(monkeypatch,tmp_path):
    import pytest
    arguments={field.name:Mock() for field in fields(index.PageIndexDependencies) if field.default is MISSING and field.default_factory is MISSING}
    arguments.update(active_vault_path=lambda:tmp_path,index_entries={},index_initialized={},id_to_path={},index_lock=Lock())
    dependencies=index.PageIndexDependencies(**arguments)
    busy=Lock();busy.acquire();dependencies.refresh_locks[str(tmp_path)]=busy
    monkeypatch.setattr(index,'_dependencies',dependencies)
    try:
        with pytest.raises(RuntimeError,match='refresh_in_progress'):
            index.get_cached_page_entries(force_refresh=True,require_refresh=True)
        assert index.get_cached_page_entries(force_refresh=True) == []
    finally:
        busy.release()


def test_refresh_invalidates_only_the_matching_vault_table_and_list_snapshots(monkeypatch,tmp_path):
    from backend.domains.vault.pages.cache import invalidate_vault_page_responses
    from backend.domains.vault.pages.state import page_state
    vault=str(tmp_path/'vault');sibling=str(tmp_path/'vault-other')
    cache={f'by-table:{vault}:table':(0,[]),f'snapshot:{vault}:all:v1':(0,[]),f'by-table:{sibling}:private':(0,[])}
    monkeypatch.setattr(page_state,'response_cache',cache)
    invalidate_vault_page_responses(vault)
    assert list(cache) == [f'by-table:{sibling}:private']
