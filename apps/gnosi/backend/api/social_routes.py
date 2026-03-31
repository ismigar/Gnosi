from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import httpx
import logging
import uuid
import html
import re

from backend.services.social_clients import mastodon_client, bluesky_client

log = logging.getLogger(__name__)

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

class SchedulePostRequest(BaseModel):
    content: str
    networks: List[str]
    scheduled_time: datetime

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

# --- In-Memory Storage ---
SCHEDULED_POSTS: List[dict] = []
POST_HISTORY: List[dict] = []

# --- Helper Functions ---
def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<p>', '', text)
    text = re.sub(r'</p>', '\n\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    return text.strip()

# --- Endpoints ---

@router.get("/streams", response_model=List[Stream])
async def get_streams():
    """Returns the configured streams/columns."""
    return [
        {"id": "mastodon-home", "title": "Mastodon Home", "icon": "🐘", "network": "mastodon"},
        {"id": "bluesky-home", "title": "Bluesky Home", "icon": "🦋", "network": "bluesky"},
        {"id": "scheduled", "title": "Scheduled", "icon": "📅", "network": "scheduled"},
    ]

@router.get("/feed/{stream_id}")
async def get_feed(stream_id: str, limit: int = 20):
    """Returns posts for a specific stream."""
    
    if stream_id == "mastodon-home":
        # We'll use a specific way to detect errors vs empty lists
        # For now, let's just trust the client won't return None on success
        posts = await mastodon_client.get_home_timeline(limit=limit)
        
        # Clean HTML from Mastodon posts
        for post in posts:
            post["content"] = strip_html(post.get("content", ""))
        
        # Only show error if we suspect an auth/connection issue
        # (The client returns [] on exception)
        # If the user has a token but 0 posts, we should probably show a "Empty" message
        # But for now, let's only show the setup guide if the token is missing or explicitly failed
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
        # Return scheduled posts
        return [
            {
                "id": p["id"],
                "network": "scheduled",
                "author": "You",
                "handle": "@scheduled",
                "content": f"📅 {p['scheduled_time'][:16]}\n\n{p['content']}\n\n→ {', '.join(p['networks'])}",
                "timestamp": p["created_at"],
                "avatar": None,
                "favourited": False,
                "reblogged": False,
                "favourites_count": 0,
                "reblogs_count": 0,
                "replies_count": 0,
                "is_reblog": False,
                "url": None
            }
            for p in SCHEDULED_POSTS if p["status"] == "pending"
        ]
    
    elif stream_id.startswith(("facebook", "linkedin", "telegram")):
        network = stream_id.split("-")[0]
        
        # Filter global POST_HISTORY for posts that included this network
        # POST_HISTORY structure: { "id", "content", "networks": [], "published_at", ... }
        
        my_posts = [
            p for p in reversed(POST_HISTORY) 
            if network in p.get("networks", [])
        ]
        
        if not my_posts:
            # Show "Empty History" system message
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
            
        # Transform history to feed format
        feed_items = []
        for p in my_posts:
            # We assume current user is the author
            feed_items.append({
                "id": p["id"],
                "network": network,
                "author": "You",
                "handle": "@me",
                "content": p["content"],
                "timestamp": p["published_at"],
                "avatar": None, # Could add a static user avatar here
                "favourited": False,
                "reblogged": False,
                "favourites_count": 0,
                "reblogs_count": 0,
                "replies_count": 0,
                "is_reblog": False,
                "url": None
            })
            
        return feed_items

    return []


@router.post("/interact")
async def interact_with_post(request: InteractionRequest):
    """Perform an interaction (like, reblog) on a post."""
    
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
        raise HTTPException(status_code=500, detail=f"Failed to {request.action} post")
    
    return {"status": "success", "action": request.action, "post_id": request.post_id}


@router.post("/post")
async def create_post(request: CreatePostRequest):
    """Publishes a post to selected networks via n8n webhook."""
    
    N8N_WEBHOOK_URL = "http://host.docker.internal:5678/webhook/social-post-v2"
    
    payload = {
        "content": request.content,
        "networks": request.networks,
        "timestamp": datetime.now().isoformat()
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(N8N_WEBHOOK_URL, json=payload, timeout=10.0)
            response.raise_for_status()
        
        POST_HISTORY.append({
            "id": str(uuid.uuid4()),
            "content": request.content,
            "networks": request.networks,
            "published_at": datetime.now().isoformat(),
            "status": "success"
        })
            
        log.info(f"Successfully sent post to n8n: {response.status_code}")
        return {"status": "success", "published_to": request.networks}
        
    except httpx.HTTPError as e:
        log.error(f"Failed to call n8n webhook: {e}")
        POST_HISTORY.append({
            "id": str(uuid.uuid4()),
            "content": request.content,
            "networks": request.networks,
            "published_at": datetime.now().isoformat(),
            "status": "failed",
            "error": str(e)
        })
        raise HTTPException(status_code=502, detail=f"Failed to reach social automation service: {str(e)}")


@router.post("/schedule")
async def schedule_post(request: SchedulePostRequest):
    """Schedule a post for future publication."""
    
    if request.scheduled_time <= datetime.now():
        raise HTTPException(status_code=400, detail="Scheduled time must be in the future")
    
    post_id = str(uuid.uuid4())
    scheduled_post = {
        "id": post_id,
        "content": request.content,
        "networks": request.networks,
        "scheduled_time": request.scheduled_time.isoformat(),
        "created_at": datetime.now().isoformat(),
        "status": "pending"
    }
    
    SCHEDULED_POSTS.append(scheduled_post)
    log.info(f"Scheduled post {post_id} for {request.scheduled_time}")
    
    return {
        "status": "scheduled",
        "id": post_id,
        "scheduled_time": request.scheduled_time.isoformat(),
        "networks": request.networks
    }


@router.get("/scheduled")
async def get_scheduled_posts():
    """Returns all scheduled posts."""
    return [p for p in SCHEDULED_POSTS if p["status"] == "pending"]


@router.delete("/scheduled/{post_id}")
async def cancel_scheduled_post(post_id: str):
    """Cancel a scheduled post."""
    for post in SCHEDULED_POSTS:
        if post["id"] == post_id:
            post["status"] = "cancelled"
            return {"status": "cancelled", "id": post_id}
    
@router.post("/process-scheduled")
async def process_scheduled_posts():
    """Check for due posts and publish them."""
    now = datetime.now()
    processed = []
    
    for post in SCHEDULED_POSTS:
        if post["status"] == "pending" and datetime.fromisoformat(post["scheduled_time"]) <= now:
            # Publish to each network
            results = {}
            for network in post["networks"]:
                try:
                    if network == "mastodon":
                        # TODO: Implement create_post in MastodonClient
                        # For now, using a placeholder if client doesn't have it, 
                        # but we need to implement it to make this work.
                        # Assuming mastodon_client.post_status exists or we add it.
                        await mastodon_client.post_status(post["content"])
                        results[network] = "success"
                    elif network == "bluesky":
                        await bluesky_client.create_post(post["content"])
                        results[network] = "success"
                except Exception as e:
                    log.error(f"Failed to publish scheduled post {post['id']} to {network}: {e}")
                    results[network] = f"error: {str(e)}"
            
            # Update status
            # If at least one succeeded, mark as success (or partial)
            # For simplicity, if no errors, success.
            if any(str(r).startswith("error") for r in results.values()):
                 post["status"] = "failed"
                 post["error"] = str(results)
            else:
                post["status"] = "success"
                post["published_at"] = now.isoformat()
            
            # Add to history
            POST_HISTORY.append({
                "id": post["id"],
                "content": post["content"],
                "networks": post["networks"],
                "published_at": now.isoformat(),
                "status": post["status"],
                "results": results
            })
            
            processed.append({"id": post["id"], "results": results})
            
    return {"processed": len(processed), "details": processed}


@router.get("/history")
async def get_post_history():
    """Returns the history of published posts."""
    return sorted(POST_HISTORY, key=lambda x: x["published_at"], reverse=True)[:50]
