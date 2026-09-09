"""Cold router preparation must precede requests and preserve validation/auth."""

import asyncio
from threading import Event

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, routing
from pydantic import BaseModel

from backend.app.factory import prepare_application_routes


def test_preparation_keeps_loop_available_without_running_dependencies(monkeypatch):
    async def scenario():
        loop = asyncio.get_running_loop()
        app = FastAPI()
        parent = APIRouter(prefix="/api")
        child = APIRouter(prefix="/items")
        calls = []

        def authorize(x_read_token: str | None = Header(None)):
            calls.append("auth")
            if x_read_token != "fixture-token":
                raise HTTPException(status_code=401)

        @child.get("/{item_id}", dependencies=[Depends(authorize)])
        async def read_item(item_id: int):
            calls.append("endpoint")
            return {"id": item_id}

        @child.get("/hidden/status", include_in_schema=False)
        async def hidden_status():
            return {"ok": True}

        class Item(BaseModel):
            quantity: int

        @child.post("/", response_model=Item, dependencies=[Depends(authorize)])
        async def create_item(item: Item):
            return {"quantity": str(item.quantity), "private": "excluded"}

        parent.include_router(child)
        app.include_router(parent)
        original_openapi = app.openapi
        iter_route_contexts = getattr(routing, "iter_route_contexts", iter)

        def prepare(routes):
            served = Event()
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), "route preparation blocked the event loop"
            yield from iter_route_contexts(routes)

        def unexpected_schema():
            raise AssertionError("Startup generated the optional API document")

        monkeypatch.setattr(routing, "iter_route_contexts", prepare, raising=False)
        monkeypatch.setattr(app, "openapi", unexpected_schema)
        await prepare_application_routes(app)
        assert calls == []
        assert app.openapi_schema is None
        monkeypatch.setattr(routing, "iter_route_contexts", iter_route_contexts)

        def unexpected_build(*args, **kwargs):
            raise AssertionError("First request rebuilt lazy route dependencies")

        monkeypatch.setattr("fastapi.routing.get_dependant", unexpected_build)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.test"
        ) as client:
            assert (await client.get("/api/items/3")).status_code == 401
            assert "endpoint" not in calls
            headers = {"x-read-token": "fixture-token"}
            assert (await client.get("/api/items/invalid", headers=headers)).status_code == 422
            response = await client.get("/api/items/3", headers=headers)
            assert response.json() == {"id": 3}
            assert (await client.get("/api/items/hidden/status")).status_code == 200
            assert (
                await client.post("/api/items/", json={"quantity": "invalid"}, headers=headers)
            ).status_code == 422
            created = await client.post("/api/items/", json={"quantity": "7"}, headers=headers)
            assert created.status_code == 200
            assert created.json() == {"quantity": 7}

        schema = original_openapi()
        assert "/api/items/{item_id}" in schema["paths"]
        assert "/api/items/hidden/status" not in schema["paths"]
        assert "Item" in schema["components"]["schemas"]
        assert original_openapi() is schema

    asyncio.run(scenario())


def test_preparation_supports_versions_with_eager_routes(monkeypatch):
    app = FastAPI()

    @app.get("/items/{item_id}")
    async def read_item(item_id: int):
        return {"id": item_id}

    monkeypatch.delattr(routing, "iter_route_contexts", raising=False)

    async def scenario():
        await prepare_application_routes(app)
        assert app.openapi_schema is None
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.test"
        ) as client:
            assert (await client.get("/items/invalid")).status_code == 422
            assert (await client.get("/items/7")).json() == {"id": 7}

    asyncio.run(scenario())
