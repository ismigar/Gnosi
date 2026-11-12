"""Table-wide eligibility, independent of a website's public field selection."""
from __future__ import annotations

from pydantic import JsonValue, StrictBool
from fastapi import HTTPException

from .models import Contract, SiteConfig
from .storage import SiteStore


class TablePublicationSettings(Contract):
    table_id: str
    publishable: bool


class TablePublicationUpdate(Contract):
    publishable: StrictBool


def eligible(table: dict[str, JsonValue], data: dict[str, JsonValue], sites: list[SiteConfig], page_tables: dict[str, str | None] | None = None) -> bool:
    value = table.get('web_publishable')
    if 'web_publishable' in table:
        return value is True
    # Existing native bindings remain usable on upgrade. Unbound tables start private.
    from .exporter import records
    views = {str(view.get('id')): str(view.get('table_id')) for view in records(data, 'views')}
    return any(source.enabled and source.kind in {'table', 'view', 'page'}
               and (views.get(source.source_id) if source.kind == 'view' else (page_tables or {}).get(source.source_id) if source.kind == 'page' else source.source_id) == str(table.get('id'))
               for site in sites for source in site.sources)


def native_page_tables(store: SiteStore, data: dict[str, JsonValue], sites: list[SiteConfig]) -> dict[str, str | None]:
    from pathlib import Path
    from typing import cast
    from backend.domains.vault.pages.index_service import get_available_page_entries
    from . import exporter
    ids = {source.source_id for site in sites for source in site.sources if source.enabled and source.kind == 'page' and not source.source_id.startswith('imported:')}
    if not ids:
        return {}
    result: dict[str, str | None] = {}
    # Catalogue/eligibility reads must never start vault discovery or open Markdown.
    for entry in get_available_page_entries(store.vault) or []:
        metadata, raw_path = entry.get('metadata'), entry.get('path')
        if not isinstance(metadata, dict) or not isinstance(raw_path, str):
            continue
        identity = str(metadata.get('id'))
        path = Path(raw_path)
        if identity in ids and path.is_relative_to(store.vault) and not any(part.startswith('.') for part in path.relative_to(store.vault).parts):
            table = exporter.note_table(exporter.Note(path, cast(dict[str, JsonValue], metadata), '', ''), data, store.vault)
            result[identity] = str(table['id']) if table else None
    return result


def read(store: SiteStore, table_id: str) -> TablePublicationSettings:
    from .exporter import registry, records
    data, _ = registry(store)
    table = next((item for item in records(data, 'tables') if str(item.get('id')) == table_id), None)
    if table is None:
        raise HTTPException(404, 'Table not found')
    capability = table.get('web_publishable')
    if isinstance(capability, bool):
        return TablePublicationSettings(table_id=table_id, publishable=capability)
    sites = store.list()
    return TablePublicationSettings(table_id=table_id, publishable=eligible(table, data, sites, native_page_tables(store, data, sites)))


def update(store: SiteStore, table_id: str, request: TablePublicationUpdate) -> TablePublicationSettings:
    from backend.services.context_vars import active_vault_path
    # Initialize the compatibility composition root before its runtime ports.
    from backend.api import vault_routes  # noqa: F401
    from backend.domains.vault.registry import runtime
    from backend.domains.vault.registry.records import is_record
    token = active_vault_path.set(store.vault)
    try:
        with runtime.registry_mutation():
            data = runtime.load_registry_for_write()
            tables = data.get('tables')
            table = next((item for item in tables if is_record(item) and str(item.get('id')) == table_id), None) if isinstance(tables, list) else None
            if table is None:
                raise HTTPException(404, 'Table not found')
            table['web_publishable'] = request.publishable
            runtime.save_registry(data)
    finally:
        active_vault_path.reset(token)
    return TablePublicationSettings(table_id=table_id, publishable=request.publishable)


def validate_sources(store: SiteStore, site: SiteConfig) -> None:
    from .exporter import registry, _source_table
    native = [source for source in site.sources if source.enabled and source.kind in {'table', 'view', 'page'} and not source.source_id.startswith('imported:')]
    if not native:
        return
    data, _ = registry(store)
    previous = store.list()
    page_tables = native_page_tables(store, data, [*previous, site])
    from .exporter import records
    tables = {str(table.get('id')): table for table in records(data, 'tables')}
    for source in native:
        if source.kind == 'page':
            if source.source_id not in page_tables:
                raise HTTPException(409, 'The selected page is unavailable; reload before saving')
            table_id = page_tables[source.source_id]
            if table_id is None:
                continue  # A known standalone note has no table capability.
            table = tables[table_id]
        else:
            table, _ = _source_table(source, data)
        if not eligible(table, data, previous, page_tables):
            raise HTTPException(409, 'Enable website publication in the table settings first')
