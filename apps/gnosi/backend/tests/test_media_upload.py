"""Security tests for MediaService.upload_media (path traversal + atomicity).

What we cover:
    - album with ".." (flat or nested) → HTTP 400 and nothing written outside Images/
    - absolute album ("/etc") → content stays inside Images/ (no escape)
    - filename with separators/".." → saved INSIDE the album with a flat name
    - legitimate nested album ("Viatges/2024") still works
    - name collision → the original content is NOT overwritten
    - symlink inside Images pointing outside → 400 (post-resolve containment)

See docs/dev_memory/directives/media_upload_path_safety.md.

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_media_upload.py -v
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from backend.services.context_vars import active_vault_path
from backend.services.media_service import MediaService


@pytest.fixture()
def vault(tmp_path: Path):
    """Isolated temporary vault: Images/ is created under tmp_path."""
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir()
    token = active_vault_path.set(vault_dir)
    try:
        yield vault_dir
    finally:
        active_vault_path.reset(token)


def _upload(name: str, data: bytes = b"contingut") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name)


def _files_under(root: Path) -> set:
    return {p for p in root.rglob("*") if p.is_file()}


@pytest.mark.parametrize(
    "album",
    [
        "../fora",
        "../../fora",
        "..",
        "Viatges/../../../fora",
        "Viatges/..",
        r"..\fora",
    ],
)
def test_album_traversal_rejected(vault: Path, album: str):
    svc = MediaService()
    before = _files_under(vault.parent)
    with pytest.raises(HTTPException) as exc:
        svc.upload_media(_upload("a.jpg"), album=album)
    assert exc.value.status_code == 400
    # No new file anywhere (neither inside nor outside the vault)
    assert _files_under(vault.parent) == before


def test_album_absolute_path_contained(vault: Path):
    svc = MediaService()
    info = svc.upload_media(_upload("a.jpg"), album="/etc")
    written = vault / "Images" / "etc" / info["filename"]
    assert written.is_file()
    # Nothing outside Images
    assert _files_under(vault.parent) == {written}


def test_filename_traversal_contained(vault: Path):
    svc = MediaService()
    info = svc.upload_media(_upload("../../../evil.bin", data=b"x"), album="General")
    assert "/" not in info["filename"] and "\\" not in info["filename"]
    written = vault / "Images" / "General" / info["filename"]
    assert written.is_file()
    assert written.read_bytes() == b"x"
    assert _files_under(vault.parent) == {written}


def test_nested_album_still_works(vault: Path):
    svc = MediaService()
    info = svc.upload_media(_upload("foto.jpg", data=b"jpg"), album="Viatges/2024")
    written = vault / "Images" / "Viatges" / "2024" / "foto.jpg"
    assert written.is_file()
    assert written.read_bytes() == b"jpg"
    assert info["filename"] == "foto.jpg"


def test_collision_does_not_overwrite(vault: Path):
    svc = MediaService()
    first = svc.upload_media(_upload("x.jpg", data=b"v1"), album="General")
    second = svc.upload_media(_upload("x.jpg", data=b"v2"), album="General")
    original = vault / "Images" / "General" / first["filename"]
    renamed = vault / "Images" / "General" / second["filename"]
    assert original.read_bytes() == b"v1"
    assert second["filename"] != first["filename"]
    assert renamed.read_bytes() == b"v2"


def test_empty_or_dotty_filename_gets_fallback(vault: Path):
    svc = MediaService()
    info = svc.upload_media(_upload("..", data=b"z"), album="General")
    assert info["filename"].startswith("upload-")
    written = vault / "Images" / "General" / info["filename"]
    assert written.read_bytes() == b"z"


def test_symlink_album_escape_rejected(vault: Path):
    svc = MediaService()
    outside = vault.parent / "outside"
    outside.mkdir()
    images = vault / "Images"
    images.mkdir(parents=True, exist_ok=True)
    (images / "link").symlink_to(outside, target_is_directory=True)
    with pytest.raises(HTTPException) as exc:
        svc.upload_media(_upload("a.jpg"), album="link")
    assert exc.value.status_code == 400
    assert _files_under(outside) == set()
