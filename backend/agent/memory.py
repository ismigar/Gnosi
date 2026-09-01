"""Lazy compatibility stores for legacy Chroma-backed Agent memory."""

import os
import threading
from pathlib import Path
from typing import Any, cast

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from pydantic import SecretStr

from backend.config.app_config import load_params
from backend.config.logger_config import get_logger

log = get_logger(__name__)

# Configuration
cfg = load_params(strict_env=False)
CHROMA_DIR = cfg.paths["CHROMA"]
if CHROMA_DIR is None:
    raise RuntimeError("Chroma storage is not configured.")

# Ensure the directory exists without loading any embedding model.
Path(CHROMA_DIR).mkdir(parents=True, exist_ok=True)


def _get_embeddings() -> Embeddings | None:
    """
    Get embeddings with fallback:
    1. HuggingFace (local, free)
    2. OpenAI (if API key exists)
    """
    # 1. Try HuggingFace local embeddings (free, no API needed)
    try:
        from langchain_huggingface import HuggingFaceEmbeddings

        return HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    except ImportError:
        log.warning("⚠️ langchain-huggingface not installed, trying sentence-transformers directly")

    # 1b. Try sentence-transformers directly
    try:
        from sentence_transformers import SentenceTransformer

        class LocalEmbeddings(Embeddings):
            """Simple wrapper for sentence-transformers."""

            def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
                self.model = SentenceTransformer(model_name)

            def embed_documents(self, texts: list[str]) -> list[list[float]]:
                encoded = self.model.encode(texts).tolist()
                return cast(list[list[float]], encoded)

            def embed_query(self, text: str) -> list[float]:
                encoded = self.model.encode(text).tolist()
                return cast(list[float], encoded)

        return LocalEmbeddings()
    except ImportError:
        pass
    # 2. Fallback to OpenAI (if API key exists)
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        try:
            from langchain_openai import OpenAIEmbeddings

            return OpenAIEmbeddings(model="text-embedding-3-small", api_key=SecretStr(api_key))
        except ImportError:
            pass

    return None


class MemoryStore:
    def __init__(self) -> None:
        self.embeddings = _get_embeddings()
        self.vector_store: Chroma | None

        if not self.embeddings:
            self.vector_store = None
            return

        # Initialize persistent Chroma storage.
        self.vector_store = Chroma(
            collection_name="digital_brain_memory",
            embedding_function=self.embeddings,
            persist_directory=str(CHROMA_DIR),
        )

    def add_memory(self, text: str, metadata: dict[str, Any] | None = None) -> str:
        """Saves a text fragment to long-term memory."""
        if not self.vector_store:
            return "Error: Memory not initialized (No embeddings available)."

        doc = Document(page_content=text, metadata=metadata or {})
        self.vector_store.add_documents([doc])
        return "Success: Memory saved."

    def search_memory(self, query: str, k: int = 3) -> list[str]:
        """Retrieves relevant facts for the query."""
        if not self.vector_store:
            return []

        results = self.vector_store.similarity_search(query, k=k)
        return [doc.page_content for doc in results]


class VaultStore:
    def __init__(self) -> None:
        self.embeddings = _get_embeddings()
        self.vector_store: Chroma | None

        if not self.embeddings:
            self.vector_store = None
            return

        # Initialize Chroma Persistent for the Vault content
        # We use a different collection from the agent's memory
        self.vector_store = Chroma(
            collection_name="gnosi_vault_content",
            embedding_function=self.embeddings,
            persist_directory=str(CHROMA_DIR),
        )

    def search_vault(self, query: str, k: int = 5) -> list[dict[str, Any]]:
        """Searches for relevant content in the Vault (Wiki, BD, etc.)."""
        if not self.vector_store:
            return []

        results = self.vector_store.similarity_search(query, k=k)
        return [{"content": doc.page_content, "metadata": doc.metadata} for doc in results]

    def add_content(self, text: str, metadata: dict[str, Any] | None = None) -> bool:
        """Adds indexed content from the Vault."""
        if not self.vector_store:
            return False
        doc = Document(page_content=text, metadata=metadata or {})
        self.vector_store.add_documents([doc])
        return True


# --- Singletons MANDROSOS (lazy) -------------------------------------------
# We do NOT instantiate the stores at module level: building them calls
# `_get_embeddings()`, which imports torch (sentence-transformers). If this happens
# when importing the module, any `multiprocessing` process (spawn, default on
# macOS) that re-imports the backend during its bootstrap loads torch inside
# that restricted context and DEADLOCKS on an initialization lock
# (`PyThread_acquire_lock`). Observed result (2026-06-25): orphaned child processes hang.
# that accumulate on each restart and, if the parent `join`s them on top of the event loop,
# the whole backend freezes (every request -> 000, "doesn't load"). Deferring the
# construction to the first real use removes torch from the children's bootstrap. Same pattern
# than `services/transcription.py`.
_memory_store: MemoryStore | None = None
_vault_store: VaultStore | None = None
_store_lock = threading.Lock()


def get_memory_store() -> "MemoryStore":
    """Returns the `MemoryStore` singleton, building it (and loading torch) on first use."""
    global _memory_store
    if _memory_store is None:
        with _store_lock:
            if _memory_store is None:
                _memory_store = MemoryStore()
    return _memory_store


def get_vault_store() -> "VaultStore":
    """Returns the `VaultStore` singleton, building it (and loading torch) on first use."""
    global _vault_store
    if _vault_store is None:
        with _store_lock:
            if _vault_store is None:
                _vault_store = VaultStore()
    return _vault_store


def __getattr__(name: str) -> MemoryStore | VaultStore:
    # Backward compatibility (PEP 562): `from .memory import memory_store` / `vault_store`
    # still works, but now the singleton (and torch) is built ONLY on
    # the first real access to the attribute, not when importing the module.
    if name == "memory_store":
        return get_memory_store()
    if name == "vault_store":
        return get_vault_store()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
