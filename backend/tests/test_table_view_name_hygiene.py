"""Tests for table/view label normalization at the registry boundary."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.api import vault_routes as vr  # noqa: E402


def test_normalize_table_view_name_removes_emoji_everywhere():
    assert vr._normalize_table_view_name("📚 Projectes 🚀", "View") == "Projectes"
    assert vr._normalize_table_view_name("📚🚀", "View") == "View"
    assert vr._normalize_table_view_name("  Àrees   i notes  ", "View") == "Àrees i notes"


def test_registry_migration_names_main_view_after_table_name():
    registry = {
        "tables": [{"id": "t1", "name": "📚 Projectes"}],
        "views": [
            {"id": "v-main", "table_id": "t1", "name": "📋 Taula Principal"},
            {"id": "v-custom", "table_id": "t1", "name": "🚀 Per estat"},
        ],
    }

    assert vr._normalize_registry_table_view_names(registry) is True
    assert registry["tables"][0]["name"] == "Projectes"
    assert registry["views"][0]["name"] == "Projectes"
    assert registry["views"][0]["is_main"] is True
    assert registry["views"][1]["name"] == "Per estat"
    assert vr._normalize_registry_table_view_names(registry) is False


def test_ensure_main_view_uses_table_name_and_keeps_lock_marker():
    registry = {
        "tables": [{"id": "t1", "name": "Projectes"}],
        "views": [{"id": "v1", "table_id": "t1", "name": "Raw"}],
    }

    main = vr._ensure_main_view(registry, "t1")

    assert main is registry["views"][0]
    assert main["name"] == "Projectes"
    assert main["is_main"] is True


def test_create_and_update_view_strip_emoji_before_save(monkeypatch):
    registry = {
        "tables": [{"id": "t1", "name": "Projectes"}],
        "views": [],
    }
    monkeypatch.setattr(vr, "load_registry", lambda: registry)
    monkeypatch.setattr(vr, "save_registry", lambda _registry: None)

    created = asyncio.run(
        vr.create_view({"id": "v1", "table_id": "t1", "name": "🚀 Per estat"})
    )
    assert created["name"] == "Per estat"

    asyncio.run(vr.update_view("v1", {"name": "📌 Per data"}))
    assert registry["views"][0]["name"] == "Per data"


def test_main_view_update_is_forced_back_to_table_name(monkeypatch):
    registry = {
        "tables": [{"id": "t1", "name": "Projectes"}],
        "views": [{"id": "v1", "table_id": "t1", "name": "Projectes", "is_main": True}],
    }
    monkeypatch.setattr(vr, "load_registry", lambda: registry)
    monkeypatch.setattr(vr, "save_registry", lambda _registry: None)

    asyncio.run(vr.update_view("v1", {"name": "🚧 Un altre nom"}))

    assert registry["views"][0]["name"] == "Projectes"
    assert registry["views"][0]["is_main"] is True
