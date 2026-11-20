"""Reader podcast generation and download HTTP routes."""

import asyncio
import re
from pathlib import Path
from typing import Callable, cast

from fastapi import APIRouter, Depends, HTTPException

from backend.domains.reader.routing import RouteReturn, require_active_vault
from backend.domains.reader.schemas import (
    ReaderPodcastGenerationResponse,
    ReaderPodcastInfoResponse,
    ReaderPodcastStatusResponse,
)
from backend.services.plugin_access import require_plugins
from backend.services.workspace_service import require_role


def trigger_podcast_generation() -> RouteReturn:
    """Launches podcast generation in the background"""
    from backend.services.audio_summarizer import start_generation_async, get_generation_status

    generation_status = get_generation_status()
    if generation_status["running"]:
        return {
            "status": "already_running",
            "message": "A podcast is already being generated.",
            "progress": generation_status["progress"],
        }

    launch = cast(Callable[..., bool], start_generation_async)
    started = launch(vault_path=require_active_vault())
    if not started:
        from backend.services import podcast_episode
        from backend.services.agent_execution_scope import current_scope
        episode = podcast_episode.for_scope(current_scope())
        if episode and episode.status == "success":
            return {"status": "completed", "message": "Today's podcast run has finished."}
        return {"status": "already_running", "message": "A podcast is already being generated."}
    return {"status": "started", "message": "Generation started in the background."}


def get_podcast_status() -> RouteReturn:
    """Returns the current status of podcast generation"""
    from backend.services.audio_summarizer import get_generation_status

    generation_status = get_generation_status()
    return {
        "running": generation_status["running"],
        "progress": generation_status["progress"],
        "error": generation_status["error"],
        "result_filename": generation_status["result_filename"],
        "skipped_articles": generation_status.get("skipped_articles", []),
    }


def _latest_episode_file() -> Path | None:
    from backend.services.audio_summarizer import get_podcast_output_dir
    from backend.utils.metadata_io import MetadataUnavailable

    directory = get_podcast_output_dir()
    if directory.is_symlink() or directory.parent.is_symlink():
        raise MetadataUnavailable(path=directory, reason="permission")
    try:
        latest = max((path for path in directory.iterdir()
                      if re.fullmatch(r"daily_podcast_[0-9]{4}_[0-9]{2}_[0-9]{2}\.mp3", path.name)), default=None)
    except FileNotFoundError:
        return None
    if latest and latest.is_symlink():
        raise MetadataUnavailable(path=latest, reason="permission")
    return latest


def get_podcast_info() -> RouteReturn:
    """Return the last published episode available to this Reader."""
    from datetime import datetime

    latest = _latest_episode_file()
    if latest is None:
        return {"exists": False}
    latest_file = latest.name
    dt = datetime.fromtimestamp(latest.stat().st_mtime)

    return {
        "exists": True,
        "filename": latest_file,
        "created_at": dt.isoformat(),
        "formatted_date": dt.strftime("%d/%m/%Y"),
        "formatted_time": dt.strftime("%H:%M"),
    }


async def get_latest_podcast() -> RouteReturn:
    """Stream the selected episode using the same coordinated file snapshot as vault downloads."""
    from backend.domains.vault.files.serving import serve_snapshot

    latest = await asyncio.to_thread(_latest_episode_file)
    if latest is None:
        raise HTTPException(status_code=404, detail="No podcasts available")
    return await serve_snapshot(latest, require_active_vault(),
                                headers={"Content-Disposition": 'attachment; filename="gnosi_daily.mp3"'})


def register_routes(router: APIRouter) -> None:
    """Register podcast handlers directly on the canonical Reader router."""
    router.post(
        "/podcast/generate",
        response_model=ReaderPodcastGenerationResponse,
        response_model_exclude_unset=True,
        dependencies=[Depends(require_role("editor")), Depends(require_plugins("ai-platform"))],
    )(trigger_podcast_generation)
    router.get("/podcast/status", response_model=ReaderPodcastStatusResponse)(
        get_podcast_status
    )
    router.get(
        "/podcast/info",
        response_model=ReaderPodcastInfoResponse,
        response_model_exclude_unset=True,
    )(get_podcast_info)
    router.get("/podcast/latest")(get_latest_podcast)


__all__ = [
    "get_latest_podcast",
    "get_podcast_info",
    "get_podcast_status",
    "register_routes",
    "trigger_podcast_generation",
]
