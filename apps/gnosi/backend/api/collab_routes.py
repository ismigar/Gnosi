"""Col·laboració en temps real — presència + relay de missatges per pàgina.

Esquelet (Via B: servidor central com a relay). Aquest mòdul implementa el
**canal** de col·laboració, no encara el document CRDT complet:

  - **Presència**: qui està veient/editant una pàgina ara mateix. El client
    rep un missatge `{type: "presence", users: [...]}` cada cop que algú
    entra o surt → la UI mostra "X està editant".
  - **Relay**: qualsevol altre missatge (cursor, selecció i —en el futur—
    updates binaris de Yjs) es reenvia tal qual a la resta de peers de la
    mateixa pàgina. Així la binding completa de Yjs/BlockNote serà només
    afegir un `type: "update"` per aquest mateix canal, sense tocar el
    transport.

Decisions:
  - **Sense dependències noves**: només FastAPI/Starlette WebSocket + stdlib.
  - **Sense persistència** de cap document encara (TODO: snapshot Yjs a disc
    perquè un peer que entra tard rebi l'estat actual).
  - **Identitat**: si la cookie `gnosi_session` és present i vàlida, el
    servidor hi confia per sobre del `user_id` rebut per query (evita que un
    client suplanti un altre). El `name` (display) ve per query.

TODO producció:
  - Autoritzar l'accés a la pàgina (workspace/rol) abans d'acceptar el WS.
  - Límit de connexions per pàgina i rate-limit de missatges.
  - Snapshot/replay de l'estat CRDT per a late-joiners.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

# Identitat opcional via JWT. Si el mòdul d'autenticació hi és (PR d'auth
# fusionat), confiem en la cookie de sessió per sobre del user_id rebut per
# query. Si encara no hi és en aquesta instal·lació, la col·laboració funciona
# igualment amb la identitat per query (mode personal/legacy). Així aquest
# mòdul no depèn dur de l'auth i es pot desplegar de forma independent.
try:
    from backend.services.auth_service import COOKIE_NAME, decode_access_token
except ImportError:  # pragma: no cover
    COOKIE_NAME = "gnosi_session"

    def decode_access_token(_token):
        return None

log = logging.getLogger(__name__)

router = APIRouter()


class _Peer:
    """Una connexió WebSocket dins d'una pàgina."""

    __slots__ = ("ws", "user_id", "name")

    def __init__(self, ws: WebSocket, user_id: str, name: str):
        self.ws = ws
        self.user_id = user_id
        self.name = name


class CollabManager:
    """Registre en memòria de peers per pàgina (room = page_id).

    En memòria del procés: suficient per a un sol worker uvicorn (el cas
    actual). Amb múltiples workers caldria un backend compartit (Redis
    pub/sub) — documentat com a TODO.
    """

    # Cap màxim d'updates Yjs guardats per pàgina (replay a late-joiners). Els
    # updates Yjs són acumulatius i mergeables: aplicar-los en ordre reconstrueix
    # l'estat. Limitem la mida per no créixer sense fre en sessions llargues; si
    # se supera, el late-joiner pot demanar un re-sync complet a un peer viu.
    _MAX_BUFFER = 500

    def __init__(self) -> None:
        self._rooms: Dict[str, Set[_Peer]] = {}
        # Buffer d'updates Yjs (base64) per pàgina, per a replay a late-joiners.
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
                    # Sala buida: l'estat ja s'ha materialitzat a disc (autosave
                    # del client). Descartem el buffer per no servir estat ranci.
                    self._doc_buffer.pop(page_id, None)

    def record_update(self, page_id: str, data: str) -> None:
        """Desa un update Yjs (base64) per a replay. Descarta el més antic si
        se supera el cap (el client farà re-sync si cal)."""
        buf = self._doc_buffer.setdefault(page_id, [])
        buf.append(data)
        if len(buf) > self._MAX_BUFFER:
            del buf[0 : len(buf) - self._MAX_BUFFER]

    def buffered_updates(self, page_id: str) -> List[str]:
        return list(self._doc_buffer.get(page_id, []))

    def peers(self, page_id: str) -> List[_Peer]:
        return list(self._rooms.get(page_id, set()))

    def presence_payload(self, page_id: str) -> dict:
        """Llista d'usuaris únics presents (un usuari pot tenir 2 pestanyes)."""
        seen: Dict[str, str] = {}
        for p in self.peers(page_id):
            seen.setdefault(p.user_id, p.name)
        users = [{"id": uid, "name": nm} for uid, nm in seen.items()]
        return {"type": "presence", "page_id": page_id, "users": users, "count": len(users)}

    async def broadcast(self, page_id: str, message: dict, exclude: Optional[_Peer] = None) -> None:
        """Envia un missatge JSON a tots els peers de la pàgina.

        Els peers que fallen l'enviament (connexió morta) s'eliminen perquè
        no quedin penjats a la presència.
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
    """Prioritza el JWT de la cookie sobre el user_id rebut per query.

    Si la cookie és present i vàlida, és la font de veritat (un client no pot
    suplantar un altre). Sense cookie (mode personal/legacy), s'usa el query.
    """
    token = websocket.cookies.get(COOKIE_NAME)
    if token:
        uid = decode_access_token(token)
        if uid:
            return uid
    return query_user_id or "anon"


@router.websocket("/collab/{page_id}")
async def collab_ws(
    websocket: WebSocket,
    page_id: str,
    user_id: str = Query(default="anon"),
    name: str = Query(default="Anònim"),
):
    await websocket.accept()
    effective_uid = _resolve_user_id(websocket, user_id)
    peer = _Peer(websocket, effective_uid, name or "Anònim")
    await manager.join(page_id, peer)
    try:
        # Anuncia la presència actual a tothom (inclòs el nou peer).
        await manager.broadcast(page_id, manager.presence_payload(page_id))

        # Replay de l'estat CRDT al nou peer (late-joiner): li reenviem els
        # updates Yjs acumulats de la sessió perquè vegi el document actual sense
        # esperar que algú torni a teclejar.
        for data in manager.buffered_updates(page_id):
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
                # Keep-alive del client; responem perquè detecti la connexió viva.
                await websocket.send_json({"type": "pong"})
                continue
            # Updates Yjs: a més de reenviar-los, els guardem per a late-joiners.
            if mtype == "yjs-update" and isinstance(msg.get("data"), str):
                manager.record_update(page_id, msg["data"])
            # Relay genèric (cursor, selecció, updates Yjs, awareness).
            # Segellem qui l'envia perquè el receptor no s'hagi de refiar del
            # camp arbitrari del client.
            msg["from"] = effective_uid
            await manager.broadcast(page_id, msg, exclude=peer)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning(f"collab_ws error a page={page_id}: {e}")
    finally:
        await manager.leave(page_id, peer)
        # Actualitza la presència per a la resta després de marxar.
        await manager.broadcast(page_id, manager.presence_payload(page_id))
