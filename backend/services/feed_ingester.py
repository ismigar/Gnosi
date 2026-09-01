"""Compatibility facade for feed ingestion."""

from typing import Any

from backend.data.db import get_engine_for_path as get_engine_for_path
from backend.domains.mail.ingestion.feeds import (
    _fetch_feed as _fetch_feed,
)
from backend.domains.mail.ingestion.feeds import (
    fetch_and_store_feeds as _canonical_fetch_and_store_feeds,
)
from backend.services.article_extractor import (
    extract_full_content as extract_full_content,
)
from backend.services.article_extractor import (
    looks_like_excerpt as looks_like_excerpt,
)
from backend.services.context_vars import get_active_vault_path as get_active_vault_path


def fetch_and_store_feeds() -> Any:
    return _canonical_fetch_and_store_feeds(
        fetch_feed=_fetch_feed,
        engine_factory=get_engine_for_path,
        vault_path_factory=get_active_vault_path,
        excerpt_detector=looks_like_excerpt,
        content_extractor=extract_full_content,
    )
