"""Path containment in the agent tool `create_page` (arg `folder`).

Sanitizing `folder` (which comes from the LLM) strips dots but keeps
slashes: "../../etc" → "///etc", and `vault / "///etc"` becomes absolute (/etc),
discarding the vault prefix → writing the .md OUTSIDE the vault. The
containment confines the destination to the vault (falls back to the default folder).
"""
import backend.services.context_vars as cv
import backend.api.vault_routes as vr
from backend.agent.vault_tools import create_page


def _call(**kw):
    f = create_page.func if hasattr(create_page, "func") else create_page
    return f(**kw)


def _setup(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(vr, "register_page_in_index", lambda p: None)
    return vault


def _all_inside(vault):
    root = vault.resolve()
    pages = list(vault.rglob("*.md"))
    return pages and all(root in p.resolve().parents for p in pages)


def test_escaping_folder_contained_to_vault(monkeypatch, tmp_path):
    vault = _setup(monkeypatch, tmp_path)
    outside = tmp_path / "Desktop"
    outside.mkdir()

    _call(title="Malici", content="x", folder="../../../../Desktop")

    assert list(outside.rglob("*.md")) == [], "no s'ha d'escriure fora del vault"
    assert _all_inside(vault), "la pàgina s'ha de crear DINS del vault"


def test_absolute_escape_contained(monkeypatch, tmp_path):
    vault = _setup(monkeypatch, tmp_path)
    _call(title="X", folder="../../../etc")
    assert _all_inside(vault)


def test_legit_folder_still_works(monkeypatch, tmp_path):
    vault = _setup(monkeypatch, tmp_path)
    _call(title="Nota", folder="Articles")
    assert (vault / "Articles").exists()
    assert list((vault / "Articles").glob("*.md")), "la carpeta legítima ha de funcionar"


def test_nested_legit_folder(monkeypatch, tmp_path):
    vault = _setup(monkeypatch, tmp_path)
    _call(title="Sub", folder="Cervell/Notes")
    assert list((vault / "Cervell" / "Notes").glob("*.md"))
