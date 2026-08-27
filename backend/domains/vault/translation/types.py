"""Shared strict contracts for Vault translation services."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from fastapi import BackgroundTasks

from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest


Metadata = dict[str, Any]
Result = dict[str, Any]


class PageLike(Protocol):
    """Small page shape used by translation lookup and synchronization."""

    id: str
    metadata: Metadata


class TranslateText(Protocol):
    def __call__(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        *,
        deepl_api_key: str,
    ) -> tuple[str, str]: ...


class TranslateMarkdown(Protocol):
    def __call__(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        *,
        deepl_api_key: str,
    ) -> tuple[str, set[str]]: ...


class TranslateTitle(Protocol):
    def __call__(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        *,
        deepl_api_key: str,
    ) -> tuple[str, str]: ...


CreatePage = Callable[[PageSaveRequest, BackgroundTasks], Awaitable[Result]]
PatchPage = Callable[[str, PagePatchRequest, BackgroundTasks], Awaitable[Result]]


__all__ = [
    "CreatePage",
    "Metadata",
    "PageLike",
    "PatchPage",
    "Result",
    "TranslateMarkdown",
    "TranslateText",
    "TranslateTitle",
]
