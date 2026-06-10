"""Tests de seguretat de MediaService.upload_media (path traversal + atomicitat).

What we cover:
    - album amb ".." (pla o niat) → HTTP 400 i res escrit fora d'Images/
    - album absolut ("/etc") → contingut dins d'Images/ (no escapa)
    - filename amb separadors/".." → es desa DINS l'àlbum amb nom pla
    - àlbum niat legítim ("Viatges/2024") segueix funcionant
    - col·lisió de nom → el contingut original NO se sobreescriu
    - symlink dins Images apuntant fora → 400 (contenció post-resolve)

Veure docs/dev_memory/directives/media_upload_path_safety.md.

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
    """Vault temporal aïllat: Images/ es crea sota tmp_path."""
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
    # Cap fitxer nou enlloc (ni dins ni fora del vault)
    assert _files_under(vault.parent) == before


def test_album_absolute_path_contained(vault: Path):
    svc = MediaService()
    info = svc.upload_media(_upload("a.jpg"), album="/etc")
    written = vault / "Images" / "etc" / info["filename"]
    assert written.is_file()
    # Res fora d'Images
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
