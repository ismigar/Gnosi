"""Genogram semantic, projection and persistence boundary regressions."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date
import threading

import pytest
from fastapi import HTTPException
from backend.domains.genograms.contracts import GenogramConfig, GenogramPerson as Person, GenogramRelation as Relation
from backend.domains.genograms.model import date_interval, project, validate_network
from backend.domains.genograms.schema import make_table, field_id, stable_id
from backend.domains.genograms.storage import normalize, reject_new_errors, write_guard


def people(*ids: str) -> list[Person]:
    return [Person(id=id, title=id) for id in ids]


def parent(id: str, source: str, target: str, **extra: str) -> Relation:
    return Relation(id=id, kind="parent", source=source, target=target, **extra)


def codes(persons: list[Person], relationships: list[Relation]) -> set[str]:
    return {i.code for i in validate_network(persons, relationships)}


def test_dates_preserve_precision_and_validate_calendar() -> None:
    assert date_interval("1980") == (date(1980, 1, 1), date(1980, 12, 31))
    assert date_interval("2024-02") == (date(2024, 2, 1), date(2024, 2, 29))
    assert date_interval("") is None
    for value in ("2023-02-29", "unknown", "1900-13", "0000"):
        with pytest.raises(ValueError):
            date_interval(value)


def test_filiation_cycles_do_not_confuse_shared_ancestors_or_emotions() -> None:
    persons = people("g", "a", "b", "c")
    rels = [parent("ga", "g", "a"), parent("gb", "g", "b"), parent("ac", "a", "c"), parent("bc", "b", "c")]
    assert not codes(persons, rels)
    assert not codes(persons, rels + [Relation(id="emotion", kind="emotional", source="c", target="g")])
    assert "parent_cycle" in codes(persons, rels + [parent("cycle", "c", "g")])


def test_relations_reference_valid_people_and_unions() -> None:
    persons = people("a", "b", "c", "d")
    union = Relation(id="u", source="a", target="b")
    assert not codes(persons, [union, parent("p", "a", "c", union_id="u")])
    assert "invalid_union" in codes(persons, [union, parent("p", "d", "c", union_id="u")])
    assert "self_relation" in codes(persons, [parent("p", "a", "a")])
    assert "missing_person" in codes(persons, [parent("p", "a", "absent")])
    assert "incomplete_relation" in codes(persons, [Relation(id="draft")])


def test_union_episodes_and_emotional_observations_remain_independent() -> None:
    persons = people("a", "b")
    first = Relation(id="u1", source="a", target="b", start_date="1990", end_date="2000")
    later = Relation(id="u2", source="b", target="a", start_date="2010")
    assert not codes(persons, [first, later])
    assert "duplicate_relation" in codes(persons, [first, first.model_copy(update={"id": "copy"})])
    assert not codes(persons, [first, Relation(id="e", kind="emotional", source="a", target="b")])


def test_projection_bounds_partner_expansion_and_does_not_invent_edges() -> None:
    persons = people("g", "p", "r", "sibling", "child", "partner", "partner_parent")
    rels = [parent("gp", "g", "p"), parent("pr", "p", "r"), parent("ps", "p", "sibling"), parent("rc", "r", "child"), Relation(id="u", source="r", target="partner"), parent("pp", "partner_parent", "partner")]
    visible, hidden = project(persons, rels, GenogramConfig(root_id="r"), None)
    assert set(visible) == {"g", "p", "r", "sibling", "child", "partner"}
    assert hidden == 1
    visible, hidden = project(persons, rels, GenogramConfig(root_id="r", exclude_ids=["p"]), None)
    assert "p" not in visible and "g" in visible and hidden > 1
    assert len(rels) == 6


def test_dates_are_warnings_not_fabricated_repairs() -> None:
    p = Person(id="p", title="P", birth_date="2000", death_date="1990")
    issues = validate_network([p], [])
    assert issues[0].severity == "warning"
    assert p.birth_date == "2000"


def test_normalization_uses_stable_fields_after_rename() -> None:
    table = make_table("people", "ca")
    props = table["properties"]
    assert isinstance(props, list)
    for prop in props:
        if prop["id"] == field_id("people", "birth_date"):
            prop["name"] = "Renamed birthday"
    person = normalize({"id": "p", "title": "Mercè", "Renamed birthday": "1980"}, table, "people", Person)
    assert person.birth_date == "1980"
    assert person.title == "Mercè"


def test_invalid_external_records_do_not_prevent_unrelated_repairs() -> None:
    before = validate_network(people("a"), [parent("bad", "a", "missing")])
    reject_new_errors(before, before)
    with pytest.raises(HTTPException):
        reject_new_errors(before, before + validate_network(people("a"), [parent("new", "a", "a")]))


def test_canonical_write_guard_serializes_opposing_parent_updates(monkeypatch: pytest.MonkeyPatch, tmp_path, isolated_validation_runtime) -> None:
    from backend.api import vault_routes as vault
    from backend.domains.genograms import storage
    persons = people("a", "b")
    rels: list[Relation] = []
    tables = [make_table("people", "en"), make_table("relations", "en")]
    monkeypatch.setattr(vault, "load_registry", lambda: {"tables": tables})
    monkeypatch.setattr(storage, "read_network", lambda registry: (list(persons), list(rels), []))
    fields = storage.field_names(tables[1], "relations")
    barrier = threading.Barrier(2)
    def save(id: str, source: str, target: str) -> bool:
        metadata = {"id": id, "table_id": stable_id("relations"), fields["kind"]: "parent", fields["source"]: source, fields["target"]: target}
        barrier.wait()
        try:
            with write_guard(tmp_path / f"{id}.md", metadata):
                rels.append(parent(id, source, target))
            return True
        except HTTPException as error:
            assert error.status_code == 422
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(save, "ab", "a", "b")
        b = pool.submit(save, "ba", "b", "a")
        assert sorted([a.result(), b.result()]) == [False, True]
