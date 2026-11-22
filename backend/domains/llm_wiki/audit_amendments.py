"""Adjudicate a source audit's open findings without regenerating accepted prose."""
from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
import json
from typing import Any

from backend.domains.llm_wiki.audit_citation_repairs import AuditCitationIssue, CitationSlot, SourceAuditValidator, validate_revision_origins
from backend.domains.llm_wiki.audit_findings import issue_texts
from backend.domains.llm_wiki.chunking import encoded, record
from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
from backend.domains.llm_wiki.semantic_contracts import TEXT, obj, validate_schema
from backend.domains.llm_wiki.semantic_quote_selection import QuoteSelection
from backend.domains.llm_wiki.semantic_repairs import original_spans
from backend.services.agent_output_repair import OutputRepair


def _index(count: int) -> dict[str, Any]:
    return {"type": "integer", "minimum": 1, "maximum": count}


def _record_findings(result: dict[str, Any], issues: dict[str, str], decisions: dict[str, Any],
                     excerpts: tuple[str, ...]) -> None:
    for name, issue in issues.items():
        finding = decisions[name]
        reason = finding["reason"].strip()
        if not reason:
            raise ValueError("Explain the disposition of every original finding")
        if finding["status"] == "unresolved":
            result["unresolved_issues"].append(f"{issue} — {reason}")
        else:
            quote_id = int(finding["evidence_excerpt"])
            result["assessment"] += "\n" + (f"{issue} — {reason}" if issue else reason)
            if (quote_id != result.get("evidence_quote_id") and
                    excerpts[quote_id - 1] != result.get("evidence_quote")):
                result["assessment"] += f" «{excerpts[quote_id - 1]}»"


def open_findings(proposal: dict[str, Any]) -> dict[str, str]:
    issues = {f"issue_{i}": text for i, text in enumerate(issue_texts(proposal.get("unresolved_issues")), 1)}
    # A renewed review may explain a fresh objection in a prior finding's
    # disposition even if its general list of outstanding issues is empty.
    for key, decision in record(proposal.get("finding_resolutions")).items():
        value = record(decision)
        if value.get("status") == "unresolved":
            for reason in issue_texts(value.get("reason")):
                if reason not in issues.values():
                    issues[f"prior_{key}"] = reason
    return issues


def amendment_findings(proposal: dict[str, Any]) -> list[str]:
    """Read observations independently of whether another part of the amendment is valid."""
    correction = record(proposal.get("correction"))
    revised = record(correction.get("revised_audit"))
    # The amendment's findings are dispositions of observations from the
    # original audit. Each unresolved reason can report further evidence.
    dispositions = {"finding_resolutions": proposal.get("findings")}
    return [*open_findings(revised).values(), *open_findings(dispositions).values()]


def _repairable_slots(selection: QuoteSelection, text: str, proposed: dict[str, Any],
                      validate: Callable[[dict[str, object]], None], error: Exception) -> list[CitationSlot] | None:
    try:
        validate_schema(proposed, selection.schema)
    except ValueError:
        return None
    try:
        canonical = json.loads(selection.restore(text))
        if canonical["unresolved_issues"]:
            # Probe other validators. Only the reviewer may dispose of the original findings.
            validate({**canonical, "unresolved_issues": []})
        elif isinstance(error, AuditCitationIssue):
            raise error
        else:
            return None
    except AuditCitationIssue as citation_error:
        return citation_error.alternatives() or None
    except ValueError:
        if isinstance(validate, SourceAuditValidator):
            return validate.unbound_slots(selection, proposed) or None
        return None
    return []


def _restore_changes(proposed: dict[str, Any], correction: dict[str, Any], slots: list[CitationSlot]) -> dict[str, Any]:
    result = deepcopy(proposed)
    result["unresolved_issues"] = []
    for slot in slots:
        index = int(correction["keep_changes"][slot.name]) - 1
        literal = slot.choices[index]
        citations = result["changes"][slot.change]["replacement"]["quotes"]
        if isinstance(citations[slot.quote], dict):
            citations[slot.quote]["text"] = literal
        else:
            citations[slot.quote] = literal
    return result


def _amendment(selection: QuoteSelection, proposed: dict[str, Any], issues: dict[str, str],
               slots: list[CitationSlot] | None, diagnostic: str) -> OutputRepair:
    request = json.loads(selection.input)
    original = request["original"]
    excerpts = selection.audit_evidence or tuple(original_spans(original["text"]))
    if not selection.audit_evidence:
        original["evidence_excerpts"] = dict(enumerate(excerpts, 1))
        original.pop("text")
    decision = obj({"status": {"type": "string", "enum": ["addressed", "source_limitation", "unresolved"]},
                    "reason": TEXT, "evidence_excerpt": _index(len(excerpts))})
    # A full reassessment still accounts for each proposal it can change or withdraw.
    changes = proposed.get("changes")
    prior = {f"change_{i}": change for i, change in enumerate(changes, 1)} if isinstance(changes, list) else {}
    full = obj({"revised_audit": selection.schema, "prior_changes": obj({k: obj({
        "reason": TEXT, "evidence_excerpt": _index(len(excerpts))}) for k in prior})})
    if slots is None:
        # The complete originals, original drafts and provider findings remain.
        # The new assessment supplies its own literal citations and classification fields.
        request.update(prior_proposals={k: _proposed_claim(c) for k, c in prior.items()}, review_error=diagnostic)
        correction_schema = full
    else:
        request.update(previous_audit=proposed, citation_choices={s.name: dict(enumerate(s.choices, 1)) for s in slots})
        patch = obj({s.name: _index(len(s.choices)) for s in slots})
        correction_schema = {"anyOf": [obj({"keep_changes": patch}), full]}
    request["findings"] = issues
    request["instruction"] += (
        " For every named finding decide whether the corrected notes already address it, it is a source"
        " limitation accurately reflected in the notes, or it remains unresolved. Give a specific reason"
        " in the reading language and a supporting primary evidence excerpt number. Correct missing claims,"
        " mistaken attribution and unsupported conclusions or keep them open."
        " When keep_changes is offered, use it to retain the proposed notes and select a listed excerpt for"
        " each failed citation, supporting the same claim in its original. For substantive edits or unsuitable"
        " excerpts use revised_audit. In prior_changes explain what you retained, corrected or withdrew from"
        " each previous proposal and why the cited original supports that decision. A citation-only correction"
        " must retain the original it refers to. If the attribution changes, reassess the claim itself.")
    schema = obj({"findings": obj({k: decision for k in issues}), "correction": correction_schema})
    def restore(response: str) -> str:
        reply = json.loads(response)
        validate_schema(reply, schema)
        correction = reply["correction"]
        if "revised_audit" in correction:
            result = correction["revised_audit"]
            validate_revision_origins(proposed, result, selection)
            dispositions = {k: {**v, "status": "addressed"} for k, v in correction["prior_changes"].items()}
            _record_findings(result, {k: "" for k in prior}, dispositions, excerpts)
        else:
            result = _restore_changes(proposed, correction, slots or [])
        _record_findings(result, issues, reply["findings"], excerpts)
        return encoded(result)
    return OutputRepair(encoded(request), schema, restore)


def _proposed_claim(change: object) -> object:
    if not isinstance(change, dict) or not isinstance(change.get("replacement"), dict):
        return change
    replacement = change["replacement"]
    return {**change, "replacement": {k: v for k, v in replacement.items() if k != "quotes"}}


def build_audit_amendment(selection: QuoteSelection, text: str, validate: Callable[[dict[str, object]], None],
                          error: Exception, fits: Callable[[OutputRepair], bool] = lambda _: True) -> OutputRepair | None:
    try:
        proposed = json.loads(text)
    except ValueError:
        return None
    if not isinstance(proposed, dict):
        return None
    issues = open_findings(proposed)
    slots = _repairable_slots(selection, text, proposed, validate, error)
    if slots is None and not issues and not proposed.get("changes") and not isinstance(error, AuditCitationIssue):
        return None
    if slots is not None:
        patch = _amendment(selection, proposed, issues, slots, "")
        if fits(patch):
            return patch
    reason = str(error) if isinstance(error, PassageReviewIssue) else "Recheck the proposal and its original evidence."
    revision = _amendment(selection, proposed, issues, None, reason)
    if fits(revision):
        return revision
    raise PassageReviewIssue("The reviewer's context cannot fit the source and its required amendment. " +
                             " ".join(issues.values())) from error
