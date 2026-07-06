"""Resolució del binari pandoc en entorn NATIU (_pandoc_bin).

Els LaunchAgents poden arrencar el backend amb un PATH mínim: encara que
pandoc estigui instal·lat via Homebrew, `subprocess.run(['pandoc',…])` petava
amb FileNotFoundError. `_pandoc_bin` resol: PANDOC_PATH → shutil.which →
ubicacions Homebrew habituals → 'pandoc' (últim recurs, manté el 500
informatiu dels cridadors).
"""
import backend.api.vault_routes as vr


def test_env_override_wins(monkeypatch, tmp_path):
    fake = tmp_path / "pandoc-custom"
    fake.write_text("#!/bin/sh\n")
    monkeypatch.setenv("PANDOC_PATH", str(fake))
    assert vr._pandoc_bin() == str(fake)


def test_env_override_ignored_if_missing(monkeypatch):
    monkeypatch.setenv("PANDOC_PATH", "/no/existeix/pandoc")
    monkeypatch.setattr(vr.shutil, "which", lambda _: "/resolt/per/which/pandoc")
    assert vr._pandoc_bin() == "/resolt/per/which/pandoc"


def test_which_fallback(monkeypatch):
    monkeypatch.delenv("PANDOC_PATH", raising=False)
    monkeypatch.setattr(vr.shutil, "which", lambda _: "/usr/local/bin/pandoc")
    assert vr._pandoc_bin() == "/usr/local/bin/pandoc"


def test_last_resort_is_bare_name(monkeypatch):
    monkeypatch.delenv("PANDOC_PATH", raising=False)
    monkeypatch.setattr(vr.shutil, "which", lambda _: None)
    # Simula un host sense pandoc enlloc: les rutes Homebrew tampoc existeixen.
    monkeypatch.setattr(vr, "Path", _NoExistPath)
    assert vr._pandoc_bin() == "pandoc"


class _NoExistPath:
    def __init__(self, *_a, **_k):
        pass

    def exists(self):
        return False
