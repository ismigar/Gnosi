"""Real-time collaboration — presence + per-page message relay.

Skeleton (Route B: central server as relay). This module implements the
**channel** for collaboration, not yet the full CRDT document:

  - **Presence**: who's viewing/editing a page right now. The client
    receives a `{type: "presence", users: [...]}` message every time someone
    joins or leaves → the UI shows "X is editing".
  - **Relay**: any other message (cursor, selection, and — in the future —
    binary Yjs updates) is forwarded as-is to the rest of the peers on the
    same page. This way the full Yjs/BlockNote binding will just be
    adding a `type: "update"` for this same channel, without touching the
    transport.

Decisions:
  - **No new dependencies**: only FastAPI/Starlette WebSocket + stdlib.
  - **No persistence** of any document yet (TODO: Yjs snapshot to disk
    so a late-joining peer gets the current state).
  - **Identity**: if the `gnosi_session` cookie is present and valid, the
    server trusts it over the `user_id` received via query (prevents a
    client from impersonating another). The `name` (display) comes via query.

Production TODO:
  - Authorize access to the page (workspace/role) before accepting the WS.
  - Per-page connection limit and message rate-limiting.
  - Snapshot/replay of CRDT state for late-joiners.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from backend.services.auth_service import (
    COOKIE_NAME,
    decode_access_token,
    require_auth_enabled,
    resolve_identity,
)

log = logging.getLogger(__name__)

router = APIRouter()


class _Peer:
    """A WebSocket connection within a page."""

    __slots__ = ("ws", "user_id", "name")

    def __init__(self, ws: WebSocket, user_id: str, name: str) -> None:
        self.ws = ws
        self.user_id = user_id
        self.name = name


class CollabManager:
    """In-memory registry of peers per page (room = page_id).

    In-process memory: sufficient for a single uvicorn worker (the current
    case). With multiple workers a shared backend would be needed (Redis
    pub/sub) — documented as a TODO.
    
    """

    # Maximum cap of Yjs updates stored per page (replay to late-joiners). The
    # Yjs updates are cumulative and mergeable: applying them in order reconstructs
    # the state. We cap the size so it doesn't grow unbounded in long sessions; if
    # is exceeded, the late-joiner can request a full re-sync from a live peer.
    _MAX_BUFFER = 500

    def __init__(self) -> None:
        self._rooms: Dict[str, Set[_Peer]] = {}
        # Buffer of Yjs updates (base64) per page, for replay to late-joiners.
        self._doc_buffer: Dict[str, List[str]] = {}
        self._lock = asyncio.Lock()

    async def join(self, page_id: str, peer: _Peer) -> None:
        async with self._lock:
            self._rooms.setdefault(page_id, set()).add(peer)

    async def leave(self, page_id: str, peer: _Peer) -> None:
        async with self._lock:
            room = self._rooms.get(page_id)
            if room:
                room.discard(peer)
                if not room:
                    self._rooms.pop(page_id, None)
                    # Empty room: the state has already been materialized to disk (autosave
                    # from the client). We discard the buffer to avoid serving stale state.
                    self._doc_buffer.pop(page_id, None)

    def record_update(self, page_id: str, data: str) -> None:
        """Stores a Yjs update (base64) for replay. Discards the oldest one if
        the cap is exceeded (the client will re-sync if needed)."""
        buf = self._doc_buffer.setdefault(page_id, [])
        buf.append(data)
        if len(buf) > self._MAX_BUFFER:
            del buf[0 : len(buf) - self._MAX_BUFFER]

    def buffered_updates(self, page_id: str) -> List[str]:
        return list(self._doc_buffer.get(page_id, []))

    def peers(self, page_id: str) -> List[_Peer]:
        return list(self._rooms.get(page_id, set()))

    def presence_payload(
        self,
        room: str,
        page_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """List of unique users present (a user can have 2 tabs).
        `room` is the internal key (vault+page_id); `page_id` is the real value
        shown in the message (without the vault prefix)."""
        seen: Dict[str, str] = {}
        for p in self.peers(room):
            seen.setdefault(p.user_id, p.name)
        users = [{"id": uid, "name": nm} for uid, nm in seen.items()]
        return {"type": "presence", "page_id": page_id or room, "users": users, "count": len(users)}

    async def broadcast(
        self,
        page_id: str,
        message: dict[str, Any],
        exclude: Optional[_Peer] = None,
    ) -> None:
        """Sends a JSON message to all peers on the page.

        Peers for which sending fails (dead connection) are removed so they
        don't stay stuck in the presence list.
        
        """
        dead: List[_Peer] = []
        for peer in self.peers(page_id):
            if exclude is not None and peer is exclude:
                continue
            try:
                await peer.ws.send_json(message)
            except Exception:
                dead.append(peer)
        for peer in dead:
            await self.leave(page_id, peer)


manager = CollabManager()


def _resolve_user_id(websocket: WebSocket, query_user_id: str) -> str:
    """Prioritizes the JWT from the cookie over the user_id received via query.

    If the cookie is present and valid, it's the source of truth (a client can't
    impersonate another). Without a cookie (personal/legacy mode), the query is used.
    
    """
    token = websocket.cookies.get(COOKIE_NAME)
    if token:
        uid = decode_access_token(token)
        if uid:
            return uid
    return query_user_id or "anon"


def _room_key(websocket: WebSocket, page_id: str) -> str:
    """Room key = (vault, page_id). The vault comes from the
    `gnosi_active_vault` cookie, which the browser sends at the WebSocket handshake.

    Without this, two vaults with a page of the SAME id shared a room → the
    presence and CRDT updates got mixed between vaults (org mode, or two
    vaults with pages cloned from the same id). Without a cookie (single-vault) the
    namespace stays empty → same behavior as before."""
    vault_id = (websocket.cookies.get("gnosi_active_vault") or "").strip()
    return f"{vault_id}\x1f{page_id}" if vault_id else page_id


@router.websocket("/collab/{page_id}")
async def collab_ws(
    websocket: WebSocket,
    page_id: str,
    user_id: str = Query(default="anon"),
    name: str = Query(default="Anònim"),
) -> None:
    # Enforcement is applied here rather than by the app-wide gate: refusing a
    # WebSocket means closing it with a code, which an HTTPException cannot
    # express. This socket carries CRDT updates that persist to the page, so
    # leaving it ungated would keep a write path open while the HTTP API was
    # closed — the exact shape of hole this migration exists to remove.
    #
    # `_resolve_user_id` falls back to the `user_id` QUERY PARAM and then to
    # "anon", both caller-controlled, so under enforcement a real credential is
    # required. It goes through the same `resolve_identity` the HTTP gate uses:
    # checking only the session cookie here would refuse a PAT — the credential
    # phase 3 gave every non-browser client — while the identical token kept
    # working on every HTTP route, and the socket would just close with no
    # visible reason.
    if require_auth_enabled():
        if not resolve_identity(websocket):
            # 1008 = policy violation. Closing before `accept()` sends an HTTP
            # 403 during the handshake, which is what a browser can act on.
            await websocket.close(code=1008, reason="Authentication required")
            return

    await websocket.accept()
    effective_uid = _resolve_user_id(websocket, user_id)
    room = _room_key(websocket, page_id)   # room isolated per vault (vault+page_id)
    peer = _Peer(websocket, effective_uid, name or "Anònim")
    await manager.join(room, peer)
    try:
        # Announces the current presence to everyone (including the new peer).
        await manager.broadcast(room, manager.presence_payload(room, page_id))

        # Replay of the CRDT state to the new peer (late-joiner): we resend the
        # accumulated Yjs updates from the session so it sees the current document without
        # waiting for someone to type again.
        for data in manager.buffered_updates(room):
            try:
                await websocket.send_json({"type": "yjs-update", "data": data, "replay": True})
            except Exception:
                break

        while True:
            msg = await websocket.receive_json()
            if not isinstance(msg, dict):
                continue
            mtype = msg.get("type")
            if mtype == "ping":
                # Client keep-alive; we respond so it detects the connection is alive.
                await websocket.send_json({"type": "pong"})
                continue
            # Yjs updates: besides forwarding them, we store them for late-joiners.
            if mtype == "yjs-update" and isinstance(msg.get("data"), str):
                manager.record_update(room, msg["data"])
            # Generic relay (cursor, selection, Yjs updates, awareness).
            # We stamp who's sending it so the receiver doesn't have to trust the
            # arbitrary field from the client.
            msg["from"] = effective_uid
            await manager.broadcast(room, msg, exclude=peer)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning(f"collab_ws error a page={page_id}: {e}")
    finally:
        await manager.leave(room, peer)
        # Updates presence for everyone else after leaving.
        await manager.broadcast(room, manager.presence_payload(room, page_id))
