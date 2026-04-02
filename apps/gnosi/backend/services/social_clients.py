"""
Social Network API Clients
Handles connections to Mastodon and Bluesky APIs for real feeds and interactions.
"""
import os
import httpx
import logging
from datetime import datetime
from typing import List, Dict, Optional, Any

log = logging.getLogger(__name__)


class MastodonClient:
    """Client for Mastodon API."""
    
    def __init__(self):
        self.instance = os.getenv("TEMENOS_MASTODON_INSTANCE", "https://mastodon.social")
        self.bearer = os.getenv("TEMENOS_MASTODON_BEARER", "")
        self.handle = os.getenv("TEMENOS_MASTODON_HANDLE", "")
        self.headers = {
            "Authorization": f"Bearer {self.bearer}",
            "Content-Type": "application/json"
        }
    
    async def get_home_timeline(self, limit: int = 20) -> List[Dict]:
        """Get the home timeline feed. Fallback to trends if empty."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.instance}/api/v1/timelines/home",
                    headers=self.headers,
                    params={"limit": limit},
                    timeout=10.0
                )
                response.raise_for_status()
                data = response.json()
                
                if not data:
                    log.info("Mastodon home empty, fetching trends...")
                    return await self._get_trends(limit)
                    
                log.info(f"Mastodon response: {response.status_code}, items: {len(data)}")
                return self._transform_posts(data)
        except Exception as e:
            log.error(f"Mastodon timeline error: {e}")
            if hasattr(e, 'response') and e.response:
                 log.error(f"Response body: {e.response.text}")
            return []

    async def _get_trends(self, limit: int = 20) -> List[Dict]:
        """Get trending statuses as fallback."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.instance}/api/v1/trends/statuses",
                    headers=self.headers,
                    params={"limit": limit},
                    timeout=10.0
                )
                if response.status_code == 200:
                    return self._transform_posts(response.json())
                return []
        except Exception as e:
             log.error(f"Mastodon trends error: {e}")
             return []
    
    async def get_notifications(self, limit: int = 20) -> List[Dict]:
        """Get notifications (mentions, likes, boosts)."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.instance}/api/v1/notifications",
                    headers=self.headers,
                    params={"limit": limit},
                    timeout=10.0
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            log.error(f"Mastodon notifications error: {e}")
            return []
    
    async def favourite(self, status_id: str) -> bool:
        """Like a post."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.instance}/api/v1/statuses/{status_id}/favourite",
                    headers=self.headers,
                    timeout=10.0
                )
                response.raise_for_status()
                return True
        except Exception as e:
            log.error(f"Mastodon favourite error: {e}")
            return False
    
    async def unfavourite(self, status_id: str) -> bool:
        """Unlike a post."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.instance}/api/v1/statuses/{status_id}/unfavourite",
                    headers=self.headers,
                    timeout=10.0
                )
                response.raise_for_status()
                return True
        except Exception as e:
            log.error(f"Mastodon unfavourite error: {e}")
            return False
    
    async def reblog(self, status_id: str) -> bool:
        """Boost/reblog a post."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.instance}/api/v1/statuses/{status_id}/reblog",
                    headers=self.headers,
                    timeout=10.0
                )
                response.raise_for_status()
                return True
        except Exception as e:
            log.error(f"Mastodon reblog error: {e}")
            return False
    
    async def unreblog(self, status_id: str) -> bool:
        """Remove a boost/reblog."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.instance}/api/v1/statuses/{status_id}/unreblog",
                    headers=self.headers,
                    timeout=10.0
                )
                response.raise_for_status()
                return True
        except Exception as e:
            log.error(f"Mastodon unreblog error: {e}")
            return False
    
    def _transform_posts(self, posts: List[Dict]) -> List[Dict]:
        """Transform Mastodon posts to our unified format."""
        transformed = []
        for post in posts:
            # Handle reblogged posts
            actual_post = post.get("reblog") or post
            account = actual_post.get("account", {})
            
            transformed.append({
                "id": post["id"],
                "network": "mastodon",
                "author": account.get("display_name", account.get("username", "Unknown")),
                "handle": f"@{account.get('acct', '')}",
                "content": actual_post.get("content", ""),
                "timestamp": post.get("created_at", ""),
                "avatar": account.get("avatar", None),
                "is_reblog": "reblog" in post and post["reblog"] is not None,
                "reblog_by": post.get("account", {}).get("display_name") if post.get("reblog") else None,
                "favourited": actual_post.get("favourited", False),
                "reblogged": actual_post.get("reblogged", False),
                "favourites_count": actual_post.get("favourites_count", 0),
                "reblogs_count": actual_post.get("reblogs_count", 0),
                "replies_count": actual_post.get("replies_count", 0),
                "media_attachments": actual_post.get("media_attachments", []),
                "url": actual_post.get("url", "")
            })
        return transformed

    async def post_status(self, status: str) -> Optional[Dict]:
        """Publish a new status."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.instance}/api/v1/statuses",
                    headers=self.headers,
                    json={"status": status},
                    timeout=10.0
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            log.error(f"Mastodon post error: {e}")
            if hasattr(e, 'response') and e.response:
                 log.error(f"Response body: {e.response.text}")
            raise e


class BlueskyClient:
    """Client for Bluesky AT Protocol API."""
    
    def __init__(self):
        self.handle = os.getenv("TEMENOS_BLUESKY_HANDLE", "")
        self.app_password = os.getenv("TEMENOS_BLUESKY_APP_PASSWORD", "")
        self.base_url = "https://bsky.social/xrpc"
        self.access_token = None
        self.did = None
    
    async def _authenticate(self) -> bool:
        """Authenticate with Bluesky and get access token."""
        if self.access_token:
            return True
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/com.atproto.server.createSession",
                    json={
                        "identifier": self.handle,
                        "password": self.app_password
                    },
                    timeout=10.0
                )
                response.raise_for_status()
                data = response.json()
                self.access_token = data.get("accessJwt")
                self.did = data.get("did")
                return True
        except Exception as e:
            log.error(f"Bluesky auth error: {e}")
            return False
    
    async def get_timeline(self, limit: int = 20) -> List[Dict]:
        """Get the home timeline feed. Fallback to 'Whats Hot' if empty."""
        if not await self._authenticate():
            return []
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/app.bsky.feed.getTimeline",
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    params={"limit": limit},
                    timeout=10.0
                )
                response.raise_for_status()
                data = response.json().get("feed", [])
                
                if not data:
                    log.info("Bluesky timeline empty, fetching Whats Hot...")
                    return await self._get_whats_hot(limit)
                    
                return self._transform_posts(data)
        except Exception as e:
            log.error(f"Bluesky timeline error: {e}")
            return []

    async def _get_whats_hot(self, limit: int = 20) -> List[Dict]:
        """Get What's Hot feed as fallback."""
        feed_uri = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot"
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/app.bsky.feed.getFeed",
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    params={"feed": feed_uri, "limit": limit},
                    timeout=10.0
                )
                if response.status_code == 200:
                    return self._transform_posts(response.json().get("feed", []))
                return []
        except Exception as e:
            log.error(f"Bluesky whats hot error: {e}")
            return []
    
    async def like(self, uri: str, cid: str) -> bool:
        """Like a post."""
        if not await self._authenticate():
            return False
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/com.atproto.repo.createRecord",
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    json={
                        "repo": self.did,
                        "collection": "app.bsky.feed.like",
                        "record": {
                            "$type": "app.bsky.feed.like",
                            "subject": {"uri": uri, "cid": cid},
                            "createdAt": datetime.utcnow().isoformat() + "Z"
                        }
                    },
                    timeout=10.0
                )
                response.raise_for_status()
                return True
        except Exception as e:
            log.error(f"Bluesky like error: {e}")
            return False
    
    async def repost(self, uri: str, cid: str) -> bool:
        """Repost a post."""
        if not await self._authenticate():
            return False
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/com.atproto.repo.createRecord",
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    json={
                        "repo": self.did,
                        "collection": "app.bsky.feed.repost",
                        "record": {
                            "$type": "app.bsky.feed.repost",
                            "subject": {"uri": uri, "cid": cid},
                            "createdAt": datetime.utcnow().isoformat() + "Z"
                        }
                    },
                    timeout=10.0
                )
                response.raise_for_status()
                return True
        except Exception as e:
            log.error(f"Bluesky repost error: {e}")
            return False

    async def create_post(self, text: str) -> Optional[Dict]:
        """Create a new post."""
        if not await self._authenticate():
             raise Exception("Failed to authenticate with Bluesky")
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/com.atproto.repo.createRecord",
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    json={
                        "repo": self.did,
                        "collection": "app.bsky.feed.post",
                        "record": {
                            "$type": "app.bsky.feed.post",
                            "text": text,
                            "createdAt": datetime.utcnow().isoformat() + "Z"
                        }
                    },
                    timeout=10.0
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            log.error(f"Bluesky create post error: {e}")
            raise e
    
    def _transform_posts(self, feed: List[Dict]) -> List[Dict]:
        """Transform Bluesky posts to our unified format."""
        transformed = []
        for item in feed:
            post = item.get("post", {})
            author = post.get("author", {})
            record = post.get("record", {})
            
            # Check if it's a repost
            reason = item.get("reason")
            is_repost = reason and reason.get("$type") == "app.bsky.feed.defs#reasonRepost"
            repost_by = reason.get("by", {}).get("displayName") if is_repost else None
            
            transformed.append({
                "id": post.get("uri", ""),
                "cid": post.get("cid", ""),
                "network": "bluesky",
                "author": author.get("displayName", author.get("handle", "Unknown")),
                "handle": f"@{author.get('handle', '')}",
                "content": record.get("text", ""),
                "timestamp": record.get("createdAt", ""),
                "avatar": author.get("avatar", None),
                "is_reblog": is_repost,
                "reblog_by": repost_by,
                "favourited": post.get("viewer", {}).get("like") is not None,
                "reblogged": post.get("viewer", {}).get("repost") is not None,
                "favourites_count": post.get("likeCount", 0),
                "reblogs_count": post.get("repostCount", 0),
                "replies_count": post.get("replyCount", 0),
                "media_attachments": [],  # TODO: Parse embed images
                "url": f"https://bsky.app/profile/{author.get('handle')}/post/{post.get('uri', '').split('/')[-1]}"
            })
        return transformed


# Singleton instances
mastodon_client = MastodonClient()
bluesky_client = BlueskyClient()
