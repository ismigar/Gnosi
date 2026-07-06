"""Contenció de path a l'eina d'agent `read_pdf`.

El `path` ve de l'LLM (prompt-injectable via contingut no confiable que l'agent
llegeix). Sense contenció, una ruta absoluta o un `../` llegia qualsevol PDF del
sistema i en tornava el text a la conversa (exfiltració). `read_pdf` ha de
confinar la lectura al vault actiu (mateix patró que `_safe_directive_path`).
"""
import backend.services.context_vars as cv
from backend.agent.vault_tools import read_pdf


def _call(path):
    return read_pdf.func(path) if hasattr(read_pdf, "func") else read_pdf(path)


def _make_pdf(path):
    from pypdf import PdfWriter
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    with open(path, "wb") as f:
        w.write(f)


def test_pdf_inside_vault_is_allowed(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    (vault / "Assets").mkdir(parents=True)
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: vault)
    _make_pdf(vault / "Assets" / "doc.pdf")

    out = _call("Assets/doc.pdf")
    # Contenció superada (pàgina en blanc → sense text extraïble, però NO denegat).
    assert not out.startswith("Accés denegat")
    assert "extraïble" in out or out  # llegeix, no bloqueja


def test_absolute_path_outside_vault_denied(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: vault)
    outside = tmp_path / "secret.pdf"
    _make_pdf(outside)

    out = _call(str(outside))
    assert out.startswith("Accés denegat"), f"hauria de denegar, retorna: {out[:80]}"


def test_relative_traversal_denied(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: vault)
    # Un PDF real just fora del vault; el `../` intenta arribar-hi.
    _make_pdf(tmp_path / "outside.pdf")

    out = _call("../outside.pdf")
    assert out.startswith("Accés denegat"), f"hauria de denegar, retorna: {out[:80]}"


def test_no_active_vault(monkeypatch):
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: None)
    out = _call("Assets/x.pdf")
    assert "vault actiu" in out
