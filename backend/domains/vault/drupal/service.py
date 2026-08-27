"""Orchestrate idempotent Vault-row synchronization to Drupal."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, cast

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.drupal.core import Metadata
from backend.domains.vault.schemas.pages import PagePatchRequest


class BuildFields(Protocol):
    def __call__(
        self,
        *,
        mapping: Metadata,
        props_by_ref: dict[str, Metadata],
        field_meta: dict[str, Metadata],
        metadata: Metadata,
        body: str,
        bundle: str,
        term_cache: dict[str, str],
        image_cache: dict[str, str],
        text_only: bool = False,
        media_only: bool = False,
    ) -> Awaitable[tuple[Metadata, Metadata, list[Metadata]]]: ...


class UploadFieldImage(Protocol):
    def __call__(
        self,
        value: Any,
        bundle: str,
        drupal_field: str,
        metadata: Metadata,
        image_cache: dict[str, str],
    ) -> Awaitable[Metadata | None]: ...


@dataclass(frozen=True)
class DrupalSyncDependencies:
    sync_error: type[Exception]
    not_found_error: type[Exception]
    find_page: Callable[[str], Path | None]
    materialize: Callable[[Path, str], Awaitable[object]]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    table_id: Callable[[Metadata], str | None]
    table_by_id: Callable[[str | None], Metadata | None]
    inject_virtual_fields: Callable[[Metadata, str, Metadata, Any], None]
    virtual_page_loader: Any
    check_requires: Callable[[Metadata, str, Metadata], tuple[bool, str | None]]
    action_sync_drupal: str
    props_by_ref: Callable[[Metadata], dict[str, Metadata]]
    list_fields: Callable[[str], Awaitable[list[Metadata]]]
    build_fields: BuildFields
    resolve_langcode: Callable[[Metadata], Awaitable[str]]
    image_mapping: Callable[
        [Metadata, dict[str, Metadata]],
        tuple[str | None, str | None],
    ]
    field_translatable: Callable[[str, str], Awaitable[bool]]
    read_prop_value: Callable[[Metadata, Metadata | None], Any]
    upload_field_image: UploadFieldImage
    uuid_to_fid: Callable[[object], Awaitable[object | None]]
    row_image_alt: Callable[
        [Metadata, dict[str, Metadata], str | None],
        str,
    ]
    find_nodes_by_title: Callable[[str, str], Awaitable[list[Metadata]]]
    add_translation: Callable[[str, str, Metadata], Awaitable[Metadata]]
    base_url: Callable[[], str]
    create_node: Callable[
        [str, Metadata, Metadata, str],
        Awaitable[Metadata],
    ]
    update_node: Callable[[str, str, Metadata, Metadata], Awaitable[Metadata]]
    media_signatures: Callable[
        [Metadata, dict[str, Metadata], dict[str, Metadata], Metadata],
        dict[str, str],
    ]
    existing_translations: Callable[[str], Awaitable[dict[str, Any]]]
    pages_for_table: Callable[[str], list[Any]]
    identity_metadata: Callable[[Metadata, object, object, object], Metadata]
    status_effect: Callable[
        [Metadata, str, str],
        tuple[Metadata | None, str | None, bool],
    ]
    effect_write_key: Callable[[Metadata, Metadata], str | None]
    persist_status_options: Callable[[str, list[Any]], None]
    patch_page: Callable[
        [str, PagePatchRequest, BackgroundTasks],
        Awaitable[Metadata],
    ]
    logger: logging.Logger


@dataclass
class SyncContext:
    item_id: str
    file_path: Path
    metadata: Metadata
    body: str
    table_id: str
    table: Metadata
    bundle: str
    mapping: Metadata
    properties_by_ref: dict[str, Metadata]
    field_metadata: dict[str, Metadata]
    term_cache: dict[str, str] = field(default_factory=dict)
    image_cache: dict[str, str] = field(default_factory=dict)
    source_language: str = "en"


@dataclass
class TranslationImage:
    image_ref: str | None = None
    image_field: str | None = None
    shared_fid: object | None = None


@dataclass
class NodeState:
    uuid: str | None
    nid: object | None
    url: str | None
    created: bool = False
    languages: list[str] = field(default_factory=list)
    skipped_fields: list[Metadata] = field(default_factory=list)


def _field_metadata(fields: list[Metadata]) -> dict[str, Metadata]:
    result: dict[str, Metadata] = {}
    for field_config in fields:
        field_name = field_config.get("field_name")
        if not field_name:
            continue
        field_type = field_config.get("field_type")
        vocabulary: object | None = None
        if field_type == "entity_reference":
            raw_bundles = field_config.get("target_bundles") or []
            bundles = raw_bundles if isinstance(raw_bundles, list) else []
            vocabulary = bundles[0] if bundles else "tags"
        result[str(field_name)] = {
            "type": field_type,
            "vocab": vocabulary,
        }
    return result


async def _load_context(
    item_id: str,
    dependencies: DrupalSyncDependencies,
) -> SyncContext:
    file_path = await asyncio.to_thread(dependencies.find_page, item_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {item_id})")
    await dependencies.materialize(file_path, "drupal-sync")
    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = dependencies.parse_frontmatter(raw_content, file_path)
    table_id = dependencies.table_id(metadata)
    table = dependencies.table_by_id(table_id) if table_id else None
    if not table:
        raise HTTPException(status_code=400, detail="Row is not part of a table")
    if not table.get("drupal_sync_enabled"):
        raise HTTPException(
            status_code=400,
            detail="Drupal sync is not enabled on this table",
        )
    await asyncio.to_thread(
        dependencies.inject_virtual_fields,
        table,
        str(metadata.get("id") or item_id),
        metadata,
        dependencies.virtual_page_loader,
    )
    allowed, reason = dependencies.check_requires(
        table,
        dependencies.action_sync_drupal,
        metadata,
    )
    if not allowed:
        raise HTTPException(status_code=409, detail=reason)
    bundle = str(table.get("drupal_bundle") or "").strip()
    raw_mapping = table.get("drupal_field_mapping") or {}
    mapping = cast(Metadata, raw_mapping)
    if not bundle or not mapping:
        raise HTTPException(
            status_code=400,
            detail="Drupal content type or field mapping not configured",
        )
    try:
        fields = await dependencies.list_fields(bundle)
    except dependencies.sync_error as error:
        raise HTTPException(status_code=502, detail=f"Drupal: {error}") from error
    context = SyncContext(
        item_id=item_id,
        file_path=file_path,
        metadata=metadata,
        body=body,
        table_id=str(table_id),
        table=table,
        bundle=bundle,
        mapping=mapping,
        properties_by_ref=dependencies.props_by_ref(table),
        field_metadata=_field_metadata(fields),
    )
    context.source_language = await dependencies.resolve_langcode(metadata)
    return context


async def _text_attributes(
    context: SyncContext,
    dependencies: DrupalSyncDependencies,
) -> Metadata:
    attributes, _relationships, _skipped = await dependencies.build_fields(
        mapping=context.mapping,
        props_by_ref=context.properties_by_ref,
        field_meta=context.field_metadata,
        metadata=context.metadata,
        body=context.body,
        bundle=context.bundle,
        term_cache=context.term_cache,
        image_cache=context.image_cache,
        text_only=True,
    )
    if not attributes.get("title"):
        attributes["title"] = str(context.metadata.get("title") or "Sense títol")
    return attributes


async def _translation_image(
    context: SyncContext,
    skipped_fields: list[Metadata],
    dependencies: DrupalSyncDependencies,
) -> TranslationImage:
    image_ref, image_field = dependencies.image_mapping(
        context.mapping,
        context.field_metadata,
    )
    result = TranslationImage(image_ref=image_ref, image_field=image_field)
    if not image_field or not await dependencies.field_translatable(
        context.bundle,
        image_field,
    ):
        return result
    main_image = (
        dependencies.read_prop_value(
            context.metadata,
            context.properties_by_ref.get(image_ref),
        )
        if image_ref
        else None
    )
    if main_image in (None, "", [], {}):
        return result
    try:
        relationship = await dependencies.upload_field_image(
            main_image,
            context.bundle,
            image_field,
            context.metadata,
            context.image_cache,
        )
        if relationship:
            data = relationship.get("data")
            file_uuid = data.get("id") if isinstance(data, dict) else None
            result.shared_fid = await dependencies.uuid_to_fid(file_uuid)
    except Exception as error:
        skipped_fields.append({"field": image_field, "reason": f"image(trad): {error}"})
    return result


def _image_fields(
    metadata: Metadata,
    context: SyncContext,
    image: TranslationImage,
    dependencies: DrupalSyncDependencies,
) -> Metadata:
    if not (image.shared_fid and image.image_field):
        return {}
    return {
        image.image_field: {
            "target_id": image.shared_fid,
            "alt": dependencies.row_image_alt(
                metadata,
                context.properties_by_ref,
                image.image_ref,
            ),
        }
    }


async def _link_by_title(
    context: SyncContext,
    state: NodeState,
    dependencies: DrupalSyncDependencies,
) -> None:
    if state.uuid:
        return
    title = str(context.metadata.get("title") or "").strip()
    try:
        matches = await dependencies.find_nodes_by_title(context.bundle, title) if title else []
    except dependencies.sync_error:
        matches = []
    if len(matches) != 1:
        return
    match = matches[0]
    state.uuid = str(match.get("uuid") or "") or None
    state.nid = match.get("nid")
    state.url = str(match.get("url") or "") or None
    dependencies.logger.info(
        "sync-drupal: '%s' linked by title to node %s (avoids duplicate)",
        title[:40],
        state.nid,
    )


def _raise_sync_error(error: Exception, skipped: list[Metadata]) -> None:
    message = str(error)
    if "field_image" not in message:
        raise HTTPException(status_code=502, detail=f"Drupal: {error}") from error
    image_reason = next(
        (row.get("reason") for row in skipped if "image" in str(row.get("reason", ""))),
        None,
    )
    detail = (
        "This article needs a valid image smaller than 2 MB before it can be published to Drupal."
    )
    if image_reason:
        detail += f" Detail: {image_reason}"
    raise HTTPException(status_code=400, detail=detail) from error


async def _upsert_source(
    context: SyncContext,
    text_attributes: Metadata,
    image: TranslationImage,
    publish: bool,
    state: NodeState,
    dependencies: DrupalSyncDependencies,
) -> None:
    await _link_by_title(context, state, dependencies)
    try:
        if state.uuid:
            try:
                response = await dependencies.add_translation(
                    state.uuid,
                    context.source_language,
                    {
                        **text_attributes,
                        **_image_fields(
                            context.metadata,
                            context,
                            image,
                            dependencies,
                        ),
                    },
                )
                state.nid = response.get("nid")
                if not state.url and state.nid:
                    state.url = f"{dependencies.base_url()}/node/{state.nid}"
                state.languages.append(context.source_language)
            except dependencies.not_found_error:
                state.uuid = None
        if not state.uuid:
            attributes, relationships, state.skipped_fields = await dependencies.build_fields(
                mapping=context.mapping,
                props_by_ref=context.properties_by_ref,
                field_meta=context.field_metadata,
                metadata=context.metadata,
                body=context.body,
                bundle=context.bundle,
                term_cache=context.term_cache,
                image_cache=context.image_cache,
            )
            if not attributes.get("title"):
                attributes["title"] = str(context.metadata.get("title") or "Sense títol")
            create_attributes = attributes if publish else {**attributes, "status": False}
            response = await dependencies.create_node(
                context.bundle,
                create_attributes,
                relationships,
                context.source_language,
            )
            state.uuid = str(response.get("uuid") or "") or None
            state.nid = response.get("nid")
            state.url = str(response.get("url") or "") or None
            state.created = True
            state.languages.append(context.source_language)
    except dependencies.sync_error as error:
        _raise_sync_error(error, state.skipped_fields)


async def _push_media(
    context: SyncContext,
    state: NodeState,
    push_media: bool,
    dependencies: DrupalSyncDependencies,
) -> tuple[bool, dict[str, str] | None]:
    if not (push_media and state.uuid and not state.created):
        return False, None
    current = dependencies.media_signatures(
        context.mapping,
        context.properties_by_ref,
        context.field_metadata,
        context.metadata,
    )
    previous = context.metadata.get("drupal_media_sig") or {}
    if current == previous:
        return False, current
    _attributes, relationships, skipped = await dependencies.build_fields(
        mapping=context.mapping,
        props_by_ref=context.properties_by_ref,
        field_meta=context.field_metadata,
        metadata=context.metadata,
        body=context.body,
        bundle=context.bundle,
        term_cache=context.term_cache,
        image_cache=context.image_cache,
        media_only=True,
    )
    state.skipped_fields.extend(skipped)
    if not relationships:
        return False, current
    try:
        await dependencies.update_node(state.uuid, context.bundle, {}, relationships)
        return True, current
    except dependencies.sync_error as error:
        state.skipped_fields.append({"field": "media", "reason": str(error)})
        return False, current


def sibling_rows(
    table_id: str,
    nid: object,
    exclude_id: str,
    dependencies: DrupalSyncDependencies,
) -> list[Any]:
    """Find same-node rows in other source languages."""
    if not nid:
        return []
    siblings: list[Any] = []
    try:
        for page in dependencies.pages_for_table(table_id):
            if page.id == exclude_id:
                continue
            metadata = page.metadata or {}
            if metadata.get("translation_lang"):
                continue
            if (
                str(metadata.get("drupal_nid") or "") == str(nid)
                and str(metadata.get("drupal_uuid") or "").strip()
            ):
                siblings.append(page)
    except Exception as error:
        dependencies.logger.warning(
            "sync-drupal: sibling lookup failed: %s",
            error,
        )
    return siblings


async def row_text_fields(
    page_id: str,
    *,
    mapping: Metadata,
    props_by_ref: dict[str, Metadata],
    field_meta: dict[str, Metadata],
    bundle: str,
    term_cache: dict[str, str],
    image_cache: dict[str, str],
    dependencies: DrupalSyncDependencies,
) -> tuple[Metadata | None, str | None, Metadata | None]:
    """Read one row and build only the translated Drupal text fields."""
    file_path = await asyncio.to_thread(dependencies.find_page, page_id)
    if not file_path or not file_path.exists():
        return None, None, None
    await dependencies.materialize(file_path, "drupal-sync")
    raw = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = dependencies.parse_frontmatter(raw, file_path)
    table = dependencies.table_by_id(dependencies.table_id(metadata))
    if table:
        await asyncio.to_thread(
            dependencies.inject_virtual_fields,
            table,
            str(metadata.get("id") or page_id),
            metadata,
            dependencies.virtual_page_loader,
        )
    fields, _relationships, _skipped = await dependencies.build_fields(
        mapping=mapping,
        props_by_ref=props_by_ref,
        field_meta=field_meta,
        metadata=metadata,
        body=body,
        bundle=bundle,
        term_cache=term_cache,
        image_cache=image_cache,
        text_only=True,
    )
    if fields and not fields.get("title"):
        fields["title"] = str(metadata.get("title") or "Sense títol")
    return fields, await dependencies.resolve_langcode(metadata), metadata


async def _sync_related(
    context: SyncContext,
    state: NodeState,
    image: TranslationImage,
    scope: str,
    dependencies: DrupalSyncDependencies,
) -> list[Metadata]:
    results: list[Metadata] = []
    if scope != "all" or not state.uuid:
        return results
    existing = await dependencies.existing_translations(context.item_id)
    for language, page in existing.items():
        child_id = getattr(page, "id", None)
        if not child_id:
            continue
        fields, resolved_language, metadata = await row_text_fields(
            str(child_id),
            mapping=context.mapping,
            props_by_ref=context.properties_by_ref,
            field_meta=context.field_metadata,
            bundle=context.bundle,
            term_cache=context.term_cache,
            image_cache=context.image_cache,
            dependencies=dependencies,
        )
        target_language = resolved_language or str(language)
        if not fields:
            results.append({"lang": target_language, "status": "skipped (sense text)"})
            continue
        try:
            await dependencies.add_translation(
                state.uuid,
                target_language,
                {
                    **fields,
                    **_image_fields(
                        metadata or {},
                        context,
                        image,
                        dependencies,
                    ),
                },
            )
            results.append({"lang": target_language, "status": "ok"})
            state.languages.append(target_language)
        except dependencies.sync_error as error:
            results.append({"lang": target_language, "status": f"error: {error}"})
    siblings = await asyncio.to_thread(
        sibling_rows,
        context.table_id,
        state.nid,
        context.item_id,
        dependencies,
    )
    for sibling in siblings:
        sibling_fields, sibling_language, sibling_metadata = await row_text_fields(
            str(sibling.id),
            mapping=context.mapping,
            props_by_ref=context.properties_by_ref,
            field_meta=context.field_metadata,
            bundle=context.bundle,
            term_cache=context.term_cache,
            image_cache=context.image_cache,
            dependencies=dependencies,
        )
        if not sibling_fields or not sibling_language:
            continue
        try:
            await dependencies.add_translation(
                state.uuid,
                sibling_language,
                {
                    **sibling_fields,
                    **_image_fields(
                        sibling_metadata or {},
                        context,
                        image,
                        dependencies,
                    ),
                },
            )
            results.append({"lang": sibling_language, "row": sibling.id, "status": "ok"})
            state.languages.append(sibling_language)
        except dependencies.sync_error as error:
            results.append(
                {
                    "lang": sibling_language,
                    "row": sibling.id,
                    "status": f"error: {error}",
                }
            )
    return results


async def _write_identity(
    context: SyncContext,
    state: NodeState,
    media_signature: dict[str, str] | None,
    background_tasks: BackgroundTasks,
    dependencies: DrupalSyncDependencies,
) -> None:
    update = dependencies.identity_metadata(
        context.table,
        state.uuid,
        state.nid,
        state.url,
    )
    prop, value, changed = dependencies.status_effect(
        context.table,
        dependencies.action_sync_drupal,
        "source",
    )
    if prop and value is not None:
        if changed:
            dependencies.persist_status_options(context.table_id, [value])
        key = dependencies.effect_write_key(context.metadata, prop)
        if key:
            update[key] = value
    if media_signature is not None:
        failed_fields = {str(row.get("field")) for row in state.skipped_fields if row.get("field")}
        update["drupal_media_sig"] = {
            key: value for key, value in media_signature.items() if key not in failed_fields
        }
    try:
        await dependencies.patch_page(
            context.item_id,
            PagePatchRequest(metadata=update),
            background_tasks,
        )
    except Exception as error:
        dependencies.logger.error(
            "sync-drupal: failed writing identity back to %s: %s",
            context.item_id,
            error,
        )


async def sync_drupal_row(
    item_id: str,
    *,
    background_tasks: BackgroundTasks,
    publish: bool,
    scope: str,
    push_media: bool,
    dependencies: DrupalSyncDependencies,
) -> Metadata:
    """Create or update one Drupal node and its requested translations."""
    context = await _load_context(item_id, dependencies)
    text_attributes = await _text_attributes(context, dependencies)
    state = NodeState(
        uuid=str(context.metadata.get("drupal_uuid") or "").strip() or None,
        nid=None,
        url=str(context.metadata.get("drupal_url") or "").strip() or None,
    )
    image = await _translation_image(context, state.skipped_fields, dependencies)
    await _upsert_source(
        context,
        text_attributes,
        image,
        publish,
        state,
        dependencies,
    )
    media_pushed, media_signature = await _push_media(
        context,
        state,
        push_media,
        dependencies,
    )
    translations = await _sync_related(
        context,
        state,
        image,
        scope,
        dependencies,
    )
    await _write_identity(
        context,
        state,
        media_signature,
        background_tasks,
        dependencies,
    )
    return {
        "item_id": item_id,
        "uuid": state.uuid,
        "nid": state.nid,
        "url": state.url,
        "created": state.created,
        "media_pushed": media_pushed,
        "source_lang": context.source_language,
        "scope": scope,
        "languages": sorted(set(state.languages)),
        "translations": translations,
        "skipped_fields": state.skipped_fields,
    }


__all__ = [
    "DrupalSyncDependencies",
    "row_text_fields",
    "sibling_rows",
    "sync_drupal_row",
]
