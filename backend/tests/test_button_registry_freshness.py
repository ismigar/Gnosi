"""Mutation schemas are read from disk, without stale-cache fallback."""
import json
import time

from fastapi import HTTPException
import pytest

from backend.domains.vault.registry import runtime
from backend.domains.vault.registry.state import RegistryState


@pytest.fixture
def registry(tmp_path, monkeypatch):
    path = tmp_path / "registry.json"
    monkeypatch.setattr(runtime._legacy, "get_p", lambda key: path if key == "REGISTRY" else tmp_path)
    path.write_text(json.dumps({"tables": [{"id": "actual", "properties": [{"name": "Count", "read_only": False}]}]}))
    state = RegistryState()
    state.cache[str(path)] = {"tables": [{"id": "cached"}]}
    state.cache_timestamp[str(path)] = time.monotonic()
    state.cache_mtime[str(path)] = path.stat().st_mtime
    monkeypatch.setattr(runtime._legacy.registry_repository, "state", state)
    return path


def test_mutations_see_new_schema_without_waiting_for_cache_expiry(registry):
    assert runtime.load_registry()["tables"][0]["id"] == "cached"
    assert runtime.load_registry_for_write()["tables"][0]["id"] == "actual"
    assert runtime.load_registry()["tables"][0]["id"] == "actual"
    registry.write_text(json.dumps({"tables": [{"id": "actual", "properties": [{"name": "Count", "read_only": True}]}]}))
    assert runtime.load_registry_for_write()["tables"][0]["properties"][0]["read_only"] is True
    assert runtime.load_registry()["tables"][0]["properties"][0]["read_only"] is True


@pytest.mark.parametrize("value", ["invalid JSON", '[]', '{"tables":null}', '{"tables":[3]}',
                                 '{"tables":[{"id":null}]}', '{"tables":[{"id":"actual","properties":{}}]}'])
def test_invalid_schema_never_uses_a_valid_cached_schema(registry, value):
    registry.write_text(value)
    with pytest.raises(HTTPException) as error: runtime.load_registry_for_write()
    assert error.value.status_code == 422


def test_missing_schema_never_uses_cached_authorization(registry):
    registry.unlink()
    with pytest.raises(HTTPException) as error: runtime.load_registry_for_write()
    assert error.value.status_code == 503


def test_registry_symlink_cannot_read_another_vault(registry, tmp_path):
    external = tmp_path.parent / (tmp_path.name + "-outside.json")
    external.write_text('{"tables":[]}')
    try:
        registry.unlink(); registry.symlink_to(external)
        with pytest.raises(HTTPException) as error: runtime.load_registry_for_write()
        assert error.value.status_code == 403
    finally: external.unlink()
