"""Per-model parameter source review. Supplied URLs are never fetched by the server."""
from __future__ import annotations
import threading
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlsplit, quote
from pydantic import BaseModel, ConfigDict, Field
from backend.services import model_parameters as parameters
from backend.services.model_parameter_seed import PUBLISHED, UNDISCLOSED
from requests import RequestException

_lock = threading.RLock()


class ParameterReviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    model_id: str = Field(min_length=1, max_length=256)
    action: Literal['inspect','refresh','save'] = 'inspect'
    status: Literal['known','not_published'] = 'known'
    total: float | None = Field(default=None, gt=0, lt=1_000_000, allow_inf_nan=False)
    active: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    source: str = Field(default='', max_length=2000)
    reviewed: bool = False


ReviewOutcome = Literal['loaded','verified','needs_review','source_unavailable','saved']


class ParameterReviewResponse(BaseModel):
    model_id: str
    status: str
    total: float | None = None
    active: float | None = None
    source: str | None = None
    checked_at: str | None = None
    verification: str | None = None
    source_links: list[str] = Field(default_factory=list)
    outcome: ReviewOutcome = 'loaded'


def review(payload: ParameterReviewRequest, *, model: dict[str, Any] | None = None) -> dict[str, Any]:
    if model is None:
        from backend.services.artificial_analysis import _read_cache, fetch_all_models
        feed = _read_cache() or fetch_all_models()
        model = next((m for m in feed.get('models', []) if str(m.get('id')) == payload.model_id), None)
    if model is None or str(model.get('id')) != payload.model_id:
        raise LookupError('model_comparison.review_model_missing')
    key = parameters.model_key(model)
    author = parameters.AUTHORS.get(parameters.creator_key(str(model.get('creator',''))))
    links = []
    if author:
        links.append(f'https://huggingface.co/{author}?search={quote(parameters.base_name(str(model.get("name",""))))}')
    for seed in [*PUBLISHED, *UNDISCLOSED]:
        if parameters.creator_key(seed['creator']) == parameters.creator_key(str(model.get('creator',''))) and seed['source'] not in links:
            links.append(seed['source'])
            break
    outcome: ReviewOutcome = 'loaded'
    value: dict[str, Any] | None = None
    if payload.action == 'save':
        url = urlsplit(payload.source)
        if not payload.reviewed or url.scheme != 'https' or not url.hostname or url.username or url.password or url.port not in {None,443}:
            raise ValueError('model_comparison.review_source_required')
        if payload.status == 'known' and not parameters.valid_counts({'total':payload.total,'active':payload.active}):
            raise ValueError('model_comparison.review_invalid_counts')
        value = {'status':payload.status,'source':payload.source,'checked_at':datetime.now(timezone.utc).isoformat(),'verification':'user_review'}
        if payload.status == 'known':
            value.update(total=payload.total,active=payload.active)
        outcome = 'saved'
    elif payload.action == 'refresh':
        try:
            found = parameters.discover(model, author) if author else None
            if found:
                value = {**found,'status':'known','checked_at':datetime.now(timezone.utc).isoformat(),'verification':'official_card'}
                outcome = 'verified'
            else:
                outcome = 'needs_review'
        except (RequestException, ValueError, KeyError, TypeError):
            outcome = 'source_unavailable'
    with _lock:
        cache = parameters.read_cache()
        if value is not None:
            # Keep a reviewed disclosure when automatic discovery has no evidence.
            cache['entries'][key] = value
            parameters.write_cache(cache)
        current = parameters.metadata(model, cache)
    return ParameterReviewResponse(model_id=payload.model_id, source_links=links, outcome=outcome, **current).model_dump()
