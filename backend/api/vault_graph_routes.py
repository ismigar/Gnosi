import asyncio
import gzip
import logging
import threading
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter

from backend.domains.graph.schemas import GraphResponse
from backend.domains.graph.timing import collect_graph_timing, graph_cache_hit, graph_phase
from backend.services.graph_service import GraphService
from backend.utils.errors import safe_error_detail
from backend.utils.request_profile import start_request_profile

log = logging.getLogger(__name__)

router = APIRouter()

_GRAPH_RESPONSE_ADAPTER = TypeAdapter(GraphResponse)
_JSON_CACHE_LOCK = threading.Lock()
_cached_graph: dict[str, Any] | None = None
_cached_graph_json: bytes | None = None
_cached_graph_gzip: bytes | None = None


class GraphJSONResponse(JSONResponse):
    """Return the JSON bytes already validated and encoded by the graph worker."""

    def render(self, content: Any) -> bytes:
        return content if isinstance(content, bytes) else super().render(content)


def _graph_response_json(graph: dict[str, Any]) -> bytes:
    """Encode the current immutable graph snapshot once, retaining just one body."""
    global _cached_graph, _cached_graph_json, _cached_graph_gzip
    # GraphService must resolve the current snapshot before this lookup. Its TTL
    # and invalidations publish a new object, as for the virtual-field caches.
    # Retaining the source object also prevents Python object-ID reuse.
    if not graph.get("partial"):
        with _JSON_CACHE_LOCK:
            if graph is _cached_graph and _cached_graph_json is not None:
                graph_cache_hit("json", True)
                return _cached_graph_json
    graph_cache_hit("json", False)
    validated = GraphResponse.model_validate(graph)
    encoded = _GRAPH_RESPONSE_ADAPTER.dump_json(validated, by_alias=True, exclude_unset=True)
    if not graph.get("partial"):
        with _JSON_CACHE_LOCK:
            _cached_graph, _cached_graph_json = graph, encoded
            _cached_graph_gzip = None
    return encoded


def _gzip_graph_json(graph: dict[str, Any], encoded: bytes) -> bytes:
    global _cached_graph_gzip
    with _JSON_CACHE_LOCK:
        if graph is _cached_graph and _cached_graph_gzip is not None:
            graph_cache_hit("gzip", True)
            return _cached_graph_gzip
    graph_cache_hit("gzip", False)
    # The generic gzip middleware compresses on the event loop, including cache
    # hits. Keep this multi-megabyte response's compression in the worker too.
    compressed = gzip.compress(encoded, compresslevel=1, mtime=0)
    with _JSON_CACHE_LOCK:
        if graph is _cached_graph and encoded is _cached_graph_json:
            _cached_graph_gzip = compressed
    return compressed


def _encoding_qualities(value: str) -> dict[str, float]:
    qualities: dict[str, float] = {}
    for item in value.lower().split(","):
        coding, *parameters = item.strip().split(";")
        quality = 1.0
        for parameter in parameters:
            key, _, raw_value = parameter.strip().partition("=")
            if key == "q":
                try:
                    quality = float(raw_value)
                except ValueError:
                    quality = 0.0
        qualities[coding] = quality if 0 < quality <= 1 else 0
    return qualities


def _build_graph_response(*, accept_gzip: bool = False, with_timing: bool = False) -> GraphJSONResponse:
    with collect_graph_timing(with_timing) as timing:
        with graph_phase("graph"):
            graph = GraphService().build_unified_graph()
        with graph_phase("json"):
            encoded = _graph_response_json(graph)
        if accept_gzip:
            with graph_phase("gzip"):
                encoded = _gzip_graph_json(graph, encoded)
        # Response headers/background tasks belong to this request, never the cache.
        headers = {"Content-Encoding": "gzip" if accept_gzip else "identity", "Vary": "Accept-Encoding"}
        if timing is not None:
            headers["Server-Timing"] = timing.header(len(graph.get("nodes", [])))
        return GraphJSONResponse(content=encoded, headers=headers)


@router.get(
    "/graph",
    response_model=GraphResponse,
    response_class=GraphJSONResponse,
    response_model_exclude_unset=True,
)
async def get_vault_graph(request: Request) -> GraphJSONResponse:
    """
    Return the current Vault topology and the canonical Brain proposal overlay.
    """
    qualities = _encoding_qualities(request.headers.get("accept-encoding", ""))
    accept_gzip = qualities.get("gzip", qualities.get("*", 0)) > 0
    # Identity is implicitly acceptable unless explicitly excluded, or excluded
    # by a wildcard without a more specific identity preference.
    accept_identity = qualities.get("identity", qualities.get("*", 1)) > 0
    if not accept_gzip and not accept_identity:
        raise HTTPException(status_code=406, detail="No acceptable graph content encoding")
    profile = start_request_profile(request.headers.get("x-gnosi-graph-profile") == "1")
    profile_id = None
    try:
        # Keep graph construction, validation and JSON encoding off the event loop.
        if profile is None:
            response = await asyncio.to_thread(
                _build_graph_response,
                accept_gzip=accept_gzip,
                with_timing=request.headers.get("x-gnosi-graph-timing") == "1",
            )
        else:
            response = await asyncio.to_thread(
                profile.run,
                _build_graph_response,
                accept_gzip=accept_gzip,
                with_timing=request.headers.get("x-gnosi-graph-timing") == "1",
            )
    except Exception as e:
        log.exception(f"Error generating the vault graph: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="GET /api/graph"))
    finally:
        if profile is not None:
            profile_id = profile.stop()
    if profile_id is not None:
        response.headers["X-Gnosi-Request-Profile-Id"] = profile_id
    return response
