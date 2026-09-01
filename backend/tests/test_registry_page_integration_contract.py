"""Synthetic checks at the shared registry, page cache and HTTP boundaries."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from backend.api import vault_routes
from backend.domains.vault.pages import cache, metadata_mutations
from backend.domains.vault.pages.state import PageState
from backend.domains.vault.registry import runtime
from backend.domains.vault.registry.api import RegistryApiDependencies
from backend.domains.vault.registry.contracts import VaultRegistryUpdateRequest
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo
from backend.services.library_paths import library_roots, resolve_library


def test_open_metadata_patch_preserves_unknown_keys_and_nested_identity() -> None:
    key = object()
    nested = [object()]
    metadata: RegistryData = {17: nested, key: "keep", "remove": "old"}
    updates: RegistryData = {23: nested, "remove": None, "label": "new"}

    result = metadata_mutations.apply_metadata_patch(metadata, updates, [])

    assert result == {17: nested, key: "keep", 23: nested, "label": "new"}
    assert result is not metadata
    assert result[17] is nested
    assert result[23] is nested
    assert metadata == {17: nested, key: "keep", "remove": "old"}
    assert updates["remove"] is None


@pytest.mark.parametrize("value", [None, 0, [], "text"])
def test_metadata_mapping_keeps_existing_scalar_fallback(value: object) -> None:
    assert metadata_mutations._mapping(value) == {}


def test_metadata_mapping_does_not_copy_or_drop_nontext_keys() -> None:
    value: RegistryData = {9: object()}
    assert metadata_mutations._mapping(value) is value


def test_response_cache_preserves_list_and_open_metadata_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = PageState()
    monkeypatch.setattr(cache, "page_state", state)
    clock = [10.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    metadata: RegistryData = {31: object()}
    page = PageInfo.model_construct(id="fixture", metadata=metadata)
    pages = [page]

    cache.set_cached_page_response("fixture", pages)
    assert cache.get_cached_page_response("fixture") is pages
    assert pages[0].metadata is metadata
    assert state.response_cache["fixture"][1] is pages
    clock[0] += cache.PAGES_RESPONSE_CACHE_TTL
    assert cache.get_cached_page_response("fixture") is pages
    clock[0] += 0.001
    assert cache.get_cached_page_response("fixture") is None
    assert "fixture" not in state.response_cache


def test_registry_request_passes_model_dump_without_a_second_copy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload: RegistryData = {"databases": [], "tables": [], "views": [], 7: object()}
    received: list[RegistryData] = []
    result: RegistryData = {"status": "success"}

    def dump(_self: VaultRegistryUpdateRequest) -> RegistryData:
        return payload

    async def update(
        data: RegistryData, _dependencies: RegistryApiDependencies
    ) -> RegistryData:
        received.append(data)
        return result

    monkeypatch.setattr(VaultRegistryUpdateRequest, "model_dump", dump)
    monkeypatch.setattr(vault_routes.registry_api, "update_registry", update)
    request = VaultRegistryUpdateRequest(databases=[], tables=[], views=[])

    assert asyncio.run(runtime.update_registry(request)) is result
    assert received == [payload]
    assert received[0] is payload


def test_inactive_library_retains_native_division_error() -> None:
    with pytest.raises(TypeError) as native:
        eval("None / 'Library'", {"__builtins__": {}})
    with pytest.raises(TypeError) as resolved:
        resolve_library(None)
    with pytest.raises(TypeError) as roots:
        library_roots(None)
    assert resolved.value.args == native.value.args
    assert roots.value.args == native.value.args


def test_library_paths_are_relative_to_the_selected_vault(tmp_path: Path) -> None:
    assert resolve_library(tmp_path) == tmp_path / "Library"
    assert library_roots(tmp_path) == [tmp_path / "Library"]
    assert not (tmp_path / "Library").exists()
