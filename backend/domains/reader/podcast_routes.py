"""Reader podcast generation and download HTTP routes."""

import asyncio
from datetime import datetime
from typing import Annotated, Callable, cast

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import FileResponse, Response

from backend.domains.reader.podcast_media import EpisodeResponse, PodcastEpisode, find_episode, latest_episode, open_episode

from backend.domains.reader.routing import RouteReturn, require_active_vault
from backend.domains.reader.schemas import (
    ReaderPodcastGenerationResponse,
    ReaderPodcastInfoResponse,
    ReaderPodcastStatusResponse,
)
from backend.services.plugin_access import require_plugins
from backend.services.workspace_service import WorkspaceContext, get_workspace_context, require_role


PodcastContext = Annotated[WorkspaceContext, Depends(get_workspace_context)]
OptionalPodcastContext = Annotated[WorkspaceContext | None, Depends(get_workspace_context)]


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


def _latest_for_context(context: WorkspaceContext | None) -> PodcastEpisode | None:
    from backend.services.audio_summarizer import get_podcast_output_dir

    directory = get_podcast_output_dir(context.vault_path) if context else get_podcast_output_dir()
    try:
        return latest_episode(directory)
    except OSError as error:
        raise HTTPException(status_code=503, detail="Podcast storage is temporarily unavailable") from error


def get_podcast_info(context: OptionalPodcastContext = None) -> RouteReturn:
    """Read latest publication metadata without opening or hydrating any audio."""
    episode = _latest_for_context(context)
    if episode is None:
        return {"exists": False}
    dt = datetime.fromtimestamp(episode.metadata.st_mtime).astimezone()

    return {
        "exists": True,
        "filename": episode.path.name,
        "episode_id": episode.episode_id,
        "created_at": dt.isoformat(),
        "formatted_date": dt.strftime("%d/%m/%Y"),
        "formatted_time": dt.strftime("%H:%M"),
    }


async def get_latest_podcast(context: OptionalPodcastContext = None) -> FileResponse:
    """Stream the latest published episode through the coordinated Vault reader."""
    from backend.domains.vault.files.serving import serve_snapshot

    episode = await asyncio.to_thread(_latest_for_context, context)
    if episode is None:
        raise HTTPException(status_code=404, detail="No podcasts available")
    root = context.vault_path if context else episode.path.parents[2]
    return await serve_snapshot(
        episode.path, root, headers={"Content-Disposition": 'attachment; filename="gnosi_daily.mp3"'}
    )


async def get_podcast_episode(
    episode_id: Annotated[str, Path(pattern=r"^[a-f0-9]{64}$")], context: PodcastContext
) -> Response:
    """Stream the requested published file revision in the authenticated Vault.

    Use the opaque episode_id from /podcast/info. Newer daily files leave retained
    episodes playable. Removing or replacing the named revision expires its URL.
    Byte ranges seek within this exact revision.
    """
    from backend.services.audio_summarizer import get_podcast_output_dir

    from backend.domains.vault.files.serving import serve_snapshot
    from backend.utils.metadata_io import is_native_vault_file

    directory = get_podcast_output_dir(context.vault_path)
    try:
        episode = await asyncio.to_thread(find_episode, directory, episode_id)
        if episode is None:
            raise HTTPException(status_code=404, detail="Podcast episode is unavailable")
        if await asyncio.to_thread(is_native_vault_file, episode.path, episode.metadata):
            return await serve_snapshot(
                episode.path, context.vault_path, expected_stat=episode.metadata,
                headers={"etag": f'"{episode.episode_id}"', "cache-control": "private, no-cache"},
            )
        opened = await asyncio.to_thread(open_episode, directory, episode_id)
    except OSError as error:
        raise HTTPException(status_code=503, detail="Podcast storage is temporarily unavailable") from error
    if opened is None:
        raise HTTPException(status_code=404, detail="Podcast episode is unavailable")
    return EpisodeResponse(*opened)


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
    audio_content = {"audio/mpeg": {"schema": {"type": "string", "format": "binary"}}}
    router.get(
        "/podcast/episodes/{episode_id}",
        response_class=Response,
        responses={
            200: {"description": "The published audio revision", "content": audio_content},
            206: {"description": "Requested byte range(s) of the published revision", "content": {
                **audio_content, "multipart/byteranges": {"schema": {"type": "string", "format": "binary"}},
            }},
            400: {"description": "Malformed byte range"},
            404: {"description": "Unknown, removed or replaced episode in this Vault"},
            416: {"description": "Unsatisfiable or excessive byte ranges"},
            503: {"description": "Podcast storage is temporarily unavailable"},
        },
    )(get_podcast_episode)


__all__ = [
    "get_latest_podcast",
    "get_podcast_info",
    "get_podcast_status",
    "register_routes",
    "trigger_podcast_generation",
]
