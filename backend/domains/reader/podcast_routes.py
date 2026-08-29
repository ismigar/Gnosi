"""Reader podcast generation and download HTTP routes."""

import os
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
    from backend.services.audio_summarizer import start_generation_async, generation_status

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
    from backend.services.audio_summarizer import generation_status

    return {
        "running": generation_status["running"],
        "progress": generation_status["progress"],
        "error": generation_status["error"],
        "result_filename": generation_status["result_filename"],
    }


def get_podcast_info() -> RouteReturn:
    """Returns information about the last generated podcast"""
    import os
    from datetime import datetime

    from backend.services.audio_summarizer import get_podcast_output_dir

    output_dir = cast(Callable[[], Path], get_podcast_output_dir)
    pod_dir = output_dir()
    pod_dir.mkdir(parents=True, exist_ok=True)

    files = [f for f in os.listdir(pod_dir) if f.endswith(".mp3")]
    if not files:
        return {"exists": False}

    latest_file = sorted(files, reverse=True)[0]
    # Previous bug: file_path was built using AUDIO_OUTPUT_DIR (config.paths.AUDIO)
    # but the files lived in pod_dir → getmtime failed with FileNotFoundError.
    file_path = os.path.join(pod_dir, latest_file)

    # Get the modification date
    mtime = os.path.getmtime(file_path)
    dt = datetime.fromtimestamp(mtime)

    return {
        "exists": True,
        "filename": latest_file,
        "created_at": dt.isoformat(),
        "formatted_date": dt.strftime("%d/%m/%Y"),
        "formatted_time": dt.strftime("%H:%M"),
    }


def get_latest_podcast() -> RouteReturn:
    """Download/Stream the most recent podcast"""
    from backend.services.audio_summarizer import get_podcast_output_dir

    output_dir = cast(Callable[[], Path], get_podcast_output_dir)
    pod_dir = output_dir()
    if not os.path.exists(pod_dir):
        raise HTTPException(status_code=404, detail="No podcasts available")

    files = [f for f in os.listdir(pod_dir) if f.endswith(".mp3")]
    if not files:
        raise HTTPException(status_code=404, detail="No podcasts available")

    # Sort files by name (which contains the date format YYYY_MM_DD) to get the latest
    latest_file = sorted(files, reverse=True)[0]
    file_path = os.path.join(pod_dir, latest_file)

    return FileResponse(file_path, media_type="audio/mpeg", filename="gnosi_daily.mp3")


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
