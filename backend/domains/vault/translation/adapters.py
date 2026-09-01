"""Lazy optional-provider adapters for Vault translation workflows."""

from __future__ import annotations

import logging
from collections.abc import Callable

from fastapi import HTTPException

from backend.domains.vault.translation.types import (
    TranslateMarkdown,
    TranslateText,
    TranslateTitle,
)


DetectLanguage = Callable[[str], str]


def read_deepl_key(logger: logging.Logger) -> str:
    """Read the DeepL key from the system secret store when available."""
    try:
        import backend.security.keychain_manager as keychain_module

        keychain = keychain_module.get_keychain()
        if keychain.has_credential("deepl_api_key"):
            return keychain.get_credential("deepl_api_key") or ""
    except Exception as error:
        logger.warning(
            "translate: keychain unavailable, using env fallback: %s",
            error,
        )
    return ""


def load_translate_row_skill(
    logger: logging.Logger,
) -> tuple[TranslateText, DetectLanguage]:
    """Load the optional row translator without affecting application startup."""
    try:
        import pipeline.skills.translate_row.scripts.translate_text as skill

        return skill.translate, skill.detect_source_lang
    except Exception as error:
        logger.error("translate_row skill not importable: %s", error)
        raise HTTPException(
            status_code=500,
            detail="translate_row skill unavailable",
        ) from error


def load_translate_page_skill(
    logger: logging.Logger,
) -> tuple[TranslateMarkdown, TranslateTitle, DetectLanguage]:
    """Load the optional page segmenter at request time."""
    try:
        import pipeline.skills.translate_page.scripts.markdown_segmenter as skill

        return (
            skill.translate_markdown,
            skill.translate_title,
            skill.detect_source_lang,
        )
    except Exception as error:
        logger.error("translate_page skill not importable: %s", error)
        raise HTTPException(
            status_code=500,
            detail="translate_page skill unavailable",
        ) from error


__all__ = [
    "DetectLanguage",
    "load_translate_page_skill",
    "load_translate_row_skill",
    "read_deepl_key",
]
