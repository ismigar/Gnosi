"""Filesystem containment and state-owner regressions for vault assets/files."""

from __future__ import annotations

import asyncio
import os
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException, UploadFile
from starlette.datastructures import Headers

from backend.domains.vault.assets.service import AssetDependencies, upload_icon
from backend.domains.vault.files.local_service import (
    DeleteFileDependencies,
    LocalFileDependencies,
    delete_physical_file,
    serve_local_file,
)
from backend.domains.vault.files.serving import serve_file_with_containment
from backend.domains.vault.files.state import FileServingState, LocalLinkStore
from backend.platform.files.local import LocalProvider


class PendingImageProvider(LocalProvider):
    def __init__(self) -> None:
        self.scheduled: list[Path] = []

    def is_online_only(
        self,
        _container_path: Path,
        _stat_result: os.stat_result | None = None,
    ) -> bool:
        return True

    def schedule_warmup(self, container_path: Path) -> None:
        self.scheduled.append(container_path)


def _path_provider(vault: Path):
    def get_path(key: str) -> Path:
        if key == "VAULT":
            return vault
        if key == "ASSETS":
            return vault / "Assets"
        if key == "LIBRARY":
            return vault / "Library"
        raise KeyError(key)

    return get_path


def test_contained_serving_preserves_headers_and_rejects_escape(tmp_path: Path) -> None:
    root = tmp_path / "Assets"
    root.mkdir()
    asset = root / "guide.pdf"
    asset.write_bytes(b"pdf")
    outside = tmp_path / "secret.txt"
    outside.write_text("secret", encoding="utf-8")
    state = FileServingState()
    provider = LocalProvider()

    response = asyncio.run(
        serve_file_with_containment(
            root,
            "guide.pdf",
            state=state,
            provider=provider,
        )
    )
    assert Path(response.path) == asset
    assert response.headers["cache-control"] == "public, max-age=300"

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            serve_file_with_containment(
                root,
                "../secret.txt",
                state=state,
                provider=provider,
            )
        )
    assert exc_info.value.status_code == 403
    assert outside.read_text(encoding="utf-8") == "secret"


def test_online_only_image_schedules_warmup_and_fails_fast_with_retry(
    tmp_path: Path,
) -> None:
    root = tmp_path / "Assets"
    root.mkdir()
    image = root / "icon.png"
    image.write_bytes(b"logical cloud image")
    provider = PendingImageProvider()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            serve_file_with_containment(
                root,
                "icon.png",
                state=FileServingState(),
                provider=provider,
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.headers == {
        "Cache-Control": "no-store, must-revalidate",
        "Retry-After": "3",
    }
    assert provider.scheduled == [image]


def test_local_link_store_reuses_tokens_and_persists_once(tmp_path: Path) -> None:
    store = LocalLinkStore(lambda: tmp_path / "data")
    token = store.token_for("/tmp/example.pdf")

    assert store.token_for("/tmp/example.pdf") == token
    assert store.get(token) == "/tmp/example.pdf"
    assert store.snapshot() == {token: "/tmp/example.pdf"}

    store.remove(token)
    assert store.get(token) is None


def test_local_file_serving_rejects_token_outside_allowed_roots(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / "home"
    vault = tmp_path / "vault"
    outside = tmp_path / "outside"
    home.mkdir()
    vault.mkdir()
    outside.mkdir()
    file_path = outside / "secret.txt"
    file_path.write_text("secret", encoding="utf-8")
    monkeypatch.setenv("HOME_HOST_PATH", str(home))

    store = LocalLinkStore(lambda: tmp_path / "data")
    token = store.token_for(str(file_path))

    async def materialize(_path: Path, _label: str) -> None:
        return None

    dependencies = LocalFileDependencies(
        store=store,
        resolve_target=lambda _raw: None,
        materialize=materialize,
        classify_kind=lambda _extension: "other",
        get_path=_path_provider(vault),
        provider=LocalProvider,
    )
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(serve_local_file(token, None, dependencies))
    assert exc_info.value.status_code == 403


def test_physical_asset_delete_is_contained(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    assets = vault / "Assets"
    assets.mkdir(parents=True)
    target = assets / "remove.txt"
    target.write_text("remove", encoding="utf-8")
    outside = vault / "outside.txt"
    outside.write_text("keep", encoding="utf-8")
    store = LocalLinkStore(lambda: tmp_path / "data")
    dependencies = DeleteFileDependencies(
        store=store,
        get_path=_path_provider(vault),
        expand_host_tilde=lambda value: value,
        reroot_attachment=lambda _value: None,
        move_to_trash=lambda _value: (True, ""),
    )

    result = asyncio.run(
        delete_physical_file(
            {"target": "/api/vault/assets/remove.txt"},
            dependencies,
        )
    )
    assert result["status"] == "deleted"
    assert not target.exists()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            delete_physical_file(
                {"target": "/api/vault/assets/../outside.txt"},
                dependencies,
            )
        )
    assert exc_info.value.status_code == 400
    assert outside.read_text(encoding="utf-8") == "keep"


def test_icon_background_callback_keeps_two_argument_contract(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    (vault / "Assets").mkdir(parents=True)
    dependencies = AssetDependencies(
        get_path=_path_provider(vault),
        save_uploaded_asset=lambda _upload, _target, _name: "Assets/x",
        load_registry=lambda: {},
        resolve_table=lambda _table_id, _registry: (None, None),
        table_assets_dir=lambda _table, _database: vault / "Assets",
        safe_write_bytes=lambda path, payload: path.write_bytes(payload),
        validate_external_url=lambda _url: (True, ""),
    )
    upload = UploadFile(
        file=BytesIO(b"not-decoded-until-background"),
        filename="icon.png",
        headers=Headers({"content-type": "image/png"}),
    )
    tasks = BackgroundTasks()

    def thumbnail_callback(_path: Path, _digest: str) -> str | None:
        return None

    result = asyncio.run(upload_icon(tasks, upload, dependencies, thumbnail_callback))
    assert result["url"] is not None
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].func is thumbnail_callback
    assert len(tasks.tasks[0].args) == 2
