"""Typed boundary around the legacy Reader helpers owned by the agent domain."""

from __future__ import annotations

from importlib import import_module
from typing import Any, Callable, Dict, cast

from backend.agent import internal_sources


def plain_text(value: str, parser: object | None = None) -> str:
    """Call the legacy HTML-to-text helper without exporting its private name."""
    helper = cast(
        Callable[[str, object | None], str],
        getattr(internal_sources, "_plain_text"),
    )
    return helper(value, parser)


def apply_reader_scope(query: Any, scope: Dict[str, Any]) -> Any:
    """Apply the canonical Reader filters to a SQLAlchemy query."""
    helper = cast(
        Callable[[Any, Dict[str, Any]], Any],
        getattr(internal_sources, "_apply_reader_scope"),
    )
    return helper(query, scope)


def normalize_scope(source: str, scope: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize an internal-source scope through the existing contract."""
    helper = cast(
        Callable[[str, Dict[str, Any]], Dict[str, Any]],
        getattr(internal_sources, "normalize_internal_scope"),
    )
    return helper(source, scope)


def reader_inventory(scope: Dict[str, Any]) -> Dict[str, Any]:
    """Return Reader inventory using the existing agent-domain implementation."""
    helper = cast(
        Callable[[Dict[str, Any]], Dict[str, Any]],
        getattr(internal_sources, "_reader_inventory"),
    )
    return helper(scope)


def fetch_newsletters() -> object:
    """Call the legacy newsletter ingester through an explicit typed boundary."""
    mail_ingester = import_module("backend.services.mail_ingester")
    helper = cast(
        Callable[[], object],
        getattr(mail_ingester, "fetch_and_store_newsletters"),
    )
    return helper()
