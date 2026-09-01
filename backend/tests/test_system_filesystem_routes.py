"""Characterization tests for the provider-neutral system filesystem routes."""

import asyncio
import os
from pathlib import Path
from typing import Any

import pytest

from backend.api import system_routes


def test_scan_browse_directory_is_sorted_and_hides_dotfiles(tmp_path: Path) -> None:
    (tmp_path / "Beta").mkdir()
    (tmp_path / "alpha").mkdir()
    (tmp_path / ".hidden-dir").mkdir()
    (tmp_path / "Zeta.txt").write_text("z", encoding="utf-8")
    (tmp_path / "aardvark.txt").write_text("a", encoding="utf-8")
    (tmp_path / ".hidden.txt").write_text("secret", encoding="utf-8")

    result = system_routes._scan_browse_directory(
        tmp_path,
        "/host/vault",
        {"vault": "/host/vault", "home": None, "root": "/"},
    )

    assert result["directories"] == ["alpha", "Beta"]
    assert result["files"] == ["aardvark.txt", "Zeta.txt"]
    assert result["display_path"] == "/host/vault"


def test_priority_search_roots_include_generic_cloud_storage(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    home = tmp_path / "home"
    documents = home / "Documents"
    cloud_storage = home / "Library" / "CloudStorage"
    mobile_documents = home / "Library" / "Mobile Documents"
    for path in (vault, home, documents, cloud_storage, mobile_documents):
        path.mkdir(parents=True, exist_ok=True)

    roots, seen = system_routes._priority_search_roots(str(vault), str(home))

    assert roots == [
        vault.resolve(),
        documents.resolve(),
        cloud_storage.resolve(),
        mobile_documents.resolve(),
        home.resolve(),
    ]
    assert seen == {str(path) for path in roots}


def test_walk_filesystem_normalizes_names_and_maps_vault_host(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = tmp_path / "vault"
    home = tmp_path / "home"
    vault.mkdir()
    home.mkdir()
    decomposed_name = "e\u0301tica.md"
    (vault / decomposed_name).write_text("# test", encoding="utf-8")
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(vault))
    monkeypatch.setenv("VAULT_HOST_PATH", "/host/Gnosi")
    monkeypatch.setenv("HOME_HOST_PATH", str(home))

    state = system_routes._walk_filesystem("ética", 100)

    assert state.truncated is False
    assert state.results == [
        {
            "name": decomposed_name,
            "path": f"/host/Gnosi/{decomposed_name}",
            "is_dir": False,
        }
    ]


def test_walk_filesystem_preserves_partial_results_on_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = tmp_path / "vault"
    home = tmp_path / "home"
    vault.mkdir()
    home.mkdir()
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(vault))
    monkeypatch.setenv("HOME_HOST_PATH", str(home))

    def failing_walk(*_args: object, **_kwargs: object) -> Any:
        yield str(vault), [], ["match.md"]
        raise OSError("provider unavailable")

    monkeypatch.setattr(os, "walk", failing_walk)

    state = system_routes._walk_filesystem("match", 100)

    assert state.results == [{"name": "match.md", "path": str(vault / "match.md"), "is_dir": False}]
    assert state.error is not None
    assert state.error.startswith("Internal error [")
    assert state.error.endswith(": OSError")


def test_search_merges_index_before_host_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    helper_payload: dict[str, Any] = {
        "results": [
            {"name": "duplicate", "path": "/same", "is_dir": False},
            {"name": "host", "path": "/host", "is_dir": False},
        ],
        "truncated": False,
    }
    monkeypatch.setattr(
        system_routes,
        "_search_via_host_helper",
        lambda *_args, **_kwargs: helper_payload,
    )

    from backend.services import vault_file_index

    monkeypatch.setattr(vault_file_index, "is_ready", lambda: True)
    monkeypatch.setattr(
        vault_file_index,
        "query",
        lambda *_args: [
            {"name": "index", "path": "/index", "is_dir": False},
            {"name": "duplicate", "path": "/same", "is_dir": False},
        ],
    )

    result = asyncio.run(
        system_routes.search_filesystem(system_routes.SearchRequest(query="match", limit=10))
    )

    assert result == {
        "results": [
            {"name": "index", "path": "/index", "is_dir": False},
            {"name": "duplicate", "path": "/same", "is_dir": False},
            {"name": "host", "path": "/host", "is_dir": False},
        ],
        "truncated": False,
        "engine": "index+spotlight",
    }
