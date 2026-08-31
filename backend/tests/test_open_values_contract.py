"""Native extension-value adapters preserve Python protocols and failures."""

from __future__ import annotations

import operator
from copy import deepcopy
from collections.abc import Callable, Iterator

import pytest

from backend.utils.open_values import append_value, contains_value, float_value, get_value, integer_value, item_value, iterable_values, iterate_values, length_value, list_values, pop_value, set_value


def outcome(operation: Callable[[], object]) -> object:
    try:
        return operation()
    except Exception as error:
        return type(error), error.args


class LegacySequence:
    def __init__(self, values: list[object]) -> None:
        self.values = values
        self.calls: list[int] = []

    def __getitem__(self, index: int) -> object:
        self.calls.append(index)
        return self.values[index]


@pytest.mark.parametrize("value", [None, 7, "Mercè", [1, 2, 3], (1, 2), {"key": [None]}])
@pytest.mark.parametrize("key", ["key", 0, slice(None, 8)])
def test_item_and_slice_preserve_native_results_and_errors(value: object, key: object) -> None:
    expected = outcome(lambda: eval("value[key]", {"value": value, "key": key}))
    assert outcome(lambda: item_value(value, key)) == expected


def test_item_lookup_calls_extension_once_and_preserves_result_identity() -> None:
    selected = slice(None, 8)
    events: list[object] = []
    result = object()

    class Extension:
        def __getitem__(self, key: object) -> object:
            events.append(key)
            return result

    assert item_value(Extension(), selected) is result
    assert events == [selected] and events[0] is selected


class BrokenIterable:
    def __iter__(self) -> int:
        return 7


class TracedIterator:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.values: Iterator[object] = iter([7, "opaque"])

    def __iter__(self) -> "TracedIterator":
        self.calls.append("iter")
        return self

    def __next__(self) -> object:
        self.calls.append("next")
        return next(self.values)

    def __length_hint__(self) -> int:
        self.calls.append("length_hint")
        return 2


def test_for_loop_and_generator_do_not_repeat_iterator_initialization() -> None:
    original, adapted = TracedIterator(), TracedIterator()
    assert [value for value in iterable_values(adapted)] == [value for value in original]
    assert adapted.calls == original.calls == ["iter", "next", "next", "next"]
    original, adapted = TracedIterator(), TracedIterator()
    expected = (value for value in original)
    actual = (value for value in iterable_values(adapted))
    assert original.calls == adapted.calls == ["iter"]
    assert list(actual) == list(expected)
    assert adapted.calls == original.calls


def test_native_list_retains_length_hint_and_iterator_order() -> None:
    original, adapted = TracedIterator(), TracedIterator()
    assert list_values(adapted) == list(original)
    assert adapted.calls == original.calls == ["iter", "length_hint", "next", "next", "next"]


@pytest.mark.parametrize("value", [None, 7, [], {3: "value"}, "Mercè", TracedIterator(), LegacySequence([])])
def test_length_preserves_native_results_and_rejects_length_hint(value: object) -> None:
    expected = outcome(lambda: eval("len(value)", {"value": value}))
    assert outcome(lambda: length_value(value)) == expected
    if isinstance(value, (TracedIterator, LegacySequence)):
        assert value.calls == []


class IndexNumber:
    def __index__(self) -> int:
        return 17


class RecordingAppender:
    def __init__(self) -> None:
        self.values: list[object] = []

    def append(self, value: object) -> str:
        self.values.append(value)
        return "ignored native method result"


@pytest.mark.parametrize("value", [None, 7, "text", (), {}])
def test_append_keeps_native_errors(value: object) -> None:
    expected = outcome(lambda: eval("value.append(7)", {"value": value}))
    assert outcome(lambda: append_value(value, 7)) == expected


def test_append_preserves_input_identity_and_discards_result() -> None:
    value = object()
    container = RecordingAppender()
    assert outcome(lambda: append_value(container, value)) is None
    assert container.values == [value]
    assert container.values[0] is value


@pytest.mark.parametrize("value", [None, 7, "text", [], {"key": [1]}])
@pytest.mark.parametrize("operation", ["get", "set", "pop"])
def test_native_mapping_operations_preserve_errors_and_mutation(
    value: object, operation: str,
) -> None:
    original, adapted = deepcopy(value), deepcopy(value)
    expressions = {
        "get": "value.get('key')",
        "set": "operator.setitem(value, 'key', [2])",
        "pop": "value.pop('key', None)",
    }
    expected = outcome(lambda: eval(expressions[operation], {
        "value": original, "operator": operator,
    }))
    calls: dict[str, Callable[[], object]] = {
        "get": lambda: get_value(adapted, "key"),
        "set": lambda: set_value(adapted, "key", [2]),
        "pop": lambda: pop_value(adapted, "key", None),
    }
    assert outcome(calls[operation]) == expected
    assert original == adapted


@pytest.mark.parametrize("value", [None, 3, 2.5, "abc", b"abc", {7: "opaque"}, [], BrokenIterable()])
def test_iteration_keeps_native_results_and_errors(value: object) -> None:
    # eval resolves the exact native operation on opaque test inputs, not a mock.
    expected = outcome(lambda: eval("list(iter(value))", {"value": value}))
    assert outcome(lambda: list(iterate_values(value))) == expected


def test_iteration_preserves_iterator_identity_and_getitem_fallback() -> None:
    iterator: Iterator[object] = iter([object()])
    assert iterate_values(iterator) is iterator
    original, adapted = LegacySequence(["a", 7]), LegacySequence(["a", 7])
    assert list(iterate_values(adapted)) == eval("list(original)", {"original": original})
    assert adapted.calls == original.calls == [0, 1, 2]


@pytest.mark.parametrize("container", [None, 7, "abc", {7: "opaque"}, [7], LegacySequence([7])])
@pytest.mark.parametrize("item", [7, "a", None])
def test_membership_keeps_native_results_and_errors(container: object, item: object) -> None:
    expected = outcome(lambda: eval("operator.contains(container, item)", {
        "operator": operator, "container": container, "item": item,
    }))
    assert outcome(lambda: contains_value(container, item)) == expected


@pytest.mark.parametrize("value", [None, "12", "1.5", "bad", b"12", bytearray(b"12"), 1.5, True, IndexNumber(), float("inf")])
@pytest.mark.parametrize("name,adapter", [("int", integer_value), ("float", float_value)])
def test_numeric_conversion_keeps_native_results_and_errors(
    value: object, name: str, adapter: Callable[[object], object],
) -> None:
    expected = outcome(lambda: eval(f"{name}(value)", {"value": value}))
    assert outcome(lambda: adapter(value)) == expected
