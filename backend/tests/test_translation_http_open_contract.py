"""Characterize public JSON requests before removing the legacy route namespace."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from pathlib import Path

import httpx
import pytest
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.exceptions import ResponseValidationError

from backend.api import vault_routes
from backend.domains.vault.translation import routes


@pytest.mark.parametrize("name,key", [
    ("sync_drupal_row", "item_id"), ("translate_row", "item_id"),
    ("generate_button_action", "prompt"), ("execute_button_action", "note_id"),
])
@pytest.mark.parametrize("value", [True, 7, 1.5, [1], {"key": "value"}])
def test_invalid_json_text_keeps_native_error(name: str, key: str, value: object) -> None:
    payload = {key: value}
    call: Awaitable[object]
    if name == "sync_drupal_row":
        call = routes.sync_drupal_row(BackgroundTasks(), payload)
    elif name == "translate_row":
        call = routes.translate_row(BackgroundTasks(), payload)
    elif name == "generate_button_action":
        call = routes.generate_button_action(payload)
    else:
        call = routes.execute_button_action(payload)
    with pytest.raises(AttributeError) as caught:
        asyncio.run(call)
    assert str(caught.value) == f"'{type(value).__name__}' object has no attribute 'strip'"


@pytest.mark.parametrize("value", [None, False, 0, "", [], {}])
def test_empty_text_retains_required_error(value: object) -> None:
    with pytest.raises(HTTPException) as caught:
        asyncio.run(routes.sync_drupal_row(BackgroundTasks(), {"item_id": value}))
    assert (caught.value.status_code, caught.value.detail) == (400, "item_id is required")


def test_sync_bulk_preserves_stringification_duplicates_and_raw_error_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[str, str, bool]] = []
    async def sync(
        item_id: str, *, background_tasks: BackgroundTasks, publish: bool,
        scope: str, push_media: bool,
    ) -> dict[str, object]:
        seen.append((item_id, scope, push_media))
        if item_id == "7":
            raise HTTPException(409, {"reason": "synthetic"})
        return {"item_id": item_id}
    monkeypatch.setattr(vault_routes, "_do_sync_drupal_row", sync)
    response = asyncio.run(routes.sync_drupal_rows(BackgroundTasks(), {
        "item_ids": [7, " x ", " x ", None], "scope": ["invalid"],
    }))
    assert seen == [("7", "all", True), (" x ", "all", True),
                    (" x ", "all", True), ("None", "all", True)]
    assert response == {"status": "ok", "results": [{"item_id": " x "},
        {"item_id": " x "}, {"item_id": "None"}],
        "errors": [{"item_id": 7, "detail": {"reason": "synthetic"}}]}


def test_button_config_error_occurs_after_page_read_and_parse(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    page = tmp_path / "synthetic.md"
    page.write_text("body", encoding="utf-8")
    seen: list[str] = []
    def find(page_id: str) -> Path:
        seen.append(page_id)
        return page
    def parse(raw: str, path: Path) -> tuple[dict[object, object], str]:
        seen.append(raw)
        return {}, raw
    monkeypatch.setattr(vault_routes, "find_page_path", find)
    monkeypatch.setattr(vault_routes, "parse_frontmatter", parse)
    with pytest.raises(AttributeError, match="'int' object has no attribute 'get'"):
        asyncio.run(routes.execute_button_action({
            "note_id": " note ", "button_action": "ai_prompt", "button_config": 7,
        }))
    assert seen == ["note", "body"]


@pytest.mark.parametrize("raw", ["null", "[]", "7", '"text"'])
def test_valid_nonobject_generated_json_is_not_replaced_by_fallback(
    monkeypatch: pytest.MonkeyPatch, raw: str,
) -> None:
    import json

    from backend.agent import factory
    def generate(instruction: str, prompt: str) -> tuple[str, str]:
        return raw, "fake"
    monkeypatch.setattr(factory, "generate_text", generate)
    response = asyncio.run(routes.generate_button_action({"prompt": "Synthetic"}))
    assert response == {"status": "ok", "result": json.loads(raw)}


@pytest.mark.parametrize("raw", ["null", "[]", "7", '"text"'])
def test_generated_shape_is_rejected_at_http_response_validation(
    monkeypatch: pytest.MonkeyPatch, raw: str,
) -> None:
    from backend.agent import factory
    calls: list[str] = []
    def generate(instruction: str, prompt: str) -> tuple[str, str]:
        calls.append(prompt)
        return raw, "fake"
    monkeypatch.setattr(factory, "generate_text", generate)
    app = FastAPI()
    app.add_api_route("/generate", routes.generate_button_action,
                     methods=["POST"], response_model=routes.GenerateButtonActionResponse)
    async def request() -> None:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://synthetic.invalid") as client:
            await client.post("/generate", json={"prompt": "Synthetic"})
    with pytest.raises(ResponseValidationError):
        asyncio.run(request())
    assert calls == ["Synthetic"]


def test_invalid_generated_json_retains_provider_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.agent import factory
    monkeypatch.setattr(factory, "generate_text", lambda *args: ("not JSON", "fake"))
    result = asyncio.run(routes.generate_button_action({
        "prompt": " Synthetic ", "fields": [{"name": "Summary"}],
    }))
    assert result == {"status": "ok", "result": {
        "button_label": "Acció IA", "button_action": "ai_prompt",
        "button_config": {"prompt": "Synthetic", "target_field": "Summary"},
    }}
