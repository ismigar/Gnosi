"""Governed adapters for Gnosi social reading, composition, and publishing."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import BackgroundTasks

try:
    from langchain_core.tools import tool
except Exception:  # pragma: no cover
    def tool(fn=None, **_kwargs):
        return fn if fn else (lambda function: function)


def _personal() -> None:
    from backend.agent.gnosi_tools import _workspace_id

    if _workspace_id() != "personal":
        raise PermissionError("Social integrations are available only in the personal workspace.")


@tool
async def read_social_feed(stream_id: str, limit: int = 20) -> str:
    """Read a bounded configured social stream."""
    from backend.api.social_routes import get_feed

    _personal()
    result = await get_feed(stream_id, limit=max(1, min(int(limit), 50)))
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def read_social_publication_history() -> str:
    """Read bounded publication history saved in the active Vault."""
    from backend.api.social_routes import get_post_history

    _personal()
    return json.dumps(await get_post_history(), ensure_ascii=False, default=str)


@tool
async def read_scheduled_social_posts() -> str:
    """Read pending scheduled social posts from the active Vault."""
    from backend.api.social_routes import get_scheduled_posts

    _personal()
    return json.dumps(await get_scheduled_posts(), ensure_ascii=False, default=str)


@tool
async def compose_social_posts(
    networks: List[str],
    content: str = "",
    title: str = "",
    url: str = "",
    hint: str = "",
) -> str:
    """Generate cost-bearing per-network social drafts without publishing."""
    from backend.api.social_routes import ComposeRequest, compose_posts

    _personal()
    request = ComposeRequest(
        networks=networks[:10], content=content, title=title, url=url, hint=hint
    )
    return json.dumps(await compose_posts(request), ensure_ascii=False, default=str)


@tool
async def publish_social_posts(
    posts: Dict[str, str],
    source_page_id: str = "",
    source_title: str = "",
) -> str:
    """Publish exact per-network text after interactive confirmation."""
    from backend.api.social_routes import NetworkPost, PublishRequest, publish_posts

    _personal()
    request = PublishRequest(
        posts={key: NetworkPost(text=str(value), media=None) for key, value in posts.items()},
        source_page_id=source_page_id or None,
        source_title=source_title,
        save_record=True,
    )
    result = await publish_posts(request, BackgroundTasks())
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def schedule_social_posts(
    posts: Dict[str, str],
    scheduled_time: str,
    source_page_id: str = "",
    source_title: str = "",
) -> str:
    """Schedule exact per-network text after interactive confirmation."""
    from backend.api.social_routes import NetworkPost, SchedulePublishRequest, schedule_post

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
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def interact_social_post(
    network: str,
    post_id: str,
    action: str,
    cid: str = "",
) -> str:
    """Like or reshare one exact social post after interactive confirmation."""
    from backend.api.social_routes import InteractionRequest, interact_with_post

    _personal()
    request = InteractionRequest(
        network=network, post_id=post_id, action=action, cid=cid or None
    )
    result = await interact_with_post(request)
    return json.dumps(result, ensure_ascii=False, default=str)


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
