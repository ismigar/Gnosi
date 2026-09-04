import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Callable, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from backend.domains.vault.registry.state import RegistryData
from backend.domains.social.configuration import (
    configured_networks as _configured_networks,
    configured_streams as _configured_streams,
    network_settings as _network_settings,
    strip_html,
)
from backend.domains.social.schemas import (
    CancelScheduledPostResponse,
    ComposeRequest,
    ComposeResponse,
    CreatePostRequest,
    InteractionRequest,
    InteractionResponse,
    NetworkPost,
    PostHistoryResponse,
    ProcessScheduledResponse,
    PublicationResponse,
    PublishRequest,
    ScheduledPostResponse,
    ScheduledPublicationResponse,
    SchedulePublishRequest,
    SocialNetwork,
    SocialPost,
    SocialSettingsUpdateResponse,
    Stream,
)
from backend.services import social_store
from backend.services.integration_manager import integration_manager
from backend.services.social_compose import compose_one, detect_lang

from backend.services.social_clients import (
    SOCIAL_PUBLISHERS,
    bluesky_client,
    mastodon_client,
)
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail

log = logging.getLogger(__name__)

router = APIRouter()


# --- Endpoints ---


@router.get("/streams", response_model=list[Stream])
async def get_streams() -> list[Stream]:
    """Returns the user-configured streams/columns."""
    return await asyncio.to_thread(_configured_streams)


@router.put(
    "/streams",
    dependencies=[Depends(require_role("editor"))],
    response_model=SocialSettingsUpdateResponse,
)
async def update_streams(payload: list[Stream]) -> SocialSettingsUpdateResponse:
    """Saves the user's stream configuration."""
    integration_manager.replace_key("social_streams", [stream.model_dump() for stream in payload])
    return SocialSettingsUpdateResponse(status="ok")


@router.get("/networks", response_model=list[SocialNetwork])
async def get_networks() -> list[SocialNetwork]:
    """Returns the user-configured social networks, with live config status."""
    return await asyncio.to_thread(_configured_networks)


@router.put(
    "/networks",
    dependencies=[Depends(require_role("editor"))],
    response_model=SocialSettingsUpdateResponse,
)
async def update_networks(payload: list[SocialNetwork]) -> SocialSettingsUpdateResponse:
    """Saves the enabled/disabled state and per-network settings."""
    integration_manager.replace_key(
        "social_networks", [network.model_dump() for network in payload]
    )
    return SocialSettingsUpdateResponse(status="ok")


def _social_posts(items: list[dict[str, Any]]) -> list[SocialPost]:
    """Validate feed records at the third-party adapter boundary."""
    return [SocialPost.model_validate(item) for item in items]


@router.get("/feed/{stream_id}", response_model=list[SocialPost])
async def get_feed(stream_id: str, limit: int = 20) -> list[SocialPost]:
    """Returns posts for a specific stream."""

    if stream_id == "mastodon-home":
        posts = await mastodon_client.get_home_timeline(limit=limit)
        for post in posts:
            post["content"] = strip_html(post.get("content", ""))
        if not posts and not mastodon_client.bearer:
            return _social_posts(
                [
                    {
                        "id": "mastodon-setup",
                        "network": "mastodon",
                        "author": "🚀 Mastodon Setup",
                        "handle": "@guide",
                        "content": "You haven't configured the Mastodon token yet.\n\n1. Go to Development\n2. Create an App with 'read' and 'write' permissions\n3. Save the token in Gnosi's secure settings",
                        "timestamp": datetime.now().isoformat(),
                        "avatar": None,
                        "favourited": False,
                        "reblogged": False,
                        "favourites_count": 0,
                        "reblogs_count": 0,
                        "replies_count": 0,
                        "is_reblog": False,
                        "url": "https://mastodon.social/settings/applications",
                    }
                ]
            )
        return _social_posts(posts)

    elif stream_id == "bluesky-home":
        posts = await bluesky_client.get_timeline(limit=limit)
        if not posts and not bluesky_client.app_password:
            return _social_posts(
                [
                    {
                        "id": "bluesky-setup",
                        "network": "bluesky",
                        "author": "🚀 Bluesky Setup",
                        "handle": "@guide",
                        "content": "You haven't configured the Bluesky App Password yet.\n\n1. Go to Settings -> App Passwords\n2. Create a new one\n3. Save it in Gnosi's secure settings",
                        "timestamp": datetime.now().isoformat(),
                        "avatar": None,
                        "favourited": False,
                        "reblogged": False,
                        "favourites_count": 0,
                        "reblogs_count": 0,
                        "replies_count": 0,
                        "is_reblog": False,
                        "url": "https://bsky.app/settings/app-passwords",
                    }
                ]
            )
        return _social_posts(posts)

    elif stream_id == "scheduled":
        recs = await social_store.list_publications(status=social_store.STATUS_SCHEDULED)
        items = []
        for r in recs:
            sched = r.get(social_store.COL_SCHEDULED) or ""
            networks = [
                n.strip() for n in (r.get(social_store.COL_NETWORKS) or "").split(",") if n.strip()
            ]
            content_preview = _messages_preview(r)
            items.append(
                {
                    "id": r.get("id"),
                    "network": "scheduled",
                    "author": "You",
                    "handle": "@scheduled",
                    "content": f"📅 {sched[:16]}\n\n{content_preview}\n\n→ {', '.join(networks)}",
                    "timestamp": sched,
                    "avatar": None,
                    "favourited": False,
                    "reblogged": False,
                    "favourites_count": 0,
                    "reblogs_count": 0,
                    "replies_count": 0,
                    "is_reblog": False,
                    "url": None,
                }
            )
        return _social_posts(items)

    elif stream_id.startswith(("facebook", "linkedin", "telegram", "instagram", "x")):
        network = stream_id.split("-")[0]
        recs = await social_store.list_publications()
        my_posts = [
            r
            for r in recs
            if network in [n.strip() for n in (r.get(social_store.COL_NETWORKS) or "").split(",")]
        ]
        if not my_posts:
            network_name = network.capitalize()
            return _social_posts(
                [
                    {
                        "id": f"system-{stream_id}-empty",
                        "network": network,
                        "author": "System",
                        "handle": "@system",
                        "content": f"There are no recent posts on {network_name} from this application.\n\nUse the 'New Post' button to send your first message!",
                        "timestamp": datetime.now().isoformat(),
                        "avatar": None,
                        "favourited": False,
                        "reblogged": False,
                        "favourites_count": 0,
                        "reblogs_count": 0,
                        "replies_count": 0,
                        "is_reblog": False,
                        "url": None,
                    }
                ]
            )
        feed_items = []
        for r in my_posts:
            feed_items.append(
                {
                    "id": r.get("id"),
                    "network": network,
                    "author": "You",
                    "handle": "@me",
                    "content": _messages_preview(r, network=network),
                    "timestamp": r.get(social_store.COL_PUBLISHED)
                    or r.get(social_store.COL_SCHEDULED)
                    or "",
                    "avatar": None,
                    "favourited": False,
                    "reblogged": False,
                    "favourites_count": 0,
                    "reblogs_count": 0,
                    "replies_count": 0,
                    "is_reblog": False,
                    "url": _messages_url(r, network),
                }
            )
        return _social_posts(feed_items)

    return []


def _messages_preview(rec: dict[str, Any], network: str | None = None) -> str:
    """Extracts readable text from a record's Missatges field."""
    try:
        msgs = cast(
            dict[str, dict[str, Any]],
            json.loads(rec.get(social_store.COL_MESSAGES) or "{}"),
        )
    except Exception:
        return ""
    if network and network in msgs:
        return str((msgs[network] or {}).get("text", ""))
    return "\n---\n".join(str((d or {}).get("text", "")) for d in msgs.values())


def _messages_url(rec: dict[str, Any], network: str) -> str | None:
    try:
        msgs = cast(
            dict[str, dict[str, Any]],
            json.loads(rec.get(social_store.COL_MESSAGES) or "{}"),
        )
        url = (msgs.get(network) or {}).get("url")
        return str(url) if url is not None else None
    except Exception:
        return None


_VALID_NETWORKS = {"mastodon", "bluesky"}
_VALID_ACTIONS = {
    "mastodon": {"like", "unlike", "reblog", "unreblog"},
    "bluesky": {"like", "reblog"},
}


@router.post(
    "/interact",
    dependencies=[Depends(require_role("editor"))],
    response_model=InteractionResponse,
)
async def interact_with_post(request: InteractionRequest) -> InteractionResponse:
    """Perform an interaction (like, reblog) on a post."""

    if request.network not in _VALID_NETWORKS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown network '{request.network}'. Valid: {sorted(_VALID_NETWORKS)}",
        )

    valid_actions = _VALID_ACTIONS[request.network]
    if request.action not in valid_actions:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Action '{request.action}' not supported on {request.network}. "
                f"Valid: {sorted(valid_actions)}"
            ),
        )

    success = False

    if request.network == "mastodon":
        if request.action == "like":
            success = await mastodon_client.favourite(request.post_id)
        elif request.action == "unlike":
            success = await mastodon_client.unfavourite(request.post_id)
        elif request.action == "reblog":
            success = await mastodon_client.reblog(request.post_id)
        elif request.action == "unreblog":
            success = await mastodon_client.unreblog(request.post_id)

    elif request.network == "bluesky":
        if not request.cid:
            raise HTTPException(status_code=400, detail="CID required for Bluesky interactions")

        if request.action == "like":
            success = await bluesky_client.like(request.post_id, request.cid)
        elif request.action == "reblog":
            success = await bluesky_client.repost(request.post_id, request.cid)

    if not success:
        raise HTTPException(
            status_code=502, detail=f"Failed to {request.action} post on {request.network}"
        )

    return InteractionResponse(status="success", action=request.action, post_id=request.post_id)


@router.post(
    "/compose",
    dependencies=[Depends(require_role("editor"))],
    response_model=ComposeResponse,
)
async def compose_posts(request: ComposeRequest) -> ComposeResponse:
    """Generate (with AI) a text proposal adapted for each network. Does NOT publish.

    The text is generated IN THE SAME LANGUAGE as the original content (detected
    automatically). Each network respects its character limit and its
    config (tone, hashtags). To regenerate just one, pass `regenerate_only`
    and an increasing `variation`.

    """
    networks = request.regenerate_only or request.networks
    if not networks:
        raise HTTPException(status_code=400, detail="Select at least one network.")

    source_lang = detect_lang(request.content or request.title)

    async def _one(net: str) -> tuple[str, dict[str, Any]]:
        client = SOCIAL_PUBLISHERS.get(net)
        char_limit = getattr(client, "char_limit", 280) if client else 280
        settings = _network_settings(net)
        data = await asyncio.to_thread(
            compose_one,
            network=net,
            char_limit=char_limit,
            content=request.content,
            title=request.title,
            url=request.url or "",
            source_lang=source_lang,
            tone=settings.get("tone", ""),
            hashtags_default=settings.get("hashtags", ""),
            hint=request.hint or "",
            variation=request.variation or 0,
        )
        return net, data

    results = await asyncio.gather(*[_one(n) for n in networks], return_exceptions=True)

    proposals: dict[str, Any] = {}
    provider = None
    for r in results:
        if isinstance(r, BaseException):
            log.error(f"compose error: {r}")
            continue
        net, data = r
        proposals[net] = data
        provider = provider or data.get("provider")

    if not proposals:
        raise HTTPException(
            status_code=502,
            detail="No proposal could be generated. Check the AI provider configuration.",
        )
    return ComposeResponse.model_validate(
        {"proposals": proposals, "source_lang": source_lang, "provider": provider}
    )


async def _load_source_row(
    source_page_id: str,
) -> tuple[RegistryData | None, RegistryData | None]:
    """(table, metadata) of the Vault source row, or (None, None).

    Lazy import of vault_routes to avoid the social↔vault cycle (same
    pattern as social_store)."""
    sid = (source_page_id or "").strip()
    if not sid:
        return None, None
    from backend.api import vault_routes as vr

    find_page_path = vr.find_page_path
    fp = await asyncio.to_thread(find_page_path, sid)
    if not fp or not fp.exists():
        return None, None
    raw = await asyncio.to_thread(fp.read_text, encoding="utf-8")
    parse_frontmatter = vr.parse_frontmatter
    metadata, _body = parse_frontmatter(raw, fp)
    get_table_id = vr.get_table_id
    table_by_id = vr._table_by_id
    table = table_by_id(get_table_id(metadata))
    return table, metadata


async def _check_publish_requires(source_page_id: str) -> None:
    """action_rules safeguard ("a draft cannot be published") on the
    source row. 409 with the reason; if the row can't be resolved, it passes through
    (publications without a Vault origin are not blocked)."""
    try:
        from backend.services import action_rules as ars

        table, metadata = await _load_source_row(source_page_id)
        if not table or metadata is None:
            return
        ok, reason = ars.check_requires(table, ars.ACTION_PUBLISH_SOCIAL, metadata)
    except HTTPException:
        raise
    except Exception as e:
        log.debug(f"publish_social: requires check saltat per a {source_page_id}: {e}")
        return
    if not ok:
        raise HTTPException(status_code=409, detail=reason)


async def _apply_publish_effect_to_source(
    source_page_id: str, background_tasks: BackgroundTasks
) -> None:
    """action_rules effect on success: the Vault ORIGIN row moves to
    "Published to Social Media" (decision §9.3 of the option-catalog directive)."""
    try:
        from backend.api import vault_routes as vr
        from backend.services import action_rules as ars

        table, metadata = await _load_source_row(source_page_id)
        if not table or metadata is None:
            return
        prop, value, changed = ars.status_effect(table, ars.ACTION_PUBLISH_SOCIAL, "source")
        if not prop or value is None:
            return
        if changed:
            ensure_options = cast(
                Callable[[Any, list[Any]], None], vr._ensure_status_options_persisted
            )
            ensure_options(table.get("id"), [value])
        if ars.read_prop_value(metadata, prop) == value:
            return
        key = ars.effect_write_key(metadata, prop)
        patch_page = cast(Callable[..., Any], vr.patch_page)
        page_patch_request = cast(Callable[..., Any], vr.PagePatchRequest)
        await patch_page(
            source_page_id,
            page_patch_request(metadata={key: value}),
            background_tasks,
        )
    except Exception as e:
        log.warning(
            "publish_social: could not update the source status %s: %s",
            source_page_id,
            e,
        )


async def _do_publish(
    posts: dict[str, dict[str, Any]],
    *,
    background_tasks: BackgroundTasks,
    source_page_id: str = "",
    source_title: str = "",
    save_record: bool = True,
    record_id: str | None = None,
) -> tuple[str | None, str, dict[str, Any]]:
    """Publish the final text to each network and persist the result.

    `posts`: {network: {"text": str, "media": list|None}}.
    Returns (record_id, final_status, results per network).

    """
    results: dict[str, Any] = {}
    for net, post in posts.items():
        client = SOCIAL_PUBLISHERS.get(net)
        text = post.get("text", "")
        media = post.get("media")
        if not client or not client.is_configured():
            results[net] = {"status": "error", "error": f"Xarxa '{net}' no configurada."}
            continue
        try:
            res = await client.publish(text, media=media)
            results[net] = {"status": "success", "url": res.get("url"), "id": res.get("id")}
        except Exception as e:
            log.error(f"publish error a {net}: {e}")
            results[net] = {"status": "error", "error": safe_error_detail(e)}

    successes = [r for r in results.values() if r.get("status") == "success"]
    errors = [r for r in results.values() if r.get("status") == "error"]
    if successes and errors:
        final = social_store.STATUS_PARTIAL
    elif successes:
        final = social_store.STATUS_PUBLISHED
    else:
        final = social_store.STATUS_ERROR

    rid = record_id
    if save_record:
        now = datetime.now().isoformat()
        if rid:
            await social_store.update_publication(
                rid,
                status=final,
                results=results,
                published_at=now,
                background_tasks=background_tasks,
            )
        else:
            proposals = {net: {"text": p.get("text", "")} for net, p in posts.items()}
            rid = await social_store.save_publication(
                networks=list(posts.keys()),
                proposals=proposals,
                status=final,
                source_page_id=source_page_id,
                source_title=source_title,
                background_tasks=background_tasks,
            )
            await social_store.update_publication(
                rid,
                status=final,
                results=results,
                published_at=now,
                background_tasks=background_tasks,
            )
    # Effect on the source row ONLY on full success: a publication
    # partial (some network failed) should not mark the row as published.
    if final == social_store.STATUS_PUBLISHED and source_page_id:
        await _apply_publish_effect_to_source(source_page_id, background_tasks)
    return rid, final, results


@router.post(
    "/publish",
    dependencies=[Depends(require_role("editor"))],
    response_model=PublicationResponse,
)
async def publish_posts(
    request: PublishRequest, background_tasks: BackgroundTasks
) -> PublicationResponse:
    """Publish a message (potentially different) per network and save the registry."""
    if not request.posts:
        raise HTTPException(status_code=400, detail="Cap publicació a enviar.")
    await _check_publish_requires(request.source_page_id or "")
    posts = {net: {"text": p.text, "media": p.media} for net, p in request.posts.items()}
    rid, final, results = await _do_publish(
        posts,
        source_page_id=request.source_page_id or "",
        source_title=request.source_title,
        save_record=request.save_record,
        background_tasks=background_tasks,
    )
    return PublicationResponse.model_validate(
        {"record_id": rid, "status": final, "results": results}
    )


@router.post(
    "/post",
    dependencies=[Depends(require_role("editor"))],
    response_model=PublicationResponse,
)
async def create_post(
    request: CreatePostRequest, background_tasks: BackgroundTasks
) -> PublicationResponse:
    """Compat: publishes the SAME text to multiple networks. For a per-network message,
    use /publish. (Previously returned 501 because it depended on n8n; now it publishes via
    the direct clients.)"""
    posts = {net: {"text": request.content, "media": None} for net in request.networks}
    rid, final, results = await _do_publish(posts, background_tasks=background_tasks)
    if final == social_store.STATUS_ERROR:
        raise HTTPException(status_code=502, detail=f"Publishing failed: {results}")
    return PublicationResponse.model_validate(
        {"record_id": rid, "status": final, "results": results}
    )


@router.post(
    "/schedule",
    dependencies=[Depends(require_role("editor"))],
    response_model=ScheduledPublicationResponse,
)
async def schedule_post(
    request: SchedulePublishRequest, background_tasks: BackgroundTasks
) -> ScheduledPublicationResponse:
    """Schedule a future publication (saved to the Vault table, not in memory)."""
    if request.scheduled_time <= datetime.now():
        raise HTTPException(status_code=400, detail="The scheduled time must be in the future.")
    if not request.posts:
        raise HTTPException(status_code=400, detail="Cap publicació a programar.")
    await _check_publish_requires(request.source_page_id or "")

    networks = list(request.posts.keys())
    proposals = {net: {"text": p.text} for net, p in request.posts.items()}
    rid = await social_store.save_publication(
        networks=networks,
        proposals=proposals,
        status=social_store.STATUS_SCHEDULED,
        scheduled_time=request.scheduled_time.isoformat(),
        source_page_id=request.source_page_id or "",
        source_title=request.source_title,
        background_tasks=background_tasks,
    )
    return ScheduledPublicationResponse(
        status="scheduled",
        id=rid,
        scheduled_time=request.scheduled_time.isoformat(),
        networks=networks,
    )


@router.get("/scheduled", response_model=list[ScheduledPostResponse])
async def get_scheduled_posts() -> list[ScheduledPostResponse]:
    """Returns all pending scheduled posts."""
    recs = await social_store.list_publications(status=social_store.STATUS_SCHEDULED)
    out = []
    for r in recs:
        out.append(
            {
                "id": r.get("id"),
                "content": _messages_preview(r),
                "networks": [
                    n.strip()
                    for n in (r.get(social_store.COL_NETWORKS) or "").split(",")
                    if n.strip()
                ],
                "scheduled_time": r.get(social_store.COL_SCHEDULED) or "",
                "status": "pending",
            }
        )
    return [ScheduledPostResponse.model_validate(item) for item in out]


@router.delete(
    "/scheduled/{post_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=CancelScheduledPostResponse,
)
async def cancel_scheduled_post(
    post_id: str, background_tasks: BackgroundTasks
) -> CancelScheduledPostResponse:
    """Cancel a scheduled post (marks the status as cancelled)."""
    recs = await social_store.list_publications(status=social_store.STATUS_SCHEDULED)
    if not any(r.get("id") == post_id for r in recs):
        raise HTTPException(status_code=404, detail=f"Scheduled post {post_id} not found")
    await social_store.update_publication(
        post_id,
        status=social_store.STATUS_CANCELLED,
        background_tasks=background_tasks,
    )
    return CancelScheduledPostResponse(status="cancelled", id=post_id)


@router.post(
    "/process-scheduled",
    dependencies=[Depends(require_role("editor"))],
    response_model=ProcessScheduledResponse,
)
async def process_scheduled_posts(
    background_tasks: BackgroundTasks,
) -> ProcessScheduledResponse:
    """Publish overdue scheduled posts. Called periodically by the scheduler."""
    now = datetime.now()
    pending = await social_store.list_publications(status=social_store.STATUS_SCHEDULED)
    processed = []
    for rec in pending:
        sched = rec.get(social_store.COL_SCHEDULED) or ""
        try:
            due = bool(sched) and datetime.fromisoformat(sched) <= now
        except Exception:
            due = False
        if not due:
            continue
        rid = rec.get("id")
        if not isinstance(rid, str):
            log.warning("Skipping scheduled publication without a string id")
            continue
        try:
            msgs = json.loads(rec.get(social_store.COL_MESSAGES) or "{}")
        except Exception:
            msgs = {}
        posts = {net: {"text": (d or {}).get("text", ""), "media": None} for net, d in msgs.items()}
        await social_store.update_publication(
            rid,
            status=social_store.STATUS_PUBLISHING,
            background_tasks=background_tasks,
        )
        _, final, results = await _do_publish(
            posts,
            save_record=True,
            record_id=rid,
            # Origin saved on the record: when publishing the scheduled item, the effect
            # of the status field reaches the Vault row anyway.
            source_page_id=rec.get(social_store.COL_ORIGIN) or "",
            background_tasks=background_tasks,
        )
        processed.append({"id": rid, "status": final, "results": results})
    return ProcessScheduledResponse.model_validate(
        {"processed": len(processed), "details": processed}
    )


@router.get("/history", response_model=list[PostHistoryResponse])
async def get_post_history() -> list[PostHistoryResponse]:
    """Returns the history of published posts (most recent first)."""
    recs = await social_store.list_publications()
    done_states = {
        social_store.STATUS_PUBLISHED,
        social_store.STATUS_PARTIAL,
        social_store.STATUS_ERROR,
    }
    hist: list[dict[str, Any]] = []
    for r in recs:
        if r.get(social_store.COL_STATUS) not in done_states:
            continue
        hist.append(
            {
                "id": r.get("id"),
                "content": _messages_preview(r),
                "networks": [
                    n.strip()
                    for n in (r.get(social_store.COL_NETWORKS) or "").split(",")
                    if n.strip()
                ],
                "published_at": r.get(social_store.COL_PUBLISHED) or "",
                "status": r.get(social_store.COL_STATUS),
            }
        )
    ordered = sorted(hist, key=lambda x: str(x["published_at"]), reverse=True)[:50]
    return [PostHistoryResponse.model_validate(item) for item in ordered]
