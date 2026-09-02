"""Bounded process-local mail caches."""

from __future__ import annotations

from typing import Any, cast

from backend.utils.cache import SimpleCache

_MAIL_CACHE = SimpleCache(default_ttl=120, max_size=128)

_COUNTS_CACHE = SimpleCache(default_ttl=300, max_size=64)

_INLINE_PARTS_CACHE = SimpleCache(default_ttl=120, max_size=16)
_MAX_INLINE_PARTS_BYTES = 5 * 1024 * 1024


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
    _INLINE_PARTS_CACHE.clear()


def _inline_parts_key(email: str, message_id: str, folder: str) -> str:
    return f"{email.casefold()}|{folder.casefold()}|{message_id}"


def _get_cached_inline_parts(
    email: str,
    message_id: str,
    folder: str,
) -> dict[str, Any] | None:
    return cast(
        dict[str, Any] | None,
        _INLINE_PARTS_CACHE.get(_inline_parts_key(email, message_id, folder)),
    )


def _set_cached_inline_parts(
    email: str,
    message_id: str,
    folder: str,
    parts: dict[str, Any],
) -> None:
    total_bytes = sum(
        len(data)
        for part in parts.values()
        if isinstance(part, dict)
        and isinstance((data := part.get("data")), bytes)
    )
    if total_bytes <= _MAX_INLINE_PARTS_BYTES:
        _INLINE_PARTS_CACHE.set(_inline_parts_key(email, message_id, folder), parts)
