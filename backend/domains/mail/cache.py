"""Bounded process-local mail caches."""

from __future__ import annotations

from threading import Lock
from typing import Any, cast
from weakref import WeakValueDictionary

from backend.utils.cache import SimpleCache

_MAIL_CACHE = SimpleCache(default_ttl=120, max_size=128)


class _CountsReadGeneration:
    """Identity held only while a count read is in progress."""


class _MailCountsCache(SimpleCache):
    def __init__(self) -> None:
        super().__init__(default_ttl=300, max_size=64)
        self._generation_lock = Lock()
        self._generations: WeakValueDictionary[str, _CountsReadGeneration] = WeakValueDictionary()

    def read_generation(self, email: str) -> _CountsReadGeneration:
        with self._generation_lock:
            generation = self._generations.get(email)
            if generation is None:
                generation = _CountsReadGeneration()
                self._generations[email] = generation
            return generation

    def set_if_current(self, email: str, generation: _CountsReadGeneration, value: Any) -> bool:
        # Invalidation and publication must be atomic even when a mail action
        # clears the cache from a worker thread.
        with self._generation_lock:
            if self._generations.get(email) is not generation:
                return False
            super().set(email, value)
            return True

    def pop(self, key: str) -> Any:
        with self._generation_lock:
            self._generations.pop(key, None)
            return super().pop(key)

    def clear(self) -> None:
        with self._generation_lock:
            self._generations.clear()
            super().clear()


_COUNTS_CACHE = _MailCountsCache()

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
