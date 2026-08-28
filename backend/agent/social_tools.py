"""Governed adapters for Gnosi social reading, composition, and publishing."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from fastapi import BackgroundTasks
from fastapi.encoders import jsonable_encoder
from langchain_core.tools import tool


def _personal() -> None:
    from backend.agent.gnosi_tools import _workspace_id

    if _workspace_id() != "personal":
        raise PermissionError("Social integrations are available only in the personal workspace.")


def _json_result(result: object) -> str:
    """Serialize route models with the same JSON shape as HTTP responses."""
    return json.dumps(jsonable_encoder(result), ensure_ascii=False)


@tool
async def read_social_feed(stream_id: str, limit: int = 20) -> str:
    """Read a bounded configured social stream."""
    from backend.api.social_routes import get_feed

    _personal()
    result = await get_feed(stream_id, limit=max(1, min(int(limit), 50)))
    return _json_result(result)


@tool
async def read_social_publication_history() -> str:
    """Read bounded publication history saved in the active Vault."""
    from backend.api.social_routes import get_post_history

    _personal()
    return _json_result(await get_post_history())


@tool
async def read_scheduled_social_posts() -> str:
    """Read pending scheduled social posts from the active Vault."""
    from backend.api.social_routes import get_scheduled_posts

    _personal()
    return _json_result(await get_scheduled_posts())


@tool
async def compose_social_posts(
    networks: list[str],
    content: str = "",
    title: str = "",
    url: str = "",
    hint: str = "",
) -> str:
    """Generate cost-bearing per-network social drafts without publishing."""
    from backend.api.social_routes import compose_posts
    from backend.domains.social.schemas import ComposeRequest

    _personal()
    request = ComposeRequest(
        networks=networks[:10], content=content, title=title, url=url, hint=hint
    )
    return _json_result(await compose_posts(request))


@tool
async def publish_social_posts(
    posts: dict[str, str],
    source_page_id: str = "",
    source_title: str = "",
) -> str:
    """Publish exact per-network text after interactive confirmation."""
    from backend.api.social_routes import publish_posts
    from backend.domains.social.schemas import NetworkPost, PublishRequest

    _personal()
    request = PublishRequest(
        posts={key: NetworkPost(text=str(value), media=None) for key, value in posts.items()},
        source_page_id=source_page_id or None,
        source_title=source_title,
        save_record=True,
    )
    result = await publish_posts(request, BackgroundTasks())
    return _json_result(result)


@tool
async def schedule_social_posts(
    posts: dict[str, str],
    scheduled_time: str,
    source_page_id: str = "",
    source_title: str = "",
) -> str:
    """Schedule exact per-network text after interactive confirmation."""
    from backend.api.social_routes import schedule_post
    from backend.domains.social.schemas import NetworkPost, SchedulePublishRequest

    _personal()
    when = datetime.fromisoformat(scheduled_time.replace("Z", "+00:00"))
    if when.tzinfo is not None:
        when = when.astimezone(timezone.utc).replace(tzinfo=None)
    request = SchedulePublishRequest(
        posts={key: NetworkPost(text=str(value), media=None) for key, value in posts.items()},
        scheduled_time=when,
        source_page_id=source_page_id or None,
        source_title=source_title,
    )
    result = await schedule_post(request, BackgroundTasks())
    return _json_result(result)


@tool
async def interact_social_post(
    network: str,
    post_id: str,
    action: str,
    cid: str = "",
) -> str:
    """Like or reshare one exact social post after interactive confirmation."""
    from backend.api.social_routes import interact_with_post
    from backend.domains.social.schemas import InteractionRequest

    _personal()
    request = InteractionRequest(
        network=network, post_id=post_id, action=action, cid=cid or None
    )
    result = await interact_with_post(request)
    return _json_result(result)


SOCIAL_READ_TOOLS = [
    read_social_feed,
    read_social_publication_history,
    read_scheduled_social_posts,
]
SOCIAL_AI_TOOLS = [compose_social_posts]
SOCIAL_EXTERNAL_WRITE_TOOLS = [
    publish_social_posts,
    schedule_social_posts,
    interact_social_post,
]
