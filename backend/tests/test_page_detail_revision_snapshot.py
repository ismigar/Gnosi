"""A detail response keeps the revision of the bytes it actually read."""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.domains.vault.api import pages_queries
from backend.domains.vault.schemas.pages import PageDetailResponse
from backend.utils.safe_io import file_etag


@pytest.mark.parametrize("change", ["rename", "replace"])
def test_detail_revision_matches_read_content_during_concurrent_save(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    path = tmp_path / "Original title.md"
    path.write_text("Original body", encoding="utf-8")
    original_revision = file_etag(path)
    assert original_revision

    async def materialize(_path: Path, _page_id: str) -> None:
        pass

    def resolve_title(metadata: dict[str, str], _path: Path) -> str:
        # The body is already read when the async title resolver runs. Model
        # an atomic save/rename before response assembly, without timing sleeps.
        if change == "rename":
            path.rename(tmp_path / "Changed title.md")
        else:
            replacement = tmp_path / "replacement.md"
            replacement.write_text("A different concurrent body", encoding="utf-8")
            replacement.replace(path)
        return metadata["title"]

    dependencies = SimpleNamespace(
        find_page=lambda _id: path,
        materialize_page=materialize,
        is_dashboard=lambda _path: False,
        parse_frontmatter=lambda raw, _path: ({"id": "page", "title": "Original title"}, raw),
        resolve_title=resolve_title,
        enrich_single_page=lambda metadata, *_args: (metadata, "Wiki", None),
        file_etag=file_etag,
    )
    monkeypatch.setattr(pages_queries, "_deps", lambda: dependencies)
    response = PageDetailResponse.model_validate(asyncio.run(pages_queries.get_page("page")))
    assert response.content == "Original body"
    assert response.title == "Original title"
    assert response.etag == original_revision
    assert file_etag(path) != response.etag
