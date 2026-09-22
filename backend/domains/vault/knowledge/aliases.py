"""Knowledge URLs share the historical handlers and their authorization guards."""
from fastapi import APIRouter
from fastapi.routing import APIRoute


def knowledge_aliases(source: APIRouter) -> APIRouter:
    router = APIRouter(tags=["Knowledge"])
    for route in source.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path.startswith("/llm-wiki/"):
            path = route.path.replace("/llm-wiki/", "/knowledge/", 1)
        elif route.path.startswith("/brain-table"):
            path = route.path.replace("/brain-table", "/knowledge/table", 1)
        else:
            continue
        router.add_api_route(
            path, route.endpoint, methods=list(route.methods or []),
            response_model=route.response_model, status_code=route.status_code,
            dependencies=[*source.dependencies, *route.dependencies],
            responses=route.responses, response_class=route.response_class,
            response_model_by_alias=route.response_model_by_alias,
            response_model_exclude_none=route.response_model_exclude_none,
            response_model_exclude_unset=route.response_model_exclude_unset,
            response_model_exclude_defaults=route.response_model_exclude_defaults,
            name=f"knowledge_{route.name}", operation_id=f"knowledge_{route.unique_id}",
        )
    return router
