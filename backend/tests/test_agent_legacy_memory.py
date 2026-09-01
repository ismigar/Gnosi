"""Compatibility and lazy-loading contracts for legacy Agent memory."""

from backend.agent import memory


def test_memory_store_degrades_without_embeddings(monkeypatch) -> None:
    monkeypatch.setattr(memory, "_get_embeddings", lambda: None)

    store = memory.MemoryStore()

    assert store.add_memory("remember this") == (
        "Error: Memory not initialized (No embeddings available)."
    )
    assert store.search_memory("remember") == []


def test_vault_store_degrades_without_embeddings(monkeypatch) -> None:
    monkeypatch.setattr(memory, "_get_embeddings", lambda: None)

    store = memory.VaultStore()

    assert store.add_content("indexed") is False
    assert store.search_vault("indexed") == []


def test_legacy_memory_attribute_is_built_lazily(monkeypatch) -> None:
    sentinel = object()
    monkeypatch.setattr(memory, "_memory_store", None)
    monkeypatch.setattr(memory, "MemoryStore", lambda: sentinel)

    resolved = memory.__getattr__("memory_store")

    assert resolved is sentinel
    assert memory._memory_store is sentinel
