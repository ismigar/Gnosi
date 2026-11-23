"""Cache ownership for authenticated Calendar reads and their provider workers."""
from contextlib import contextmanager
from contextvars import ContextVar
import json
from typing import Iterator, TYPE_CHECKING

if TYPE_CHECKING:
    from backend.services.workspace_service import WorkspaceContext


calendar_cache_owner: ContextVar[str] = ContextVar("calendar_cache_owner", default="")


def request_cache_owner(context: "WorkspaceContext | None") -> str:
    if context is None:
        return ""
    return json.dumps([context.workspace_id, context.user_id, str(context.vault_path)])


@contextmanager
def calendar_cache_scope(owner: str) -> Iterator[None]:
    token = calendar_cache_owner.set(owner)
    try:
        yield
    finally:
        calendar_cache_owner.reset(token)


def scoped_calendar_key(key: str) -> str:
    owner = calendar_cache_owner.get()
    return f"{owner}\0{key}" if owner else key
