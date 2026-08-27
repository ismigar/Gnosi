"""Behavior and architecture contracts for the linkable document inventory."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from backend.domains.vault.links import document_inventory


def test_inventory_excludes_hidden_pages_and_reuses_fresh_cache(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    dashboards = tmp_path / "dashboards"
    alive = vault / "Alive.md"
    trashed = vault / ".trash" / "trashed" / "page.md"
    historical = vault / ".history" / "alive" / "old.md"
    dashboard = dashboards / "Board.json"
    for path in (alive, trashed, historical, dashboard):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(path.stem, encoding="utf-8")
    now = [100.0]
    parsed: list[str] = []
    cache: document_inventory.DocumentCache = {}

    def parse_page(path: Path) -> tuple[document_inventory.Metadata, str]:
        parsed.append(path.name)
        return {"id": path.stem.lower()}, path.read_text(encoding="utf-8")

    def unavailable_index(_vault: Path) -> list[Path]:
        raise RuntimeError("index warming")

    dependencies = document_inventory.DocumentInventoryDependencies(
        now=lambda: now[0],
        current_vault_key=lambda: str(vault),
        cache=cache,
        cache_lock=threading.Lock(),
        cache_ttl=60.0,
        vault_path=lambda: vault,
        list_markdown=unavailable_index,
        parsed_document=parse_page,
        dashboards_path=lambda: dashboards,
        read_dashboard=lambda path: ({"id": "board"}, path.read_text(encoding="utf-8")),
        logger=logging.getLogger(__name__),
    )

    first = document_inventory.linkable_documents(dependencies)
    second = document_inventory.linkable_documents(dependencies)

    assert first is second
    assert [(path.name, is_dashboard) for path, _metadata, _body, is_dashboard in first] == [
        ("Alive.md", False),
        ("Board.json", True),
    ]
    assert parsed == ["Alive.md"]


def test_document_inventory_domain_does_not_import_http_facade() -> None:
    source_path = Path(document_inventory.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
