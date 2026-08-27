"""Build Drupal attributes and relationships from Vault table mappings."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from backend.domains.vault.drupal.core import DRUPAL_BODY_REF, Metadata


@dataclass(frozen=True)
class DrupalFieldDependencies:
    sync_error: type[Exception]
    markdown_to_html: Callable[[str, dict[str, str | None]], str]
    read_prop_value: Callable[[Metadata, Metadata | None], Any]
    upload_field_image: Callable[
        [Any, str, str, Metadata, dict[str, str]],
        Awaitable[Metadata | None],
    ]
    resolve_or_create_term: Callable[
        [str, str, dict[str, str]],
        Awaitable[str],
    ]
    coerce_scalar: Callable[[object, str | None], object | None]


@dataclass
class FieldBuildState:
    attributes: Metadata
    relationships: Metadata
    skipped: list[Metadata]
    wikilink_cache: dict[str, str | None]


async def _taxonomy_relationship(
    value: object,
    drupal_field: str,
    vocabulary: str,
    term_cache: dict[str, str],
    dependencies: DrupalFieldDependencies,
) -> tuple[Metadata | None, list[Metadata]]:
    names = value if isinstance(value, list) else re.split(r"[;,]", str(value))
    data: list[Metadata] = []
    skipped: list[Metadata] = []
    for raw_name in names:
        name = str(raw_name).strip()
        if not name:
            continue
        try:
            term_id = await dependencies.resolve_or_create_term(
                vocabulary,
                name,
                term_cache,
            )
            data.append(
                {
                    "type": f"taxonomy_term--{vocabulary}",
                    "id": term_id,
                }
            )
        except dependencies.sync_error as error:
            skipped.append(
                {
                    "field": drupal_field,
                    "value": name,
                    "reason": str(error),
                }
            )
    return ({"data": data} if data else None), skipped


async def _build_body_field(
    drupal_field: str,
    body: str,
    media_only: bool,
    state: FieldBuildState,
    dependencies: DrupalFieldDependencies,
) -> None:
    if media_only or not body.strip():
        return
    html = await asyncio.to_thread(
        dependencies.markdown_to_html,
        body,
        state.wikilink_cache,
    )
    state.attributes[drupal_field] = {"value": html, "format": "full_html"}


async def _build_mapped_value(
    *,
    value: object,
    drupal_field: str,
    field_config: Metadata,
    field_type: str | None,
    metadata: Metadata,
    bundle: str,
    term_cache: dict[str, str],
    image_cache: dict[str, str],
    text_only: bool,
    media_only: bool,
    state: FieldBuildState,
    dependencies: DrupalFieldDependencies,
) -> None:
    if field_type in ("text_with_summary", "text_long"):
        if media_only:
            return
        html = await asyncio.to_thread(
            dependencies.markdown_to_html,
            str(value),
            state.wikilink_cache,
        )
        state.attributes[drupal_field] = {"value": html, "format": "full_html"}
        return
    if field_type == "entity_reference":
        if text_only:
            return
        relationship, term_skips = await _taxonomy_relationship(
            value,
            drupal_field,
            str(field_config.get("vocab") or "tags"),
            term_cache,
            dependencies,
        )
        state.skipped.extend(term_skips)
        if relationship:
            state.relationships[drupal_field] = relationship
        return
    if field_type in ("image", "file"):
        if text_only:
            return
        try:
            relationship = await dependencies.upload_field_image(
                value,
                bundle,
                drupal_field,
                metadata,
                image_cache,
            )
            if relationship:
                state.relationships[drupal_field] = relationship
        except Exception as error:
            state.skipped.append({"field": drupal_field, "reason": f"image: {error}"})
        return
    if not media_only:
        coerced = dependencies.coerce_scalar(value, field_type)
        if coerced is not None:
            state.attributes[drupal_field] = coerced


async def build_fields(
    *,
    mapping: Metadata,
    properties_by_ref: dict[str, Metadata],
    field_metadata: dict[str, Metadata],
    metadata: Metadata,
    body: str,
    bundle: str,
    term_cache: dict[str, str],
    image_cache: dict[str, str],
    dependencies: DrupalFieldDependencies,
    text_only: bool = False,
    media_only: bool = False,
) -> tuple[Metadata, Metadata, list[Metadata]]:
    """Build Drupal attributes, relationships and skipped-field diagnostics."""
    state = FieldBuildState(
        attributes={},
        relationships={},
        skipped=[],
        wikilink_cache={},
    )
    for raw_ref, raw_drupal_field in mapping.items():
        ref = str(raw_ref)
        drupal_field = str(raw_drupal_field or "")
        if not drupal_field:
            continue
        field_config = field_metadata.get(drupal_field) or {}
        field_type = str(field_config.get("type") or "") or None
        if ref == DRUPAL_BODY_REF:
            await _build_body_field(
                drupal_field,
                body,
                media_only,
                state,
                dependencies,
            )
            continue
        prop = properties_by_ref.get(ref)
        if not prop:
            continue
        value = dependencies.read_prop_value(metadata, prop)
        if value in (None, "", [], {}):
            continue
        await _build_mapped_value(
            value=value,
            drupal_field=drupal_field,
            field_config=field_config,
            field_type=field_type,
            metadata=metadata,
            bundle=bundle,
            term_cache=term_cache,
            image_cache=image_cache,
            text_only=text_only,
            media_only=media_only,
            state=state,
            dependencies=dependencies,
        )
    return state.attributes, state.relationships, state.skipped


__all__ = ["DrupalFieldDependencies", "build_fields"]
