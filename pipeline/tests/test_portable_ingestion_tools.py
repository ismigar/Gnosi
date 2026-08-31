"""Portable ingestion contracts using synthetic providers in a clean child process.

Only the wrapper is collected normally. Child checks set every validation path
before importing backend configuration, regardless of parent collection order.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Iterator, Sequence
from copy import deepcopy
from datetime import datetime, timedelta, timezone, tzinfo
from importlib import import_module
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import TYPE_CHECKING

import httpx
import pytest

if TYPE_CHECKING:
    from backend.domains.vault.pages.foundation_values import PageMetadata
    from pipeline.skills.rss_to_audio.scripts.rss_to_audio import Article


def test_portable_ingestion_in_isolated_subprocess(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GNOSI_VALIDATION_ROOT", raising=False)
    if "backend.config.paths_config" not in sys.modules:
        monkeypatch.setitem(
            sys.modules, "backend.config.paths_config", ModuleType("backend.config.paths_config")
        )
    with tempfile.TemporaryDirectory(prefix="gnosi-portable-ingestion-") as temporary:
        root = Path(temporary).resolve()
        for name in ("data", "vault", "host"):
            (root / name).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "TZ": "UTC",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_SHARED_ENV_FILE": str(root / "disabled.env"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
        }
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "-p",
                "no:cacheprovider",
                "--basetemp",
                str(root / "tests"),
                "-o",
                "python_functions=check_*",
                "pipeline/tests/test_portable_ingestion_tools.py",
            ],
            cwd=Path(__file__).resolve().parents[2],
            env=environment,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        logging.getLogger(__name__).info("Isolated ingestion checks: %s", result.stdout.strip())


@pytest.fixture(autouse=True)
def isolated_providers(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    if request.node.name == "test_portable_ingestion_in_isolated_subprocess":
        yield
        return

    from backend.config import env_config
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()
    attempts: list[str] = []

    def forbidden(*args: object, **kwargs: object) -> None:
        attempts.append("unmocked provider, credential or process access")
        raise AssertionError(attempts[-1])

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(env_config, "_read_env_file", forbidden)
    monkeypatch.setattr(env_config, "_load_keychain", forbidden)
    monkeypatch.setattr(import_module("feedparser"), "parse", forbidden)
    monkeypatch.setattr(import_module("gtts"), "gTTS", forbidden)
    monkeypatch.setattr(import_module("groq"), "Groq", forbidden)

    from backend.services import integration_manager as integrations
    from backend.services import notion_importer
    from backend.services.integration_manager import integration_manager
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    monkeypatch.setattr(integrations, "get_keychain", forbidden)
    monkeypatch.setattr(integration_manager, "get_raw", forbidden)
    monkeypatch.setattr(notion_importer, "NotionClient", forbidden)
    monkeypatch.setattr(rss, "Groq", forbidden)
    yield
    assert attempts == []


class _Clock(datetime):
    @classmethod
    def now(cls, tz: tzinfo | None = None) -> _Clock:
        return cls(2026, 8, 31, 12, tzinfo=tz)


def _entry(title: object = "Recent", hours: int = 1) -> dict[object, object]:
    date = (_Clock.now(timezone.utc) - timedelta(hours=hours)).timetuple()
    return {"title": title, "published_parsed": date, "summary": "<p>Hello <b>world</b></p>"}


def _article() -> Article:
    return {"source": "Synthetic", "category": "News", "title": "Title", "content": "Body"}


def check_rss_opml_categories_and_failures(tmp_path: Path) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    source = tmp_path / "input.opml"
    source.write_text(
        '<opml><body><outline title="News"><outline title="One" xmlUrl="synthetic:one"/>'
        '<outline text="Two" xmlUrl="synthetic:two"/><outline title="Empty"/>'
        '<outline><outline xmlUrl="synthetic:nested"/></outline></outline>'
        '<outline text="ESS"><outline text="Three" xmlUrl="synthetic:three"/></outline>'
        '<outline title="Religió"><outline xmlUrl="synthetic:four"/></outline>'
        '<outline title="Actualitat"><outline xmlUrl="synthetic:five"/></outline>'
        '<outline title="Other"><outline xmlUrl="synthetic:excluded"/></outline>'
        '<outline title="Direct" xmlUrl="synthetic:direct"/></body></opml>',
        encoding="utf-8",
    )
    assert rss.TARGET_TAGS == ["Religió", "ESS", "Actualitat", "News"]
    feeds = rss.parse_opml(source)
    assert [feed["url"] for feed in feeds] == [
        "synthetic:one",
        "synthetic:two",
        "synthetic:three",
        "synthetic:four",
        "synthetic:five",
    ]
    assert [feed["title"] for feed in feeds] == ["One", "Two", "Three", "", ""]
    assert rss.parse_opml(tmp_path / "absent") == []
    source.write_text("<opml>broken", encoding="utf-8")
    assert rss.parse_opml(source) == []


def check_rss_dates_content_and_opaque_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    opaque_title = {"custom": [None, {7: "retained"}]}
    recent = _entry(opaque_title)
    recent["content"] = [{"value": "<p>" + "x" * 2100 + "</p>", "extension": [1, None]}]
    recent[7] = "opaque non-text key"
    updated = _entry("Updated")
    parsed_date = updated.pop("published_parsed")
    assert isinstance(parsed_date, tuple)
    updated["updated_parsed"] = tuple(parsed_date)
    entries = [
        recent,
        _entry("Old", 25),
        _entry("Boundary", 24),
        updated,
        {"title": "Undated", "content": object()},
        _entry("Recent duplicate"),
        _entry("Recent duplicate"),
    ]
    before = deepcopy(entries[:4])
    monkeypatch.setattr(rss, "datetime", _Clock)
    monkeypatch.setattr(import_module("feedparser"), "parse", lambda _url: {"entries": entries})
    articles = rss.fetch_rss_24h([{"title": "Feed", "url": "synthetic:rss", "category": "ESS"}])
    assert [article["title"] for article in articles] == [
        opaque_title,
        "Updated",
        "Recent duplicate",
        "Recent duplicate",
    ]
    assert articles[0]["title"] is opaque_title
    assert articles[0]["content"] == "x" * 2000
    assert articles[1]["content"] == "Hello world"
    assert entries[:4] == before


@pytest.mark.parametrize(
    "broken",
    [
        None,
        {"published_parsed": "bad"},
        {"content": []},
        {"content": [{"wrong": "key"}]},
        {"content": [{"value": None}]},
        {"published_parsed": (1, 2)},
    ],
)
def check_rss_bad_entry_stops_only_its_feed(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], broken: object
) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    malformed = {**_entry("Bad"), **broken} if isinstance(broken, dict) else broken
    entries = [_entry("Before"), malformed, _entry("Not visited")]
    monkeypatch.setattr(rss, "datetime", _Clock)

    def parse(url: str) -> object:
        return {"entries": entries if url == "synthetic:bad" else [_entry("Next feed")]}

    monkeypatch.setattr(import_module("feedparser"), "parse", parse)
    result = rss.fetch_rss_24h(
        [
            {"title": "Bad", "url": "synthetic:bad", "category": "News"},
            {"title": "Good", "url": "synthetic:good", "category": "News"},
        ]
    )
    assert [entry["title"] for entry in result] == ["Before", "Next feed"]
    assert "Error processing feed synthetic:bad:" in capsys.readouterr().out


def check_rss_summary_contract_and_null(monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    calls: list[dict[str, object]] = []

    def create(**kwargs: object) -> SimpleNamespace:
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None))])

    def factory(*, api_key: str) -> SimpleNamespace:
        assert api_key == "synthetic-key"
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    monkeypatch.setattr(rss, "GROQ_API_KEY", None)
    assert rss.generate_summary([]) == "Error: the Groq API key is missing."
    monkeypatch.setattr(rss, "GROQ_API_KEY", "synthetic-key")
    assert rss.generate_summary([]) == (
        "Hello. There are no new articles from the last 24 hours in the selected categories."
    )
    monkeypatch.setattr(rss, "Groq", factory)
    article: rss.Article = {**_article()}
    large: rss.Article = {**article, "content": "x" * 25000}
    assert rss.generate_summary([article, large, article]) is None
    assert len(calls) == 1
    assert calls[0]["model"] == "llama3-70b-8192" and calls[0]["temperature"] == 0.7
    messages = calls[0]["messages"]
    assert isinstance(messages, list) and len(messages) == 2
    assert messages[0] == {
        "role": "system",
        "content": (
            "You are an intelligent podcast assistant. Write only the text that will be read "
            "aloud, without notes or meta-commentary."
        ),
    }
    assert messages[1] == {
        "role": "user",
        "content": (
            "You are a senior editorial assistant. Summarize the following articles for a listener "
            "with a background in engineering and philosophy. Avoid shallow headlines; focus on "
            "depth, connections between topics, and ethical implications. Structure the summary "
            "as a fluid 10–15 minute podcast script. Language: English.\n\nARTICLES:\n"
            "--- Article 1 ---\nSource: Synthetic (Category: News)\nTitle: Title\nContent: Body\n\n"
        ),
    }


def check_rss_provider_error_boundaries(monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    def fail(**kwargs: object) -> object:
        raise RuntimeError("synthetic provider failure")

    monkeypatch.setattr(rss, "GROQ_API_KEY", "synthetic-key")
    article: rss.Article = {**_article()}
    monkeypatch.setattr(rss, "Groq", fail)
    with pytest.raises(RuntimeError, match="synthetic provider failure"):
        rss.generate_summary([article])
    monkeypatch.setattr(
        rss,
        "Groq",
        lambda **_kwargs: SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=fail))
        ),
    )
    assert rss.generate_summary([article]) == (
        "The summary could not be generated because of an LLM provider error."
    )


@pytest.mark.parametrize("explicit", [False, True])
def check_rss_main_paths_and_mock_audio(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, explicit: bool
) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    data = Path(os.environ["GNOSI_DATA_DIR"])
    source = tmp_path / "input.opml" if explicit else data / "rss_to_audio" / "feeds.opml"
    output = tmp_path / "output" if explicit else data / "audio" / "rss_to_audio"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("<opml/>", encoding="utf-8")
    monkeypatch.setattr(rss, "datetime", _Clock)
    monkeypatch.setattr(rss, "generate_summary", lambda _articles: "Synthetic summary")

    class Audio:
        def __init__(self, *, text: str, lang: str, slow: bool) -> None:
            assert (text, lang, slow) == ("Synthetic summary", "en", False)

        def save(self, filename: str) -> None:
            Path(filename).write_bytes(b"synthetic audio")

    monkeypatch.setattr(import_module("gtts"), "gTTS", Audio)
    args = ["--opml", str(source), "--output-dir", str(output)] if explicit else []
    run: Callable[[Sequence[str] | None], object] = rss.main
    assert run(args) is None
    assert output.is_relative_to(tmp_path if explicit else data)
    assert (output / "summary_2026_08_31.txt").read_text() == "Synthetic summary"
    assert (output / "summary_2026_08_31.mp3").read_bytes() == b"synthetic audio"
    assert not output.is_relative_to(rss.REPOSITORY_ROOT)


def check_rss_missing_input_and_null_write(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    source, output = tmp_path / "input.opml", tmp_path / "out"
    args = ["--opml", str(source), "--output-dir", str(output)]
    with pytest.raises(SystemExit) as stopped:
        rss.main(args)
    assert stopped.value.code == 1 and not output.exists()
    source.write_text("<opml/>", encoding="utf-8")
    monkeypatch.setattr(rss, "datetime", _Clock)
    monkeypatch.setattr(rss, "generate_summary", lambda _articles: None)
    with pytest.raises(TypeError, match="write"):
        rss.main(args)
    assert (output / "summary_2026_08_31.txt").read_bytes() == b""
    assert not (output / "summary_2026_08_31.mp3").exists()


def check_rss_complete_flow_with_synthetic_providers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    source, output = tmp_path / "feeds.opml", tmp_path / "audio"
    source.write_text(
        '<opml><body><outline title="News"><outline title="Synthetic" '
        'xmlUrl="synthetic:feed"/></outline></body></opml>',
        encoding="utf-8",
    )
    events: list[str] = []
    monkeypatch.setattr(rss, "datetime", _Clock)
    monkeypatch.setattr(rss, "GROQ_API_KEY", "synthetic-key")

    def fetch(url: str) -> object:
        assert url == "synthetic:feed"
        events.append("feed")
        return {"entries": [_entry("Recent"), _entry("Old", 25)]}

    def create(**kwargs: object) -> SimpleNamespace:
        assert kwargs["model"] == "llama3-70b-8192"
        messages = kwargs["messages"]
        assert isinstance(messages, list)
        prompt = messages[1]["content"]
        assert "Title: Recent" in prompt and "Title: Old" not in prompt
        assert "Content: Hello world" in prompt
        events.append("summary")
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Synthetic spoken summary"))]
        )

    class Audio:
        def __init__(self, *, text: str, lang: str, slow: bool) -> None:
            assert (text, lang, slow) == ("Synthetic spoken summary", "en", False)
            events.append("tts")

        def save(self, filename: str) -> None:
            Path(filename).write_bytes(b"synthetic-mp3")

    monkeypatch.setattr(import_module("feedparser"), "parse", fetch)
    monkeypatch.setattr(
        rss,
        "Groq",
        lambda **_kwargs: SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create))
        ),
    )
    monkeypatch.setattr(import_module("gtts"), "gTTS", Audio)
    rss.main(["--opml", str(source), "--output-dir", str(output)])
    assert events == ["feed", "summary", "tts"]
    assert (output / "summary_2026_08_31.txt").read_text() == "Synthetic spoken summary"
    assert (output / "summary_2026_08_31.mp3").read_bytes() == b"synthetic-mp3"


def check_rewalk_cli_help_and_required_vault_do_not_read_credentials(
    capsys: pytest.CaptureFixture[str],
) -> None:
    from pipeline.utils import rewalk_subpage_parents as rewalk

    with pytest.raises(SystemExit) as help_exit:
        rewalk.main(["--help"])
    assert help_exit.value.code == 0
    help_text = capsys.readouterr().out
    assert all(option in help_text for option in ("--vault-id", "--backend", "--apply"))
    with pytest.raises(SystemExit) as missing_vault:
        rewalk.main([])
    assert missing_vault.value.code == 2


def check_rss_tts_failure_still_returns_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from pipeline.skills.rss_to_audio.scripts import rss_to_audio as rss

    class BrokenAudio:
        def save(self, filename: str) -> None:
            raise RuntimeError("synthetic save failure")

    monkeypatch.setattr(import_module("gtts"), "gTTS", lambda **_kwargs: BrokenAudio())
    generate: Callable[[str | None, str | Path], object] = rss.text_to_audio
    assert generate("Hello", tmp_path / "out.mp3") is None
    assert "Error generating TTS audio: synthetic save failure" in capsys.readouterr().out
    assert not (tmp_path / "out.mp3").exists()


class _RewalkAPI:
    def __init__(self) -> None:
        self.pages: list[dict[str, object]] = []
        self.blocks: dict[str, dict[str, object] | Exception] = {}
        self.block_reads: list[str] = []
        self.payload: object = []
        self.status = 200
        self.response_body: bytes | None = None
        self.patches: list[tuple[str, dict[str, str], object, int]] = []
        self.outcomes: list[int | Exception] = []
        self.gets: list[tuple[str, dict[str, str], int]] = []
        self.pauses: list[float] = []

    def search_pages(self) -> list[dict[str, object]]:
        return self.pages

    def get_block(self, block_id: str) -> dict[str, object]:
        self.block_reads.append(block_id)
        block = self.blocks[block_id]
        if isinstance(block, Exception):
            raise block
        return block

    def get(self, url: str, *, headers: dict[str, str], timeout: int) -> httpx.Response:
        self.gets.append((url, headers, timeout))
        # json=None means "no JSON argument" to httpx, not a literal null body.
        content = self.response_body if self.response_body is not None else json.dumps(self.payload)
        return httpx.Response(self.status, content=content, request=httpx.Request("GET", url))

    def patch(
        self, url: str, *, headers: dict[str, str], json: object, timeout: int
    ) -> httpx.Response:
        self.patches.append((url, headers, json, timeout))
        outcome = self.outcomes.pop(0) if self.outcomes else 200
        if isinstance(outcome, Exception):
            raise outcome
        return httpx.Response(
            outcome, text="synthetic response", request=httpx.Request("PATCH", url)
        )


@pytest.fixture
def rewalk_api(monkeypatch: pytest.MonkeyPatch) -> _RewalkAPI:
    from backend.services import notion_importer
    from backend.services.integration_manager import integration_manager

    api = _RewalkAPI()

    def credentials(key: str) -> object:
        assert key == "notion"
        return {"token": "synthetic-notion", "opaque": [None, {"extension": True}]}

    def client(token: str) -> _RewalkAPI:
        assert token == "synthetic-notion"
        return api

    monkeypatch.setattr(integration_manager, "get_raw", credentials)
    monkeypatch.setattr(notion_importer, "NotionClient", client)
    monkeypatch.setattr(httpx, "get", api.get)
    monkeypatch.setattr(httpx, "patch", api.patch)
    monkeypatch.setattr(time, "sleep", api.pauses.append)
    return api


@pytest.mark.parametrize("wrapped", [False, True])
def check_rewalk_dry_run_ids_parents_and_opaque_payload(
    rewalk_api: _RewalkAPI,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    wrapped: bool,
) -> None:
    from backend.domains.notion.clone import clone_page_id
    from pipeline.utils import rewalk_subpage_parents as rewalk

    assert rewalk.clone_page_id("1234-5678") == clone_page_id("12345678")
    assert rewalk.clone_page_id("") == clone_page_id("")
    pages: list[dict[str, object]] = [
        {"id": "direct", "parent": {"type": "page_id", "page_id": "parent"}},
        {"id": "block-a", "parent": {"type": "block_id", "block_id": "inner"}},
        {"id": "block-b", "parent": {"type": "block_id", "block_id": "inner"}},
        {"id": "correct", "parent": {"type": "page_id", "page_id": "parent"}},
        {"id": "absent-child", "parent": {"type": "page_id", "page_id": "parent"}},
        {"id": "orphan", "parent": {"type": "page_id", "page_id": "absent-parent"}},
        {"id": "row", "parent": {"type": "database_id", "database_id": "db"}},
        {"id": "root", "parent": {"type": "workspace", "workspace": True}},
        {"id": "unknown", "parent": {"type": "plugin", "plugin": [1, None]}},
        {"id": "failed", "parent": {"type": "block_id", "block_id": "failed"}},
    ]
    rewalk_api.pages = pages
    rewalk_api.blocks = {
        "inner": {"parent": {"type": "block_id", "block_id": "outer"}},
        "outer": {"parent": {"type": "page_id", "page_id": "parent"}},
        "failed": RuntimeError("synthetic block failure"),
    }
    vault = [
        {
            "id": clone_page_id(name),
            "title": {"opaque": [None, name]},
            "metadata": {"view_id": "keep", "plugin": {"list": [1, False]}},
            "parent_id": clone_page_id("parent") if name == "correct" else None,
        }
        for name in ("direct", "block-a", "block-b", "correct", "orphan", "parent")
    ]
    rewalk_api.payload = {"pages": vault, "opaque": True} if wrapped else vault
    before = deepcopy(rewalk_api.payload)
    original_pages = deepcopy(pages)
    monkeypatch.setenv("GNOSI_API_TOKEN", " synthetic-pat ")
    assert rewalk.main(["--vault-id", "synthetic-vault"]) == 0
    assert rewalk_api.patches == [] and rewalk_api.pauses == []
    assert rewalk_api.payload == before and pages == original_pages
    assert rewalk_api.block_reads == ["inner", "outer", "failed"]
    assert rewalk_api.gets == [
        (
            "http://localhost:5002/api/vault/pages",
            {"X-Vault-Id": "synthetic-vault", "Authorization": "Bearer synthetic-pat"},
            180,
        )
    ]
    output = capsys.readouterr().out
    assert (
        "to repair: 3 | already correct: 1 | child not cloned: 1 | parent not cloned: 1" in output
    )
    assert "DRY-RUN" in output and "synthetic block failure" in output


@pytest.mark.parametrize(
    "outcomes, expected", [([], 0), ([500, 200], 1), ([RuntimeError("mock failure"), 200], 1)]
)
def check_rewalk_apply_and_failure_codes(
    rewalk_api: _RewalkAPI,
    monkeypatch: pytest.MonkeyPatch,
    outcomes: list[int | Exception],
    expected: int,
) -> None:
    from backend.domains.vault.schemas.pages import PagePatchRequest
    from pipeline.utils import rewalk_subpage_parents as rewalk

    rewalk_api.pages = [
        {"id": name, "parent": {"type": "page_id", "page_id": "parent"}} for name in ("one", "two")
    ]
    vault = [
        {
            "id": rewalk.clone_page_id(name),
            "title": name,
            "metadata": {"extension": {"views": ["view-id"]}},
        }
        for name in ("one", "two", "parent")
    ]
    rewalk_api.payload = vault
    before = deepcopy(vault)
    rewalk_api.outcomes = list(outcomes)
    monkeypatch.delenv("GNOSI_API_TOKEN", raising=False)
    args = ["--vault-id", "vault", "--backend", "http://synthetic.invalid", "--apply"]
    assert rewalk.main(args) == expected
    assert len(rewalk_api.patches) == 2 and rewalk_api.pauses == [0.05, 0.05]
    assert vault == before
    for name, (url, headers, body, timeout) in zip(("one", "two"), rewalk_api.patches):
        assert url == f"http://synthetic.invalid/api/vault/pages/{rewalk.clone_page_id(name)}"
        assert headers == {"X-Vault-Id": "vault", "Content-Type": "application/json"}
        assert body == {"parent_id": rewalk.clone_page_id("parent")} and timeout == 60
        request = PagePatchRequest.model_validate(body)
        assert request.parent_id == rewalk.clone_page_id("parent")
        assert request.metadata is None and request.title is None and request.content is None
    if expected == 0:
        for page in vault[:2]:
            page["parent_id"] = rewalk.clone_page_id("parent")
        rewalk_api.patches.clear()
        assert rewalk.main(args) == 0 and rewalk_api.patches == []


@pytest.mark.parametrize("payload", [[], {}, {"pages": []}])
def check_rewalk_empty_vault_returns_two(rewalk_api: _RewalkAPI, payload: object) -> None:
    from pipeline.utils import rewalk_subpage_parents as rewalk

    rewalk_api.payload = payload
    assert rewalk.main(["--vault-id", "vault", "--apply"]) == 2
    assert rewalk_api.patches == []


@pytest.mark.parametrize(
    "payload",
    [None, {"pages": None}, {"pages": "bad"}, [None], [{"title": "missing-id"}], [{"id": []}]],
)
def check_rewalk_malformed_vault_fails_before_patch(
    rewalk_api: _RewalkAPI, payload: object
) -> None:
    from pipeline.utils import rewalk_subpage_parents as rewalk

    rewalk_api.payload = payload
    with pytest.raises((TypeError, KeyError)):
        rewalk.main(["--vault-id", "vault", "--apply"])
    assert rewalk_api.patches == []


def check_rewalk_http_failure_propagates(rewalk_api: _RewalkAPI) -> None:
    from pipeline.utils import rewalk_subpage_parents as rewalk

    rewalk_api.status = 503
    with pytest.raises(httpx.HTTPStatusError):
        rewalk.main(["--vault-id", "vault", "--apply"])
    assert rewalk_api.patches == []


@pytest.mark.parametrize("content", [b"", b"invalid JSON"])
def check_rewalk_invalid_json_propagates(rewalk_api: _RewalkAPI, content: bytes) -> None:
    from pipeline.utils import rewalk_subpage_parents as rewalk

    rewalk_api.response_body = content
    with pytest.raises(json.JSONDecodeError):
        rewalk.main(["--vault-id", "vault", "--apply"])
    assert rewalk_api.patches == []


@pytest.mark.parametrize("credentials", [{}, None, {"token": ["invalid"]}])
def check_rewalk_bad_credentials_never_call_api(
    rewalk_api: _RewalkAPI, monkeypatch: pytest.MonkeyPatch, credentials: object
) -> None:
    from backend.services.integration_manager import integration_manager
    from pipeline.utils import rewalk_subpage_parents as rewalk

    monkeypatch.setattr(integration_manager, "get_raw", lambda _key: credentials)
    with pytest.raises((KeyError, TypeError)):
        rewalk.main(["--vault-id", "vault"])
    assert rewalk_api.gets == [] and rewalk_api.patches == []


def check_canonical_manager_resolves_synthetic_secure_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import integration_manager as module

    manager = module.IntegrationManager()
    assert (
        manager.config_file == Path(os.environ["GNOSI_DATA_DIR"]) / "secrets" / "integrations.json"
    )
    persisted = {"notion": {"token": "__keychain__:synthetic-ref", "opaque": [None, 7]}}
    original = deepcopy(persisted)

    class Store:
        def get_credential(self, key: str) -> str:
            assert key == "synthetic-ref"
            return "synthetic-resolved-token"

    monkeypatch.setattr(manager, "_load_persisted", lambda: persisted)
    monkeypatch.setattr(module, "get_keychain", Store)
    result: object = manager.get_raw("notion")
    assert result == {"token": "synthetic-resolved-token", "opaque": [None, 7]}
    assert persisted == original


def check_real_patch_receiver_merges_only_logical_parent(tmp_path: Path) -> None:
    from fastapi import BackgroundTasks

    from backend.domains.vault.pages.patch_service import PatchPageDependencies, patch_page
    from backend.domains.vault.schemas.pages import PagePatchRequest

    path = tmp_path / "BD" / "Table" / "child.md"
    metadata: PageMetadata = {
        "id": "child",
        "title": "Child",
        "parent_id": "old",
        "table_id": "table",
        "views": [{"id": "opaque-view-id", "plugin": [None, {"custom": True}]}],
        7: {"opaque": [None, "retained"]},
    }
    original = deepcopy(metadata)
    saved: list[tuple[Path, PageMetadata, str]] = []

    async def lock(_page_id: str) -> asyncio.Lock:
        return asyncio.Lock()

    def relocate(
        page_id: str, actual_path: Path, current: PageMetadata, title: str | None
    ) -> Path:
        assert page_id == "child" and actual_path == path and title is None
        assert current["table_id"] == "table"
        return actual_path

    dependencies = PatchPageDependencies(
        find_and_read=lambda *_args: (path, dict(metadata), "Body", "Original", None),
        get_page_write_lock=lock,
        prepare_metadata=lambda current, _path: (current, None),
        relocate_file=relocate,
        process_updates=lambda _id, _old, current: current,
        stamp_author=lambda *_args: None,
        persist_assets=lambda current: current,
        ensure_citation_key=lambda current: current,
        dedupe_citation_key=lambda current, _id: current,
        save_page=lambda actual_path, current, body: saved.append(
            (actual_path, dict(current), body)
        ),
        update_caches=lambda *_args: None,
        create_content_version=lambda: lambda *_args: None,
        create_file_version=lambda: lambda *_args: None,
        update_link_index=lambda: lambda *_args: None,
        rewrite_wikilinks=lambda: lambda *_args: 0,
        get_table_id=lambda _current: "table",
        recompute_formulas=lambda: lambda *_args: None,
        sync_calendar=lambda *_args: None,
        propagate_translation=lambda: lambda *_args: None,
        propagate_relations=lambda: lambda *_args: None,
        resolve_page_context=lambda *_args: ("BD/Table", "table"),
        file_etag=lambda _path: "synthetic-etag",
        safe_error_detail=lambda _exc, context: context,
    )
    result = asyncio.run(
        patch_page(
            "child", PagePatchRequest(parent_id="new-parent"), BackgroundTasks(), None, dependencies
        )
    )
    assert result["metadata"] == {**original, "parent_id": "new-parent"}
    assert result["folder"] == "BD/Table" and result["content"] == "Body"
    assert saved == [(path, {**original, "parent_id": "new-parent"}, "Body")]
    assert metadata == original
