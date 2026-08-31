"""Collecting ETag live tests must never implicitly access a user's backend."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
import requests


def load_live_suite() -> ModuleType:
    source = Path(__file__).with_name("test_e2e_etag_concurrency.py")
    spec = importlib.util.spec_from_file_location("etag_collection_fixture", source)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("opt_in", [None, "", "0", "false", "no", "unexpected"])
def test_collection_without_live_opt_in_never_contacts_backend(
    monkeypatch: pytest.MonkeyPatch, opt_in: str | None,
) -> None:
    if opt_in is None:
        monkeypatch.delenv("GNOSI_RUN_LIVE_E2E", raising=False)
    else:
        monkeypatch.setenv("GNOSI_RUN_LIVE_E2E", opt_in)
    monkeypatch.setenv("GNOSI_BACKEND_URL", "http://127.0.0.1:9")
    attempted: list[str] = []

    def refuse_network(url: str, **_kwargs: object) -> None:
        attempted.append(url)
        raise AssertionError("Collection must not access any HTTP endpoint")

    monkeypatch.setattr(requests, "get", refuse_network)
    module = load_live_suite()
    assert attempted == []
    assert module.RUN_LIVE_E2E is False
    assert module.pytestmark.args == (True,)


@pytest.mark.parametrize("opt_in", ["1", "true", "YES", " True "])
@pytest.mark.parametrize("reachable", [True, False])
def test_explicit_live_opt_in_keeps_reachability_gate(
    monkeypatch: pytest.MonkeyPatch, opt_in: str, reachable: bool,
) -> None:
    monkeypatch.setenv("GNOSI_RUN_LIVE_E2E", opt_in)
    monkeypatch.setenv("GNOSI_BACKEND_URL", "http://127.0.0.1:9")
    attempted: list[tuple[str, object]] = []

    class Response:
        status_code = 200 if reachable else 503

    def fake_health(url: str, **kwargs: object) -> Response:
        attempted.append((url, kwargs.get("timeout")))
        return Response()

    monkeypatch.setattr(requests, "get", fake_health)
    module = load_live_suite()
    assert attempted == [("http://127.0.0.1:9/api/health", 2)]
    assert module.RUN_LIVE_E2E is True
    assert module.pytestmark.args == (not reachable,)
