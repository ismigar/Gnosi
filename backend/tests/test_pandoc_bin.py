"""Resolving the pandoc binary in the NATIVE environment (_pandoc_bin).

LaunchAgents can start the backend with a minimal PATH: even if
pandoc is installed via Homebrew, `subprocess.run(['pandoc',…])` used to fail
with FileNotFoundError. `_pandoc_bin` resolves: PANDOC_PATH → shutil.which →
usual Homebrew locations → 'pandoc' (last resort, keeps the callers'
informative 500).
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
    # Simulates a host without pandoc anywhere: the Homebrew paths don't exist either.
    monkeypatch.setattr(vr, "Path", _NoExistPath)
    assert vr._pandoc_bin() == "pandoc"


class _NoExistPath:
    def __init__(self, *_a, **_k):
        pass

    def exists(self):
        return False
