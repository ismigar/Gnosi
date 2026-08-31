"""Characterize native virtual-field inputs without GraphService or vault I/O."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass

import pytest

from backend.api import virtual_fields as fields
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo


def invoke(function: object, *args: object, **kwargs: object) -> object:
    # Fixed test-owned expression exercises inputs outside the declared port.
    result: object = eval(
        "function(*args, **kwargs)",
        {"function": function, "args": args, "kwargs": kwargs},
    )
    return result


class LegacySequence:
    def __init__(self, values: list[object], trace: list[object]) -> None:
        self.values = values
        self.trace = trace

    def __getitem__(self, index: int) -> object:
        self.trace.append(("item", index))
        return self.values[index]


class ObservedIterator:
    def __init__(self, values: list[object], trace: list[object]) -> None:
        self.values = iter(values)
        self.trace = trace

    def __iter__(self) -> ObservedIterator:
        self.trace.append("iter")
        return self

    def __next__(self) -> object:
        self.trace.append("next")
        return next(self.values)


def source(kind: str, values: list[object], trace: list[object]) -> object:
    if kind == "legacy":
        return LegacySequence(values, trace)
    if kind == "observed":
        return ObservedIterator(values, trace)
    if kind == "tuple":
        return tuple(values)
    return values


def assert_iteration(kind: str, trace: list[object], count: int) -> None:
    if kind == "legacy":
        assert trace == [("item", index) for index in range(count + 1)]
    elif kind == "observed":
        assert trace == ["iter", *["next"] * (count + 1)]
    else:
        assert trace == []


@dataclass
class OpaquePage:
    id: object
    metadata: object


class DuckRecord:
    def __init__(self, data: RegistryData) -> None:
        self.data = data

    def get(self, key: object, default: object = None) -> object:
        return self.data.get(key, default)


@dataclass
class Harness:
    trace: list[object]
    context: dict[str, object]
    result: object


@pytest.fixture(autouse=True)
def isolated(monkeypatch: pytest.MonkeyPatch) -> Harness:
    harness = Harness([], {}, object())

    def context(needs: Iterable[object]) -> dict[str, object]:
        harness.trace.append(("context", set(needs)))
        return harness.context

    def computer(page_id: object, ctx: object) -> object:
        assert ctx is harness.context
        harness.trace.append(("compute", page_id))
        return harness.result

    monkeypatch.setattr(fields, "_build_ctx", context)
    monkeypatch.setattr(fields, "_task_progress_cache", {})
    monkeypatch.setitem(fields.VIRTUAL_COMPUTERS, "fixture", {"fn": computer, "needs": []})
    return harness


def virtual_property(**values: object) -> RegistryData:
    result: RegistryData = {"type": "virtual", "compute": "fixture", "name": "Derived"}
    for key, value in values.items():
        result[key] = value
    return result


@pytest.mark.parametrize("kind", ["list", "tuple", "legacy", "observed"])
def test_properties_keep_identity_and_native_iteration(kind: str) -> None:
    trace: list[object] = []
    prop = DuckRecord(virtual_property())
    properties = source(kind, [{"type": "text"}, prop], trace)
    actual = invoke(fields._virtual_props_of, {"properties": properties})
    assert isinstance(actual, list) and actual == [prop] and actual[0] is prop
    assert_iteration(kind, trace, 2)


@pytest.mark.parametrize("value", [None, False, 0, "", [], {}])
def test_false_properties_keep_existing_empty_fallback(value: object) -> None:
    assert invoke(fields._virtual_props_of, {"properties": value}) == []


@pytest.mark.parametrize("value", [7, True, 2.5])
def test_noniterable_properties_retain_native_error(value: object) -> None:
    with pytest.raises(TypeError, match="not iterable"):
        invoke(fields._virtual_props_of, {"properties": value})


@pytest.mark.parametrize("value", [None, 4, [], "bad"])
def test_malformed_property_is_not_filtered(value: object) -> None:
    with pytest.raises(AttributeError, match="has no attribute 'get'"):
        invoke(fields.inject_for_table, {"properties": [value]}, [])


@pytest.mark.parametrize("kind", ["list", "tuple", "legacy", "observed"])
def test_page_iteration_and_metadata_identity(kind: str, isolated: Harness) -> None:
    trace: list[object] = []
    key, value, raw_id = object(), object(), object()
    metadata: RegistryData = {key: value}
    page = OpaquePage(raw_id, metadata)
    invoke(
        fields.inject_for_table, {"properties": [virtual_property()]}, source(kind, [page], trace)
    )
    assert page.metadata is metadata and metadata[key] is value
    assert next(iter(metadata)) is key and metadata["Derived"] is isolated.result
    assert isolated.trace == [("context", {"fixture"}), ("compute", raw_id)]
    assert_iteration(kind, trace, 1)


def test_pageinfo_metadata_is_mutated_without_revalidation(isolated: Harness) -> None:
    key, value = object(), object()
    metadata: RegistryData = {key: value}
    page = PageInfo.model_construct(id="project", title="Fixture", metadata=metadata)
    fields.inject_for_table({"properties": [virtual_property()]}, [page])
    assert page.metadata is metadata and page.metadata[key] is value
    assert page.metadata["Derived"] is isolated.result


@pytest.mark.parametrize("metadata", [None, False, 0, "text", []])
def test_scalar_metadata_keeps_compute_before_assignment_error(
    metadata: object, isolated: Harness, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("DEBUG", logger=fields.__name__)
    page = OpaquePage("project", metadata)
    fields.inject_for_table({"properties": [virtual_property()]}, [page])
    assert page.metadata is metadata
    if metadata is None:
        assert isolated.trace == [("context", {"fixture"})]
        assert caplog.messages == []
    else:
        assert isolated.trace[-1] == ("compute", "project")
        assert len(caplog.messages) == 1
        assert caplog.messages[0].startswith("virtual_fields compute fixture failed for project:")


def test_opaque_metadata_sink_receives_original_computed_value(isolated: Harness) -> None:
    class Sink:
        def __setitem__(self, key: object, value: object) -> None:
            isolated.trace.append(("set", key, value))

    fields.inject_for_table({"properties": [virtual_property()]}, [OpaquePage("p", Sink())])
    assert isolated.trace[-2:] == [("compute", "p"), ("set", "Derived", isolated.result)]


def test_missing_page_id_still_initializes_dict_metadata(isolated: Harness) -> None:
    page: RegistryData = {}
    fields.inject_for_table({"properties": [virtual_property()]}, [page])
    assert page == {"metadata": {}}
    assert isolated.trace == [("context", {"fixture"})]


def test_getattr_failure_is_logged_per_page_and_next_page_runs(
    isolated: Harness, caplog: pytest.LogCaptureFixture
) -> None:
    class BrokenPage:
        @property
        def metadata(self) -> object:
            raise LookupError("fixture metadata")

    caplog.set_level("DEBUG", logger=fields.__name__)
    metadata: RegistryData = {}
    fields.inject_for_table(
        {"properties": [virtual_property()]}, [BrokenPage(), OpaquePage("p", metadata)]
    )
    assert caplog.messages == ["virtual_fields injection failed for one page: fixture metadata"]
    assert metadata["Derived"] is isolated.result


@pytest.mark.parametrize("single", [False, True])
def test_unhashable_compute_fails_before_context(single: bool, isolated: Harness) -> None:
    table = {"properties": [virtual_property(compute=["fixture"])]}
    with pytest.raises(TypeError, match="unhashable type: 'list'"):
        if single:
            invoke(fields.inject_for_single_page, table, "p", {})
        else:
            invoke(fields.inject_for_table, table, [])
    assert isolated.trace == []


@pytest.mark.parametrize("single", [False, True])
def test_malformed_computer_fn_keeps_native_error_and_next_property(
    single: bool,
    isolated: Harness,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setitem(fields.VIRTUAL_COMPUTERS, "broken", {"fn": 7, "needs": []})
    caplog.set_level("DEBUG", logger=fields.__name__)
    table: RegistryData = {"properties": [virtual_property(compute="broken"), virtual_property()]}
    metadata: RegistryData = {}
    if single:
        invoke(fields.inject_for_single_page, table, "p", metadata)
    else:
        fields.inject_for_table(table, [OpaquePage("p", metadata)])
    assert metadata["Derived"] is isolated.result
    assert caplog.messages == [
        "virtual_fields compute broken failed for p: 'int' object is not callable"
    ]


@pytest.mark.parametrize("single", [False, True])
def test_name_stringification_failure_keeps_outer_exception_boundary(
    single: bool, isolated: Harness, caplog: pytest.LogCaptureFixture
) -> None:
    class BrokenName:
        def __str__(self) -> str:
            raise ValueError("fixture name")

    table: RegistryData = {"properties": [virtual_property(name=BrokenName())]}
    caplog.set_level("DEBUG", logger=fields.__name__)
    if single:
        with pytest.raises(ValueError, match="fixture name"):
            invoke(fields.inject_for_single_page, table, "p", {})
        assert caplog.messages == []
    else:
        fields.inject_for_table(table, [OpaquePage("p", {})])
        assert caplog.messages == ["virtual_fields injection failed for one page: fixture name"]
    assert isolated.trace == [("context", {"fixture"})]


@pytest.mark.parametrize("name", [3, None, b"raw", "Name"])
def test_single_page_keeps_existing_name_coercion_and_unknown_keys(
    name: object, isolated: Harness
) -> None:
    key, value = object(), object()
    metadata: RegistryData = {key: value}
    invoke(
        fields.inject_for_single_page, {"properties": [virtual_property(name=name)]}, "p", metadata
    )
    assert next(iter(metadata)) is key and metadata[key] is value
    assert metadata[str(name)] is isolated.result


@pytest.mark.parametrize("kind", ["list", "tuple", "legacy", "observed"])
def test_task_pages_keep_iteration_relation_duplicates_and_resolver_timing(kind: str) -> None:
    trace: list[object] = []
    resolved: list[str] = []

    def resolve(key: str) -> str | None:
        resolved.append(key)
        return "project" if key == "title" else None

    pages = source(
        kind,
        [
            OpaquePage("t1", {"Projecte": ["[[Title|title]]", "project", None], "Estat": " FET "}),
            {"metadata": {"Projecte": "project", "Estat": "pending"}},
            {"metadata": {}, "Projecte": "project", "Estat": "Fet"},
            {"metadata": 7, "Projecte": "ignored"},
            OpaquePage("t5", DuckRecord({"Projecte": "ignored"})),
        ],
        trace,
    )
    assert invoke(fields.build_task_progress_index, pages, "Projecte", "Estat", "fet", resolve) == {
        "project": 75
    }
    assert resolved == ["title", "project", "project", "project"]
    assert_iteration(kind, trace, 5)


def test_relation_tuple_is_a_single_token_not_flattened() -> None:
    assert fields.build_task_progress_index(
        [{"Projecte": ("a", "b"), "Estat": "Fet"}], "Projecte", "Estat", "Fet"
    ) == {"('a', 'b')": 100}


def test_task_progress_passes_raw_config_keys_and_source_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id, relation_key, status_key, done_value = object(), object(), object(), object()
    received: list[object] = []

    def loader(table_id: object) -> list[object]:
        received.append(table_id)
        return [OpaquePage("task", {relation_key: "p", status_key: done_value})]

    monkeypatch.setattr("backend.api.virtual_fields.time.monotonic", lambda: 10.0)
    config = DuckRecord(
        {
            "source_table_id": source_id,
            "relation_field": relation_key,
            "status_field": status_key,
            "done_value": done_value,
        }
    )
    prop = DuckRecord({"config": config})
    result = invoke(fields._task_progress_index_for, prop, loader)
    assert result == {"p": 100} and received == [source_id] and received[0] is source_id
    assert next(iter(fields._task_progress_cache)) is source_id
    assert invoke(fields._task_progress_index_for, prop, loader) is result
    assert received == [source_id]


def test_cache_expiry_uses_original_preload_clock_and_source_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = iter([10.0, 11.99, 12.0])
    received: list[str] = []
    monkeypatch.setattr("backend.api.virtual_fields.time.monotonic", lambda: next(clock))

    def loader(table_id: str) -> list[object]:
        received.append(table_id)
        return [{"Projecte": "p", "Estat": "Fet"}]

    first = fields._task_progress_index_for({"config": {"source_table_id": "tasks"}}, loader)
    changed = {"config": {"source_table_id": "tasks", "done_value": "pending"}}
    assert fields._task_progress_index_for(changed, loader) is first
    expired = fields._task_progress_index_for(changed, loader)
    assert expired == {"p": 0} and expired is not first
    assert received == ["tasks", "tasks"]


@pytest.mark.parametrize("value", [4, "bad", [1]])
def test_bad_config_retains_get_error_even_without_loader(value: object) -> None:
    with pytest.raises(AttributeError, match="has no attribute 'get'"):
        invoke(fields._task_progress_index_for, {"config": value}, None)


def test_unhashable_source_fails_outside_loader_catch() -> None:
    with pytest.raises(TypeError, match="unhashable type: 'list'"):
        invoke(fields._task_progress_index_for, {"config": {"source_table_id": [1]}}, lambda _: [])


def test_loader_failure_is_logged_but_build_failure_propagates(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def broken_loader(table_id: str) -> list[object]:
        raise LookupError("fixture loader")

    prop = {"config": {"source_table_id": "tasks"}}
    caplog.set_level("DEBUG", logger=fields.__name__)
    assert fields._task_progress_index_for(prop, broken_loader) == {}
    assert caplog.messages == ["task_progress page_loader failed for tasks: fixture loader"]
    with pytest.raises(TypeError, match="not iterable"):
        invoke(fields._task_progress_index_for, prop, lambda _: 7)
    assert len(caplog.messages) == 1 and fields._task_progress_cache == {}


@pytest.mark.parametrize("kind", ["legacy", "observed"])
def test_loader_result_keeps_single_native_iteration(kind: str) -> None:
    trace: list[object] = []
    pages = source(kind, [{"Projecte": "p", "Estat": "Fet"}], trace)
    assert invoke(
        fields._task_progress_index_for,
        {"config": {"source_table_id": "tasks"}},
        lambda _: pages,
    ) == {"p": 100}
    assert_iteration(kind, trace, 1)


def test_first_task_progress_property_controls_shared_context(isolated: Harness) -> None:
    received: list[str] = []

    def loader(table_id: str) -> list[PageInfo]:
        received.append(table_id)
        return [PageInfo.model_construct(id="task", metadata={"Projecte": "p", "Estat": "Fet"})]

    table: RegistryData = {
        "properties": [
            virtual_property(
                compute="task_progress", name="First", config={"source_table_id": "one"}
            ),
            virtual_property(
                compute="task_progress", name="Second", config={"source_table_id": "two"}
            ),
        ]
    }
    metadata: RegistryData = {}
    invoke(fields.inject_for_single_page, table, "p", metadata, loader)
    assert metadata == {"First": 100, "Second": 100}
    assert received == ["one"] and isolated.context["task_progress"] == {"p": 100}


def test_needs_uses_native_iteration_once(
    monkeypatch: pytest.MonkeyPatch, isolated: Harness
) -> None:
    trace: list[object] = []
    monkeypatch.setitem(
        fields.VIRTUAL_COMPUTERS,
        "fixture",
        {"needs": ObservedIterator(["opaque"], trace), "fn": lambda *_: None},
    )
    fields.inject_for_table({"properties": [virtual_property()]}, [])
    assert isolated.trace == [("context", {"fixture", "opaque"})]
    assert_iteration("observed", trace, 1)


@pytest.mark.parametrize("kind", ["set", "dict"])
@pytest.mark.parametrize("single", [False, True])
def test_needs_keeps_set_update_native_fastpaths(
    kind: str, single: bool, monkeypatch: pytest.MonkeyPatch, isolated: Harness
) -> None:
    trace: list[object] = []

    class ObservedSet(set[object]):
        def __iter__(self) -> Iterator[object]:
            trace.append("set-iter")
            return super().__iter__()

    class ObservedDict(dict[object, object]):
        def __iter__(self) -> Iterator[object]:
            trace.append("dict-iter")
            return super().__iter__()

    values: object = ObservedSet(["opaque"]) if kind == "set" else ObservedDict({"opaque": 1})
    expected: set[object] = set()
    invoke(expected.update, values)
    native_trace = list(trace)
    trace.clear()
    monkeypatch.setitem(
        fields.VIRTUAL_COMPUTERS, "fixture", {"needs": values, "fn": lambda *_: None}
    )
    table: RegistryData = {"properties": [virtual_property()]}
    if single:
        fields.inject_for_single_page(table, "p", {})
    else:
        fields.inject_for_table(table, [])
    assert trace == native_trace
    assert isolated.trace == [("context", expected | {"fixture"})]


def test_native_callback_does_not_lookup_instance_call_attribute(
    monkeypatch: pytest.MonkeyPatch, isolated: Harness
) -> None:
    class NativeCallable:
        def __getattribute__(self, name: str) -> object:
            if name == "__call__":
                raise AssertionError("native call must use the type slot")
            return object.__getattribute__(self, name)

        def __call__(self, *args: object) -> object:
            isolated.trace.append(("native-call", *args))
            return isolated.result

    monkeypatch.setitem(fields.VIRTUAL_COMPUTERS, "fixture", {"fn": NativeCallable()})
    metadata: RegistryData = {}
    invoke(fields.inject_for_single_page, {"properties": [virtual_property()]}, "p", metadata)
    assert metadata["Derived"] is isolated.result
    assert isolated.trace[-1] == ("native-call", "p", isolated.context)


def test_native_loader_does_not_lookup_instance_call_attribute() -> None:
    class NativeLoader:
        def __getattribute__(self, name: str) -> object:
            if name == "__call__":
                raise AssertionError("native call must use the type slot")
            return object.__getattribute__(self, name)

        def __call__(self, table_id: str) -> list[object]:
            assert table_id == "tasks"
            return [{"Projecte": "p", "Estat": "Fet"}]

    assert invoke(
        fields._task_progress_index_for,
        {"config": {"source_table_id": "tasks"}},
        NativeLoader(),
    ) == {"p": 100}


def test_native_subscription_does_not_lookup_instance_getitem_attribute(
    monkeypatch: pytest.MonkeyPatch, isolated: Harness
) -> None:
    class Descriptor:
        def __getattribute__(self, name: str) -> object:
            if name == "__getitem__":
                raise AssertionError("native subscription must use the type slot")
            return object.__getattribute__(self, name)

        def get(self, key: object, default: object = None) -> object:
            return default

        def __getitem__(self, key: object) -> object:
            assert key == "fn"
            isolated.trace.append("lookup-fn")
            return lambda *_: isolated.result

    # Keep this malformed-but-supported descriptor opaque, like decoded inputs.
    invoke(monkeypatch.setitem, fields.VIRTUAL_COMPUTERS, "fixture", Descriptor())
    metadata: RegistryData = {}
    invoke(fields.inject_for_single_page, {"properties": [virtual_property()]}, "p", metadata)
    assert metadata["Derived"] is isolated.result
    assert isolated.trace == [("context", {"fixture"}), "lookup-fn"]


@pytest.mark.parametrize("single", [False, True])
def test_missing_fn_preserves_subscription_error(
    single: bool, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setitem(fields.VIRTUAL_COMPUTERS, "fixture", {"needs": []})
    caplog.set_level("DEBUG", logger=fields.__name__)
    table: RegistryData = {"properties": [virtual_property()]}
    if single:
        invoke(fields.inject_for_single_page, table, "p", {})
    else:
        fields.inject_for_table(table, [OpaquePage("p", {})])
    assert caplog.messages == ["virtual_fields compute fixture failed for p: 'fn'"]


def test_page_iteration_error_is_not_caught_as_page_failure(isolated: Harness) -> None:
    def pages() -> Iterator[object]:
        yield OpaquePage("p", {})
        raise LookupError("fixture iterator")

    with pytest.raises(LookupError, match="fixture iterator"):
        invoke(fields.inject_for_table, {"properties": [virtual_property()]}, pages())
    assert isolated.trace[-1] == ("compute", "p")


def test_declared_ports_accept_pageinfo_loaders_and_registry_metadata(isolated: Harness) -> None:
    inject_table: Callable[
        [RegistryData | None, list[PageInfo], Callable[[str], list[PageInfo]]], None
    ] = fields.inject_for_table
    inject_single: Callable[
        [RegistryData | None, str, RegistryData, Callable[[str], list[PageInfo]]], None
    ] = fields.inject_for_single_page

    def loader(table_id: str) -> list[PageInfo]:
        return []

    table: RegistryData = {"properties": [virtual_property()]}
    key, value = object(), object()
    metadata: RegistryData = {key: value}
    page = PageInfo.model_construct(id="page", metadata=metadata)
    inject_table(table, [page], loader)
    inject_single(table, "page", metadata, loader)
    assert page.metadata is metadata and metadata[key] is value
    assert metadata["Derived"] is isolated.result
