"""Typed translation workflow for standalone Vault pages."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.registry.records import is_object_list
from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest
from backend.domains.vault.translation.adapters import DetectLanguage
from backend.domains.vault.translation.types import (
    CreatePage,
    Metadata,
    PatchPage,
    Result,
    TranslateMarkdown,
    TranslateTitle,
)


PageTranslatorBundle = tuple[TranslateMarkdown, TranslateTitle, DetectLanguage]


@dataclass(frozen=True)
class PageTranslationDependencies:
    load_translators: Callable[[], PageTranslatorBundle]
    read_deepl_key: Callable[[], str]
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    detect_record_source_lang: Callable[[Metadata], str]
    existing_translations: Callable[[str], Awaitable[dict[str, object]]]
    create_page: CreatePage
    patch_page: PatchPage
    logger: logging.Logger


def _validated_payload(payload: dict[str, object]) -> tuple[str, list[object]]:
    page_id = str(payload.get("page_id") or "").strip()
    target_languages = payload.get("target_languages") or []
    button_action = payload.get("button_action") or "translate_page"
    if not page_id:
        raise HTTPException(status_code=400, detail="page_id is required")
    if not is_object_list(target_languages) or not target_languages:
        raise HTTPException(
            status_code=400,
            detail="target_languages must be a non-empty list",
        )
    if button_action != "translate_page":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported button_action: {button_action}",
        )
    return page_id, target_languages


def _translate_content(
    title: str,
    body: str,
    source_language: str,
    target_language: str,
    deepl_api_key: str,
    translate_markdown: TranslateMarkdown,
    translate_title: TranslateTitle,
) -> tuple[str, str, set[str]]:
    providers: set[str] = set()
    translated_title, title_provider = translate_title(
        title,
        source_language,
        target_language,
        deepl_api_key=deepl_api_key,
    )
    if title_provider != "noop":
        providers.add(title_provider)
    translated_body, body_providers = translate_markdown(
        body,
        source_language,
        target_language,
        deepl_api_key=deepl_api_key,
    )
    providers |= {provider for provider in body_providers if provider != "noop"}
    return translated_title, translated_body, providers


def _translation_metadata(
    page_id: str,
    source_language: str,
    target_language: str,
    providers: set[str],
) -> Metadata:
    return {
        "translation_lang": target_language,
        "translation_source_lang": source_language,
        "translation_origin_id": page_id,
        "translation_stale": False,
        "translation_provider": ("mixed" if len(providers) > 1 else next(iter(providers), "noop")),
    }


async def _persist_page_translation(
    *,
    page_id: str,
    target_language: str,
    title: str,
    body: str,
    providers: set[str],
    metadata: Metadata,
    existing: object,
    background_tasks: BackgroundTasks,
    dependencies: PageTranslationDependencies,
) -> tuple[str, Result]:
    existing_id: object = getattr(existing, "id", None) if existing is not None else None
    if existing_id:
        patch_request = PagePatchRequest.model_validate({
            "title": title,
            "content": body,
            "metadata": metadata,
        })
        await dependencies.patch_page(
            str(existing_id),
            patch_request,
            background_tasks,
        )
        return "updated", {
            "id": existing_id,
            "lang": target_language,
            "providers": sorted(providers),
            "title": title,
        }
    create_request = PageSaveRequest.model_validate({
        "title": title,
        "content": body,
        "parent_id": page_id,
        "metadata": metadata,
    })
    created = await dependencies.create_page(create_request, background_tasks)
    return "created", {
        "id": created.get("id"),
        "lang": target_language,
        "providers": sorted(providers),
        "title": title,
    }


async def translate_page(
    background_tasks: BackgroundTasks,
    payload: dict[str, object],
    dependencies: PageTranslationDependencies,
) -> Result:
    """Translate one Vault page into idempotent per-language children."""
    page_id, target_languages = _validated_payload(payload)
    translate_markdown, translate_title, detect_language = dependencies.load_translators()
    deepl_api_key = dependencies.read_deepl_key()
    file_path = await asyncio.to_thread(dependencies.find_page, page_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {page_id})")
    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = dependencies.parse_frontmatter(raw_content, file_path)
    parent_title = str(metadata.get("title") or "")
    source_language = dependencies.detect_record_source_lang(metadata)
    if not source_language:
        sample = body.strip() if body and body.strip() else parent_title
        source_language = detect_language(sample) if sample else "en"
    existing = await dependencies.existing_translations(page_id)
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
        try:
            translated_title, translated_body, providers = await asyncio.to_thread(
                _translate_content,
                parent_title,
                body,
                source_language,
                language,
                deepl_api_key,
                translate_markdown,
                translate_title,
            )
        except Exception as error:
            dependencies.logger.error(
                "translate_page: failed translating page %s → %s: %s",
                page_id,
                language,
                error,
            )
            skipped.append({"lang": language, "reason": f"translate failed: {error}"})
            continue
        title = translated_title or (f"{parent_title} ({language})" if parent_title else language)
        try:
            disposition, record = await _persist_page_translation(
                page_id=page_id,
                target_language=language,
                title=title,
                body=translated_body,
                providers=providers,
                metadata=_translation_metadata(
                    page_id,
                    source_language,
                    language,
                    providers,
                ),
                existing=existing.get(language),
                background_tasks=background_tasks,
                dependencies=dependencies,
            )
            (updated if disposition == "updated" else created).append(record)
        except Exception as error:
            operation = "update" if existing.get(language) is not None else "create"
            dependencies.logger.error(
                "translate_page: failed %s child page for %s: %s",
                f"{operation}ing",
                language,
                error,
            )
            skipped.append({"lang": language, "reason": f"{operation} failed: {error}"})
    return {
        "status": "ok",
        "page_id": page_id,
        "source_lang": source_language,
        "created": created,
        "updated": updated,
        "skipped": skipped,
    }


__all__ = ["PageTranslationDependencies", "translate_page"]
