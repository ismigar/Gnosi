"""Single-owner contracts for registry locks and caches."""

from backend.api import vault_routes
from backend.domains.vault.registry.state import registry_state


def test_legacy_registry_state_exports_are_identity_aliases() -> None:
    assert vault_routes._registry_cache is registry_state.cache
    assert vault_routes._registry_cache_mtime is registry_state.cache_mtime
    assert vault_routes._registry_cache_ts is registry_state.cache_timestamp
    assert vault_routes._registry_ensured_tables is registry_state.ensured_tables
    assert vault_routes._registry_seen_nondegenerate is registry_state.seen_nondegenerate
    assert vault_routes._registry_mutation_lock is registry_state.mutation_lock
    assert vault_routes.registry_repository.state is registry_state
