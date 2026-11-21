"""Bind an audit to the documents actually cited by the reviewed drafts."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from collections import defaultdict

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.contextual_reading import CheckpointScope, ContextualReader, ReadingCheckpointUnavailable, fingerprint
from backend.domains.llm_wiki.reading_quality import adjacent_originals
from backend.domains.llm_wiki.review_selection import passage_key
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key, source_key


def passage_sources(primary: dict[str, object], drafts: list[dict[str, object]], plan: dict[str, object],
                    neighbours: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    cited = {c["segment_id"] for n in drafts for c in records(n.get("citations"))}
    support = [s for s in records(plan.get("evidence_segments")) if s["id"] in cited]
    originals = {segment_source_key(s): s for s in [*support, *neighbours, primary]}
    return support, list(originals.values())


def owner_digest(reader: ContextualReader, primary: dict[str, object], drafts: list[dict[str, object]],
                 evidence: list[dict[str, object]]) -> str:
    if not reader.ambiguous_pdf_segments:
        return ""
    primary_key = segment_source_key(primary)
    owners = (segment_source_key(s) for s in evidence)
    repeated = [owner for owner in owners if owner != primary_key and owner in reader.ambiguous_pdf_segments]
    if not repeated and primary_key not in reader.ambiguous_pdf_segments:
        return ""
    citations = [[c["segment_id"] for c in records(n.get("citations"))] for n in drafts]
    return fingerprint([primary_key, repeated, citations])


def historical_scopes(reader: ContextualReader, job: str) -> dict[str, str]:
    """Replay durable, bound upstream decisions once, with no writes or model execution."""
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.domains.llm_wiki.semantic_review import review_plans

    saved = reader.dependencies.load_checkpoint(job, "semantic-state")
    if not isinstance(saved, dict) or not saved.get("plans") or not saved.get("reviewed_groups"):
        return {}
    historical = SemanticReader(replace(reader, job_id="", resume_job_id="", models=[], warnings=[], report_progress=False))
    parts = saved.get("identity_parts")
    if not isinstance(parts, dict) or any(
        parts.get(k) != historical.state["identity_parts"][k] for k in ("sources", "classification")
    ):
        return {}
    historical.state = deepcopy(saved)
    try:
        reviewed = review_plans(historical, str(saved.get("global_map", "")), str(saved.get("notes_map", "")),
                                checkpoints_only=True)
    except (ReadingCheckpointUnavailable, KeyError, ValueError):
        return {}
    except RuntimeError as exc:
        if str(exc).startswith("reading_quality_unresolved:"):
            return {}
        raise
    neighbours = adjacent_originals(reader.chunks)
    scopes = {}
    for chunk, plan in reviewed:
        notes: dict[str, list[dict[str, object]]] = defaultdict(list)
        for note in records(plan["notes"]):
            notes[str(note["source_segment_id"])].append(note)
        for segment in records(chunk["segments"]):
            primary = {**segment, "origin_label": chunk.get("origin_label", "")}
            drafts = notes[str(primary["id"])]
            _, evidence = passage_sources(primary, drafts, plan, neighbours.get(str(primary["id"]), []))
            digest = owner_digest(reader, primary, drafts, evidence)
            if digest:
                scopes[passage_key(primary)] = digest
    return scopes


def audit_scope(reader: ContextualReader, primary: dict[str, object], drafts: list[dict[str, object]],
                evidence: list[dict[str, object]]) -> CheckpointScope | None:
    digest = owner_digest(reader, primary, drafts, evidence)
    if not digest:
        return None

    def matches_legacy(job: str) -> bool:
        if not job or job == reader.job_id:
            return False
        if job not in reader.historical_audit_scopes:
            reader.historical_audit_scopes[job] = historical_scopes(reader, job)
        return reader.historical_audit_scopes[job].get(passage_key(primary)) == digest

    return CheckpointScope(digest, matches_legacy)


def verified_legacy_answer(reader: ContextualReader, primary: dict[str, object], drafts: list[dict[str, object]],
                           originals: list[dict[str, object]], entry: dict[str, object], key: str) -> bool:
    """A complete old correction may itself identify every ambiguous citation it reviewed."""
    if entry.get("key") != key or not isinstance(entry.get("answer"), dict):
        return False
    ambiguous = {str(s["id"]): source_key(source_view(s)) for s in originals
                 if segment_source_key(s) in reader.ambiguous_pdf_segments}
    changes = {p: record(c.get("replacement")) for c in records(record(entry["answer"]).get("changes"))
               if type(p := c.get("position")) is int}
    witnessed = {str(primary["id"])}
    for position, draft in enumerate(drafts, 1):
        expected = [str(c["segment_id"]) for c in records(draft.get("citations")) if str(c["segment_id"]) in ambiguous]
        if not expected:
            continue
        replacement = changes.get(position, {})
        ids, keys = replacement.get("quote_segment_ids"), replacement.get("quote_source_keys")
        if not isinstance(ids, list) or not isinstance(keys, list) or len(ids) != len(keys):
            return False
        selected = [identifier for identifier, owner in zip(ids, keys, strict=True)
                    if isinstance(identifier, str) and identifier in ambiguous and ambiguous[identifier] == owner]
        if selected != expected:
            return False
        witnessed.update(selected)
    return bool(ambiguous) and set(ambiguous) <= witnessed
