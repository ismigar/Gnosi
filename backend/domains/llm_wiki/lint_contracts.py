"""Records constructed by deterministic Brain checks, not persisted page schemas."""

from typing import NotRequired, TypedDict


class NoteFinding(TypedDict):
    """Identity of a note reported by a check."""

    id: str
    title: str


class LintNote(NoteFinding):
    """Normalized, in-memory projection built by the lint note loader."""

    body: str
    out_ids: set[str]
    out_titles: set[str]
    review: str
    note_type: str
    managed_key: str
    managed_role: str
    managed_stale: bool
    source_table_id: str
    resource_id: str


class StaleFinding(NoteFinding):
    """A missing, invalid or expired review date."""

    review: str | None
    days: int | None


class MissingCrossReference(NoteFinding):
    """A prose mention of another note without an explicit link."""

    should_link: str
    target_id: str


class DuplicateManagedKey(TypedDict):
    """Notes sharing the same managed provenance key, in encounter order."""

    key: str
    notes: list[NoteFinding]


class ResourceIndexDrift(TypedDict):
    """Source resource whose reading notes have no managed index."""

    source_table_id: str
    resource_id: str


class ReprocessCandidate(NoteFinding):
    """Source row modified after its last recorded processing date."""

    processed: str
    modified: str


class BrokenCitation(NoteFinding):
    """Unresolvable immutable evidence reference."""

    resource_id: str
    snapshot_id: str
    segment_id: str


class LintCounts(TypedDict):
    """Counts of the eight deterministic finding categories."""

    orphans: int
    stale: int
    missing_xref: int
    reprocess: int
    duplicate_keys: int
    stale_managed: int
    broken_cites: int
    index_drift: int


class LintReport(TypedDict):
    """Complete deterministic report with optional HTTP suggestion totals."""

    note_count: int
    orphans: list[NoteFinding]
    stale: list[StaleFinding]
    missing_xref: list[MissingCrossReference]
    reprocess: list[ReprocessCandidate]
    duplicate_keys: list[DuplicateManagedKey]
    stale_managed: list[NoteFinding]
    broken_cites: list[BrokenCitation]
    index_drift: list[ResourceIndexDrift]
    counts: LintCounts
    truncated_missing_xref: bool
    suggestions_queued: NotRequired[int]
    suggestions_pending: NotRequired[int]
