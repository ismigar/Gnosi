"""The editor catalogue must not hydrate or hash every Markdown note."""
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.domains.sites import exporter
from backend.domains.vault.pages import index_service
from backend.tests.test_sites import website as website
from backend.tests.test_sites_imported_pilot import imported_pilot as imported_pilot


def test_warm_snapshot_uses_metadata_without_opening_markdown(website, monkeypatch):
    store = website.store
    monkeypatch.setattr(exporter, 'notes', lambda *_: pytest.fail('No note scan in editor catalogue'))
    monkeypatch.setattr(Path, 'rglob', lambda *_: pytest.fail('No recursive discovery'))
    monkeypatch.setattr(index_service, 'get_available_page_entries', lambda root: [
        {'path': str(root / 'Wiki/entry.md'), 'id': 'one', 'title': 'Indexed title', 'metadata': {'id': 'one'}},
        {'path': str(root / '../other/private.md'), 'title': 'Other vault', 'metadata': {'id': 'other'}},
        {'path': str(root / '.private/entry.md'), 'metadata': {'id': 'hidden'}},
    ])
    snapshot = exporter.catalogue_snapshot(store)
    assert snapshot.pages_ready
    assert [(item.id, item.title) for item in snapshot.items if item.kind == 'page'] == [('one', 'Indexed title')]


def test_cold_snapshot_returns_available_sources_and_explicit_incomplete_state(website, monkeypatch):
    monkeypatch.setattr(index_service, 'get_available_page_entries', lambda _: None)
    monkeypatch.setattr(exporter, 'notes', lambda *_: pytest.fail('Cold index cannot trigger a full scan'))
    snapshot = exporter.catalogue_snapshot(website.store)
    assert not snapshot.pages_ready
    assert any(item.kind == 'table' for item in snapshot.items)


def test_snapshot_rejects_duplicate_page_ids(website, monkeypatch):
    monkeypatch.setattr(index_service, 'get_available_page_entries', lambda root: [
        {'path': str(root / path), 'metadata': {'id': 'duplicate'}} for path in ('a.md', 'b.md')
    ])
    with pytest.raises(HTTPException, match='409'):
        exporter.catalogue_snapshot(website.store)


def test_imported_records_are_available_even_when_native_index_is_cold(imported_pilot, monkeypatch):
    store, _, _, _ = imported_pilot
    monkeypatch.setattr(index_service, 'get_available_page_entries', lambda _: None)
    monkeypatch.setattr(exporter, 'notes', lambda *_: pytest.fail('Do not hydrate notes for imported choices'))
    snapshot = exporter.catalogue_snapshot(store)
    assert not snapshot.pages_ready
    record = next(item for item in snapshot.items if item.id == '11111111-1111-4111-8111-111111111111')
    assert record.kind == 'record'
    assert record.languages == ['ca', 'es', 'en-gb']
    assert record.source_ids == ['imported:blog']


def test_corrupt_imported_catalogue_cannot_be_presented_as_complete(imported_pilot, monkeypatch):
    store, site, _, _ = imported_pilot
    monkeypatch.setattr(index_service, 'get_available_page_entries', lambda _: [])
    (store.site_dir(site.id) / 'imported/baseline.json').write_text('{broken')
    with pytest.raises(HTTPException, match='409'):
        exporter.catalogue_snapshot(store)
