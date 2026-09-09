"""Pure validation and bounded projection; never infer undocumented facts."""
from __future__ import annotations

from calendar import monthrange
from datetime import date
import re
from collections import defaultdict

from .contracts import GenogramConfig, GenogramIssue, GenogramPerson, GenogramRelation

PERSON_OPTIONS = {
    "kind": ("person", "pregnancy"),
    "symbol": ("square", "circle", "neutral"),
    "vital_status": ("unknown", "alive", "deceased", "stillborn"),
    "pregnancy_status": ("ongoing", "miscarriage", "termination"),
    "multiple_type": ("unknown", "fraternal", "identical"),
}
RELATION_OPTIONS = {
    "kind": ("union", "parent", "emotional"),
    "union_type": ("marriage", "cohabitation", "partnership", "coparenting"),
    "union_status": ("unknown", "active", "separated", "divorced", "ended"),
    "parentage": ("biological", "adoptive", "foster", "unknown"),
    "emotion": ("close", "fused", "distant", "cutoff", "conflict", "close_conflict", "distant_conflict", "fused_conflict"),
}


def date_interval(value: str) -> tuple[date, date] | None:
    if not value:
        return None
    if not re.fullmatch(r"\d{4}(?:-\d{2}(?:-\d{2})?)?", value):
        raise ValueError("Invalid partial date")
    parts = [int(part) for part in value.split("-")]
    year = parts[0]
    month = parts[1] if len(parts) > 1 else 1
    day = parts[2] if len(parts) > 2 else 1
    start = date(year, month, day)
    end = start if len(parts) == 3 else date(year, month, monthrange(year, month)[1]) if len(parts) == 2 else date(year, 12, 31)
    return start, end


class _NetworkValidation:
    """Check each independent invariant while retaining one issue collection."""

    def __init__(self, people: list[GenogramPerson], relations: list[GenogramRelation]) -> None:
        self.people = people
        self.relations = relations
        self.by_id = {person.id: person for person in people}
        self.relation_ids = {relation.id: relation for relation in relations}
        self.parents: dict[str, list[str]] = defaultdict(list)
        self.signatures: set[tuple[str, ...]] = set()
        self.seen_ids: set[str] = set()
        self.issues: list[GenogramIssue] = []

    def issue(self, code: str, record_id: str, field: str = "", warning: bool = False) -> None:
        self.issues.append(GenogramIssue(
            code=code, record_id=record_id, field=field,
            severity="warning" if warning else "error",
        ))

    def validate_record(self, record: GenogramPerson | GenogramRelation) -> None:
        if not record.id or record.id in self.seen_ids:
            self.issue("duplicate_identity" if record.id else "missing_identity", record.id)
        self.seen_ids.add(record.id)
        options = PERSON_OPTIONS if isinstance(record, GenogramPerson) else RELATION_OPTIONS
        for field, values in options.items():
            if getattr(record, field) not in values:
                self.issue("invalid_option", record.id, field)
        for field, value in record.model_dump().items():
            if field.endswith("_date") and value:
                try:
                    date_interval(str(value))
                except ValueError:
                    self.issue("invalid_date", record.id, field, True)

    def validate_person(self, person: GenogramPerson) -> None:
        try:
            birth = date_interval(person.birth_date)
            death = date_interval(person.death_date)
            if birth and death and death[1] < birth[0]:
                self.issue("date_order", person.id, "death_date", True)
        except ValueError:
            pass
        if person.pregnancy_weeks is not None and not 0 <= person.pregnancy_weeks <= 45:
            self.issue("pregnancy_weeks", person.id, "pregnancy_weeks", True)

    def validate_parentage(self, relation: GenogramRelation) -> None:
        self.parents[relation.source].append(relation.target)
        parent = self.by_id.get(relation.source)
        child = self.by_id.get(relation.target)
        if parent and parent.kind == "pregnancy":
            self.issue("pregnancy_parent", relation.id)
        if relation.union_id:
            self.validate_union_reference(relation)
        try:
            birth_parent = date_interval(parent.birth_date) if parent else None
            birth_child = date_interval(child.birth_date) if child else None
            if birth_parent and birth_child and birth_parent[0] > birth_child[1]:
                self.issue("parent_date_order", relation.id, "source", True)
        except ValueError:
            pass

    def validate_union_reference(self, relation: GenogramRelation) -> None:
        union = self.relation_ids.get(relation.union_id)
        if (
            not union or union.kind != "union"
            or relation.source not in (union.source, union.target)
            or relation.target in (union.source, union.target)
        ):
            self.issue("invalid_union", relation.id, "union_id")

    def validate_relation_dates(self, relation: GenogramRelation) -> None:
        try:
            last = date_interval(relation.start_date)
            for field in ("separation_date", "divorce_date", "end_date"):
                current = date_interval(getattr(relation, field))
                if current and last and current[1] < last[0]:
                    self.issue("date_order", relation.id, field, True)
                if current:
                    last = current
        except ValueError:
            pass

    def validate_relation(self, relation: GenogramRelation) -> None:
        if not relation.source or not relation.target:
            self.issue("incomplete_relation", relation.id)
            return
        if relation.source == relation.target:
            self.issue("self_relation", relation.id)
        if relation.source not in self.by_id or relation.target not in self.by_id:
            self.issue("missing_person", relation.id)
        if relation.kind == "parent":
            self.validate_parentage(relation)
        signature = _relation_signature(relation)
        if signature in self.signatures:
            self.issue("duplicate_relation", relation.id)
        self.signatures.add(signature)
        self.validate_relation_dates(relation)

    def validate_parent_cycles(self) -> None:
        # Iteration also supports long externally edited chains.
        for relation in self.relations:
            if relation.kind != "parent":
                continue
            seen: set[str] = set()
            pending = [relation.target]
            while pending:
                node = pending.pop()
                if node == relation.source:
                    self.issue("parent_cycle", relation.id)
                    break
                if node not in seen:
                    seen.add(node)
                    pending.extend(self.parents.get(node, []))


def _relation_signature(relation: GenogramRelation) -> tuple[str, ...]:
    endpoints: tuple[str, ...]
    if relation.kind == "parent":
        endpoints = (relation.source, relation.target)
        detail: tuple[str, ...] = (relation.parentage, relation.union_id)
    else:
        endpoints = tuple(sorted((relation.source, relation.target)))
        if relation.kind == "emotional":
            detail = (relation.emotion, relation.observed_date, relation.informant)
        else:
            detail = (relation.union_type, relation.start_date, relation.end_date)
    return (relation.kind, *endpoints, *detail)


def validate_network(people: list[GenogramPerson], relations: list[GenogramRelation]) -> list[GenogramIssue]:
    validation = _NetworkValidation(people, relations)
    all_records: list[GenogramPerson | GenogramRelation] = [*people, *relations]
    for record in all_records:
        validation.validate_record(record)
    for person in people:
        validation.validate_person(person)
    for relation in relations:
        validation.validate_relation(relation)
    validation.validate_parent_cycles()
    return validation.issues


def project(people: list[GenogramPerson], relations: list[GenogramRelation], config: GenogramConfig, eligible_ids: list[str] | None) -> tuple[list[str], int]:
    all_ids = {p.id for p in people}
    allowed = all_ids if eligible_ids is None else all_ids.intersection(eligible_ids)
    allowed -= set(config.exclude_ids)
    up: dict[str, set[str]] = defaultdict(set)
    down: dict[str, set[str]] = defaultdict(set)
    for r in relations:
        if r.kind == "parent":
            up[r.target].add(r.source)
            down[r.source].add(r.target)
    selected = {config.root_id} & all_ids
    for adjacency, depth in ((up, config.ancestors), (down, config.descendants)):
        frontier = {config.root_id} & all_ids
        for _ in range(depth):
            frontier = {other for node in frontier for other in adjacency[node]} - selected
            selected |= frontier
    # Siblings of the focus, not the siblings of every ancestor.
    selected |= {child for parent in up[config.root_id] for child in down[parent]}
    selected |= set(config.include_ids) & all_ids
    family = set(selected)
    for r in relations:
        if r.kind == "union" and (r.source in family or r.target in family):
            selected.update((r.source, r.target))
    selected &= allowed
    hidden = sum((r.source in selected) != (r.target in selected) for r in relations if r.kind != "emotional" or config.emotional)
    return sorted(selected), hidden
