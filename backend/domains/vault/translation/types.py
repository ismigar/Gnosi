"""Shared strict contracts for Vault translation services."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol

from fastapi import BackgroundTasks

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import RecordReader
from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest


Metadata = PageMetadata
Result = dict[str, object]


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
    """Page providers accept content and language arguments positionally."""

    def __call__(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        /,
        *,
        deepl_api_key: str,
    ) -> tuple[str, set[str]]: ...


class TranslateTitle(Protocol):
    """Keep the shared positional contract independent of provider names."""

    def __call__(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        /,
        *,
        deepl_api_key: str,
    ) -> tuple[str, str]: ...


# Consumers read named receipt fields, not mutable page metadata. This accepts
# the actual string-keyed route receipt and extension-owned open dictionaries.
CreatePage = Callable[[PageSaveRequest, BackgroundTasks], Awaitable[RecordReader]]
PatchPage = Callable[[str, PagePatchRequest, BackgroundTasks], Awaitable[RecordReader]]


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
