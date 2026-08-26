"""Tests for backend/utils/cache.py — thread-safety + LRU + TTL.

We focus on:
    - Basic get/set/clear semantics
    - TTL expiry
    - LRU eviction when max_size is exceeded
    - Thread-safety smoke test (concurrent set/get/clear under stress)
"""
from __future__ import annotations

import threading
import time

from backend.utils.cache import SimpleCache


def test_basic_set_get():
    c = SimpleCache(default_ttl=10, max_size=4)
    c.set("k", 42)
    assert c.get("k") == 42


def test_get_returns_none_for_missing_key():
    c = SimpleCache()
    assert c.get("missing") is None


def test_ttl_expiry_returns_none(monkeypatch):
    c = SimpleCache(default_ttl=10)
    now = [1000.0]
    monkeypatch.setattr("backend.utils.cache.time.time", lambda: now[0])
    c.set("k", "v")
    assert c.get("k") == "v"
    now[0] += 11  # past TTL
    assert c.get("k") is None


def test_pop_removes_entry():
    c = SimpleCache()
    c.set("a", 1)
    assert c.pop("a") == 1
    assert c.get("a") is None
    assert c.pop("a") is None  # second pop is None


def test_clear_empties_cache():
    c = SimpleCache()
    c.set("a", 1)
    c.set("b", 2)
    c.clear()
    assert c.get("a") is None
    assert len(c) == 0


def test_lru_eviction_when_max_size_exceeded():
    """Oldest entry is dropped first when the cache fills up."""
    c = SimpleCache(default_ttl=300, max_size=3)
    c.set("a", 1)
    c.set("b", 2)
    c.set("c", 3)
    # Touching "a" moves it to the back of the LRU queue.
    assert c.get("a") == 1
    # Adding a fourth should evict the now-oldest, which is "b".
    c.set("d", 4)
    assert c.get("a") == 1
    assert c.get("b") is None
    assert c.get("c") == 3
    assert c.get("d") == 4


def test_get_or_set_does_not_recompute_on_hit():
    c = SimpleCache()
    calls = []

    def factory():
        calls.append(1)
        return "computed"

    assert c.get_or_set("k", factory) == "computed"
    assert c.get_or_set("k", factory) == "computed"
    assert len(calls) == 1


def test_concurrent_access_smoke():
    """Many threads hammering the same cache must not blow up."""
    c = SimpleCache(default_ttl=60, max_size=128)
    errors = []

    def worker(i):
        try:
            for j in range(200):
                c.set(f"k{i}-{j % 10}", j)
                _ = c.get(f"k{i}-{j % 10}")
                if j % 25 == 0:
                    c.pop(f"k{i}-{j % 10}")
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert errors == [], f"thread errors: {errors}"
    # Cache size must remain within the bound
    assert len(c) <= 128
