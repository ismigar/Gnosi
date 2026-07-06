"""Snapshot de seguretat del restore: `_create_page_version(force=True)`.

El cooldown de 10 min de l'historial està pensat per als autosaves; aplicar-lo
també al snapshot "estat just abans del restore" feia que, si hi havia hagut
una edició fa <10 min, l'estat actual es descartés EN SILENCI i quedés
irrecuperable després del restore (reproduït contra el backend real:
restaurar v1 amb v3 al disc perdia v3 per sempre).
"""
import backend.api.vault_routes as vr


def _setup(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    page = vault / "page.md"
    page.write_text("---\nid: p1\n---\ncontingut actual\n", encoding="utf-8")
    monkeypatch.setattr(vr, "get_p", lambda key: vault)
    return vault, page


def test_force_bypasses_cooldown(monkeypatch, tmp_path):
    vault, page = _setup(monkeypatch, tmp_path)
    hist = vault / ".history" / "p1"
    hist.mkdir(parents=True)
    # Un snapshot RECENT (mtime = ara) activa el cooldown per als autosaves.
    recent = hist / "20260706_000000.md"
    recent.write_text("vell", encoding="utf-8")

    vr._create_page_version("p1", page)  # autosave: el cooldown el descarta
    assert len(list(hist.glob("*.md"))) == 1

    vr._create_page_version("p1", page, force=True)  # restore: mai es descarta
    snapshots = sorted(hist.glob("*.md"))
    assert len(snapshots) == 2, "el snapshot de seguretat s'ha descartat pel cooldown"
    newest = snapshots[-1].read_text(encoding="utf-8")
    assert "contingut actual" in newest


def test_force_never_overwrites_existing_snapshot(monkeypatch, tmp_path):
    vault, page = _setup(monkeypatch, tmp_path)
    hist = vault / ".history" / "p1"
    hist.mkdir(parents=True)
    # Snapshot preexistent amb el timestamp del MATEIX segon que ara.
    from datetime import datetime
    now_name = datetime.now().strftime("%Y%m%d_%H%M%S")
    collision = hist / f"{now_name}.md"
    collision.write_text("snapshot previ que no s'ha de perdre", encoding="utf-8")

    vr._create_page_version("p1", page, force=True)

    assert collision.read_text(encoding="utf-8") == "snapshot previ que no s'ha de perdre"
    assert len(list(hist.glob("*.md"))) == 2, "el snapshot nou ha sobreescrit el previ"
