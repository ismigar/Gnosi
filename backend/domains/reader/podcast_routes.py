"""Reader podcast generation and download HTTP routes."""

from datetime import datetime
from pathlib import Path
from typing import Callable, cast

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

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
        raise HTTPException(status_code=409, detail="Generation already in progress.")
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


def _latest_episode() -> Path | None:
    from backend.services.audio_summarizer import get_podcast_output_dir

    directory = get_podcast_output_dir()
    try:
        return max((item for item in directory.iterdir() if item.suffix == ".mp3" and item.is_file()), default=None)
    except FileNotFoundError:
        return None


def get_podcast_info() -> RouteReturn:
    """Returns information about the last generated podcast"""
    episode = _latest_episode()
    if episode is None:
        return {"exists": False}
    dt = datetime.fromtimestamp(episode.stat().st_mtime).astimezone()

    return {
        "exists": True,
        "filename": episode.name,
        "created_at": dt.isoformat(),
        "formatted_date": dt.strftime("%d/%m/%Y"),
        "formatted_time": dt.strftime("%H:%M"),
    }


def get_latest_podcast() -> RouteReturn:
    """Download/Stream the most recent podcast"""
    episode = _latest_episode()
    if episode is None:
        raise HTTPException(status_code=404, detail="No podcasts available")
    return FileResponse(episode, media_type="audio/mpeg", filename="gnosi_daily.mp3")


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
