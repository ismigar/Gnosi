"""Synthetic JSON, cache and Markdown callback characterization for Drupal."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import pytest

from backend.domains.vault.drupal import core, languages, markdown
from backend.domains.vault.pages.state import PageState


def language_dependencies(
    document: object, events: list[object]
) -> languages.DrupalLanguageDependencies:
    class Response:
        def json(self) -> object:
            events.append("json")
            if isinstance(document, Exception):
                raise document
            return document

    class Client:
        async def __aenter__(self):
            events.append("enter")
            return self

        async def __aexit__(self, *args):
            events.append("exit")

        async def get(self, path, *, params=None):
            events.append(("get", path, params))
            return Response()

    return languages.DrupalLanguageDependencies(
        Client, lambda metadata: "ca-ES", lambda metadata: "en", logging.getLogger(__name__)
    )


def test_language_json_is_read_after_exit_and_cached_by_identity() -> None:
    events: list[object] = []
    dependencies = language_dependencies(
        {
            "data": [
                None,
                {"attributes": {"drupal_internal__id": "CA"}},
                {"attributes": {"drupal_internal__id": "und"}},
                {"attributes": {"drupal_internal__id": 7}},
            ]
        },
        events,
    )
    state = languages.DrupalLanguageState()
    result = asyncio.run(languages.langcodes(dependencies, state))
    assert result == {"ca", "7"}
    assert events[-2:] == ["exit", "json"]
    assert asyncio.run(languages.langcodes(dependencies, state)) is result
    assert len(events) == 4


@pytest.mark.parametrize(
    "raw",
    [
        None,
        7,
        "bad",
        {"data": ({"attributes": {"drupal_internal__id": "ca"}},)},
        {"data": [None, {"attributes": 7}]},
    ],
)
def test_malformed_language_json_keeps_original_empty_policy(raw: object) -> None:
    dependencies = language_dependencies(raw, [])
    assert asyncio.run(languages.langcodes(dependencies, languages.DrupalLanguageState())) == set()
    assert asyncio.run(languages.uuid_to_fid("uuid", dependencies)) is None
    assert (
        asyncio.run(
            languages.field_translatable(
                "article", "field", dependencies, languages.DrupalLanguageState()
            )
        )
        is False
    )


def test_uuid_fid_stays_opaque_and_false_uuid_skips_client() -> None:
    opaque = object()
    events: list[object] = []
    dependencies = language_dependencies(
        {"data": {"attributes": {"drupal_internal__fid": opaque}}}, events
    )
    assert asyncio.run(languages.uuid_to_fid("uuid", dependencies)) is opaque
    events.clear()
    assert asyncio.run(languages.uuid_to_fid(0, dependencies)) is None
    assert events == []


def test_json_failure_is_logged_and_empty_language_cache_is_retained(caplog) -> None:
    events: list[object] = []
    dependencies = language_dependencies(ValueError("malformed JSON"), events)
    state = languages.DrupalLanguageState()
    assert asyncio.run(languages.langcodes(dependencies, state)) == set()
    assert asyncio.run(languages.langcodes(dependencies, state)) == set()
    assert len(events) == 4 and "malformed JSON" in caplog.text


def test_translatable_reads_first_entry_truthiness_and_caches_false() -> None:
    events: list[object] = []
    dependencies = language_dependencies(
        {"data": [{"attributes": {"translatable": []}}, {"attributes": {"translatable": True}}]},
        events,
    )
    state = languages.DrupalLanguageState()
    assert (
        asyncio.run(languages.field_translatable("article", "field", dependencies, state)) is False
    )
    assert (
        asyncio.run(languages.field_translatable("article", "field", dependencies, state)) is False
    )
    assert len(events) == 4


def test_explicit_language_set_avoids_client_and_retains_fallback() -> None:
    events: list[object] = []
    dependencies = language_dependencies(None, events)
    assert (
        asyncio.run(languages.resolve_langcode({}, dependencies, configured_langcodes={"ca"}))
        == "ca"
    )
    assert (
        asyncio.run(languages.resolve_langcode({}, dependencies, configured_langcodes=set()))
        == "en"
    )
    assert events == []


def test_image_mapping_and_alt_keep_order_raw_keys_and_fallback() -> None:
    assert languages.image_mapping(
        {7: "file", "later": "image"}, {"file": {"type": "file"}, "image": {"type": "image"}}
    ) == ("7", "file")
    metadata = {17: object(), "first_ALT": " first ", "title": "Title", "image": {"alt": 42}}
    assert (
        languages.row_image_alt(metadata, {"image": {"id": "image"}}, "image", core.read_prop_value)
        == "42"
    )
    assert languages.row_image_alt(metadata, {}, None, core.read_prop_value) == "first"


def markdown_dependencies(
    tmp_path: Path, events: list[object], metadata: object
) -> markdown.DrupalMarkdownDependencies:
    page = tmp_path / "page.md"
    page.write_text("synthetic markdown", encoding="utf-8")
    state = PageState()
    state.index_entries[str(tmp_path)] = {"entry": {"title": " Title ", "id": 7}}

    def find(page_id: str) -> Path:
        events.append(("find", page_id))
        return page

    def parse(text: str, path: Path):
        events.append(("parse", text, path))
        return metadata, "body"

    return markdown.DrupalMarkdownDependencies(
        lambda: tmp_path, state, find, parse, lambda text: f"<html>{text}</html>"
    )


def test_markdown_success_shared_cache_embeds_and_title_lookup(tmp_path: Path) -> None:
    events: list[object] = []
    dependencies = markdown_dependencies(tmp_path, events, {"drupal_url": " /article "})
    cache: dict[str, str | None] = {}
    result = markdown.markdown_to_html(
        "![[image]] [[Title#part|Display]] [[Title]] [[Unknown]]", cache, dependencies
    )
    assert result == "<html> [Display](/article) [Title](/article) Unknown</html>"
    assert cache == {"Title": "/article", "Unknown": None}
    assert [event[0] for event in events] == ["find", "parse"]
    assert events[0] == ("find", "7")


@pytest.mark.parametrize("metadata", [7, [], "malformed"])
def test_markdown_malformed_metadata_is_caught_and_negative_cached(
    tmp_path: Path, metadata: object
) -> None:
    events: list[object] = []
    dependencies = markdown_dependencies(tmp_path, events, metadata)
    cache: dict[str, str | None] = {}
    assert (
        markdown.preprocess_markdown("[[Title]] [[Title|Again]]", dependencies, cache=cache)
        == "Title Again"
    )
    assert cache == {"Title": None} and len(events) == 2


def test_markdown_accepts_native_get_without_copy_or_dict_assertion(tmp_path: Path) -> None:
    class Reader:
        def get(self, key: str) -> object:
            assert key == "drupal_url"
            return "/native"

    dependencies = markdown_dependencies(tmp_path, [], Reader())
    assert markdown.wikilink_url("Title", {}, dependencies) == "/native"


def test_image_mapping_native_items_and_malformed_field_config() -> None:
    class MappingValue:
        def items(self):
            return [(17, "file")]

    assert languages.image_mapping(MappingValue(), {"file": {"type": "file"}}) == ("17", "file")
    with pytest.raises(AttributeError, match="'int' object has no attribute 'items'"):
        languages.image_mapping(7, {})
    with pytest.raises(AttributeError, match="'int' object has no attribute 'get'"):
        languages.image_mapping({"ref": "file"}, {"file": 7})
