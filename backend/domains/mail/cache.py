"""Bounded process-local mail caches."""

from __future__ import annotations

from typing import Any, cast

from backend.utils.cache import SimpleCache

_MAIL_CACHE = SimpleCache(default_ttl=120, max_size=128)

_COUNTS_CACHE = SimpleCache(default_ttl=300, max_size=64)


def _cache_key(email: str, folder: str | None, category: str | None) -> str:
    return f"{email}|{folder or ''}|{category or ''}"


def _get_cached_messages(email: str, folder: str | None, category: str | None) -> list[Any] | None:
    return cast(list[Any] | None, _MAIL_CACHE.get(_cache_key(email, folder, category)))


def _set_cached_messages(
    email: str,
    folder: str | None,
    category: str | None,
    messages: list[Any],
) -> None:
    _MAIL_CACHE.set(_cache_key(email, folder, category), messages)


def _invalidate_mail_cache() -> None:
    _MAIL_CACHE.clear()
    _COUNTS_CACHE.clear()
