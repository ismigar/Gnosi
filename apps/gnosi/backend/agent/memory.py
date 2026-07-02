import os
import threading
import chromadb
from pathlib import Path
from langchain_chroma import Chroma
from langchain_core.documents import Document
from backend.config.app_config import load_params

# Configuració
cfg = load_params(strict_env=False)
CHROMA_DIR = cfg.paths["CHROMA"]

# Assegurar directori
os.makedirs(CHROMA_DIR, exist_ok=True)


def _get_embeddings():
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
        print(
            "⚠️ langchain-huggingface not installed, trying sentence-transformers directly"
        )

    # 1b. Try sentence-transformers directly
    try:
        from sentence_transformers import SentenceTransformer

        class LocalEmbeddings:
            """Simple wrapper for sentence-transformers."""

            def __init__(self, model_name="all-MiniLM-L6-v2"):
                self.model = SentenceTransformer(model_name)

            def embed_documents(self, texts):
                return self.model.encode(texts).tolist()

            def embed_query(self, text):
                return self.model.encode(text).tolist()

        return LocalEmbeddings()
    except ImportError:
        pass
    # 2. Fallback to OpenAI (if API key exists)
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        try:
            from langchain_openai import OpenAIEmbeddings

            return OpenAIEmbeddings(model="text-embedding-3-small", api_key=api_key)
        except ImportError:
            pass

    return None


class MemoryStore:
    def __init__(self):
        self.embeddings = _get_embeddings()

        if not self.embeddings:
            self.vector_store = None
            return

        # Inicialitzar Chroma Persistent
        self.vector_store = Chroma(
            collection_name="digital_brain_memory",
            embedding_function=self.embeddings,
            persist_directory=str(CHROMA_DIR),
        )

    def add_memory(self, text: str, metadata: dict = None):
        """Guarda un fragment de text a la memòria a llarg termini."""
        if not self.vector_store:
            return "Error: Memory not initialized (No embeddings available)."

        doc = Document(page_content=text, metadata=metadata or {})
        self.vector_store.add_documents([doc])
        return "Success: Memory saved."

    def search_memory(self, query: str, k: int = 3):
        """Recupera fets rellevants per a la query."""
        if not self.vector_store:
            return []

        results = self.vector_store.similarity_search(query, k=k)
        return [doc.page_content for doc in results]


class VaultStore:
    def __init__(self):
        self.embeddings = _get_embeddings()

        if not self.embeddings:
            self.vector_store = None
            return

        # Inicialitzar Chroma Persistent per al contingut del Vault
        # Fem servir una col·lecció diferent de la memòria de l'agent
        self.vector_store = Chroma(
            collection_name="gnosi_vault_content",
            embedding_function=self.embeddings,
            persist_directory=str(CHROMA_DIR),
        )

    def search_vault(self, query: str, k: int = 5):
        """Busca contingut rellevant al Vault (Wiki, BD, etc.)."""
        if not self.vector_store:
            return []

        results = self.vector_store.similarity_search(query, k=k)
        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata
            }
            for doc in results
        ]

    def add_content(self, text: str, metadata: dict = None):
        """Afegeix contingut indexat del Vault."""
        if not self.vector_store:
            return False
        doc = Document(page_content=text, metadata=metadata or {})
        self.vector_store.add_documents([doc])
        return True


# --- Singletons MANDROSOS (lazy) -------------------------------------------
# NO instanciem els stores a nivell de mòdul: construir-los crida
# `_get_embeddings()`, que importa torch (sentence-transformers). Si això passa
# en importar el mòdul, qualsevol procés `multiprocessing` (spawn, default a
# macOS) que reimporti el backend durant el seu bootstrap carrega torch dins
# d'aquell context restringit i es DEADLOCKA en un lock d'inicialització
# (`PyThread_acquire_lock`). Resultat observat (2026-06-25): fills orfes penjats
# que s'acumulen a cada reinici i, si el pare en fa `join` damunt l'event loop,
# tot el backend es congela (tota petició -> 000, "no carrega"). Diferir la
# construcció al 1r ús real elimina torch del bootstrap dels fills. Mateix patró
# que `services/transcription.py`.
_memory_store = None
_vault_store = None
_store_lock = threading.Lock()


def get_memory_store() -> "MemoryStore":
    """Retorna el `MemoryStore` singleton, construint-lo (i carregant torch) al 1r ús."""
    global _memory_store
    if _memory_store is None:
        with _store_lock:
            if _memory_store is None:
                _memory_store = MemoryStore()
    return _memory_store


def get_vault_store() -> "VaultStore":
    """Retorna el `VaultStore` singleton, construint-lo (i carregant torch) al 1r ús."""
    global _vault_store
    if _vault_store is None:
        with _store_lock:
            if _vault_store is None:
                _vault_store = VaultStore()
    return _vault_store


def __getattr__(name):
    # Retrocompat (PEP 562): `from .memory import memory_store` / `vault_store`
    # segueix funcionant, però ara el singleton (i torch) es construeix NOMÉS en
    # el 1r accés real a l'atribut, no en importar el mòdul.
    if name == "memory_store":
        return get_memory_store()
    if name == "vault_store":
        return get_vault_store()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
