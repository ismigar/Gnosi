"""Clobber guard for the central registry (vault_db_registry.json).

2026-07-14 incident: a second Mac started Gnosi against the same OneDrive
vault, read the registry as EMPTY (dataless/unsynced placeholder) and
`ensure_default_registry_structure()` reseeded the default structure over a
registry holding 16 tables / 797 views; cloud sync propagated the clobber to
every device (recovered from a `.bak-*`).

The guard has two layers (both in `vault_routes`):

- Seed side: `_ensure_default_registry_structure_locked` aborts when the
  registry reads empty but the vault shows signs of a PRIOR registry —
  `vault_db_registry.bak-*` backups / conflict copies next to it, non-empty
  table folders inside `BD/`, or a registry file that exists but can't be
  parsed (the dataless-placeholder case).
- Save side: `save_registry` refuses a degenerate payload (no databases and no
  tables) on a path this process has NEVER seen non-degenerate. Deliberate
  flows (the user deletes the last database) still work: the earlier
  successful load marks the path in `_registry_seen_nondegenerate`.

Style reference: `test_vault_registry_race.py` (monkeypatch module globals,
no live backend needed).
"""
import json
import threading
from types import SimpleNamespace

import pytest

import backend.api.vault_routes as vr

GOOD_REGISTRY = {
    "databases": [{"id": "db-real", "name": "Real", "folder": "BD/Real"}],
    "tables": [{"id": "t1", "name": "Taula", "database_id": "db-real", "folder": "BD/Real/Taula"}],
    "views": [{"id": "v1", "table_id": "t1", "name": "Vista"}],
}

EMPTY_REGISTRY = {"databases": [], "tables": [], "views": []}


@pytest.fixture()
def vault(tmp_path, monkeypatch):
    """Isolated vault on tmp_path with all per-process registry state reset."""
    bd = tmp_path / "BD"
    bd.mkdir()
    reg = bd / "vault_db_registry.json"

    def fake_get_p(key):
        mapping = {
            "REGISTRY": reg,
            "DATABASES": bd,
            "VAULT": tmp_path,
        }
        return mapping.get(key, tmp_path / key.lower())

    monkeypatch.setattr(vr, "get_p", fake_get_p)
    monkeypatch.setattr(vr, "_registry_cache", {})
    monkeypatch.setattr(vr, "_registry_cache_ts", {})
    monkeypatch.setattr(vr, "_registry_cache_mtime", {})
    monkeypatch.setattr(vr, "_registry_ensured_tables", set())
    monkeypatch.setattr(vr, "_registry_seen_nondegenerate", set())
    monkeypatch.setattr(vr, "_registry_mutation_lock", threading.RLock())
    return SimpleNamespace(root=tmp_path, bd=bd, reg=reg)


# ---------------------------------------------------------------- seed side


def test_seed_aborted_when_backup_exists(vault):
    """Registry missing but a .bak-* sits next to it → the vault HAD a registry;
    the default seed must not create one over it."""
    (vault.bd / "vault_db_registry.bak-del-adjunts-20260711.json").write_text(
        json.dumps(GOOD_REGISTRY), encoding="utf-8"
    )

    vr.ensure_default_registry_structure()

    assert not vault.reg.exists(), "el seed ha escrit el default sobre un vault amb backup"


def test_seed_aborted_when_conflict_copy_exists(vault):
    """OneDrive conflict copies (vault_db_registry-<Device> (N).json) are the
    signature of the 2026-07-14 device clash — also a data signal."""
    (vault.bd / "vault_db_registry-MacBook Pro de Ismael (2).json").write_text(
        json.dumps(GOOD_REGISTRY), encoding="utf-8"
    )

    vr.ensure_default_registry_structure()

    assert not vault.reg.exists()


def test_seed_aborted_when_bd_has_nonempty_table_folders(vault):
    """Registry reads empty but BD/ holds table folders with pages → prior data."""
    vault.reg.write_text(json.dumps(EMPTY_REGISTRY), encoding="utf-8")
    table_dir = vault.bd / "Recursos"
    table_dir.mkdir()
    (table_dir / "una-pagina.md").write_text("---\nid: x\n---\n", encoding="utf-8")

    vr.ensure_default_registry_structure()

    on_disk = json.loads(vault.reg.read_text(encoding="utf-8"))
    assert on_disk == EMPTY_REGISTRY, "el seed ha sembrat el default sobre un BD/ amb dades"


def test_seed_aborted_when_registry_unreadable(vault):
    """File exists but can't be parsed (dataless cloud placeholder / half sync):
    treat it as the good copy and leave the bytes alone."""
    vault.reg.write_text("{corrupt", encoding="utf-8")

    vr.ensure_default_registry_structure()

    assert vault.reg.read_text(encoding="utf-8") == "{corrupt"


def test_seed_runs_on_truly_fresh_vault(vault):
    """No registry, no backups, BD/ empty → the default seed still works."""
    vr.ensure_default_registry_structure()

    on_disk = json.loads(vault.reg.read_text(encoding="utf-8"))
    ids = {d["id"] for d in on_disk["databases"]}
    assert "gnosi_vault_db" in ids


def test_seed_ignores_empty_and_hidden_dirs(vault):
    """Empty scaffolding folders and dot-dirs (.trash/.history) are NOT data signals."""
    (vault.bd / "EmptyTable").mkdir()
    trash = vault.bd / ".trash"
    trash.mkdir()
    (trash / "old.md").write_text("x", encoding="utf-8")

    vr.ensure_default_registry_structure()

    assert vault.reg.exists(), "carpetes buides/ocultes no haurien de blocar el seed"


# ---------------------------------------------------------------- save side


def test_save_blocks_degenerate_overwrite_of_unread_registry(vault):
    """A good registry on disk that this process never read → a degenerate save
    is a misread being written back; the file must stay intact."""
    vault.reg.write_text(json.dumps(GOOD_REGISTRY), encoding="utf-8")

    vr.save_registry(dict(EMPTY_REGISTRY))

    on_disk = json.loads(vault.reg.read_text(encoding="utf-8"))
    assert on_disk == GOOD_REGISTRY, "save_registry ha clobberat el registre bo"


def test_save_blocks_degenerate_when_only_backups_exist(vault):
    """No readable registry, but backups next to it → still refuse."""
    (vault.bd / "vault_db_registry.bak-20260711.json").write_text(
        json.dumps(GOOD_REGISTRY), encoding="utf-8"
    )

    vr.save_registry(dict(EMPTY_REGISTRY))

    assert not vault.reg.exists()


def test_load_registry_does_not_require_optional_status_migration(vault, monkeypatch):
    """Registry loading remains valid without an optional status migrator."""
    vault.reg.write_text(json.dumps(GOOD_REGISTRY), encoding="utf-8")
    monkeypatch.delattr(
        vr.option_catalogs_service,
        "ensure_global_status_catalog",
        raising=False,
    )

    loaded = vr.load_registry()

    assert loaded["databases"], "registry loading must not depend on the optional migrator"


def test_save_allows_degenerate_after_process_read_good_registry(vault):
    """Deliberate flow: the process loaded the real registry, the user then
    deleted everything → the degenerate save must go through."""
    vault.reg.write_text(json.dumps(GOOD_REGISTRY), encoding="utf-8")
    loaded = vr.load_registry()
    assert loaded["databases"], "precondició: la càrrega ha de veure el registre bo"

    vr.save_registry(dict(EMPTY_REGISTRY))

    on_disk = json.loads(vault.reg.read_text(encoding="utf-8"))
    assert on_disk["databases"] == [] and on_disk["tables"] == []


def test_save_allows_degenerate_on_fresh_vault(vault):
    """Brand-new vault (no file, no signals): writing an empty skeleton is fine."""
    vr.save_registry(dict(EMPTY_REGISTRY))

    on_disk = json.loads(vault.reg.read_text(encoding="utf-8"))
    assert on_disk == EMPTY_REGISTRY


def test_save_nondegenerate_always_allowed_and_marks_path(vault):
    """A structured save always writes, and marks the path so a LATER degenerate
    save (same process) is treated as deliberate."""
    vr.save_registry(json.loads(json.dumps(GOOD_REGISTRY)))
    assert json.loads(vault.reg.read_text(encoding="utf-8")) == GOOD_REGISTRY

    vr.save_registry(dict(EMPTY_REGISTRY))
    on_disk = json.loads(vault.reg.read_text(encoding="utf-8"))
    assert on_disk == EMPTY_REGISTRY
