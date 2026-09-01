"""Typed, idempotent translation workflow for table rows."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest
from backend.domains.vault.translation.adapters import DetectLanguage
from backend.domains.vault.translation.types import (
    CreatePage,
    Metadata,
    PatchPage,
    Result,
    TranslateMarkdown,
    TranslateText,
)
from backend.utils.open_values import iterable_values, list_values


@dataclass(frozen=True)
class RowTranslationDependencies:
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    table_id: Callable[[Metadata], str | None]
    table_by_id: Callable[[str | None], Metadata | None]
    check_requires: Callable[[Metadata, str, Metadata], tuple[bool, str | None]]
    action_translate: str
    detect_record_source_lang: Callable[[Metadata], str]
    is_composite_image_value: Callable[[object], bool]
    is_image_field_name: Callable[[object], bool]
    translate_image_field: Callable[
        [object, Callable[[str], tuple[str, str]]],
        tuple[object, set[str], bool],
    ]
    language_field_assignment: Callable[
        [Iterable[object], str, Metadata],
        tuple[str | None, str | list[str] | None],
    ]
    status_effect: Callable[
        [Metadata, str, str],
        tuple[Metadata | None, str | None, bool],
    ]
    effect_write_key: Callable[[Metadata, Metadata], str | None]
    persist_status_options: Callable[[str, list[object]], None]
    write_metadata_key: Callable[[str, Path, str, object], bool]
    existing_translations: Callable[[str], Awaitable[dict[str, object]]]
    recover_translations: Callable[
        [str, Path, Iterable[object]],
        Awaitable[dict[str, object]],
    ]
    materialize: Callable[[Path, str], Awaitable[object]]
    known_translations: Callable[[str], dict[str, str]]
    record_translation: Callable[[str, str, str], None]
    forget_translation: Callable[[str, str], None]
    create_page: CreatePage
    patch_page: PatchPage
    load_markdown_translator: Callable[[], TranslateMarkdown | None]
    logger: logging.Logger


@dataclass
class FieldTranslation:
    metadata: Metadata
    providers: set[str]
    translated_title: str = ""
    first_text_translation: str = ""
    any_translated: bool = False


def _read_property(metadata: Metadata, prop: Metadata) -> object:
    is_title = prop.get("type") == "title" or prop.get("name") == "title"
    candidate_keys: list[str] = []
    if is_title:
        candidate_keys.append("title")
    prop_id = prop.get("id")
    prop_name = prop.get("name") or ""
    if prop_id:
        candidate_keys.append(str(prop_id))
    if prop_name:
        candidate_keys.append(str(prop_name))
    if is_title:
        candidate_keys.append("title")
    fallback: object = None
    for key in candidate_keys:
        if key not in metadata:
            continue
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if value not in (None, "", [], {}):
            return value
        if fallback is None:
            fallback = value
    return fallback


def _source_language(
    metadata: Metadata,
    properties: list[Metadata],
    detect_language: DetectLanguage,
    dependencies: RowTranslationDependencies,
) -> tuple[str, bool]:
    source_language = dependencies.detect_record_source_lang(metadata)
    if source_language:
        return source_language, True
    sample = ""
    for prop in properties:
        value = _read_property(metadata, prop)
        if isinstance(value, str) and len(value.strip()) > len(sample):
            sample = value.strip()
    if not sample:
        sample = str(metadata.get("title") or "")
    return (detect_language(sample) if sample else "en"), False


def _translate_one_factory(
    source_language: str,
    source_is_explicit: bool,
    target_language: str,
    translate_text: TranslateText,
    detect_language: DetectLanguage,
    deepl_api_key: str,
    logger: logging.Logger,
) -> Callable[[str], tuple[str, str]]:
    def _translate_one(text: str) -> tuple[str, str]:
        field_language = ""
        if not source_is_explicit:
            try:
                field_language = detect_language(text)
            except Exception:
                field_language = ""
        if field_language == target_language:
            return text, "noop"
        try:
            return translate_text(
                text,
                source_language,
                target_language,
                deepl_api_key=deepl_api_key,
            )
        except Exception as error:
            logger.warning(
                "translate_row: failed translating field → %s: %s",
                target_language,
                error,
            )
            return f"[error: {error}]", "error"

    return _translate_one


def _translate_fields(
    metadata: Metadata,
    properties: list[Metadata],
    target_language: str,
    translate_one: Callable[[str], tuple[str, str]],
    dependencies: RowTranslationDependencies,
) -> FieldTranslation:
    result = FieldTranslation(metadata={}, providers=set())
    for prop in properties:
        value = _read_property(metadata, prop)
        key = prop.get("id") or prop.get("name")
        is_image = dependencies.is_composite_image_value(value) or (
            (prop.get("type") == "image" or dependencies.is_image_field_name(prop.get("name")))
            and isinstance(value, (dict, str))
            and bool(value)
        )
        if is_image:
            translated, providers, changed = dependencies.translate_image_field(
                value,
                translate_one,
            )
            if key:
                result.metadata[str(key)] = translated
            result.providers |= providers
            result.any_translated = result.any_translated or changed
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        translated, provider = translate_one(value)
        if provider != "noop":
            result.providers.add(provider)
        if key:
            result.metadata[str(key)] = translated
        result.any_translated = True
        if (
            prop.get("name") == "title" or prop.get("type") == "title"
        ) and not result.translated_title:
            result.translated_title = translated
        elif not result.first_text_translation and prop.get("type") in (
            "text",
            "rich_text",
        ):
            result.first_text_translation = translated
    return result


async def _translate_body(
    body: str,
    source_language: str,
    target_language: str,
    deepl_api_key: str,
    translator: TranslateMarkdown | None,
    logger: logging.Logger,
) -> tuple[str, set[str]]:
    if translator is None:
        return "", set()
    try:
        translated, providers = await asyncio.to_thread(
            translator,
            body,
            source_language,
            target_language,
            deepl_api_key=deepl_api_key,
        )
        return translated, {provider for provider in providers if provider != "noop"}
    except Exception as error:
        logger.warning(
            "translate_row: failed translating body → %s: %s",
            target_language,
            error,
        )
        return body, set()


def _apply_language_and_status(
    result: FieldTranslation,
    properties: list[object],
    target_language: str,
    parent_metadata: Metadata,
    table: Metadata,
    table_id: str,
    dependencies: RowTranslationDependencies,
) -> None:
    language_key, language_value = dependencies.language_field_assignment(
        properties,
        target_language,
        parent_metadata,
    )
    if language_key and language_value is not None:
        result.metadata[language_key] = language_value
    prop, value, changed = dependencies.status_effect(
        table,
        dependencies.action_translate,
        "created",
    )
    if prop and value is not None:
        key = prop.get("id") or prop.get("name")
        if key:
            result.metadata[str(key)] = value
        if changed:
            dependencies.persist_status_options(table_id, [value])


def _translated_title(
    parent_title: str,
    target_language: str,
    fields: FieldTranslation,
    title_is_translatable: bool,
) -> str:
    if title_is_translatable and fields.translated_title:
        return fields.translated_title
    if fields.first_text_translation:
        return fields.first_text_translation[:120]
    return f"{parent_title} ({target_language})" if parent_title else target_language


async def _merge_known_translations(
    item_id: str,
    target_languages: list[object],
    table_directory: Path,
    dependencies: RowTranslationDependencies,
) -> dict[str, object]:
    existing = await dependencies.existing_translations(item_id)
    requested = {
        language.strip().lower()
        for language in target_languages
        if isinstance(language, str) and language.strip()
    }
    if not requested.issubset(existing):
        recovered = await dependencies.recover_translations(
            item_id,
            table_directory,
            set(existing),
        )
        for language, page in recovered.items():
            existing.setdefault(language, page)
    known = await asyncio.to_thread(dependencies.known_translations, item_id)
    for language, child_id in known.items():
        if language in existing:
            continue
        child_path = await asyncio.to_thread(dependencies.find_page, child_id)
        if child_path and child_path.exists():
            existing[language] = SimpleNamespace(id=child_id, metadata={})
        else:
            await asyncio.to_thread(
                dependencies.forget_translation,
                item_id,
                language,
            )
    return existing


async def _persist_translation(
    *,
    item_id: str,
    target_language: str,
    title: str,
    body: str,
    metadata: Metadata,
    providers: set[str],
    existing: object,
    background_tasks: BackgroundTasks,
    dependencies: RowTranslationDependencies,
) -> tuple[str, Result]:
    existing_id: object = getattr(existing, "id", None) if existing is not None else None
    if existing_id:
        existing_path = await asyncio.to_thread(dependencies.find_page, str(existing_id))
        if existing_path:
            await dependencies.materialize(
                existing_path,
                f"translate-patch/{existing_id}",
            )
        patch_request = PagePatchRequest.model_validate({
            "title": title,
            "metadata": metadata,
            "content": body if body and body.strip() else None,
        })
        await dependencies.patch_page(
            str(existing_id),
            patch_request,
            background_tasks,
        )
        await asyncio.to_thread(
            dependencies.record_translation,
            item_id,
            target_language,
            str(existing_id),
        )
        return "updated", {
            "id": existing_id,
            "lang": target_language,
            "providers": sorted(providers),
            "title": title,
        }
    create_request = PageSaveRequest.model_validate({
        "title": title,
        "content": body or "",
        "parent_id": item_id,
        "metadata": metadata,
    })
    created = await dependencies.create_page(create_request, background_tasks)
    new_id = created.get("id")
    if new_id:
        await asyncio.to_thread(
            dependencies.record_translation,
            item_id,
            target_language,
            str(new_id),
        )
    return "created", {
        "id": new_id,
        "lang": target_language,
        "providers": sorted(providers),
        "title": title,
    }


async def _apply_source_status(
    item_id: str,
    file_path: Path,
    metadata: Metadata,
    table: Metadata,
    table_id: str,
    dependencies: RowTranslationDependencies,
) -> None:
    prop, value, changed = dependencies.status_effect(
        table,
        dependencies.action_translate,
        "source",
    )
    if not prop or value is None:
        return
    if changed:
        dependencies.persist_status_options(table_id, [value])
    key = dependencies.effect_write_key(metadata, prop)
    if key:
        await asyncio.to_thread(
            dependencies.write_metadata_key,
            item_id,
            file_path,
            key,
            value,
        )


def _load_body_translator(
    body: str,
    dependencies: RowTranslationDependencies,
) -> TranslateMarkdown | None:
    if not body or not body.strip():
        return None
    try:
        return dependencies.load_markdown_translator()
    except Exception as error:
        dependencies.logger.warning(
            "translate_row: markdown segmenter unavailable, body left empty: %s",
            error,
        )
        return None


async def translate_row(
    item_id: str,
    target_languages: list[object],
    *,
    translate_fn: TranslateText,
    detect_fn: DetectLanguage,
    deepl_api_key: str,
    background_tasks: BackgroundTasks,
    dependencies: RowTranslationDependencies,
) -> Result:
    """Translate one row into idempotent per-language child records."""
    file_path = await asyncio.to_thread(dependencies.find_page, item_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {item_id})")
    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = dependencies.parse_frontmatter(raw_content, file_path)
    table_id = dependencies.table_id(metadata)
    table = dependencies.table_by_id(table_id) if table_id else None
    if not table:
        raise HTTPException(status_code=400, detail="Row is not part of a table")
    if not table.get("translation_enabled"):
        raise HTTPException(
            status_code=400,
            detail=(
                "This table is not configured for translation. Enable it in the schema config."
            ),
        )
    properties = [
        prop
        for prop in iterable_values(table.get("properties") or [])
        if is_record(prop) and prop.get("translatable") is True
    ]
    if not properties:
        raise HTTPException(
            status_code=400,
            detail="No translatable fields configured on this table.",
        )
    allowed, reason = dependencies.check_requires(
        table,
        dependencies.action_translate,
        metadata,
    )
    if not allowed:
        raise HTTPException(status_code=409, detail=reason)
    source_language, source_is_explicit = _source_language(
        metadata,
        properties,
        detect_fn,
        dependencies,
    )
    parent_title = str(metadata.get("title") or "")
    title_is_translatable = any(
        (prop.get("name") == "title" or prop.get("type") == "title")
        and prop.get("translatable") is True
        for prop in properties
    )
    body_translator = _load_body_translator(body, dependencies)
    existing = await _merge_known_translations(
        item_id,
        target_languages,
        file_path.parent,
        dependencies,
    )
    created: list[Result] = []
    updated: list[Result] = []
    skipped: list[Result] = []
    for raw_language in target_languages:
        if not isinstance(raw_language, str) or not raw_language.strip():
            continue
        language = raw_language.strip().lower()
        if language == source_language:
            skipped.append({"lang": language, "reason": "same as source"})
            continue
        translate_one = _translate_one_factory(
            source_language,
            source_is_explicit,
            language,
            translate_fn,
            detect_fn,
            deepl_api_key,
            dependencies.logger,
        )
        fields = _translate_fields(
            metadata,
            properties,
            language,
            translate_one,
            dependencies,
        )
        translated_metadata = fields.metadata
        fields.metadata = {
            "table_id": table_id,
            "database_table_id": table_id,
            "translation_lang": language,
            "translation_source_lang": source_language,
            "translation_origin_id": item_id,
            "translation_stale": False,
        }
        fields.metadata.update(translated_metadata)
        _apply_language_and_status(
            fields,
            list_values(table.get("properties") or []),
            language,
            metadata,
            table,
            str(table_id),
            dependencies,
        )
        translated_body, body_providers = await _translate_body(
            body,
            source_language,
            language,
            deepl_api_key,
            body_translator,
            dependencies.logger,
        )
        fields.providers |= body_providers
        if not fields.any_translated and not translated_body.strip():
            skipped.append({"lang": language, "reason": "no translatable content"})
            continue
        title = _translated_title(
            parent_title,
            language,
            fields,
            title_is_translatable,
        )
        fields.metadata["translation_provider"] = (
            "mixed" if len(fields.providers) > 1 else next(iter(fields.providers), "placeholder")
        )
        try:
            disposition, record = await _persist_translation(
                item_id=item_id,
                target_language=language,
                title=title,
                body=translated_body,
                metadata=fields.metadata,
                providers=fields.providers,
                existing=existing.get(language),
                background_tasks=background_tasks,
                dependencies=dependencies,
            )
            (updated if disposition == "updated" else created).append(record)
        except Exception as error:
            operation = "updating" if existing.get(language) is not None else "creating"
            dependencies.logger.error(
                "translate_row: failed %s subitem for %s: %s",
                operation,
                language,
                error,
            )
            label = "update" if operation == "updating" else "create"
            skipped.append({"lang": language, "reason": f"{label} failed: {error}"})
    if created or updated:
        await _apply_source_status(
            item_id,
            file_path,
            metadata,
            table,
            str(table_id),
            dependencies,
        )
    return {
        "item_id": item_id,
        "source_lang": source_language,
        "created": created,
        "updated": updated,
        "skipped": skipped,
    }


__all__ = ["RowTranslationDependencies", "translate_row"]
