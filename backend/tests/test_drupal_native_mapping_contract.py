"""Native mapping iteration must not validate or copy extension documents."""

from __future__ import annotations

from collections.abc import Iterator
from operator import methodcaller

import pytest

from backend.utils.open_values import mapping_items, unpack_pair


class Items:
    def __init__(self, values: object, trace: list[str]) -> None:
        self.values = values
        self.trace = trace

    def items(self) -> object:
        self.trace.append("items")
        return self.values


class SequencePair:
    def __init__(self, trace: list[str]) -> None:
        self.trace = trace

    def __getitem__(self, index: int) -> object:
        self.trace.append(f"item-{index}")
        if index == 2:
            raise IndexError(index)
        return index


def test_mapping_items_retains_identity_order_and_live_values() -> None:
    key, first, second = object(), object(), object()
    document = {key: first, "next": second}
    pairs = iter(mapping_items(document))
    assert unpack_pair(next(pairs)) == (key, first)
    document["next"] = first
    assert unpack_pair(next(pairs)) == ("next", first)
    with pytest.raises(StopIteration):
        next(pairs)


def test_items_is_called_before_iteration_and_pairs_use_native_sequence_protocol() -> None:
    trace: list[str] = []

    def values() -> Iterator[object]:
        trace.append("iterate")
        yield SequencePair(trace)
        trace.append("after")

    pairs = mapping_items(Items(values(), trace))
    assert trace == ["items"]
    assert [unpack_pair(pair) for pair in pairs] == [(0, 1)]
    assert trace == ["items", "iterate", "item-0", "item-1", "item-2", "after"]


@pytest.mark.parametrize("value", [None, 7, [], "value"])
def test_missing_items_raises_original_attribute_error(value: object) -> None:
    with pytest.raises(AttributeError) as original:
        methodcaller("items")(value)
    with pytest.raises(AttributeError) as adapted:
        mapping_items(value)
    assert str(adapted.value) == str(original.value)


@pytest.mark.parametrize("value", [None, 7])
def test_noniterable_items_fail_before_loop_body(value: object) -> None:
    with pytest.raises(TypeError, match="not iterable"):
        for _pair in mapping_items(Items(value, [])):
            pytest.fail("A noniterable cannot enter the loop body")


@pytest.mark.parametrize("entry,message", [([], "not enough values"), ([1], "not enough values"), ([1, 2, 3], "too many values")])
def test_malformed_pairs_keep_native_unpacking_error(entry: list[int], message: str) -> None:
    pairs = mapping_items(Items([entry], []))
    with pytest.raises(ValueError, match=message):
        [unpack_pair(pair) for pair in pairs]


def test_string_entries_are_unpacked_instead_of_filtered() -> None:
    assert [unpack_pair(pair) for pair in mapping_items(Items(["ab", b"cd"], []))] == [("a", "b"), (99, 100)]


def test_unpack_stop_iteration_propagates_without_generator_conversion() -> None:
    class BrokenPair:
        def __iter__(self) -> Iterator[object]:
            raise StopIteration("synthetic unpack")

    with pytest.raises(StopIteration, match="synthetic unpack"):
        for pair in mapping_items(Items([BrokenPair()], [])):
            unpack_pair(pair)
