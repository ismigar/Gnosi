"""Test del mòdul de sidecar per a metadata interna de pàgina.

Vegeu `docs/dev_memory/directives/sidecar_internal_metadata.md`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.page_sidecar import (
    apply_sidecar_to,
    delete_sidecar,
    is_sidecar_key,
    persist_sidecar_from,
    read_sidecar,
    sidecar_path_for,
    split_metadata,
    write_sidecar,
)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    """Vault minimal amb `.gnosi/` per a què `vault_root_for` el detecti."""
    (tmp_path / ".gnosi").mkdir()
    return tmp_path


def test_is_sidecar_key_static():
    assert is_sidecar_key("is_template")
    assert is_sidecar_key("is_default_template")
    # Manual flag dinàmic
    assert is_sidecar_key("title_manual")
    assert is_sidecar_key("tags_manual")
    # Camps normals
    assert not is_sidecar_key("title")
    assert not is_sidecar_key("tags")
    assert not is_sidecar_key("id")
    # Edge: claus que NO acaben amb "_manual"
    assert not is_sidecar_key("manual")
    assert not is_sidecar_key("manualization")
    # Tipus no-string
    assert not is_sidecar_key(None)  # type: ignore[arg-type]


def test_split_metadata_separates_internal_flags():
    meta = {
        "id": "abc",
        "title": "Foo",
        "tags": ["a", "b"],
        "is_template": True,
        "title_manual": True,
    }
    fm, sc = split_metadata(meta)
    assert fm == {"id": "abc", "title": "Foo", "tags": ["a", "b"]}
    assert sc == {"is_template": True, "title_manual": True}
    # No mutar l'entrada
    assert "is_template" in meta


def test_split_metadata_empty():
    assert split_metadata({}) == ({}, {})
    assert split_metadata(None) == ({}, {})  # type: ignore[arg-type]


def test_write_read_round_trip(vault: Path):
    write_sidecar(vault, "page-1", {"is_template": True, "title_manual": True})
    assert sidecar_path_for(vault, "page-1").exists()
    data = read_sidecar(vault, "page-1")
    assert data == {"is_template": True, "title_manual": True}


def test_write_empty_dict_removes_file(vault: Path):
    write_sidecar(vault, "p", {"is_template": True})
    assert sidecar_path_for(vault, "p").exists()
    write_sidecar(vault, "p", {})
    assert not sidecar_path_for(vault, "p").exists()


def test_read_sidecar_missing_returns_empty(vault: Path):
    assert read_sidecar(vault, "no-such-page") == {}


def test_read_sidecar_corrupt_returns_empty(vault: Path):
    path = sidecar_path_for(vault, "p")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{not json")
    assert read_sidecar(vault, "p") == {}


def test_delete_sidecar(vault: Path):
    write_sidecar(vault, "p", {"is_template": True})
    delete_sidecar(vault, "p")
    assert not sidecar_path_for(vault, "p").exists()
    # Idempotent — segona crida no peta
    delete_sidecar(vault, "p")


def test_apply_sidecar_to_merges(vault: Path):
    write_sidecar(vault, "abc", {"is_template": True})
    fake_md = vault / "Wiki" / "page.md"
    fake_md.parent.mkdir(parents=True, exist_ok=True)
    fake_md.write_text("---\nid: abc\ntitle: Hi\n---\n")
    meta = {"id": "abc", "title": "Hi"}
    merged = apply_sidecar_to(meta, fake_md)
    assert merged["title"] == "Hi"
    assert merged["is_template"] is True
    # No mutar
    assert "is_template" not in meta


def test_apply_sidecar_no_id_returns_unchanged(vault: Path):
    fake_md = vault / "Wiki" / "page.md"
    fake_md.parent.mkdir(parents=True, exist_ok=True)
    meta = {"title": "Sense id"}
    assert apply_sidecar_to(meta, fake_md) == {"title": "Sense id"}


def test_apply_sidecar_no_vault_returns_unchanged(tmp_path: Path):
    # tmp_path sense `.gnosi/` → no és vault
    fake_md = tmp_path / "page.md"
    meta = {"id": "abc", "title": "X"}
    assert apply_sidecar_to(meta, fake_md) == meta


def test_persist_sidecar_from_writes_and_strips(vault: Path):
    fake_md = vault / "page.md"
    meta = {"id": "abc", "title": "Hi", "is_template": True, "title_manual": True}
    fm = persist_sidecar_from(meta, fake_md)
    assert fm == {"id": "abc", "title": "Hi"}
    # Sidecar persistit
    assert read_sidecar(vault, "abc") == {
        "is_template": True,
        "title_manual": True,
    }


def test_persist_sidecar_no_id_returns_full_metadata(vault: Path):
    fake_md = vault / "page.md"
    meta = {"title": "Sense id", "is_template": True}
    # Sense id, no podem fer sidecar; retornem el dict íntegre per a no perdre
    # flags al .md (fallback al comportament antic).
    fm = persist_sidecar_from(meta, fake_md)
    assert fm == meta


def test_persist_sidecar_empty_clears_existing(vault: Path):
    write_sidecar(vault, "abc", {"is_template": True})
    fake_md = vault / "page.md"
    meta = {"id": "abc", "title": "Hi"}  # cap flag interna
    fm = persist_sidecar_from(meta, fake_md)
    assert fm == {"id": "abc", "title": "Hi"}
    # El sidecar previ s'ha eliminat
    assert not sidecar_path_for(vault, "abc").exists()
