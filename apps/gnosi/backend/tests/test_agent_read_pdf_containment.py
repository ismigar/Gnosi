"""Path containment in the agent tool `read_pdf`.

`path` comes from the LLM (prompt-injectable via untrusted content that the agent
reads). Without containment, an absolute path or a `../` could read any PDF on the
system and return its text into the conversation (exfiltration). `read_pdf` must
confine reading to the active vault (same pattern as `_safe_directive_path`).
"""
import backend.services.context_vars as cv
from backend.agent.vault_tools import read_pdf


def _call(path, max_chars=12000):
    return (
        read_pdf.func(path, max_chars)
        if hasattr(read_pdf, "func")
        else read_pdf(path, max_chars)
    )


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
    # Containment passed (blank page → no extractable text, but NOT denied).
    assert not out.startswith("Access denied")
    assert "extractable" in out or out  # reads, doesn't block


def test_absolute_path_outside_vault_denied(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: vault)
    outside = tmp_path / "secret.pdf"
    _make_pdf(outside)

    out = _call(str(outside))
    assert out.startswith("Access denied"), f"expected access denial, got: {out[:80]}"


def test_relative_traversal_denied(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: vault)
    # A real PDF just outside the vault; the `../` tries to reach it.
    _make_pdf(tmp_path / "outside.pdf")

    out = _call("../outside.pdf")
    assert out.startswith("Access denied"), f"expected access denial, got: {out[:80]}"


def test_no_active_vault(monkeypatch):
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: None)
    out = _call("Assets/x.pdf")
    assert "active vault" in out


def test_pdf_model_limit_is_clamped(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(cv, "get_active_vault_path", lambda: vault)
    target = vault / "doc.pdf"
    _make_pdf(target)

    out = _call("doc.pdf", 10**9)

    assert len(out) <= 20_000
