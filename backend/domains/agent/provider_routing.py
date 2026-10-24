"""Explicit upstream selection for a bot's pinned OpenRouter model."""
from __future__ import annotations

import re
from copy import deepcopy
from dataclasses import replace
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from backend.domains.agent.workflow_setup import ModelSetup


def selected_upstream(profile: dict[str, Any], provider: str, model: str) -> str | None:
    """Keep an upstream choice attached to its exact configured model route."""
    if provider != 'openrouter' or profile.get('provider') != provider or profile.get('model') != model:
        return None
    route = profile.get('openrouter_route')
    if route is None:
        return None
    if not isinstance(route, dict) or set(route) != {'model', 'provider'} or not isinstance(route['model'], str):
        raise ValueError('agent_openrouter_provider_invalid')
    if route['model'] != model:
        return None
    value = route['provider']
    if not isinstance(value, str):
        raise ValueError('agent_openrouter_provider_invalid')
    value = value.strip().lower()
    if not value:
        return None
    if len(value) > 128 or not re.fullmatch(r'[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)*', value):
        raise ValueError('agent_openrouter_provider_invalid')
    return value


def constrain_provider_route(model: Any, provider: str, upstream: str | None) -> Any:
    """Preserve existing privacy and capability constraints on a fixed route."""
    if provider != 'openrouter' or upstream is None:
        return model
    from backend.agent.json_tool_model import JsonToolModel
    if isinstance(model, JsonToolModel):
        return JsonToolModel(constrain_provider_route(model.model, provider, upstream), model.schemas)
    if not callable(getattr(model, 'bind', None)):
        raise ValueError('agent_openrouter_provider_transport_unsupported')
    base = getattr(model, 'bound', model)
    extra = deepcopy(getattr(base, 'extra_body', None) or {})
    bound = deepcopy(getattr(model, 'kwargs', {}).get('extra_body') or {})
    preferences = {**extra.get('provider', {}), **bound.get('provider', {})}
    extra.update(bound)
    extra['provider'] = {**preferences, 'order': [upstream], 'allow_fallbacks': False,
                         'require_parameters': True}
    if not callable(getattr(base, 'model_copy', None)) or not hasattr(base, 'extra_body'):
        raise ValueError('agent_openrouter_provider_transport_unsupported')
    routed = base.model_copy(update={'extra_body': extra})
    if base is model:
        return routed
    # bind_tools delegates to the underlying client, so a binding alone would
    # silently lose the route. Keep it on the copied client as well as the binding.
    return model.model_copy(update={'bound': routed,
        'kwargs': {**getattr(model, 'kwargs', {}), 'extra_body': deepcopy(extra)}})


def resumed_provider_profile(frozen: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Refresh only an explicit upstream for the same bot and frozen model."""
    provider, model = str(frozen.get('provider') or ''), str(frozen.get('model') or '')
    if (provider != 'openrouter' or not frozen.get('id') or current.get('id') != frozen['id']
            or current.get('provider') != provider or current.get('model') != model):
        return frozen
    upstream = selected_upstream(current, provider, model)
    route = {'model': model, 'provider': upstream} if upstream is not None else None
    if frozen.get('openrouter_route') == route:
        return frozen
    result = deepcopy(frozen)
    if route is None:
        result.pop('openrouter_route', None)
    else:
        result['openrouter_route'] = route
    return result


def apply_provider_route(profile: dict[str, Any], model: ModelSetup) -> tuple[ModelSetup, dict[str, Any]]:
    """Apply the explicit upstream and return matching execution metadata."""
    upstream = selected_upstream(profile, model.provider_name, model.model_name or '')
    if upstream is None:
        return model, {}
    routed = replace(model, llm=constrain_provider_route(model.llm, model.provider_name, upstream))
    return routed, {'provider_routing': {'order': [upstream], 'allow_fallbacks': False,
                                        'require_parameters': True}}
