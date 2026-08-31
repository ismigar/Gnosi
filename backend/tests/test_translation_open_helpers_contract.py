"""Characterize opaque translation inputs before changing their annotations."""

from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace

import pytest

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.translation import staleness
from backend.services import translation_helpers as helpers


class LegacySequence:
    def __init__(self, values: list[object]) -> None:
        self.values = values
        self.indices: list[int] = []

    def __getitem__(self, index: int) -> object:
        self.indices.append(index)
        return self.values[index]


def test_lookup_keeps_last_page_identity_and_open_metadata() -> None:
    extension = object()
    metadata: RegistryData = {
        7: extension, "translation_origin_id": "A-B", "translation_lang": " ES "
    }
    first = SimpleNamespace(metadata=metadata, id=42)
    last: RegistryData = {"metadata": metadata, "id": ["opaque"]}
    found = helpers.find_translations_of("ab", [None, first, last])
    assert found["es"] is last
    assert helpers._meta_of(first) is metadata
    assert metadata[7] is extension
    assert helpers.find_translations_of("ab", [SimpleNamespace(metadata=12)]) == {}


def test_lookup_metadata_attribute_precedes_dict_fallback() -> None:
    class Hybrid(dict[object, object]):
        @property
        def metadata(self) -> object:
            return 42

    page = Hybrid(metadata={"translation_origin_id": "ab", "translation_lang": "es"})
    assert helpers.find_translations_of("ab", [page]) == {}


@pytest.mark.parametrize("raw", [None, 7, "cover.png", ["opaque"]])
def test_non_dictionary_image_returns_original(raw: object) -> None:
    def unexpected(_text: str) -> tuple[str, str]:
        pytest.fail("non-dictionaries must not call the provider")

    result, providers, changed = helpers.translate_image_field(raw, unexpected)
    assert result is raw and providers == set() and changed is False


def test_image_shallow_copy_preserves_keys_and_late_source_reads() -> None:
    extension = object()
    source: RegistryData = {9: extension, "src": "image", "alt": "one", "title": "old"}
    calls: list[str] = []

    def translate(text: str) -> tuple[str, str]:
        calls.append(text)
        source["title"] = "changed by previous callback"
        return text.upper(), "fake"

    result, providers, changed = helpers.translate_image_field(source, translate)
    assert isinstance(result, dict)
    assert result is not source and result[9] is extension and result["src"] == "image"
    assert calls == ["one", "changed by previous callback"]
    assert result["title"] == "CHANGED BY PREVIOUS CALLBACK"
    assert providers == {"fake"} and changed


def test_option_guard_does_not_freeze_second_read() -> None:
    reads: list[object] = []

    class Config(dict[object, object]):
        def get(self, key: object, default: object = None) -> object:
            reads.append(("get", key))
            return [] if key == "options" else super().get(key, default)

        def __getitem__(self, key: object) -> object:
            reads.append(("item", key))
            return LegacySequence(["Castellà", {"label": " EN "}])

    prop: RegistryData = {"config": Config()}
    assert helpers._select_option_values(prop) == ["Castellà", "EN"]
    assert reads == [("get", "options"), ("item", "options")]


def test_malformed_second_options_read_keeps_native_error() -> None:
    class Config(dict[object, object]):
        def get(self, key: object, default: object = None) -> object:
            return []

        def __getitem__(self, key: object) -> object:
            return 42

    with pytest.raises(TypeError, match="'int' object is not iterable"):
        helpers._select_option_values({"config": Config()})


def test_staleness_properties_and_aliases_keep_legacy_sequence() -> None:
    aliases = LegacySequence(["alias", 9, None])
    props = LegacySequence([None, {"id": "f", "name": "title", "translatable": True,
                                   "aliases": aliases}])
    assert staleness._translatable_keys({"properties": props}) == (["f", "title", "alias", "9"], True)
    assert props.indices == [0, 1, 2] and aliases.indices == [0, 1, 2, 3]


@pytest.mark.parametrize("table", [{"properties": 42}, {"properties": [{"translatable": True, "aliases": 42}]}])
def test_staleness_malformed_iterables_keep_native_errors(table: RegistryData) -> None:
    with pytest.raises(TypeError):
        staleness._translatable_keys(table)


def test_language_assignment_uses_original_property_and_parent_keys() -> None:
    prop: RegistryData = {8: object(), "id": "language-id", "name": "Idioma", "options": ["Castellà"]}
    assert helpers.find_language_property(iter([prop])) is prop
    assert helpers.language_field_assignment([prop], "es", {7: object(), "Idioma": []}) == ("language-id", ["Castellà"])


def test_empty_origin_never_consumes_pages() -> None:
    def pages() -> Iterator[object]:
        pytest.fail("empty origin must not iterate")
        yield None

    assert helpers.find_translations_of("", pages()) == {}
