"""Drupal language and translatable-field discovery with owned caches."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from types import TracebackType
from typing import Any, Protocol

from backend.domains.vault.drupal.core import Metadata


class JsonResponse(Protocol):
    def json(self) -> Any: ...


class DrupalHttpClient(Protocol):
    def get(
        self,
        path: str,
        *,
        params: dict[str, str] | None = None,
    ) -> Awaitable[JsonResponse]: ...


class DrupalClientContext(Protocol):
    async def __aenter__(self) -> DrupalHttpClient: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None: ...


@dataclass
class DrupalLanguageState:
    langcodes: set[str] | None = None
    field_translatable: dict[str, bool] = field(default_factory=dict)


@dataclass(frozen=True)
class DrupalLanguageDependencies:
    client: Callable[[], DrupalClientContext]
    detect_record_lang_raw: Callable[[Metadata], str]
    detect_record_source_lang: Callable[[Metadata], str]
    logger: logging.Logger


language_state = DrupalLanguageState()


def _document(value: Any) -> Metadata:
    return value if isinstance(value, dict) else {}


async def langcodes(
    dependencies: DrupalLanguageDependencies,
    state: DrupalLanguageState = language_state,
) -> set[str]:
    """Return configured Drupal language codes from a process cache."""
    if state.langcodes is not None:
        return state.langcodes
    languages: set[str] = set()
    try:
        async with dependencies.client() as client:
            response = await client.get(
                "/jsonapi/configurable_language/configurable_language",
                params={
                    "fields[configurable_language--configurable_language]": ("drupal_internal__id")
                },
            )
        document = _document(response.json())
        rows = document.get("data")
        for raw_row in rows if isinstance(rows, list) else []:
            row = _document(raw_row)
            attributes = _document(row.get("attributes"))
            code = attributes.get("drupal_internal__id")
            if code and str(code).lower() not in ("und", "zxx"):
                languages.add(str(code).lower())
    except Exception as error:
        dependencies.logger.warning(
            "drupal: could not read the configured languages: %s",
            error,
        )
    state.langcodes = languages
    return languages


async def resolve_langcode(
    metadata: Metadata,
    dependencies: DrupalLanguageDependencies,
    state: DrupalLanguageState = language_state,
    *,
    configured_langcodes: set[str] | None = None,
) -> str:
    """Map one row's language field to an actual Drupal langcode."""
    languages = (
        configured_langcodes
        if configured_langcodes is not None
        else await langcodes(dependencies, state)
    )
    raw = dependencies.detect_record_lang_raw(metadata)
    if raw and languages:
        if raw in languages:
            return raw
        prefix = raw.split("-")[0].split("_")[0]
        if prefix in languages:
            return prefix
    code = dependencies.detect_record_source_lang(metadata)
    if code and (not languages or code in languages):
        return code
    return code or "en"


async def uuid_to_fid(
    file_uuid: object,
    dependencies: DrupalLanguageDependencies,
) -> object | None:
    """Resolve a Drupal file UUID to the numeric target ID used by translations."""
    if not file_uuid:
        return None
    try:
        async with dependencies.client() as client:
            response = await client.get(
                f"/jsonapi/file/file/{file_uuid}",
                params={"fields[file--file]": "drupal_internal__fid"},
            )
        document = _document(response.json())
        data = _document(document.get("data"))
        attributes = _document(data.get("attributes"))
        return attributes.get("drupal_internal__fid")
    except Exception as error:
        dependencies.logger.warning("drupal: uuid→fid ha fallat: %s", error)
        return None


async def field_translatable(
    bundle: str,
    field_name: str,
    dependencies: DrupalLanguageDependencies,
    state: DrupalLanguageState = language_state,
) -> bool:
    """Return whether one configured Drupal field is translatable."""
    cache_key = f"{bundle}.{field_name}"
    if cache_key in state.field_translatable:
        return state.field_translatable[cache_key]
    value = False
    try:
        async with dependencies.client() as client:
            response = await client.get(
                "/jsonapi/field_config/field_config",
                params={
                    "filter[field_name]": field_name,
                    "filter[bundle]": bundle,
                    "fields[field_config--field_config]": "translatable",
                },
            )
        document = _document(response.json())
        raw_data = document.get("data")
        data = raw_data if isinstance(raw_data, list) else []
        if data:
            attributes = _document(_document(data[0]).get("attributes"))
            value = bool(attributes.get("translatable"))
    except Exception as error:
        dependencies.logger.warning(
            "drupal: could not read 'translatable' for %s: %s",
            field_name,
            error,
        )
    state.field_translatable[cache_key] = value
    return value


def image_mapping(
    mapping: Metadata,
    field_metadata: dict[str, Metadata],
) -> tuple[str | None, str | None]:
    """Return the first mapped image/file property and Drupal field."""
    for raw_ref, raw_field in mapping.items():
        ref = str(raw_ref)
        drupal_field = str(raw_field or "")
        field_type = (field_metadata.get(drupal_field) or {}).get("type")
        if drupal_field and field_type in ("image", "file"):
            return ref, drupal_field
    return None, None


def row_image_alt(
    metadata: Metadata,
    properties_by_ref: dict[str, Metadata],
    image_ref: str | None,
    read_prop_value: Callable[[Metadata, Metadata | None], Any],
) -> str:
    """Resolve translation-specific image alt text with historical fallbacks."""
    if image_ref:
        prop = properties_by_ref.get(image_ref)
        value = read_prop_value(metadata, prop)
        if isinstance(value, dict) and value.get("alt"):
            return str(value["alt"])
    for key, value in metadata.items():
        if "alt" in str(key).lower() and isinstance(value, str) and value.strip():
            return value.strip()
    return str(metadata.get("title") or "")


__all__ = [
    "DrupalClientContext",
    "DrupalLanguageDependencies",
    "DrupalLanguageState",
    "field_translatable",
    "image_mapping",
    "langcodes",
    "language_state",
    "resolve_langcode",
    "row_image_alt",
    "uuid_to_fid",
]
