"""Open Vault source records through the social facade, without publishing."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import BackgroundTasks, HTTPException
import pytest

from backend.api import social_routes, vault_routes
from backend.domains.vault.registry.state import RegistryData
from backend.services import action_rules


def test_source_lookup_preserves_open_records_and_late_callback_capture(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "source.md"
    path.write_text("synthetic", encoding="utf-8")
    opaque = object()
    metadata: RegistryData = {7: opaque, "table_id": "table"}
    table: RegistryData = {None: opaque, "id": "table"}
    events: list[str] = []

    def wrong_lookup(table_id: object) -> RegistryData:
        raise AssertionError("table callback was resolved after its argument")

    def table_id(received: RegistryData) -> str:
        assert received is metadata
        events.append("table_id")
        monkeypatch.setattr(vault_routes, "_table_by_id", wrong_lookup)
        return "table"

    def lookup(identifier: object) -> RegistryData:
        assert identifier == "table"
        events.append("lookup")
        return table

    def parse(raw: str, received: Path) -> tuple[RegistryData, str]:
        assert raw == "synthetic" and received == path
        events.append("parse")
        monkeypatch.setattr(vault_routes, "get_table_id", table_id)
        monkeypatch.setattr(vault_routes, "_table_by_id", lookup)
        return metadata, "body"

    def find(identifier: str) -> Path:
        assert identifier == "source"
        events.append("find")
        monkeypatch.setattr(vault_routes, "parse_frontmatter", parse)
        return path

    monkeypatch.setattr(vault_routes, "find_page_path", find)
    actual_table, actual_metadata = asyncio.run(social_routes._load_source_row(" source "))
    assert actual_table is table and actual_metadata is metadata
    assert events == ["find", "parse", "table_id", "lookup"]


@pytest.mark.parametrize("missing", ["empty", "none", "absent"])
def test_source_lookup_keeps_unresolved_passthrough(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, missing: str
) -> None:
    calls: list[str] = []

    def find(identifier: str) -> Path | None:
        calls.append(identifier)
        return tmp_path / "absent.md" if missing == "absent" else None

    monkeypatch.setattr(vault_routes, "find_page_path", find)
    assert asyncio.run(social_routes._load_source_row(" " if missing == "empty" else "id")) == (
        None, None
    )
    assert calls == ([] if missing == "empty" else ["id"])


@pytest.mark.parametrize("failure", ["deny", "native", "http", "allow"])
def test_requires_preserves_record_identity_and_error_policy(
    monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    table: RegistryData = {None: object()}
    metadata: RegistryData = {7: object()}
    native_error = TypeError("synthetic native error")
    http_error = HTTPException(status_code=418, detail="synthetic")

    async def load(identifier: str) -> tuple[RegistryData, RegistryData]:
        return table, metadata

    def check(received: RegistryData, action: str, row: object) -> tuple[bool, str | None]:
        assert received is table and row is metadata
        assert action == action_rules.ACTION_PUBLISH_SOCIAL
        if failure == "native":
            raise native_error
        if failure == "http":
            raise http_error
        return failure == "allow", "synthetic denied"

    monkeypatch.setattr(social_routes, "_load_source_row", load)
    monkeypatch.setattr(action_rules, "check_requires", check)
    if failure in {"deny", "http"}:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(social_routes._check_publish_requires("source"))
        if failure == "http":
            assert caught.value is http_error
        else:
            assert caught.value.status_code == 409
            assert caught.value.detail == "synthetic denied"
    else:
        asyncio.run(social_routes._check_publish_requires("source"))


def test_publish_effect_forwards_same_table_and_keeps_persist_before_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    opaque = object()
    table: RegistryData = {"id": "table", None: opaque}
    metadata: RegistryData = {7: opaque, "status": "published"}
    prop: RegistryData = {"id": "status", None: opaque}
    events: list[str] = []

    async def load(identifier: str) -> tuple[RegistryData, RegistryData]:
        return table, metadata

    def effect(received: RegistryData, action: str, target: str) -> tuple[RegistryData, str, bool]:
        assert received is table and target == "source"
        assert action == action_rules.ACTION_PUBLISH_SOCIAL
        events.append("effect")
        return prop, "published", True

    def persist(identifier: object, values: list[object]) -> None:
        assert identifier == "table" and values == ["published"]
        events.append("persist")

    def read(row: object, field: RegistryData) -> str:
        assert row is metadata and field is prop
        events.append("read")
        return "published"

    monkeypatch.setattr(social_routes, "_load_source_row", load)
    monkeypatch.setattr(action_rules, "status_effect", effect)
    monkeypatch.setattr(vault_routes, "_ensure_status_options_persisted", persist)
    monkeypatch.setattr(action_rules, "read_prop_value", read)
    asyncio.run(social_routes._apply_publish_effect_to_source("source", BackgroundTasks()))
    assert events == ["effect", "persist", "read"]
    assert table[None] is metadata[7] is prop[None] is opaque
