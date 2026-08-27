"""Single process-wide lock ownership for vault comments."""

from __future__ import annotations

import asyncio
import threading


page_comments_io_lock = threading.Lock()
page_comments_mutation_lock = asyncio.Lock()
inline_comments_mutation_lock = asyncio.Lock()


__all__ = [
    "inline_comments_mutation_lock",
    "page_comments_io_lock",
    "page_comments_mutation_lock",
]
