"""Startup policy for the provider-neutral filename index."""

from __future__ import annotations

from backend.services import vault_file_index


def test_cached_index_defers_first_cloud_walk(monkeypatch) -> None:
    monkeypatch.setattr(vault_file_index, "_REFRESH_SECONDS", 600)

    assert vault_file_index._initial_rebuild_delay(cache_loaded=True) == 600


def test_missing_index_rebuilds_immediately(monkeypatch) -> None:
    monkeypatch.setattr(vault_file_index, "_REFRESH_SECONDS", 600)

    assert vault_file_index._initial_rebuild_delay(cache_loaded=False) == 0
