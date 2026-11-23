"""The home layout is private to an authenticated actor's selected Vault."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.domains.vault.home_canvas import HomeCanvasBlock, HomeCanvasState, get_home_canvas, save_home_canvas
from backend.services.workspace_service import WorkspaceContext


def test_layout_reopens_with_order_width_settings_and_actor_scope(tmp_path):
    owner = WorkspaceContext("research", "reader", "viewer", tmp_path)
    initial = get_home_canvas(owner)
    assert initial.start_mode == "page" and initial.blocks is None
    assert not (tmp_path / ".gnosi").exists()
    cards = [
        HomeCanvasBlock(id="first", kind="board", width=3, settings={"boardId": "reading"}),
        HomeCanvasBlock(id="second", kind="board", width=1, settings={"boardId": "writing"}),
    ]
    request = HomeCanvasState(start_mode="canvas", blocks=cards)
    saved = save_home_canvas(request, owner)
    assert saved.revision and get_home_canvas(owner) == saved
    assert save_home_canvas(request, owner) == saved
    assert get_home_canvas(WorkspaceContext("research", "someone-else", "owner", tmp_path)) == initial
    assert get_home_canvas(WorkspaceContext("other", "reader", "owner", tmp_path)) == initial
    other = tmp_path / "another-vault"
    other.mkdir()
    assert get_home_canvas(WorkspaceContext("research", "reader", "viewer", other)) == initial
    empty = save_home_canvas(HomeCanvasState(revision=saved.revision, blocks=[]), owner)
    assert empty.revision != saved.revision and get_home_canvas(owner).blocks == []


def test_concurrent_edits_do_not_silently_overwrite_the_saved_layout(tmp_path):
    scope = WorkspaceContext("workspace", "member", "editor", tmp_path)

    def save(name):
        block = HomeCanvasBlock(id=name, kind="graph", width=1)
        try:
            save_home_canvas(HomeCanvasState(blocks=[block]), scope)
        except HTTPException as error:
            return error.status_code
        return 200

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, ["one", "two"])) == [200, 409]
    assert len(get_home_canvas(scope).blocks) == 1


def test_unreadable_existing_metadata_and_duplicate_ids_are_preserved(tmp_path):
    scope = WorkspaceContext("w", "u", "owner", tmp_path)
    save_home_canvas(HomeCanvasState(blocks=[]), scope)
    stored = next((tmp_path / ".gnosi" / "home").glob("*.json"))
    stored.write_text("interrupted document")
    with pytest.raises(HTTPException) as failure:
        save_home_canvas(HomeCanvasState(start_mode="canvas"), scope)
    assert failure.value.status_code == 422 and stored.read_text() == "interrupted document"
    card = HomeCanvasBlock(kind="board", id="unique", width=2)
    with pytest.raises(ValidationError):
        HomeCanvasState(blocks=[card, card])
