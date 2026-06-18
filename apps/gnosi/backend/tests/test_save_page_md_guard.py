"""Guarda anti-pèrdua de `save_page_md`: MAI escriure un `.md` sense `id`.

Regressió "frontmatter mutilat". Una nota sense `id` al frontmatter s'indexa
pel nom de fitxer (`metadata.get("id") or file_path.stem`), de manera que tots
els wikilinks per UUID que hi apunten passen a fer 404 silenciosament.
Vegeu la red flag a `docs/dev_memory/directives/wikilink_interactions.md`.

El bug real: `parse_frontmatter` torna `{}` en llegir un fitxer truncat/online
-only d'OneDrive; un PATCH de reparent hi afegeix només `parent_id` i el
desa → frontmatter amb només `parent_id`. La guarda a `save_page_md` recupera
l'`id` del disc (frontmatter o regex) o en genera un de nou.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from backend.api.vault_routes import parse_frontmatter, save_page_md

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    """Vault mínim amb `.gnosi/` perquè `persist_sidecar_from` el detecti."""
    (tmp_path / ".gnosi").mkdir()
    return tmp_path


def _read_fm(f: Path):
    md, _ = parse_frontmatter(f.read_text(encoding="utf-8"), f)
    md = md or {}
    return md.get("id"), md.get("title"), md.get("parent_id")


def test_normal_write_keeps_id(vault: Path):
    f = vault / "nota.md"
    save_page_md(
        f,
        {"id": "11111111-1111-4111-8111-111111111111", "title": "T", "parent_id": "P"},
        "cos",
    )
    _id, _title, _parent = _read_fm(f)
    assert _id == "11111111-1111-4111-8111-111111111111"
    assert _title == "T"
    assert _parent == "P"


def test_recovers_id_from_disk_when_caller_drops_it(vault: Path):
    """El cas EXACTE del bug: PATCH reparent amb metadata sense `id`."""
    f = vault / "nota.md"
    save_page_md(
        f,
        {"id": "22222222-2222-4222-8222-222222222222", "title": "Orig", "parent_id": "P1"},
        "cos",
    )
    # Caller buggy: metadata només amb parent_id (id perdut per parse→{}).
    save_page_md(f, {"parent_id": "P2"}, "cos2")
    _id, _title, _parent = _read_fm(f)
    assert _id == "22222222-2222-4222-8222-222222222222"  # recuperat del disc
    assert _parent == "P2"  # el canvi demanat s'aplica
    assert _title  # title no buit


def test_recovers_id_when_yaml_corrupt(vault: Path):
    """Frontmatter amb YAML invàlid però amb `id:` extraïble (regex/fallback)."""
    f = vault / "nota.md"
    f.write_text(
        "---\nid: 33333333-3333-4333-8333-333333333333\n\tbroken: : :\n---\ncos antic\n",
        encoding="utf-8",
    )
    save_page_md(f, {"parent_id": "P3"}, "cos nou")
    _id, _title, _parent = _read_fm(f)
    assert _id == "33333333-3333-4333-8333-333333333333"
    assert _parent == "P3"


def test_generates_uuid_when_unrecoverable(vault: Path):
    """Cap `id` recuperable → genera un uuid nou. MAI escriu sense `id`."""
    f = vault / "nova.md"  # no existeix
    save_page_md(f, {"parent_id": "P4"}, "cos")
    _id, _title, _parent = _read_fm(f)
    assert _id and UUID_RE.match(_id)
    assert _parent == "P4"


def test_never_writes_empty_frontmatter(vault: Path):
    """Ni amb metadata totalment buit el `.md` queda sense `id`."""
    f = vault / "buida.md"
    save_page_md(f, {}, "cos")
    _id, _title, _parent = _read_fm(f)
    assert _id and UUID_RE.match(_id)
