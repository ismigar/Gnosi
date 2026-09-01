"""Reader full-content extraction and backfill HTTP routes."""

import logging
from pathlib import Path
from typing import Any, TypedDict, cast

from fastapi import APIRouter, Depends

from backend.domains.reader.routing import RouteReturn, require_active_vault
from backend.domains.reader.schemas import (
    ReaderBackfillStatusResponse,
    ReaderBackfillTriggerResponse,
)
from backend.models import reader as models
from backend.services.workspace_service import require_role


log = logging.getLogger("backend.domains.reader.routes")


class BackfillStatus(TypedDict):
    running: bool
    total: int
    done: int
    extracted: int
    failed: int
    current: str
    error: str | None


backfill_status: BackfillStatus = {
    "running": False,
    "total": 0,
    "done": 0,
    "extracted": 0,
    "failed": 0,
    "current": "",
    "error": None,
}


def _run_backfill(vault_path: Path) -> None:
    """Iterate excerpt-only articles, extract via trafilatura, persist.

    Polite: 1s sleep between fetches of the same hostname so we don't
    hammer a single publisher. 8s per-request timeout already lives in
    the extractor. Stops if the global flag goes False (set on a fresh
    trigger; container restart is an implicit stop).
    """
    import time
    from urllib.parse import urlparse

    from sqlalchemy.orm import sessionmaker

    from backend.data.db import get_engine_for_path
    from backend.services.article_extractor import (
        extract_full_content,
        looks_like_excerpt,
    )
    from backend.services.context_vars import active_vault_path

    # ContextVars don't propagate to fresh threads; set it explicitly
    # so anything inside the worker that calls get_active_vault_path()
    # (logging, downstream services) sees the right vault.
    active_vault_path.set(vault_path)
    engine, _ = get_engine_for_path(vault_path)
    SessionLocal = sessionmaker(bind=engine)

    last_seen_at: dict[str, float] = {}  # hostname -> monotonic timestamp

    try:
        with SessionLocal() as db:
            # Pick everything that still lacks a full_content. We then
            # filter client-side to those that look like excerpts so we
            # don't waste an HTTP call on already-rich articles.
            candidates = cast(
                list[Any],
                db.query(models.Article)
                .filter(models.Article.full_content.is_(None))
                .order_by(models.Article.published_at.desc().nullslast())
                .all(),
            )
            targets = [a for a in candidates if looks_like_excerpt(a.content)]
            backfill_status["total"] = len(targets)
            log.info("Backfill: %s articles to process", len(targets))

            for art in targets:
                if not backfill_status["running"]:
                    log.info("Backfill: stopped externally")
                    break
                backfill_status["current"] = (art.title or "")[:80]

                # Per-host rate limit
                try:
                    host = urlparse(art.url).hostname or ""
                except Exception:
                    host = ""
                now = time.monotonic()
                wait = 1.0 - (now - last_seen_at.get(host, 0))
                if wait > 0:
                    time.sleep(wait)
                last_seen_at[host] = time.monotonic()

                extracted = extract_full_content(art.url)
                if extracted:
                    art.full_content = extracted
                    db.commit()
                    backfill_status["extracted"] += 1
                else:
                    backfill_status["failed"] += 1
                backfill_status["done"] += 1
    except Exception as e:
        log.exception("Backfill crashed")
        backfill_status["error"] = str(e)
    finally:
        backfill_status["running"] = False
        backfill_status["current"] = ""


def trigger_backfill_extract() -> RouteReturn:
    """Spin up a background pass that fills `full_content` on existing
    articles whose RSS body looks like an excerpt. Idempotent — only
    rows with `full_content IS NULL` are touched.
    """
    import threading

    if backfill_status["running"]:
        return {"status": "already_running", **backfill_status}

    backfill_status.update(
        {
            "running": True,
            "total": 0,
            "done": 0,
            "extracted": 0,
            "failed": 0,
            "current": "",
            "error": None,
        }
    )

    vault_path = require_active_vault()

    thread = threading.Thread(target=_run_backfill, args=(vault_path,), daemon=True)
    thread.start()
    return {"status": "started"}


def get_backfill_extract_status() -> RouteReturn:
    """Poll the backfill progress. Safe to call any time."""
    return backfill_status


def register_routes(router: APIRouter) -> None:
    """Register backfill handlers directly on the canonical Reader router."""
    router.post(
        "/articles/backfill-extract",
        response_model=ReaderBackfillTriggerResponse,
        response_model_exclude_unset=True,
        dependencies=[Depends(require_role("editor"))],
    )(trigger_backfill_extract)
    router.get(
        "/articles/backfill-extract/status",
        response_model=ReaderBackfillStatusResponse,
    )(get_backfill_extract_status)


__all__ = [
    "BackfillStatus",
    "_run_backfill",
    "backfill_status",
    "get_backfill_extract_status",
    "register_routes",
    "trigger_backfill_extract",
]
