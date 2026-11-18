"""Contextual record publication through the existing website release pipeline."""
from __future__ import annotations

import json
from typing import Literal, cast

from fastapi import HTTPException
from pydantic import Field, JsonValue

from . import exporter, publication, runtime
from .models import Contract, SiteConfig, SitePreview, SiteSource
from .storage import SiteStore, fingerprint
from .translations import PublicTranslations


class RecordDestination(Contract):
    site_id: str
    site_name: str
    target_id: str
    target_name: str
    environment: str
    url: str
    published_page_ids: list[str] = Field(default_factory=list)


class RecordPublicationReview(Contract):
    page_id: str = Field(min_length=1)
    target_id: str
    action: Literal["publish", "withdraw"]


def _binding(source: SiteSource, table_id: str, data: dict[str, JsonValue]) -> bool:
    if not source.enabled or source.kind == "page" or source.source_id.startswith("imported:"):
        return False
    table, _ = exporter._source_table(source, data)
    return ('web_publishable' not in table or table.get('web_publishable') is True) and str(table.get("id")) == table_id


class _TableBindingConflict(HTTPException):
    def __init__(self) -> None:
        super().__init__(409, "The record has no unambiguous table binding")


def _context(store: SiteStore, page_id: str, snapshot: exporter.SourceSnapshot | None = None) -> tuple[dict[str, JsonValue], list[exporter.Note], exporter.Note, str]:
    if snapshot is None:
        snapshot = exporter.source_snapshot(store)
    snapshot.require_vault(store)
    data, notes = snapshot.data, snapshot.notes
    matching = [note for note in notes if str(note.metadata["id"]) == page_id]
    if len(matching) != 1:
        raise HTTPException(409, "The record is unavailable or has conflicting identities")
    note = matching[0]
    tables = [table for table in exporter.records(data, "tables") if note in exporter._table_notes([note], data, table, store.vault)]
    if len(tables) != 1:
        raise _TableBindingConflict()
    return data, notes, note, str(tables[0]["id"])


def _discovery_notes(store: SiteStore) -> list[exporter.Note] | None:
    """Read existing metadata hints without traversing or parsing document bodies.

    This inventory serves non-publishing menus only. Review and confirmation
    retain independent fresh scoped reads before any publication mutation.
    """
    from .source_inputs import _path, available_entries
    entries = available_entries(store.vault)
    if entries is None:
        return None
    notes: list[exporter.Note] = []
    identities: set[str] = set()
    for entry in entries:
        path, metadata = _path(store.vault, entry.get('path')), entry.get('metadata')
        if path is None or entry.get('is_database') or not isinstance(metadata, dict) or not metadata.get('id'):
            continue
        identity = str(metadata['id'])
        if identity in identities:
            raise HTTPException(409, "Duplicate note identities must be resolved before publication")
        identities.add(identity)
        notes.append(exporter.Note(path, cast(dict[str, JsonValue], json.loads(json.dumps(metadata, default=str))), "", ""))
    return notes


def _domain_notes(store: SiteStore, data: dict[str, JsonValue], sources: list[SiteSource]) -> list[exporter.Note]:
    from .asset_files import parent_descriptor_cache, read_session
    from .note_parse_cache import parsed_metadata_context
    from .source_inputs import read_inputs
    lookup = SiteConfig(name='Record publication lookup', sources=sources)
    with read_session(), parent_descriptor_cache(), parsed_metadata_context(store.private_root):
        return read_inputs(store, lookup, data, set())[0]


def _menu_notes(store: SiteStore, data: dict[str, JsonValue], page_id: str | None, table_id: str | None, sites: list[SiteConfig]) -> list[exporter.Note]:
    notes = _discovery_notes(store)
    if notes and (not page_id or any(str(note.metadata['id']) == page_id for note in notes)):
        return notes
    if table_id:
        if not any(str(table.get('id')) == table_id for table in exporter.records(data, 'tables')):
            return []
        sources = [SiteSource(id='record-lookup', kind='table', source_id=table_id, enabled=True)]
    else:
        # Record filenames are titles, not IDs. Without a locator, enumerate
        # configured publication table domains rather than arbitrary vault bodies.
        bound = [source for site in sites for source in site.sources if source.enabled
                 and source.kind in {'table', 'view'} and not source.source_id.startswith('imported:')]
        sources = [SiteSource(id=f'record-lookup-{index}', kind=source.kind, source_id=source.source_id, enabled=True)
                   for index, source in enumerate(bound)]
    return _domain_notes(store, data, sources)


def destinations(store: SiteStore, *, page_id: str | None = None, table_id: str | None = None) -> list[RecordDestination]:
    if bool(page_id) == bool(table_id):
        raise HTTPException(422, "Choose a record or a table")
    from backend.domains.vault.tables.rows import build_table_folder_index, resolve_table_id_from_context

    data, _ = exporter.registry(store)
    sites = store.list()
    notes = _menu_notes(store, data, page_id, table_id, sites)
    if page_id:
        matching = [note for note in notes if str(note.metadata["id"]) == page_id]
        if len(matching) != 1:
            raise HTTPException(409, "The record is unavailable or has conflicting identities")
        note = matching[0]
        table_id = resolve_table_id_from_context(cast(dict[object, object], note.metadata), str(note.path.parent.relative_to(store.vault)), build_table_folder_index(cast(dict[object, object], data)))
        if table_id is None:
            return []
    tables = [table for table in exporter.records(data, "tables") if str(table.get("id")) == table_id]
    if page_id and len(tables) != 1:
        return []
    table = tables[0] if len(tables) == 1 else None
    if table is None:
        raise HTTPException(404, "Table not found")
    notes = exporter._table_notes(notes, data, table, store.vault)
    result = []
    for site in sites:
        if not any(_binding(source, str(table_id), data) for source in site.sources):
            continue
        translations = PublicTranslations(site, [note.metadata for note in notes])
        for target in site.targets:
            if not target.enabled:
                continue
            active = store.active_bundle(site.id, target.id) or {}
            records = active.get("records", [])
            identities = {(str(record.get("id")), str(record.get("language"))) for record in records if isinstance(record, dict)} if isinstance(records, list) else set()
            published = []
            for note in notes:
                if page_id and str(note.metadata["id"]) != page_id:
                    continue
                try:
                    identity = exporter._note_identity(note, translations)
                except HTTPException:
                    continue
                if identity in identities:
                    published.append(str(note.metadata["id"]))
            result.append(RecordDestination(site_id=site.id, site_name=site.name, target_id=target.id, target_name=target.name, environment=target.environment, url=target.base_url, published_page_ids=published))
    return result


def proposal(store: SiteStore, site: SiteConfig, request: RecordPublicationReview, *, snapshot: exporter.SourceSnapshot | None = None) -> SiteConfig:
    if snapshot is None:
        snapshot = exporter.source_snapshot(store, site=site, extra_page_ids={request.page_id})
    snapshot.require_site(store, site)
    data, notes, note, table_id = _context(store, request.page_id, snapshot)
    candidate = site.model_copy(deep=True)
    language = exporter._note_identity(note, PublicTranslations(site, [item.metadata for item in notes]))[1]
    bound = [source for source in candidate.sources if _binding(source, table_id, data)]
    if not bound:
        raise HTTPException(409, "This table is not an enabled source of this website")
    eligible = []
    for source in bound:
        probe = source.model_copy(update={"page_ids": [], "withdrawn_ids": [], "selection_mode": "all"}, deep=True)
        selected, _ = exporter.source_notes(probe, notes, data, store.vault, imported=site.legacy_pilot)
        if note in selected:
            eligible.append(source)
    if request.action == "publish" and not eligible:
        raise HTTPException(409, "The record is private, a draft, or excluded by the website source filters")
    affected = eligible if request.action == "publish" else bound + [source for source in candidate.sources if source.enabled and source.kind == "page" and source.source_id == request.page_id]
    for source in affected:
        if request.action == "withdraw":
            source.withdrawn_ids = sorted(set(source.withdrawn_ids) | {request.page_id})
        else:
            source.withdrawn_ids = [value for value in source.withdrawn_ids if value != request.page_id]
            if request.page_id in source.withdrawn_versions:
                source.withdrawn_versions[request.page_id] = [value for value in source.withdrawn_versions[request.page_id] if value != language]
            if source.selection_mode == "selected" or source.page_ids:
                source.page_ids = list(dict.fromkeys([*source.page_ids, request.page_id]))
    # The reviewed bundle must have the same revision as the eventual saved selection.
    candidate.revision += 1
    return candidate


def context_fingerprint(store: SiteStore, page_id: str, *, snapshot: exporter.SourceSnapshot | None = None) -> str:
    data, _, note, table_id = _context(store, page_id, snapshot)
    return fingerprint([data, note.digest, str(note.path.relative_to(store.vault)), table_id])


def review(store: SiteStore, site: SiteConfig, request: RecordPublicationReview) -> SitePreview:
    from .preview_worker import run_isolated, in_worker
    from backend.utils.bounded_file_io import cloud_path
    if cloud_path(store.vault) and not in_worker.get():
        return run_isolated(store, site, request.target_id, record=request)
    snapshot = exporter.source_snapshot(store, site=site, extra_page_ids={request.page_id})
    record_fingerprint = context_fingerprint(store, request.page_id, snapshot=snapshot)
    candidate = proposal(store, site, request, snapshot=snapshot)
    bundle = exporter.build_bundle(store, candidate, request.target_id, snapshot=snapshot, reuse_asset_snapshots=True)
    _, notes, note, _ = _context(store, request.page_id, snapshot)
    identity = exporter._note_identity(note, PublicTranslations(site, [item.metadata for item in notes]))
    included = any((record.id, record.language) == identity for record in bundle.records)
    if included != (request.action == "publish"):
        raise HTTPException(409, "Other source selections prevent this record change; review the website sources")
    result = publication._preview_bundle(store, candidate, request.target_id, bundle, expected_revision=site.revision)
    try:
        # An independent fresh scan retains duplicate-identity, source-availability
        # and record/registry freshness checks after rendering the exact bundle.
        fresh = exporter.source_snapshot(store, site=site, extra_page_ids={request.page_id})
        if context_fingerprint(store, request.page_id, snapshot=fresh) != record_fingerprint:
            raise HTTPException(409, "The record changed during review; review again")
        with store.database() as db:
            row = db.execute("SELECT payload FROM previews WHERE id=?", (result.id,)).fetchone()
            payload = json.loads(row["payload"])
            payload["record_proposal"] = {"request": request.model_dump(mode="json"), "site": candidate.model_dump(mode="json"), "original_fingerprint": fingerprint(site.model_dump(mode="json")), "record_fingerprint": record_fingerprint}
            db.execute("UPDATE previews SET payload=? WHERE id=?", (json.dumps(payload), result.id))
    except BaseException:
        try:
            runtime.stop_preview(store, site.id, result.id)
        finally:
            with store.database() as db:
                db.execute("DELETE FROM previews WHERE id=? AND consumed=0", (result.id,))
        raise
    return result
