"""Exercise optional translation providers only in an isolated interpreter."""

from __future__ import annotations

import importlib
import ast
import logging
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ROW_MODULE = "pipeline.skills.translate_row.scripts.translate_text"
PAGE_MODULE = "pipeline.skills.translate_page.scripts.markdown_segmenter"
KEYCHAIN_MODULE = "backend.security.keychain_manager"
LOG = logging.getLogger("synthetic.translation-provider")


def test_translation_providers_in_isolated_subprocess() -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-translation-providers-") as temporary:
        root = Path(temporary).resolve()
        for name in ("data", "vault", "host"):
            (root / name).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_REQUIRE_AUTH": "1",
            "GNOSI_JWT_SECRET": "synthetic-provider-fixture-not-an-account-key",
            "GNOSI_PROVIDER_CONTRACT_CHILD": "1",
        }
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "--tb=short",
                "-p",
                "no:cacheprovider",
                "--basetemp",
                str(root / "tests"),
                "-o",
                "python_functions=check_*",
                str(Path(__file__).resolve()),
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


@pytest.fixture(scope="session", autouse=True)
def isolated_providers() -> Iterator[None]:
    if os.environ.get("GNOSI_PROVIDER_CONTRACT_CHILD") != "1":
        yield
        return
    import socket
    import urllib.request

    import requests

    root = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    assert root.is_absolute() and root.is_dir()
    for variable, name in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        assert Path(os.environ[variable]) == root / name
    assert not {"DEEPL_API_KEY", "GNOSI_SHARED_ENV_FILE", "OPENAI_API_KEY"} & os.environ.keys()
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("External I/O is forbidden in translation provider checks")

    with pytest.MonkeyPatch.context() as guard:
        guard.setattr(requests.sessions.Session, "request", forbidden)
        guard.setattr(urllib.request, "urlopen", forbidden)
        guard.setattr(socket, "create_connection", forbidden)
        guard.setattr(socket.socket, "connect", forbidden)
        guard.setattr(subprocess, "Popen", forbidden)
        optional_modules = (ROW_MODULE, PAGE_MODULE, KEYCHAIN_MODULE)
        assert all(name not in sys.modules for name in optional_modules)
        from backend.domains.vault.translation import adapters

        assert callable(adapters.load_translate_row_skill)
        assert all(name not in sys.modules for name in optional_modules)
        assert "torch" not in sys.modules and "transformers" not in sys.modules
        yield


def _hide_module(name: str, monkeypatch: pytest.MonkeyPatch) -> None:
    parent_name, _, attribute = name.rpartition(".")
    parent = importlib.import_module(parent_name)
    monkeypatch.delattr(parent, attribute, raising=False)
    monkeypatch.setitem(sys.modules, name, None)


@pytest.mark.parametrize("module_name", [ROW_MODULE, PAGE_MODULE])
def check_missing_optional_provider_is_request_time_http_error(
    module_name: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from fastapi import HTTPException

    from backend.domains.vault.translation import adapters

    _hide_module(module_name, monkeypatch)
    loader = (
        adapters.load_translate_row_skill
        if module_name == ROW_MODULE
        else adapters.load_translate_page_skill
    )
    label = "translate_row" if module_name == ROW_MODULE else "translate_page"
    with pytest.raises(HTTPException) as error:
        loader(LOG)
    assert error.value.status_code == 500
    assert error.value.detail == f"{label} skill unavailable"
    assert isinstance(error.value.__cause__, ImportError)
    assert f"{label} skill not importable:" in caplog.text


@pytest.mark.parametrize("member", ["translate", "detect_source_lang"])
def check_missing_row_member_keeps_attribute_error_cause(
    member: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi import HTTPException

    from backend.domains.vault.translation import adapters

    owner = importlib.import_module(ROW_MODULE)
    monkeypatch.delattr(owner, member)
    with pytest.raises(HTTPException) as error:
        adapters.load_translate_row_skill(LOG)
    assert error.value.status_code == 500
    assert error.value.detail == "translate_row skill unavailable"
    assert isinstance(error.value.__cause__, AttributeError)


@pytest.mark.parametrize("member", ["translate_markdown", "translate_title", "detect_source_lang"])
def check_missing_page_member_keeps_attribute_error_cause(
    member: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi import HTTPException

    from backend.domains.vault.translation import adapters

    owner = importlib.import_module(PAGE_MODULE)
    monkeypatch.delattr(owner, member)
    with pytest.raises(HTTPException) as error:
        adapters.load_translate_page_skill(LOG)
    assert error.value.status_code == 500
    assert error.value.detail == "translate_page skill unavailable"
    assert isinstance(error.value.__cause__, AttributeError)


def check_missing_keychain_preserves_empty_fallback(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from backend.domains.vault.translation import adapters

    _hide_module(KEYCHAIN_MODULE, monkeypatch)
    assert adapters.read_deepl_key(LOG) == ""
    assert "keychain unavailable, using env fallback:" in caplog.text


@pytest.mark.parametrize(
    "present,value", [(False, "unused"), (True, None), (True, ""), (True, "synthetic-key")]
)
def check_keychain_uses_only_credential_contract(
    present: bool,
    value: str | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.translation import adapters
    from backend.security import keychain_manager

    calls: list[str] = []

    class SyntheticKeychain(keychain_manager.KeychainManager):
        def __init__(self) -> None:
            # Never initialize or invoke the real platform credential manager.
            pass

        def has_credential(self, key: str) -> bool:
            calls.append("has:" + key)
            return present

        def get_credential(self, key: str) -> str | None:
            calls.append("get:" + key)
            return value

    monkeypatch.setattr(keychain_manager, "get_keychain", SyntheticKeychain)
    assert adapters.read_deepl_key(LOG) == ((value or "") if present else "")
    assert calls == ["has:deepl_api_key"] + (["get:deepl_api_key"] if present else [])


def check_keychain_failure_keeps_empty_fallback(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from backend.domains.vault.translation import adapters
    from backend.security import keychain_manager

    def unavailable() -> keychain_manager.KeychainManager:
        raise RuntimeError("synthetic locked store")

    monkeypatch.setattr(keychain_manager, "get_keychain", unavailable)
    assert adapters.read_deepl_key(LOG) == ""
    assert "synthetic locked store" in caplog.text


def check_loaded_functions_are_actual_owners_and_noop_without_io() -> None:
    from backend.domains.vault.translation import adapters
    from pipeline.skills.translate_page.scripts import markdown_segmenter
    from pipeline.skills.translate_row.scripts import translate_text

    row, detect = adapters.load_translate_row_skill(LOG)
    markdown, title, page_detect = adapters.load_translate_page_skill(LOG)
    assert row is translate_text.translate
    assert detect is page_detect is translate_text.detect_source_lang
    assert markdown is markdown_segmenter.translate_markdown
    assert title is markdown_segmenter.translate_title
    assert row("Text", "ca", "ca", deepl_api_key="") == ("Text", "noop")
    assert markdown("# Títol\n[[link]]", "ca", "ca", deepl_api_key="") == (
        "# Títol\n[[link]]",
        set(),
    )
    assert title("Títol", "ca", "ca", deepl_api_key="") == ("Títol", "noop")
    assert "torch" not in sys.modules and "transformers" not in sys.modules


def check_reloading_bundle_observes_current_functions(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.vault.translation import adapters
    from pipeline.skills.translate_row.scripts import translate_text

    original, _ = adapters.load_translate_row_skill(LOG)

    def replacement(
        text: str,
        source_lang: str,
        target_lang: str,
        *,
        deepl_api_key: str,
    ) -> tuple[str, str]:
        assert (text, source_lang, target_lang, deepl_api_key) == ("Text", "ca", "fr", "fake")
        return "Texte", "synthetic"

    monkeypatch.setattr(translate_text, "translate", replacement)
    current, _ = adapters.load_translate_row_skill(LOG)
    assert current is replacement and original is not current
    assert current("Text", "ca", "fr", deepl_api_key="fake") == ("Texte", "synthetic")


def check_page_bundle_keeps_native_keywords_and_current_members(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.translation import adapters
    from pipeline.skills.translate_page.scripts import markdown_segmenter

    # The loader returns the actual functions, whose original keyword API survives.
    assert markdown_segmenter.translate_markdown(body="Cos", src="ca", tgt="ca") == (
        "Cos",
        set(),
    )
    assert markdown_segmenter.translate_title(title="Títol", src="ca", tgt="ca") == (
        "Títol",
        "noop",
    )
    previous_markdown, previous_title, _ = adapters.load_translate_page_skill(LOG)
    calls: list[tuple[str, str, str, str]] = []

    def translate_body(
        body: str,
        src: str,
        tgt: str,
        *,
        deepl_api_key: str,
    ) -> tuple[str, set[str]]:
        calls.append((body, src, tgt, deepl_api_key))
        return "Corps", {"synthetic-body"}

    def translate_heading(
        title: str,
        src: str,
        tgt: str,
        *,
        deepl_api_key: str,
    ) -> tuple[str, str]:
        calls.append((title, src, tgt, deepl_api_key))
        return "Titre", "synthetic-title"

    monkeypatch.setattr(markdown_segmenter, "translate_markdown", translate_body)
    monkeypatch.setattr(markdown_segmenter, "translate_title", translate_heading)
    current_markdown, current_title, _ = adapters.load_translate_page_skill(LOG)
    assert current_markdown is translate_body and current_markdown is not previous_markdown
    assert current_title is translate_heading and current_title is not previous_title
    assert current_markdown("Cos", "ca", "fr", deepl_api_key="fake") == (
        "Corps",
        {"synthetic-body"},
    )
    assert current_title("Títol", "ca", "fr", deepl_api_key="fake") == (
        "Titre",
        "synthetic-title",
    )
    assert calls == [("Cos", "ca", "fr", "fake"), ("Títol", "ca", "fr", "fake")]


@pytest.mark.parametrize("failure", ["has", "get"])
def check_keychain_member_failures_keep_existing_fallback(
    failure: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from backend.domains.vault.translation import adapters
    from backend.security import keychain_manager

    class FailingKeychain(keychain_manager.KeychainManager):
        def __init__(self) -> None:
            pass

        def has_credential(self, key: str) -> bool:
            if failure == "has":
                raise OSError("synthetic credential check failure")
            return True

        def get_credential(self, key: str) -> str | None:
            raise OSError("synthetic credential read failure")

    monkeypatch.setattr(keychain_manager, "get_keychain", FailingKeychain)
    assert adapters.read_deepl_key(LOG) == ""
    assert "keychain unavailable, using env fallback:" in caplog.text


def check_adapter_uses_checked_owners_without_typing_assertions() -> None:
    tree = ast.parse((ROOT / "backend/domains/vault/translation/adapters.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "typing":
            assert not {"Any", "cast", "Protocol"} & {name.name for name in node.names}
    providers = {
        "read_deepl_key": KEYCHAIN_MODULE,
        "load_translate_row_skill": ROW_MODULE,
        "load_translate_page_skill": PAGE_MODULE,
    }
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in providers:
            guarded = next(child for child in node.body if isinstance(child, ast.Try))
            assert any(
                isinstance(child, ast.Import)
                and any(alias.name == providers[node.name] for alias in child.names)
                for child in guarded.body
            )
