"""Canonical mail router registration object."""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.datastructures import DefaultPlaceholder
from fastapi.routing import APIRoute

from backend.services.workspace_service import get_workspace_context


class MailContractRoute(APIRoute):
    """Keep the legacy untyped response schema while route functions stay typed."""

    def __init__(
        self,
        path: str,
        endpoint: Callable[..., Any],
        **kwargs: Any,
    ) -> None:
        if isinstance(kwargs.get("response_model"), DefaultPlaceholder):
            kwargs["response_model"] = None
        super().__init__(path, endpoint, **kwargs)


router = APIRouter(
    prefix="/api/mail",
    tags=["mail"],
    dependencies=[Depends(get_workspace_context)],
    route_class=MailContractRoute,
)
