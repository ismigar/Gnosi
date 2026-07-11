from fastapi import APIRouter, Body, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
import html
import re
import json
import asyncio
import copy

from backend.services.social_clients import (
    mastodon_client, bluesky_client, SOCIAL_PUBLISHERS,
)
from backend.services import social_store
from backend.services.social_compose import compose_one, detect_lang
from backend.services.integration_manager import integration_manager
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail

log = logging.getLogger(__name__)

DEFAULT_STREAMS = [
    {"id": "mastodon-home", "title": "Mastodon Home", "icon": "🐘", "network": "mastodon"},
    {"id": "bluesky-home", "title": "Bluesky Home", "icon": "🦋", "network": "bluesky"},
    {"id": "scheduled", "title": "Programats", "icon": "📅", "network": "scheduled"},
]

DEFAULT_NETWORKS = [
    {"id": "mastodon", "name": "Mastodon", "icon": "🐘", "enabled": True},
    {"id": "bluesky",  "name": "Bluesky",  "icon": "🦋", "enabled": True},
    {"id": "linkedin", "name": "LinkedIn", "icon": "💼", "enabled": True},
    {"id": "facebook", "name": "Facebook", "icon": "📘", "enabled": False},
    {"id": "telegram", "name": "Telegram", "icon": "✈️", "enabled": False},
]

router = APIRouter()

# --- Models ---
class SocialPost(BaseModel):
    id: str
    network: str
    author: str
    handle: str
    content: str
    timestamp: str
    avatar: Optional[str] = None
    is_reblog: bool = False
    reblog_by: Optional[str] = None
    favourited: bool = False
    reblogged: bool = False
    favourites_count: int = 0
    reblogs_count: int = 0
    replies_count: int = 0
    url: Optional[str] = None
    cid: Optional[str] = None  # For Bluesky

class CreatePostRequest(BaseModel):
    content: str
    networks: List[str]

class NetworkPost(BaseModel):
    text: str
    # List of local paths or (path, alt_text) to attach media.
    media: Optional[List[Any]] = None

class ComposeRequest(BaseModel):
    networks: List[str]
    content: str = ""
    title: str = ""
    url: str = ""
    source_page_id: Optional[str] = None
    hint: str = ""
    # If passed, only these networks are regenerated (subset of `networks`).
    regenerate_only: Optional[List[str]] = None
    # Increment to force a different proposal (bypasses the AI cache keyed by hash).
    variation: int = 0

class PublishRequest(BaseModel):
    posts: Dict[str, NetworkPost]
    source_page_id: Optional[str] = None
    source_title: str = ""
    save_record: bool = True

class SchedulePublishRequest(BaseModel):
    posts: Dict[str, NetworkPost]
    scheduled_time: datetime
    source_page_id: Optional[str] = None
    source_title: str = ""

class Stream(BaseModel):
    id: str
    title: str
    icon: str
    network: str

class InteractionRequest(BaseModel):
    post_id: str
    network: str
    action: str  # like, unlike, reblog, unreblog
    cid: Optional[str] = None  # For Bluesky

# --- Helper Functions ---
def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<p>', '', text)
    text = re.sub(r'</p>', '\n\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    return text.strip()


def _network_settings(network: str) -> dict:
    """Config per-xarxa (to, hashtags, etc.) desada a integrations.json."""
    config = integration_manager._load()
    for n in config.get("social_networks", DEFAULT_NETWORKS):
        if n.get("id") == network:
            return n
    return {}


# --- Endpoints ---

@router.get("/streams", response_model=List[Stream])
async def get_streams():
    """Returns the user-configured streams/columns."""
    config = integration_manager._load()
    return config.get("social_streams", DEFAULT_STREAMS)


@router.put("/streams", dependencies=[Depends(require_role("editor"))])
async def update_streams(payload: List[dict] = Body(...)):
    """Saves the user's stream configuration."""
    integration_manager.replace_key("social_streams", payload)
    return {"status": "ok"}


@router.get("/networks")
async def get_networks():
    """Returns the user-configured social networks, with live config status."""
    config = integration_manager._load()
    # deepcopy: `_load()` caches and returns the shared object (and DEFAULT_NETWORKS is
    # a module-level constant). Enriching in place would mutate state shared across requests.
    networks = copy.deepcopy(config.get("social_networks", DEFAULT_NETWORKS))
    # Enrich with the client's actual state (configured or not) and the char limit.
    for n in networks:
        client = SOCIAL_PUBLISHERS.get(n.get("id"))
        if client is not None:
            try:
                n["configured"] = bool(client.is_configured())
            except Exception:
                n["configured"] = False
            n["char_limit"] = getattr(client, "char_limit", 280)
            n["implemented"] = not isinstance(client, social_store_unconfigured_types())
    return networks


def social_store_unconfigured_types():
    """Stub client type (networks not yet implemented)."""
    from backend.services.social_clients import UnconfiguredPublisher
    return (UnconfiguredPublisher,)


@router.put("/networks", dependencies=[Depends(require_role("editor"))])
async def update_networks(payload: List[dict] = Body(...)):
    """Saves the enabled/disabled state and per-network settings."""
    integration_manager.replace_key("social_networks", payload)
    return {"status": "ok"}


@router.get("/feed/{stream_id}")
async def get_feed(stream_id: str, limit: int = 20):
    """Returns posts for a specific stream."""

    if stream_id == "mastodon-home":
        posts = await mastodon_client.get_home_timeline(limit=limit)
        for post in posts:
            post["content"] = strip_html(post.get("content", ""))
        if not posts and not mastodon_client.bearer:
            return [{
                "id": "mastodon-setup",
                "network": "mastodon",
                "author": "🚀 Mastodon Setup",
                "handle": "@guide",
                "content": "You haven't configured the Mastodon token yet.\n\n1. Go to Development\n2. Create an App with 'read' and 'write' permissions\n3. Copy the token to .env_shared",
                "timestamp": datetime.now().isoformat(),
                "avatar": None,
                "favourited": False,
                "reblogged": False,
                "favourites_count": 0,
                "reblogs_count": 0,
                "replies_count": 0,
                "is_reblog": False,
                "url": "https://mastodon.social/settings/applications"
            }]
        return posts

    elif stream_id == "bluesky-home":
        posts = await bluesky_client.get_timeline(limit=limit)
        if not posts and not bluesky_client.app_password:
            return [{
                "id": "bluesky-setup",
                "network": "bluesky",
                "author": "🚀 Bluesky Setup",
                "handle": "@guide",
                "content": "You haven't configured the Bluesky App Password yet.\n\n1. Go to Settings -> App Passwords\n2. Create a new one\n3. Update the .env_shared file",
                "timestamp": datetime.now().isoformat(),
                "avatar": None,
                "favourited": False,
                "reblogged": False,
                "favourites_count": 0,
                "reblogs_count": 0,
                "replies_count": 0,
                "is_reblog": False,
                "url": "https://bsky.app/settings/app-passwords"
            }]
        return posts

    elif stream_id == "scheduled":
        recs = await social_store.list_publications(status=social_store.STATUS_SCHEDULED)
        items = []
        for r in recs:
            sched = r.get(social_store.COL_SCHEDULED) or ""
            networks = [n.strip() for n in (r.get(social_store.COL_NETWORKS) or "").split(",") if n.strip()]
            content_preview = _messages_preview(r)
            items.append({
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
            })
        return items

    elif stream_id.startswith(("facebook", "linkedin", "telegram", "instagram", "x")):
        network = stream_id.split("-")[0]
        recs = await social_store.list_publications()
        my_posts = [
            r for r in recs
            if network in [n.strip() for n in (r.get(social_store.COL_NETWORKS) or "").split(",")]
        ]
        if not my_posts:
            network_name = network.capitalize()
            return [{
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
                "url": None
            }]
        feed_items = []
        for r in my_posts:
            feed_items.append({
                "id": r.get("id"),
                "network": network,
                "author": "You",
                "handle": "@me",
                "content": _messages_preview(r, network=network),
                "timestamp": r.get(social_store.COL_PUBLISHED) or r.get(social_store.COL_SCHEDULED) or "",
                "avatar": None,
                "favourited": False,
                "reblogged": False,
                "favourites_count": 0,
                "reblogs_count": 0,
                "replies_count": 0,
                "is_reblog": False,
                "url": _messages_url(r, network),
            })
        return feed_items

    return []


def _messages_preview(rec: dict, network: Optional[str] = None) -> str:
    """Extracts readable text from a record's Missatges field."""
    try:
        msgs = json.loads(rec.get(social_store.COL_MESSAGES) or "{}")
    except Exception:
        return ""
    if network and network in msgs:
        return (msgs[network] or {}).get("text", "")
    return "\n---\n".join((d or {}).get("text", "") for d in msgs.values())


def _messages_url(rec: dict, network: str) -> Optional[str]:
    try:
        msgs = json.loads(rec.get(social_store.COL_MESSAGES) or "{}")
        return (msgs.get(network) or {}).get("url")
    except Exception:
        return None


_VALID_NETWORKS = {"mastodon", "bluesky"}
_VALID_ACTIONS = {
    "mastodon": {"like", "unlike", "reblog", "unreblog"},
    "bluesky": {"like", "reblog"},
}


@router.post("/interact", dependencies=[Depends(require_role("editor"))])
async def interact_with_post(request: InteractionRequest):
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
        raise HTTPException(status_code=502, detail=f"Failed to {request.action} post on {request.network}")

    return {"status": "success", "action": request.action, "post_id": request.post_id}


@router.post("/compose", dependencies=[Depends(require_role("editor"))])
async def compose_posts(request: ComposeRequest):
    """Generate (with AI) a text proposal adapted for each network. Does NOT publish.

    The text is generated IN THE SAME LANGUAGE as the original content (detected
    automatically). Each network respects its character limit and its
    config (tone, hashtags). To regenerate just one, pass `regenerate_only`
    and an increasing `variation`.
    
    """
    networks = request.regenerate_only or request.networks
    if not networks:
        raise HTTPException(status_code=400, detail="Cal triar almenys una xarxa.")

    source_lang = detect_lang(request.content or request.title)

    async def _one(net: str):
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

    proposals: Dict[str, Any] = {}
    provider = None
    for r in results:
        if isinstance(r, Exception):
            log.error(f"compose error: {r}")
            continue
        net, data = r
        proposals[net] = data
        provider = provider or data.get("provider")

    if not proposals:
        raise HTTPException(
            status_code=502,
            detail="No s'ha pogut generar cap proposta. Revisa la configuració del proveïdor d'IA.",
        )
    return {"proposals": proposals, "source_lang": source_lang, "provider": provider}


async def _load_source_row(source_page_id: str):
    """(table, metadata) of the Vault source row, or (None, None).

    Lazy import of vault_routes to avoid the social↔vault cycle (same
    pattern as social_store)."""
    sid = (source_page_id or "").strip()
    if not sid:
        return None, None
    from backend.api import vault_routes as vr

    fp = await asyncio.to_thread(vr.find_page_path, sid)
    if not fp or not fp.exists():
        return None, None
    raw = await asyncio.to_thread(fp.read_text, encoding="utf-8")
    metadata, _body = vr.parse_frontmatter(raw, fp)
    table = vr._table_by_id(vr.get_table_id(metadata))
    return table, metadata


async def _check_publish_requires(source_page_id: str) -> None:
    """action_rules safeguard ("a draft cannot be published") on the
    source row. 409 with the reason; if the row can't be resolved, it passes through
    (publications without a Vault origin are not blocked)."""
    try:
        from backend.services import action_rules as ars

        table, metadata = await _load_source_row(source_page_id)
        if not table:
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
        if not table:
            return
        prop, value, changed = ars.status_effect(
            table, ars.ACTION_PUBLISH_SOCIAL, "source"
        )
        if not prop or value is None:
            return
        if changed:
            vr._ensure_status_options_persisted(table.get("id"), [value])
        if ars.read_prop_value(metadata, prop) == value:
            return
        key = ars.effect_write_key(metadata, prop)
        await vr.patch_page(
            source_page_id,
            vr.PagePatchRequest(metadata={key: value}),
            background_tasks,
        )
    except Exception as e:
        log.warning(
            f"publish_social: no s'ha pogut actualitzar l'Estat de l'origen {source_page_id}: {e}"
        )


async def _do_publish(
    posts: Dict[str, dict],
    *,
    background_tasks: BackgroundTasks,
    source_page_id: str = "",
    source_title: str = "",
    save_record: bool = True,
    record_id: Optional[str] = None,
):
    """Publish the final text to each network and persist the result.

    `posts`: {network: {"text": str, "media": list|None}}.
    Returns (record_id, final_status, results per network).
    
    """
    results: Dict[str, Any] = {}
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
                rid, status=final, results=results, published_at=now,
                background_tasks=background_tasks,
            )
        else:
            proposals = {net: {"text": p.get("text", "")} for net, p in posts.items()}
            rid = await social_store.save_publication(
                networks=list(posts.keys()), proposals=proposals, status=final,
                source_page_id=source_page_id, source_title=source_title,
                background_tasks=background_tasks,
            )
            await social_store.update_publication(
                rid, status=final, results=results, published_at=now,
                background_tasks=background_tasks,
            )
    # Effect on the source row ONLY on full success: a publication
    # partial (some network failed) should not mark the row as published.
    if final == social_store.STATUS_PUBLISHED and source_page_id:
        await _apply_publish_effect_to_source(source_page_id, background_tasks)
    return rid, final, results


@router.post("/publish", dependencies=[Depends(require_role("editor"))])
async def publish_posts(request: PublishRequest, background_tasks: BackgroundTasks):
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
    return {"record_id": rid, "status": final, "results": results}


@router.post("/post", dependencies=[Depends(require_role("editor"))])
async def create_post(request: CreatePostRequest, background_tasks: BackgroundTasks):
    """Compat: publishes the SAME text to multiple networks. For a per-network message,
    use /publish. (Previously returned 501 because it depended on n8n; now it publishes via
    the direct clients.)"""
    posts = {net: {"text": request.content, "media": None} for net in request.networks}
    rid, final, results = await _do_publish(posts, background_tasks=background_tasks)
    if final == social_store.STATUS_ERROR:
        raise HTTPException(status_code=502, detail=f"No s'ha pogut publicar: {results}")
    return {"record_id": rid, "status": final, "results": results}


@router.post("/schedule", dependencies=[Depends(require_role("editor"))])
async def schedule_post(request: SchedulePublishRequest, background_tasks: BackgroundTasks):
    """Schedule a future publication (saved to the Vault table, not in memory)."""
    if request.scheduled_time <= datetime.now():
        raise HTTPException(status_code=400, detail="L'hora programada ha de ser futura.")
    if not request.posts:
        raise HTTPException(status_code=400, detail="Cap publicació a programar.")
    await _check_publish_requires(request.source_page_id or "")

    networks = list(request.posts.keys())
    proposals = {net: {"text": p.text} for net, p in request.posts.items()}
    rid = await social_store.save_publication(
        networks=networks, proposals=proposals,
        status=social_store.STATUS_SCHEDULED,
        scheduled_time=request.scheduled_time.isoformat(),
        source_page_id=request.source_page_id or "",
        source_title=request.source_title,
        background_tasks=background_tasks,
    )
    return {
        "status": "scheduled",
        "id": rid,
        "scheduled_time": request.scheduled_time.isoformat(),
        "networks": networks,
    }


@router.get("/scheduled")
async def get_scheduled_posts():
    """Returns all pending scheduled posts."""
    recs = await social_store.list_publications(status=social_store.STATUS_SCHEDULED)
    out = []
    for r in recs:
        out.append({
            "id": r.get("id"),
            "content": _messages_preview(r),
            "networks": [n.strip() for n in (r.get(social_store.COL_NETWORKS) or "").split(",") if n.strip()],
            "scheduled_time": r.get(social_store.COL_SCHEDULED) or "",
            "status": "pending",
        })
    return out


@router.delete("/scheduled/{post_id}", dependencies=[Depends(require_role("editor"))])
async def cancel_scheduled_post(post_id: str, background_tasks: BackgroundTasks):
    """Cancel a scheduled post (marks the status as cancelled)."""
    recs = await social_store.list_publications(status=social_store.STATUS_SCHEDULED)
    if not any(r.get("id") == post_id for r in recs):
        raise HTTPException(status_code=404, detail=f"Scheduled post {post_id} not found")
    await social_store.update_publication(
        post_id, status=social_store.STATUS_CANCELLED, background_tasks=background_tasks,
    )
    return {"status": "cancelled", "id": post_id}


@router.post("/process-scheduled", dependencies=[Depends(require_role("editor"))])
async def process_scheduled_posts(background_tasks: BackgroundTasks):
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
        try:
            msgs = json.loads(rec.get(social_store.COL_MESSAGES) or "{}")
        except Exception:
            msgs = {}
        posts = {net: {"text": (d or {}).get("text", ""), "media": None} for net, d in msgs.items()}
        await social_store.update_publication(
            rid, status=social_store.STATUS_PUBLISHING, background_tasks=background_tasks,
        )
        _, final, results = await _do_publish(
            posts, save_record=True, record_id=rid,
            # Origin saved on the record: when publishing the scheduled item, the effect
            # of Estat reaches the Vault row anyway.
            source_page_id=rec.get(social_store.COL_ORIGIN) or "",
            background_tasks=background_tasks,
        )
        processed.append({"id": rid, "status": final, "results": results})
    return {"processed": len(processed), "details": processed}


@router.get("/history")
async def get_post_history():
    """Returns the history of published posts (most recent first)."""
    recs = await social_store.list_publications()
    done_states = {
        social_store.STATUS_PUBLISHED, social_store.STATUS_PARTIAL, social_store.STATUS_ERROR,
    }
    hist = []
    for r in recs:
        if r.get(social_store.COL_STATUS) not in done_states:
            continue
        hist.append({
            "id": r.get("id"),
            "content": _messages_preview(r),
            "networks": [n.strip() for n in (r.get(social_store.COL_NETWORKS) or "").split(",") if n.strip()],
            "published_at": r.get(social_store.COL_PUBLISHED) or "",
            "status": r.get(social_store.COL_STATUS),
        })
    return sorted(hist, key=lambda x: x["published_at"], reverse=True)[:50]
