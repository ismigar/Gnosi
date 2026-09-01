"""Synthetic edge contracts for the deterministic Brain lint producer.

Run through pipeline/sandbox/verify_typed_drawings.py for runtime isolation.
Only page/body/evidence seams are replaced; no vault or provider is consulted.
"""

from __future__ import annotations

import datetime
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from backend.domains.llm_wiki import legacy_ports
from backend.domains.llm_wiki.lint_contracts import LintNote, ReprocessCandidate
from backend.services import llm_wiki_lint as lint
from backend.services import llm_wiki_storage as storage


class _FixedDate(datetime.date):
    @classmethod
    def today(cls) -> _FixedDate:
        return cls(2026, 8, 31)


@dataclass
class _Page:
    id: object = ""
    title: object = ""
    path: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


def _note(
    note_id: str,
    title: str,
    *,
    body: str = "",
    note_type: str = "lectura",
    review: str = "2026-08-31",
    managed_key: str = "",
    managed_role: str = "",
    managed_stale: bool = False,
    source_table_id: str = "",
    resource_id: str = "",
) -> LintNote:
    out_ids, out_titles = lint._outbound_targets(body)
    return {
        "id": note_id,
        "title": title,
        "body": body,
        "out_ids": out_ids,
        "out_titles": out_titles,
        "review": review,
        "note_type": note_type,
        "managed_key": managed_key,
        "managed_role": managed_role,
        "managed_stale": managed_stale,
        "source_table_id": source_table_id,
        "resource_id": resource_id,
    }


def _supply_notes(monkeypatch: pytest.MonkeyPatch, notes: list[LintNote]) -> None:
    def load_notes(table_id: str) -> list[LintNote]:
        assert table_id == "synthetic-brain"
        return notes

    monkeypatch.setattr(lint, "_load_notes", load_notes)


def test_load_notes_normalizes_values_and_omits_incomplete_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = "[[  Other Note | A-B_12 ]] [[ other note|ab12]] [[Title only]]"
    pages = [
        _Page("template", "Template", "never-read", {"is_template": "false"}),
        _Page("", "No identity", "never-read"),
        _Page("no-title", "", "never-read"),
        _Page(
            "page-id",
            "  Page title  ",
            "synthetic.md",
            {
                "id": "metadata-id",
                "title": "Metadata title",
                "Última revisió": " 2026-05-03T20:30:00Z ",
                "última revisió": "ignored-lowercase",
                "note_type": "Reading",
                "llm_wiki_key": 7,
                "llm_wiki_role": " resource-index ",
                "llm_wiki_stale": "false",
                "llm_wiki_source_table_id": 42,
                "llm_wiki_resource_id": 0,
            },
        ),
        _Page(
            None,
            None,
            metadata={
                "id": 27,
                "title": "Fallback",
                "Última revisió": "",
                "última revisió": " 2026-08-30 ",
                "Tipus de nota": "Permanent",
            },
        ),
        _Page("default", "Defaults"),
        _Page(" ", " "),
    ]
    original = deepcopy(pages)
    reads: list[str | None] = []

    def table_pages(table_id: str) -> list[_Page]:
        assert table_id == "synthetic-brain"
        return pages

    def page_metadata(page: _Page) -> dict[str, object]:
        return page.metadata

    def read_body(path: str | None) -> str:
        reads.append(path)
        assert path in {"synthetic.md", None}
        return body if path else ""

    monkeypatch.setattr(legacy_ports, "table_pages", table_pages)
    monkeypatch.setattr(storage, "page_metadata", page_metadata)
    monkeypatch.setattr(lint, "_read_body", read_body)

    assert lint._load_notes("synthetic-brain") == [
        {
            "id": "page-id",
            "title": "  Page title  ",
            "body": body,
            "out_ids": {"ab12"},
            "out_titles": {"other note", "title only"},
            "review": "2026-05-03T20:30:00Z",
            "note_type": "lectura",
            "managed_key": "7",
            "managed_role": " resource-index ",
            "managed_stale": True,
            "source_table_id": "42",
            "resource_id": "",
        },
        _note("27", "Fallback", review="2026-08-30", note_type="permanent"),
        _note("default", "Defaults", review="", note_type=""),
        _note(" ", " ", review="", note_type=""),
    ]
    assert reads == ["synthetic.md", None, None, None]
    assert pages == original


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "---\nlinks: [[Hidden|hidden]]\n---\nVisible [[Target|target]]",
            "\nVisible [[Target|target]]",
        ),
        ("---unfinished frontmatter", "---unfinished frontmatter"),
        (" \n---\nnot leading\n---\nBody", " \n---\nnot leading\n---\nBody"),
        ("Body --- remains", "Body --- remains"),
    ],
)
def test_read_body_strips_only_complete_leading_frontmatter(
    monkeypatch: pytest.MonkeyPatch,
    raw: str,
    expected: str,
) -> None:
    def read_text(path: Path, encoding: str) -> str:
        assert path == Path("synthetic.md")
        assert encoding == "utf-8"
        return raw

    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_text", read_text)
        body = lint._read_body("synthetic.md")
    assert body == expected


def test_read_body_missing_paths_and_read_errors_are_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[Path] = []

    def read_text(path: Path, encoding: str) -> str:
        calls.append(path)
        raise OSError("synthetic unreadable note")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_text", read_text)
        assert lint._read_body(None) == ""
        assert lint._read_body("") == ""
        assert lint._read_body("unreadable.md") == ""
    assert calls == [Path("unreadable.md")]


def test_inbound_links_use_ids_titles_and_exclude_self_references() -> None:
    notes = [
        _note("source", "Source", body="[[Alias|AA_BB]] [[ target by title ]] [[unknown]]"),
        _note("aa-bb", "Target by id"),
        _note("title-target", "  Target By Title  ", note_type="permanent"),
        _note("self", "Self note", body="[[Self note|self]]"),
        _note("index", "Index", note_type="index"),
        _note("system", "System", note_type="system"),
    ]
    original = deepcopy(notes)
    assert lint._inbound_note_ids(notes) == {"aa-bb", "title-target"}
    assert lint._orphan_findings(notes) == [
        {"id": "source", "title": "Source"},
        {"id": "self", "title": "Self note"},
    ]
    assert notes == original


def test_inbound_collisions_resolve_to_last_note_in_input_order() -> None:
    notes = [
        _note("source", "Source", body="[[alias|A-B]] [[shared title]]"),
        _note("a-b", "First id"),
        _note("AB", "Last id"),
        _note("first-title", "Shared Title"),
        _note("last-title", " shared title "),
    ]
    assert lint._inbound_note_ids(notes) == {"AB", "last-title"}
    assert lint._inbound_note_ids([notes[0], *reversed(notes[1:])]) == {"a-b", "first-title"}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("", None),
        ("invalid", None),
        ("2026-02-30", None),
        (" 2026-08-31", None),
        ("2026-08-31", 0),
        ("2026-08-31T23:59:59-11:00", 0),
        ("2026-09-01", -1),
        ("2026-05-03", 120),
        ("2026-05-02", 121),
        ("2024-02-29", 914),
    ],
)
def test_days_since_uses_calendar_date_prefix_and_fixed_today(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
    expected: int | None,
) -> None:
    original_date = datetime.date
    with monkeypatch.context() as patch:
        patch.setattr(datetime, "date", _FixedDate)
        result = lint._days_since(value)
    assert datetime.date is original_date
    assert result == expected


def test_stale_boundary_is_strict_and_missing_invalid_dates_remain_distinct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notes = [
        _note("boundary", "Boundary", review="2026-05-03"),
        _note("old", "Old", review="2026-05-02", note_type="permanent"),
        _note("future", "Future", review="2026-09-01"),
        _note("missing", "Missing", review=""),
        _note("invalid", "Invalid", review="broken"),
        _note("index", "Index", review="", note_type="index"),
        _note("system", "System", review="", note_type="system"),
    ]
    with monkeypatch.context() as patch:
        patch.setattr(datetime, "date", _FixedDate)
        findings = lint._stale_findings(notes)
    assert findings == [
        {"id": "old", "title": "Old", "review": "2026-05-02", "days": 121},
        {"id": "missing", "title": "Missing", "review": None, "days": None},
        {"id": "invalid", "title": "Invalid", "review": "broken", "days": None},
    ]


def test_mentions_respect_word_boundaries_literal_titles_and_explicit_links() -> None:
    notes = [
        _note(
            "source",
            "Source Note",
            body=(
                "Source Note; Cat; Concatenate; DATA.MODEL twice data.model; "
                "linked by id [[Alias|LINK_ID]]; Linked By Title [[linked by title]]; "
                "Alpha Concept then Alpha Concept; preAlphabeticalpost; DataXModel."
            ),
        ),
        _note("short", "Cat"),
        _note("literal", "Data.Model"),
        _note("link-id", "Linked By Id"),
        _note("title", "Linked By Title"),
        _note("alpha", "  Alpha Concept  "),
        _note("substring", "Alphabetical"),
    ]
    assert lint._missing_cross_references(notes) == [
        {
            "id": "source",
            "title": "Source Note",
            "should_link": "Data.Model",
            "target_id": "literal",
        },
        {
            "id": "source",
            "title": "Source Note",
            "should_link": "  Alpha Concept  ",
            "target_id": "alpha",
        },
    ]
    assert (
        lint._missing_cross_references(
            [
                _note("source", "Source", body="DataXModel"),
                _note("literal", "Data.Model"),
            ]
        )
        == []
    )


@pytest.mark.parametrize("target_count", [99, 100, 101])
def test_mentions_cap_preserves_order_and_report_truncation_boundary(
    monkeypatch: pytest.MonkeyPatch,
    target_count: int,
) -> None:
    targets = [_note(f"target-{i}", f"Concept {i:03}") for i in range(target_count)]
    body = "; ".join(target["title"] for target in reversed(targets))
    notes = [_note("source", "Source", body=body), *targets]
    _supply_notes(monkeypatch, notes)
    with monkeypatch.context() as patch:
        patch.setattr(datetime, "date", _FixedDate)
        report = lint.run_lint("synthetic-brain")
    assert report["missing_xref"] == [
        {
            "id": "source",
            "title": "Source",
            "should_link": f"Concept {i:03}",
            "target_id": f"target-{i}",
        }
        for i in range(min(target_count, 100))
    ]
    assert report["counts"]["missing_xref"] == min(target_count, 100)
    assert report["truncated_missing_xref"] is (target_count >= 100)


def test_duplicate_keys_preserve_first_key_and_member_order_without_filtering() -> None:
    notes = [
        _note("b1", "B first", managed_key="b", managed_stale=True),
        _note("a1", "A first", managed_key="a"),
        _note("empty1", "Empty one"),
        _note("empty2", "Empty two"),
        _note("b2", "B second", managed_key="b", note_type="index"),
        _note("a1", "Repeated identity", managed_key="a"),
        _note("upper", "Case sensitive", managed_key="B"),
        _note("spaced", "Space sensitive", managed_key=" b "),
    ]
    original = deepcopy(notes)
    assert lint._duplicate_managed_keys(notes) == [
        {
            "key": "b",
            "notes": [{"id": "b1", "title": "B first"}, {"id": "b2", "title": "B second"}],
        },
        {
            "key": "a",
            "notes": [{"id": "a1", "title": "A first"}, {"id": "a1", "title": "Repeated identity"}],
        },
    ]
    assert notes == original


def test_index_drift_sorts_unique_pairs_and_uses_managed_role_even_when_stale() -> None:
    notes = [
        _note("z", "Z", source_table_id="z", resource_id="a"),
        _note("b", "B", source_table_id="a", resource_id="b"),
        _note("a", "A", source_table_id="a", resource_id="a"),
        _note("duplicate", "Duplicate", source_table_id="a", resource_id="a"),
        _note("covered", "Covered", source_table_id="covered", resource_id="r"),
        _note(
            "index",
            "Stale index",
            source_table_id="covered",
            resource_id="r",
            note_type="system",
            managed_role="resource-index",
            managed_stale=True,
        ),
        _note("label", "Index label only", source_table_id="z", resource_id="a", note_type="index"),
        _note(
            "stale", "Stale reading", source_table_id="stale", resource_id="r", managed_stale=True
        ),
        _note(
            "permanent", "Permanent", source_table_id="p", resource_id="r", note_type="permanent"
        ),
        _note("no-source", "No source", resource_id="r"),
        _note("no-resource", "No resource", source_table_id="a"),
    ]
    original = deepcopy(notes)
    assert lint._resource_index_drift(notes) == [
        {"source_table_id": "a", "resource_id": "a"},
        {"source_table_id": "a", "resource_id": "b"},
        {"source_table_id": "z", "resource_id": "a"},
    ]
    assert notes == original


def test_citations_decode_immutable_ids_preserve_duplicates_and_accept_empty_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uri = "gnosi-cite:?res=res%2F1&snapshot=snap%26one&segment=seg%20%2B+%252F"
    notes = [
        _note("one", "First", body=f"[one]({uri}) [repeat]({uri})"),
        _note(
            "two",
            "Second",
            body=(
                "gnosi-cite:?res=valid&snapshot=s&segment=x "
                "gnosi-cite:?res=&snapshot=s&segment=x "
                "gnosi-cite:?res=missing-segment&snapshot=s "
                "gnosi-cite:?res=last&snapshot=s&segment=x"
            ),
        ),
    ]
    calls: list[tuple[str, str, str]] = []

    def load_evidence(
        resource_id: str, snapshot_id: str, segment_id: str
    ) -> dict[str, object] | None:
        calls.append((resource_id, snapshot_id, segment_id))
        return {} if resource_id == "valid" else None

    monkeypatch.setattr(storage, "load_evidence", load_evidence)
    assert lint._broken_citations(notes) == [
        {
            "id": "one",
            "title": "First",
            "resource_id": "res/1",
            "snapshot_id": "snap&one",
            "segment_id": "seg ++%2F",
        },
        {
            "id": "one",
            "title": "First",
            "resource_id": "res/1",
            "snapshot_id": "snap&one",
            "segment_id": "seg ++%2F",
        },
        {
            "id": "two",
            "title": "Second",
            "resource_id": "last",
            "snapshot_id": "s",
            "segment_id": "x",
        },
    ]
    assert calls == [
        ("res/1", "snap&one", "seg ++%2F"),
        ("res/1", "snap&one", "seg ++%2F"),
        ("valid", "s", "x"),
        ("last", "s", "x"),
    ]


def test_citation_cap_limits_results_but_still_checks_later_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notes = [
        _note(
            f"note-{i}",
            f"Note {i}",
            body=f"gnosi-cite:?res=res-{i}&snapshot=snapshot-{i}&segment=segment-{i}",
        )
        for i in range(103)
    ]
    calls: list[tuple[str, str, str]] = []

    def load_evidence(resource_id: str, snapshot_id: str, segment_id: str) -> None:
        calls.append((resource_id, snapshot_id, segment_id))

    monkeypatch.setattr(storage, "load_evidence", load_evidence)
    _supply_notes(monkeypatch, notes)
    with monkeypatch.context() as patch:
        patch.setattr(datetime, "date", _FixedDate)
        report = lint.run_lint("synthetic-brain")
    assert report["broken_cites"] == [
        {
            "id": f"note-{i}",
            "title": f"Note {i}",
            "resource_id": f"res-{i}",
            "snapshot_id": f"snapshot-{i}",
            "segment_id": f"segment-{i}",
        }
        for i in range(100)
    ]
    assert calls == [(f"res-{i}", f"snapshot-{i}", f"segment-{i}") for i in range(103)]
    assert report["counts"]["broken_cites"] == 100
    assert report["truncated_missing_xref"] is False


def test_evidence_lookup_errors_propagate_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("synthetic evidence failure")

    def load_evidence(resource_id: str, snapshot_id: str, segment_id: str) -> None:
        raise error

    monkeypatch.setattr(storage, "load_evidence", load_evidence)
    with pytest.raises(RuntimeError) as caught:
        lint._broken_citations([_note("n", "N", body="gnosi-cite:?res=r&snapshot=s&segment=g")])
    assert caught.value is error


@pytest.mark.parametrize("references", [None, "", []])
def test_empty_report_has_exact_shape_and_zero_counts(
    monkeypatch: pytest.MonkeyPatch,
    references: str | list[str] | None,
) -> None:
    _supply_notes(monkeypatch, [])
    calls: list[str] = []

    def candidates(source_id: str) -> list[ReprocessCandidate]:
        calls.append(source_id)
        return []

    monkeypatch.setattr(lint, "_reprocess_candidates", candidates)
    assert lint.run_lint("synthetic-brain", references) == {
        "note_count": 0,
        "orphans": [],
        "stale": [],
        "missing_xref": [],
        "reprocess": [],
        "duplicate_keys": [],
        "stale_managed": [],
        "broken_cites": [],
        "index_drift": [],
        "counts": {
            "orphans": 0,
            "stale": 0,
            "missing_xref": 0,
            "reprocess": 0,
            "duplicate_keys": 0,
            "stale_managed": 0,
            "broken_cites": 0,
            "index_drift": 0,
        },
        "truncated_missing_xref": False,
    }
    assert calls == ([""] if references == "" else [])


@pytest.mark.parametrize("references", ["source-a", ["source-b", "source-a", "source-b"]])
def test_full_report_preserves_exact_records_source_order_and_input_ownership(
    monkeypatch: pytest.MonkeyPatch,
    references: str | list[str],
) -> None:
    notes = [
        _note(
            "alpha",
            "Alpha Concept",
            body=("Beta Concept [evidence](gnosi-cite:?res=r&snapshot=s&segment=g)"),
            review="",
            note_type="permanent",
            managed_key="shared",
        ),
        _note(
            "beta",
            "Beta Concept",
            body="[[Alpha Concept|alpha]]",
            managed_key="shared",
            source_table_id="sources",
            resource_id="r",
        ),
        _note("old", "Old Index", note_type="index", managed_stale=True),
    ]
    original = deepcopy(notes)
    original_references = deepcopy(references)
    _supply_notes(monkeypatch, notes)
    calls: list[str] = []
    rows: dict[str, list[ReprocessCandidate]] = {
        source_id: [
            {
                "id": source_id,
                "title": f"Resource {source_id}",
                "processed": "2026-08-29",
                "modified": "2026-08-30",
            }
        ]
        for source_id in ("source-a", "source-b")
    }

    def candidates(source_id: str) -> list[ReprocessCandidate]:
        calls.append(source_id)
        return rows[source_id]

    def load_evidence(resource_id: str, snapshot_id: str, segment_id: str) -> None:
        assert (resource_id, snapshot_id, segment_id) == ("r", "s", "g")

    monkeypatch.setattr(lint, "_reprocess_candidates", candidates)
    monkeypatch.setattr(storage, "load_evidence", load_evidence)
    with monkeypatch.context() as patch:
        patch.setattr(datetime, "date", _FixedDate)
        report = lint.run_lint("synthetic-brain", references)
    expected_sources = [references] if isinstance(references, str) else references
    assert report == {
        "note_count": 3,
        "orphans": [{"id": "beta", "title": "Beta Concept"}],
        "stale": [{"id": "alpha", "title": "Alpha Concept", "review": None, "days": None}],
        "missing_xref": [
            {
                "id": "alpha",
                "title": "Alpha Concept",
                "should_link": "Beta Concept",
                "target_id": "beta",
            }
        ],
        "reprocess": [row for source_id in expected_sources for row in rows[source_id]],
        "duplicate_keys": [
            {
                "key": "shared",
                "notes": [
                    {"id": "alpha", "title": "Alpha Concept"},
                    {"id": "beta", "title": "Beta Concept"},
                ],
            }
        ],
        "stale_managed": [{"id": "old", "title": "Old Index"}],
        "broken_cites": [
            {
                "id": "alpha",
                "title": "Alpha Concept",
                "resource_id": "r",
                "snapshot_id": "s",
                "segment_id": "g",
            }
        ],
        "index_drift": [{"source_table_id": "sources", "resource_id": "r"}],
        "counts": {
            "orphans": 1,
            "stale": 1,
            "missing_xref": 1,
            "reprocess": len(expected_sources),
            "duplicate_keys": 1,
            "stale_managed": 1,
            "broken_cites": 1,
            "index_drift": 1,
        },
        "truncated_missing_xref": False,
    }
    assert calls == expected_sources
    assert notes == original
    assert references == original_references
    for result, source_id in zip(report["reprocess"], expected_sources, strict=True):
        assert result is rows[source_id][0]
