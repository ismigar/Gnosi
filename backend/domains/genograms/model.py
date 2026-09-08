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


def validate_network(people: list[GenogramPerson], relations: list[GenogramRelation]) -> list[GenogramIssue]:
    issues: list[GenogramIssue] = []
    by_id = {p.id: p for p in people}
    relation_ids = {r.id: r for r in relations}
    parents: dict[str, list[str]] = defaultdict(list)
    signatures: dict[tuple[str, ...], str] = {}
    def issue(code: str, record_id: str, field: str = "", warning: bool = False) -> None:
        issues.append(GenogramIssue(code=code, record_id=record_id, field=field, severity="warning" if warning else "error"))
    all_records: list[GenogramPerson | GenogramRelation] = [*people, *relations]
    seen_ids: set[str] = set()
    for record in all_records:
        if not record.id or record.id in seen_ids:
            issue("duplicate_identity" if record.id else "missing_identity", record.id)
        seen_ids.add(record.id)
        options = PERSON_OPTIONS if isinstance(record, GenogramPerson) else RELATION_OPTIONS
        for field, values in options.items():
            if getattr(record, field) not in values:
                issue("invalid_option", record.id, field)
        for field, value in record.model_dump().items():
            if field.endswith("_date") and value:
                try:
                    date_interval(str(value))
                except ValueError:
                    issue("invalid_date", record.id, field, True)
    for p in people:
        try:
            birth, death = date_interval(p.birth_date), date_interval(p.death_date)
            if birth and death and death[1] < birth[0]:
                issue("date_order", p.id, "death_date", True)
        except ValueError:
            pass
        if p.pregnancy_weeks is not None and not 0 <= p.pregnancy_weeks <= 45:
            issue("pregnancy_weeks", p.id, "pregnancy_weeks", True)
    for r in relations:
        if not r.source or not r.target:
            issue("incomplete_relation", r.id)
            continue
        if r.source == r.target:
            issue("self_relation", r.id)
        if r.source not in by_id or r.target not in by_id:
            issue("missing_person", r.id)
        if r.kind == "parent":
            parents[r.source].append(r.target)
            if by_id.get(r.source) and by_id[r.source].kind == "pregnancy":
                issue("pregnancy_parent", r.id)
            if r.union_id:
                union = relation_ids.get(r.union_id)
                if not union or union.kind != "union" or r.source not in (union.source, union.target) or r.target in (union.source, union.target):
                    issue("invalid_union", r.id, "union_id")
            try:
                parent, child = by_id.get(r.source), by_id.get(r.target)
                a = date_interval(parent.birth_date) if parent else None
                b = date_interval(child.birth_date) if child else None
                if a and b and a[0] > b[1]:
                    issue("parent_date_order", r.id, "source", True)
            except ValueError:
                pass
        endpoints = (r.source, r.target) if r.kind == "parent" else tuple(sorted((r.source, r.target)))
        detail = (r.parentage, r.union_id) if r.kind == "parent" else (r.emotion, r.observed_date, r.informant) if r.kind == "emotional" else (r.union_type, r.start_date, r.end_date)
        signature = (r.kind, *endpoints, *detail)
        if signature in signatures:
            issue("duplicate_relation", r.id)
        signatures[signature] = r.id
        try:
            last = date_interval(r.start_date)
            for field in ("separation_date", "divorce_date", "end_date"):
                current = date_interval(getattr(r, field))
                if current and last and current[1] < last[0]:
                    issue("date_order", r.id, field, True)
                if current:
                    last = current
        except ValueError:
            pass
    # Iterative reachability handles long externally edited chains without recursion.
    for r in relations:
        if r.kind != "parent":
            continue
        seen: set[str] = set()
        pending = [r.target]
        while pending:
            node = pending.pop()
            if node == r.source:
                issue("parent_cycle", r.id)
                break
            if node not in seen:
                seen.add(node)
                pending.extend(parents.get(node, []))
    return issues


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
