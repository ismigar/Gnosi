"""PathResolver.add_file/remove_file — freshness without waiting for the full rescan.

`update_index` only runs during the vault rescan (600s cooldown, and only if someone
hits GET /pages). Without `add_file`, a newly CREATED page wasn't added to the file
list (invisible to /unlinked-mentions — reproduced against the real backend
with 3 new pages — and to the rule_engine's find_path), and a RENAMED page
was left there with the old path (`find_path` → None because the old path
no longer exists).
"""
from pathlib import Path

import pytest

from backend.services.path_resolver import PathResolver


@pytest.fixture()
def resolver(tmp_path):
    r = PathResolver()
    vault = tmp_path / "vault"
    vault.mkdir()
    # Initial state as left by the full rescan.
    a = vault / "a.md"
    a.write_text("a", encoding="utf-8")
    r.update_index(vault, {"id-a": str(a)}, [a])
    return r, vault


def test_add_file_registers_new_page(resolver, tmp_path):
    r, vault = resolver
    b = vault / "b.md"
    b.write_text("b", encoding="utf-8")

    r.add_file(vault, "id-b", b)

    assert r.find_path("id-b", vault) == b
    assert b in r.list_all_files(vault)
    # Idempotent: re-adding doesn't duplicate in the list.
    r.add_file(vault, "id-b", b)
    assert r.list_all_files(vault).count(b) == 1


def test_add_file_relocates_renamed_page(resolver):
    r, vault = resolver
    renamed = vault / "a-renombrada.md"
    renamed.write_text("a", encoding="utf-8")

    r.add_file(vault, "id-a", renamed)

    assert r.find_path("id-a", vault) == renamed
    files = r.list_all_files(vault)
    assert renamed in files
    assert vault / "a.md" not in files, "el path antic ha de sortir de la llista"


def test_remove_file_unregisters(resolver):
    r, vault = resolver
    a = vault / "a.md"

    r.remove_file(vault, "id-a", a)

    assert r.find_path("id-a", vault) is None
    # List without the file (and without falling back to rglob with the rest).
    assert a not in (r._vault_files.get(str(vault)) or [])
