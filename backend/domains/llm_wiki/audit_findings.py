"""Keep each outstanding observation attached to its original until Sol accounts for it."""
from __future__ import annotations

from typing import Any

from backend.domains.llm_wiki.chunking import record
from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
from backend.domains.llm_wiki.semantic_contracts import TEXT, obj, validate_schema


class ReportedAuditIssues(PassageReviewIssue):
    """Keep separate model objections even if a later correction is rejected."""

    def __init__(self, issues: list[str], diagnostic: str = "") -> None:
        self.issues = list(dict.fromkeys(issues))
        message = "The independent reviewer must resolve outstanding source issues: " + " ".join(self.issues)
        super().__init__(" ".join(filter(None, (message, diagnostic))))


def issue_texts(value: object) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return [item.strip() for item in values if isinstance(item, str) and item.strip()]


def saved_findings(state: dict[str, Any]) -> list[str]:
    # Older receipts have only the group finding or the most recent individual reason.
    reasons = issue_texts(state.get("audit_findings")) or issue_texts(state.get("reason"))
    return list(dict.fromkeys([*issue_texts(state.get("batch_finding")), *reasons]))


def finding_coverage(findings: list[str]) -> list[object]:
    return [{"finding_id": f"issue_{i}", "independent_finding": text} for i, text in enumerate(findings, 1)]


def named_findings(coverage: list[object]) -> dict[str, str]:
    return {str(item["finding_id"]): str(item["independent_finding"]) for item in coverage
            if isinstance(item, dict) and "finding_id" in item and "independent_finding" in item}


def resolution_schema(findings: dict[str, str]) -> dict[str, Any]:
    disposition = obj({"status": {"type": "string", "enum": ["addressed", "source_limitation", "unresolved"]},
                       "reason": TEXT})
    return obj({key: disposition for key in findings})


def check_resolutions(answer: dict[str, object], findings: dict[str, str]) -> None:
    # Retain fresh semantic objections even when another field is malformed.
    open_issues = issue_texts(answer.get("unresolved_issues"))
    if open_issues:
        raise ReportedAuditIssues(open_issues)
    if not findings:
        return
    decisions = record(answer.get("finding_resolutions"))
    try:
        validate_schema(decisions, resolution_schema(findings))
    except ValueError as error:
        raise PassageReviewIssue(str(error)) from error
    for key, issue in findings.items():
        decision = record(decisions[key])
        if decision["status"] == "unresolved":
            raise PassageReviewIssue(f"{issue} — {decision['reason']}")
        if not str(decision["reason"]).strip():
            raise PassageReviewIssue(f"Explain the disposition of the finding: {issue}")


def without_resolutions(answer: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in answer.items() if key != "finding_resolutions"}
