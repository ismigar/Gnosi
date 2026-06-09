"""
Social Network API Clients
Handles connections to Mastodon and Bluesky APIs for real feeds and interactions.
"""
import os
import httpx
import logging
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any

log = logging.getLogger(__name__)


class MastodonClient:
    """Client for Mastodon API."""

    network = "mastodon"
    char_limit = 500

    def __init__(self):
        self.instance = os.getenv("TEMENOS_MASTODON_INSTANCE", "https://mastodon.social")
        self.bearer = os.getenv("TEMENOS_MASTODON_BEARER", "")
        self.handle = os.getenv("TEMENOS_MASTODON_HANDLE", "")
        self.headers = {
            "Authorization": f"Bearer {self.bearer}",
            "Content-Type": "application/json"
        }
        # Headers SENSE Content-Type json per a pujades multipart (media).
        self.auth_headers = {"Authorization": f"Bearer {self.bearer}"}

    def is_configured(self) -> bool:
        """True si hi ha token per publicar/llegir."""
        return bool(self.bearer)
    
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

    async def _upload_media(self, media: Optional[list]) -> list:
        """Puja fitxers locals a Mastodon i retorna els media_ids.

        Cada element pot ser una ruta (str) o una tupla (ruta, alt_text).
        """
        media_ids: list = []
        for item in media or []:
            path = item[0] if isinstance(item, (list, tuple)) else item
            alt = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else None
            with open(path, "rb") as fh:
                content = fh.read()
            files = {"file": (os.path.basename(str(path)), content)}
            data = {"description": alt} if alt else {}
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self.instance}/api/v2/media",
                    headers=self.auth_headers,
                    files=files,
                    data=data,
                    timeout=60.0,
                )
                resp.raise_for_status()
                media_ids.append(resp.json()["id"])
        return media_ids

    async def post_status(self, status: str, media_ids: Optional[list] = None) -> Optional[Dict]:
        """Publish a new status (optionally with already-uploaded media)."""
        try:
            payload: Dict[str, Any] = {"status": status}
            if media_ids:
                payload["media_ids"] = media_ids
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.instance}/api/v1/statuses",
                    headers=self.headers,
                    json=payload,
                    timeout=15.0
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            log.error(f"Mastodon post error: {e}")
            if hasattr(e, 'response') and e.response:
                 log.error(f"Response body: {e.response.text}")
            raise

    async def publish(self, text: str, media: Optional[list] = None) -> Dict:
        """Interfície uniforme de publicació. Retorna {url, id}."""
        media_ids = await self._upload_media(media) if media else []
        result = await self.post_status(text, media_ids=media_ids) or {}
        return {"url": result.get("url"), "id": result.get("id")}


class BlueskyClient:
    """Client for Bluesky AT Protocol API."""

    network = "bluesky"
    char_limit = 300

    def __init__(self):
        self.handle = os.getenv("TEMENOS_BLUESKY_HANDLE", "")
        self.app_password = os.getenv("TEMENOS_BLUESKY_APP_PASSWORD", "")
        self.base_url = "https://bsky.social/xrpc"
        self.access_token = None
        self.did = None

    def is_configured(self) -> bool:
        """True si hi ha handle + app password per autenticar."""
        return bool(self.handle and self.app_password)
    
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
                            "createdAt": datetime.now(timezone.utc).isoformat()
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
                            "createdAt": datetime.now(timezone.utc).isoformat()
                        }
                    },
                    timeout=10.0
                )
                response.raise_for_status()
                return True
        except Exception as e:
            log.error(f"Bluesky repost error: {e}")
            return False

    async def _upload_blob(self, path: str) -> Dict:
        """Puja un fitxer com a blob i retorna l'objecte blob per a l'embed."""
        import mimetypes
        with open(path, "rb") as fh:
            content = fh.read()
        mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/com.atproto.repo.uploadBlob",
                headers={"Authorization": f"Bearer {self.access_token}", "Content-Type": mime},
                content=content,
                timeout=60.0,
            )
            resp.raise_for_status()
            return resp.json()["blob"]

    async def create_post(self, text: str, media: Optional[list] = None) -> Optional[Dict]:
        """Create a new post (optionally with images embedded)."""
        if not await self._authenticate():
             raise Exception("Failed to authenticate with Bluesky")

        record: Dict[str, Any] = {
            "$type": "app.bsky.feed.post",
            "text": text,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        if media:
            images = []
            for item in media:
                path = item[0] if isinstance(item, (list, tuple)) else item
                alt = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else ""
                blob = await self._upload_blob(path)
                images.append({"alt": alt or "", "image": blob})
            if images:
                record["embed"] = {"$type": "app.bsky.embed.images", "images": images}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/com.atproto.repo.createRecord",
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    json={
                        "repo": self.did,
                        "collection": "app.bsky.feed.post",
                        "record": record,
                    },
                    timeout=15.0
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            log.error(f"Bluesky create post error: {e}")
            raise

    async def publish(self, text: str, media: Optional[list] = None) -> Dict:
        """Interfície uniforme de publicació. Retorna {url, id}."""
        result = await self.create_post(text, media=media) or {}
        uri = result.get("uri", "")
        rkey = uri.split("/")[-1] if uri else ""
        url = f"https://bsky.app/profile/{self.handle}/post/{rkey}" if rkey else None
        return {"url": url, "id": uri}
    
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


class UnconfiguredPublisher:
    """Stub uniforme per a xarxes encara no implementades (Fase 1+).

    Apareixen al registry perquè la UI les pugui llistar i guiar la connexió,
    però `publish()` falla amb un missatge clar i `is_configured()` és False.
    """

    def __init__(self, network: str, char_limit: int = 280):
        self.network = network
        self.char_limit = char_limit

    def is_configured(self) -> bool:
        return False

    async def publish(self, text: str, media: Optional[list] = None) -> Dict:
        raise NotImplementedError(
            f"La xarxa '{self.network}' encara no està implementada (prevista en una fase posterior)."
        )


# Singleton instances
mastodon_client = MastodonClient()
bluesky_client = BlueskyClient()
linkedin_client = UnconfiguredPublisher("linkedin", 3000)
facebook_client = UnconfiguredPublisher("facebook", 63206)
instagram_client = UnconfiguredPublisher("instagram", 2200)
x_client = UnconfiguredPublisher("x", 280)

# Registry uniforme network → client. Tots exposen la mateixa interfície:
#   .network (str), .char_limit (int), .is_configured() -> bool,
#   async .publish(text, media) -> {url, id}
# Permet que /compose i /publish iterin sense `if` per xarxa.
SOCIAL_PUBLISHERS: Dict[str, Any] = {
    "mastodon": mastodon_client,
    "bluesky": bluesky_client,
    "linkedin": linkedin_client,
    "facebook": facebook_client,
    "instagram": instagram_client,
    "x": x_client,
}
