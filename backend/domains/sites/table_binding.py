"""Bind an explicit table section without publishing or losing old selections."""
from __future__ import annotations

import json

from fastapi import HTTPException
from pydantic import Field

from . import exporter, record_publication
from .models import Contract, SiteConfig, SiteSource, safe_path
from .storage import SiteStore
from .translations import PublicTranslations


class TableBindingRequest(Contract):
    revision: int
    table_id: str = Field(min_length=1)
    section: str
    source_id: str | None = None
    enabled: bool
    include_body: bool
    field_ids: list[str] = Field(default_factory=list)
    attachment_field_ids: list[str] = Field(default_factory=list)


def _published_reference(store: SiteStore, site: SiteConfig, source: SiteSource) -> tuple[bool, dict[tuple[str, str], set[str]]]:
    published: dict[tuple[str, str], set[str]] = {}
    has_active_release = False
    for target in site.targets:
        active_bundle = store.active_bundle(site.id, target.id)
        has_active_release = has_active_release or active_bundle is not None
        active = active_bundle or {}
        for record in exporter.records(active, "records"):
            source_ids = record.get("source_ids", [])
            if isinstance(source_ids, list) and source.id in source_ids:
                identity = str(record["id"]), str(record["language"])
                published.setdefault(identity, set()).add(str(record.get("path") or ""))
    if has_active_release:
        return True, published
    # Before a first release, the existing local snapshot is the preservation
    # reference. It is never used as a content source after this binding.
    from .importer import _groups, obj, rows
    payload = obj(json.loads((store.site_dir(site.id) / "imported/baseline.json").read_text()))
    for node in rows(obj(payload.get("data", {})).get("nodes", [])):
        identity = str(node["uuid"]), str(node["lang"])
        if source.source_id in {"imported:" + group for group in _groups(node, obj(payload.get("type_map", {})))} and identity[0] not in source.withdrawn_ids and identity[1] not in source.withdrawn_versions.get(identity[0], []) and (source.selection_mode != "selected" or identity[0] in source.page_ids):
            published.setdefault(identity, set()).add(str(node.get("url") or ""))
    return False, published


def _preserve_published_paths(reference: dict[tuple[str, str], set[str]], has_active: bool, notes: list[exporter.Note], source: SiteSource, translations: PublicTranslations) -> None:
    paths: dict[tuple[str, str], str] = {}
    for identity, candidates in reference.items():
        if len(candidates) != 1:
            raise HTTPException(409, "The published website URLs differ between targets; reconcile them before replacing the imported source")
        path = next(iter(candidates))
        try:
            safe_path(path)
        except ValueError:
            raise HTTPException(409, "An existing public URL is unavailable; reconcile it before replacing the imported source") from None
        paths[identity] = path
    by_identity = {exporter._note_identity(note, translations): note for note in notes}
    for identity, expected in paths.items():
        # Use the exporter's exact path policy. Active release paths take
        # priority there; before the first release the recovered native path
        # itself must already agree with the existing publication reference.
        try:
            projected = exporter._record(by_identity[identity], source, translations, paths if has_active else {}).path
        except HTTPException:
            raise HTTPException(409, "Reconcile the native URLs before replacing the imported source") from None
        if projected != expected:
            raise HTTPException(409, "Reconcile the native URLs with the existing website before replacing its imported source")


def _binding_sources(site: SiteConfig, request: TableBindingRequest) -> tuple[list[SiteSource], list[SiteSource]]:
    selected = next((source for source in site.sources if source.id == request.source_id), None)
    if request.source_id and (selected is None or selected.kind != "table" or selected.source_id != request.table_id):
        raise HTTPException(409, "The selected table binding changed; reload before saving")
    imported = [source for source in site.sources if source.enabled and source.source_id.startswith("imported:") and source.path_prefix == request.section]
    native = [source for source in site.sources if source.kind == "table" and source.source_id == request.table_id and (source.path_prefix == request.section or source is selected)]
    other = [source for source in site.sources if source.enabled and source.path_prefix == request.section and source not in imported + native]
    if len(imported) > 1 or len(native) > 1 or other:
        raise HTTPException(409, "This website section has another source; configure its binding in Webs")
    if imported and native and imported[0].filters and imported[0].filters != native[0].filters:
        raise HTTPException(409, "The source filters differ; reconcile them in Webs before merging the bindings")
    return imported, native


def bind(store: SiteStore, site: SiteConfig, request: TableBindingRequest) -> SiteConfig:
    if site.revision != request.revision:
        raise HTTPException(409, "The website changed; reload before saving")
    try:
        safe_path(request.section)
    except ValueError:
        raise HTTPException(422, "A plain absolute website section path is required") from None
    data, _ = exporter.registry(store)
    tables = [table for table in exporter.records(data, "tables") if str(table.get("id")) == request.table_id]
    if len(tables) != 1:
        raise HTTPException(409, "The table binding is unavailable or ambiguous")
    fields = {field["id"]: field for field in exporter.fields(tables[0])}
    if set(request.field_ids + request.attachment_field_ids) - fields.keys():
        raise HTTPException(409, "A selected public field is unavailable")
    if any(not any(kind in fields[field]["type"] for kind in ("file", "attachment", "image", "media")) for field in request.attachment_field_ids):
        raise HTTPException(422, "Only attachment fields may publish attachments")
    imported, native = _binding_sources(site, request)
    prior = native[0] if native else imported[0] if imported else None
    source = prior.model_copy(deep=True) if prior else SiteSource(source_id=request.table_id, title=str(tables[0].get("name") or request.table_id), selection_mode="selected", path_prefix=request.section)
    if imported:
        source.id = imported[0].id
        if not request.enabled:
            raise HTTPException(409, "Enable the table source to replace an imported collection")
        notes = record_publication._discovery_notes(store)
        selected = exporter._table_notes(notes, data, tables[0], store.vault)
        translations = PublicTranslations(site, [note.metadata for note in notes])
        identities: dict[tuple[str, str], str] = {}
        for note in selected:
            identity = exporter._note_identity(note, translations)
            if identity in identities:
                raise HTTPException(409, "Multiple table records own one public language identity")
            identities[identity] = str(note.metadata["id"])
        has_active, published_paths = _published_reference(store, site, imported[0])
        published = set(published_paths)
        if published - identities.keys():
            raise HTTPException(409, "Reconcile the existing website records and their translations with this table before replacing its imported source")
        source.selection_mode = "selected"
        native_selection = {str(note.metadata["id"]) for old in native for note in exporter.source_notes(old, notes, data, store.vault, imported=site.legacy_pilot)[0]}
        source.page_ids = sorted({identities[identity] for identity in published} | native_selection | {page for old in native for page in old.page_ids})
        source.withdrawn_ids = sorted({page for old in native for page in old.withdrawn_ids}
            | {page for (identity, _language), page in identities.items() if identity in imported[0].withdrawn_ids})
        source.withdrawn_versions = {page: sorted({language for old in native for language in old.withdrawn_versions.get(page, [])}
            | {language for (identity, language), mapped in identities.items() if mapped == page and language in imported[0].withdrawn_versions.get(identity, [])})
            for page in set(identities.values()) | {page for old in native for page in old.withdrawn_versions}}
        native_projection = source.model_copy(update={"kind": "table", "source_id": request.table_id})
        eligible, _table = exporter.source_notes(native_projection, notes, data, store.vault, imported=site.legacy_pilot)
        eligible_identities = {key for note in eligible if (key := exporter.publication_identity(note, native_projection, translations)) is not None}
        if published - eligible_identities:
            raise HTTPException(409, "The table filters or privacy settings exclude existing public content; reconcile the selection before replacing the imported source")
        _preserve_published_paths(published_paths, has_active, eligible, native_projection, translations)
    source.kind = "table"
    source.source_id = request.table_id
    source.path_prefix = request.section
    source.enabled = request.enabled
    source.include_body = request.include_body
    source.field_ids = request.field_ids
    source.attachment_field_ids = request.attachment_field_ids
    result = site.model_copy(deep=True)
    replaced = {old.id for old in imported + native}
    result.sources = [old for old in result.sources if old.id not in replaced] + [source]
    aliases = {old.id for old in native if old.id != source.id}
    for _location, block in result.editorial_blocks():
        if block.source_id in aliases:
            block.source_id = source.id
    return store.save(result)
