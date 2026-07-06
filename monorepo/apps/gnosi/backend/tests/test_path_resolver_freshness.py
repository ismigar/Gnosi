"""PathResolver.add_file/remove_file — frescor sense esperar el rescan complet.

`update_index` només corre al rescan de vault (cooldown 600s i només si algú
toca GET /pages). Sense `add_file`, una pàgina CREADA no entrava a la llista
de fitxers (invisible per a /unlinked-mentions — reproduït contra el backend
real amb 3 pàgines noves — i per al find_path del rule_engine), i una de
RENOMBRADA hi quedava amb el path antic (`find_path` → None perquè el path
vell ja no existeix).
"""
from pathlib import Path

import pytest

from backend.services.path_resolver import PathResolver


@pytest.fixture()
def resolver(tmp_path):
    r = PathResolver()
    vault = tmp_path / "vault"
    vault.mkdir()
    # Estat inicial com el deixa el rescan complet.
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
    # Idempotent: re-afegir no duplica a la llista.
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
    # Llista sense el fitxer (i sense caure al fallback rglob amb la resta).
    assert a not in (r._vault_files.get(str(vault)) or [])
