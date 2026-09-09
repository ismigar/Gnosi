"""A slow vault read must leave the request loop available to other requests."""

from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar
from threading import Event
from types import SimpleNamespace

import pytest

from backend.domains.vault.api import pages_queries
from backend.domains.vault.registry.api import RegistryApiDependencies, get_registry


@pytest.mark.parametrize("endpoint", ["registry", "summary", "tree"])
def test_slow_navigation_read_keeps_loop_responsive_and_vault_context(
    monkeypatch: pytest.MonkeyPatch,
    endpoint: str,
) -> None:
    vault = ContextVar("navigation_test_vault", default="missing")

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        other_request_served = Event()
        observed_context: list[str] = []

        def slow_read() -> None:
            observed_context.append(vault.get())
            loop.call_soon_threadsafe(other_request_served.set)
            # A read on the request loop cannot serve this callback until after
            # the timeout. A worker read lets unrelated requests run immediately.
            assert other_request_served.wait(2), "Vault read blocked other requests"

        def read_registry() -> dict[str, object]:
            slow_read()
            return {"databases": [], "tables": [], "views": []}

        def read_pages() -> list[object]:
            slow_read()
            return []

        token = vault.set("requested-vault")
        try:
            if endpoint == "registry":
                dependencies = RegistryApiDependencies(
                    load_registry=read_registry,
                    save_registry=lambda value: None,
                    sort_key=lambda value: (0, ""),
                    safe_error_detail=lambda error, context: context,
                    logger=logging.getLogger(__name__),
                )
                assert await get_registry(dependencies) == read_registry_result
            else:
                monkeypatch.setattr(
                    pages_queries,
                    "_dependencies",
                    SimpleNamespace(get_pages_snapshot=read_pages),
                )
                result = (
                    await pages_queries.list_sidebar_tree()
                    if endpoint == "tree"
                    else await pages_queries.list_sidebar_summary(compact=True)
                )
                assert result == []
            assert observed_context == ["requested-vault"]
        finally:
            vault.reset(token)

    read_registry_result = {"databases": [], "tables": [], "views": []}
    asyncio.run(scenario())
