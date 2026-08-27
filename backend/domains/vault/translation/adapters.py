"""Lazy optional-provider adapters for Vault translation workflows."""

from __future__ import annotations

import importlib
import logging
from collections.abc import Callable
from typing import Protocol, cast

from fastapi import HTTPException

from backend.domains.vault.translation.types import (
    TranslateMarkdown,
    TranslateText,
    TranslateTitle,
)


DetectLanguage = Callable[[str], str]


class _Keychain(Protocol):
    def has_credential(self, key: str) -> bool: ...

    def get_credential(self, key: str) -> str | None: ...


class _KeychainModule(Protocol):
    def get_keychain(self) -> _Keychain: ...


class _RowSkillModule(Protocol):
    translate: TranslateText
    detect_source_lang: DetectLanguage


class _PageSkillModule(Protocol):
    translate_markdown: TranslateMarkdown
    translate_title: TranslateTitle
    detect_source_lang: DetectLanguage


def read_deepl_key(logger: logging.Logger) -> str:
    """Read the DeepL key from the system secret store when available."""
    try:
        keychain_module = cast(
            _KeychainModule,
            importlib.import_module("backend.security.keychain_manager"),
        )
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
        skill = cast(
            _RowSkillModule,
            importlib.import_module("pipeline.skills.translate_row.scripts.translate_text"),
        )
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
        skill = cast(
            _PageSkillModule,
            importlib.import_module("pipeline.skills.translate_page.scripts.markdown_segmenter"),
        )
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
