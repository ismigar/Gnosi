"""Cold-path regressions for the LLM Wiki settings response."""

from __future__ import annotations

import builtins
import importlib.util
import shutil
from importlib.machinery import ModuleSpec

import pytest

from backend.services import llm_wiki_extractors
from backend.services.optional_module_capabilities import module_available


def test_capability_report_detects_optional_modules_without_importing_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Availability checks must not initialize heavyweight optional runtimes."""
    optional_modules = {"pypdfium2", "docx", "ebooklib", "yt_dlp", "faster_whisper"}
    requested: list[str] = []
    imported: list[str] = []
    real_import = builtins.__import__

    def find_spec(name: str, package: str | None = None) -> ModuleSpec | None:
        assert package is None
        requested.append(name)
        if name == "ebooklib":
            raise ValueError("synthetic malformed module registration")
        return ModuleSpec(name, loader=None) if name in {"docx", "faster_whisper"} else None

    def guarded_import(
        name: str,
        globals: dict[str, object] | None = None,
        locals: dict[str, object] | None = None,
        fromlist: tuple[str, ...] = (),
        level: int = 0,
    ) -> object:
        if name.split(".", 1)[0] in optional_modules:
            imported.append(name)
            raise AssertionError(f"optional module executed during capability check: {name}")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(importlib.util, "find_spec", find_spec)
    monkeypatch.setattr(shutil, "which", lambda _binary: None)
    monkeypatch.setattr(builtins, "__import__", guarded_import)

    report = llm_wiki_extractors.capability_report()

    assert requested == ["pypdfium2", "docx", "ebooklib", "yt_dlp", "faster_whisper"]
    assert imported == []
    assert report["modules"] == {
        "pypdfium2": False,
        "docx": True,
        "ebooklib": False,
        "yt_dlp": False,
        "faster_whisper": True,
    }
    assert report["transcription"] is True
    assert report["ocr"] is False


def test_module_detection_degrades_to_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        importlib.util,
        "find_spec",
        lambda _name: (_ for _ in ()).throw(ValueError("synthetic invalid registration")),
    )

    assert module_available("broken_optional_module") is False
