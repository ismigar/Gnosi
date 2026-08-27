"""State ownership contracts for the extracted vault page domain."""

from backend.api import vault_routes
from backend.domains.vault.pages.state import page_state


def test_legacy_page_state_exports_are_identity_aliases() -> None:
    assert vault_routes._page_index_lock is page_state.index_lock
    assert vault_routes._page_index_entries is page_state.index_entries
    assert vault_routes._page_index_initialized is page_state.index_initialized
    assert vault_routes._page_id_to_path is page_state.id_to_path
    assert vault_routes._page_index_version is page_state.index_version
    assert vault_routes._pages_resp_cache_lock is page_state.response_cache_lock
    assert vault_routes._pages_resp_cache is page_state.response_cache
    assert vault_routes._page_write_locks is page_state.write_locks
    assert vault_routes._indexer_status_lock is page_state.indexer_status_lock
    assert vault_routes._indexer_status_by_vault is page_state.indexer_status_by_vault
    assert vault_routes._preview_cache_lock is page_state.preview_cache_lock
    assert vault_routes._preview_cache is page_state.preview_cache
    assert vault_routes._preview_inflight is page_state.preview_inflight
    assert vault_routes._preview_inflight_lock is page_state.preview_inflight_lock
    assert vault_routes._last_stale_check is page_state.last_stale_check
    assert vault_routes._user_label_cache is page_state.user_label_cache


def test_legacy_scalar_state_is_resolved_from_the_owner() -> None:
    previous_sync = page_state.last_vault_sync_time
    previous_guard = page_state.write_locks_guard
    try:
        page_state.last_vault_sync_time = 42.0
        page_state.write_locks_guard = None

        assert vault_routes._last_vault_sync_time == 42.0
        assert vault_routes._page_write_locks_guard is None
    finally:
        page_state.last_vault_sync_time = previous_sync
        page_state.write_locks_guard = previous_guard
