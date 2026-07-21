"""Safety snapshot for restore: `_create_page_version(force=True)`.

The history's 10-minute cooldown is meant for autosaves; applying it
also to the "state right before the restore" snapshot meant that, if there had been
an edit <10 min earlier, the current state was SILENTLY discarded and became
unrecoverable after the restore (reproduced against the real backend:
restoring v1 with v3 on disk lost v3 forever).
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
    # A RECENT snapshot (mtime = now) activates the cooldown for autosaves.
    recent = hist / "20260706_000000.md"
    recent.write_text("vell", encoding="utf-8")

    vr._create_page_version("p1", page)  # autosave: the cooldown discards it
    assert len(list(hist.glob("*.md"))) == 1

    vr._create_page_version("p1", page, force=True)  # restore: never discarded
    snapshots = sorted(hist.glob("*.md"))
    assert len(snapshots) == 2, "el snapshot de seguretat s'ha descartat pel cooldown"
    newest = snapshots[-1].read_text(encoding="utf-8")
    assert "contingut actual" in newest


def test_force_never_overwrites_existing_snapshot(monkeypatch, tmp_path):
    vault, page = _setup(monkeypatch, tmp_path)
    hist = vault / ".history" / "p1"
    hist.mkdir(parents=True)
    # Pre-existing snapshot with the timestamp of the SAME second as now.
    from datetime import datetime
    now_name = datetime.now().strftime("%Y%m%d_%H%M%S")
    collision = hist / f"{now_name}.md"
    collision.write_text("snapshot previ que no s'ha de perdre", encoding="utf-8")

    vr._create_page_version("p1", page, force=True)

    assert collision.read_text(encoding="utf-8") == "snapshot previ que no s'ha de perdre"
    assert len(list(hist.glob("*.md"))) == 2, "el snapshot nou ha sobreescrit el previ"
