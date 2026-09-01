"""Shared process state for grounded notebook services."""

from __future__ import annotations

import threading

VISIBILITIES = {"private", "workspace"}


CONVERSATION_MODES = {"shared", "private_member"}


RUNNING_REVISION_STATES = {"queued", "indexing"}


MAX_RESOURCE_IDS = 1_000


MAX_SEARCH_RESULTS = 50


_RESOURCE_TYPE_FIELD_NAMES = {
    "documenttype",
    "itemtype",
    "resourcetype",
    "tipo",
    "tipoderecurso",
    "tipus",
    "tipusderecurs",
    "type",
}


_RESOURCE_AUTHOR_FIELD_NAMES = {
    "author",
    "authors",
    "auteur",
    "auteurs",
    "autor",
    "autores",
    "autoria",
    "autoría",
    "autors",
    "creator",
    "creators",
}


_WRITE_LOCK = threading.RLock()


_THREAD_LOCK = threading.RLock()


_THREADS: dict[str, threading.Thread] = {}


_ANALYSIS_THREADS: dict[str, threading.Thread] = {}


class NotebookIngestionCancelled(RuntimeError):
    """Raised when a durable notebook ingestion is cancelled cooperatively."""
