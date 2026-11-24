"""A user's home layout travels with the selected Vault."""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from filelock import FileLock, Timeout
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, model_validator

from backend.services.workspace_service import WorkspaceContext, get_workspace_context
from backend.utils.metadata_io import MetadataUnavailable, ensure_metadata_local, read_metadata_text
from backend.utils.safe_io import safe_write_json

Identifier = Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
SettingValue = Annotated[str, StringConstraints(max_length=2048)]
Revision = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]


class HomeCanvasBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Identifier
    kind: Identifier
    width: Literal[1, 2, 3]
    settings: dict[Identifier, SettingValue] = Field(default_factory=dict, max_length=16)


class HomeCanvasState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: Revision | None = None
    start_mode: Literal["page", "canvas"] = "page"
    # None uses the suggested layout. An intentionally empty canvas stays empty.
    blocks: list[HomeCanvasBlock] | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def unique_blocks(self) -> HomeCanvasState:
        blocks = self.blocks or []
        if len({block.id for block in blocks}) != len(blocks):
            raise ValueError("Block identifiers must be unique")
        return self


def _layout_path(context: WorkspaceContext) -> Path:
    # Resolve the registered Vault once. Layout metadata below it must still be local to this root.
    try:
        vault = Path(context.vault_path).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(503, "Vault is unavailable") from exc
    if not vault.is_dir():
        raise HTTPException(503, "Vault is unavailable")
    identity = json.dumps([context.workspace_id, context.user_id], separators=(",", ":"))
    filename = hashlib.sha256(identity.encode()).hexdigest() + ".json"
    path = vault / ".gnosi" / "home" / filename
    for entry in (vault, vault / ".gnosi", path.parent, path):
        if entry.is_symlink():
            raise HTTPException(409, "Home layout metadata cannot use symlinks")
        ensure_metadata_local(entry)
    return path


def _read(path: Path) -> HomeCanvasState:
    try:
        return HomeCanvasState.model_validate_json(read_metadata_text(path))
    except FileNotFoundError:
        return HomeCanvasState()
    except ValidationError as exc:
        raise HTTPException(422, "Existing home layout could not be read") from exc


def get_home_canvas(context: WorkspaceContext = Depends(get_workspace_context)) -> HomeCanvasState:
    try:
        return _read(_layout_path(context))
    except (MetadataUnavailable, OSError) as exc:
        raise HTTPException(503, "Home layout is temporarily unavailable") from exc


def save_home_canvas(state: HomeCanvasState, context: WorkspaceContext = Depends(get_workspace_context)) -> HomeCanvasState:
    try:
        path = _layout_path(context)
        key = hashlib.sha256(str(path).encode()).hexdigest()
        with FileLock(str(Path(tempfile.gettempdir()) / f"gnosi-home-{key}.lock"), timeout=10):
            current = _read(_layout_path(context))
            if state.blocks == current.blocks and state.start_mode == current.start_mode:
                return current
            if state.revision != current.revision:
                raise HTTPException(409, "The home layout changed in another session")
            saved = state.model_copy(update={"revision": uuid4().hex})
            safe_write_json(path, saved.model_dump())
            return saved
    except (MetadataUnavailable, OSError, Timeout) as exc:
        raise HTTPException(503, "Home layout could not be saved") from exc


def register_routes(router: APIRouter) -> None:
    router.add_api_route("/home-canvas", get_home_canvas, methods=["GET"], response_model=HomeCanvasState)
    router.add_api_route("/home-canvas", save_home_canvas, methods=["PUT"], response_model=HomeCanvasState)
