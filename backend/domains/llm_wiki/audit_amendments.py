"""Adjudicate a source audit's open findings without regenerating accepted prose."""
from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
import json
from typing import Any

from backend.domains.llm_wiki.audit_citation_repairs import AuditCitationIssue, CitationSlot, SourceAuditValidator
from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_contracts import TEXT, obj, validate_schema
from backend.domains.llm_wiki.semantic_quote_selection import QuoteSelection
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
            result["assessment"] += "\n" + reason
            if quote_id != result["evidence_quote_id"]:
                result["assessment"] += f" «{excerpts[quote_id - 1]}»"


def build_audit_amendment(selection: QuoteSelection, text: str, validate: Callable[[dict[str, object]], None],
                          error: Exception) -> OutputRepair | None:
    if not selection.audit_evidence:
        return None
    slots: list[CitationSlot] = []
    try:
        proposed = json.loads(text)
        validate_schema(proposed, selection.schema)
    except ValueError:
        return None
    issues = {f"issue_{i}": issue for i, issue in enumerate(proposed["unresolved_issues"], 1)}
    try:
        canonical = json.loads(selection.restore(text))
        if issues:
            # Discover other failures in the proposal. This probe is never a
            # candidate answer: every original finding needs the reviewer's decision.
            validate({**canonical, "unresolved_issues": []})
        elif isinstance(error, AuditCitationIssue):
            raise error
        else:
            return None
    except AuditCitationIssue as citation_error:
        slots = citation_error.alternatives()
        if not slots:
            return None
    except ValueError:
        # A paired literal can be misspelled before it ever reaches source
        # validation. Only its explicitly supplied document can offer an alternative.
        if not isinstance(validate, SourceAuditValidator) or not (slots := validate.unbound_slots(selection, proposed)):
            return None

    request = json.loads(selection.input)
    request.update(previous_audit=proposed, findings=issues, citation_choices={
        slot.name: dict(enumerate(slot.choices, 1)) for slot in slots})
    request["instruction"] += (
        " Review the previous audit and its proposed corrections against the complete supplied evidence."
        " For every named finding say whether the corrected notes already address it, it is a limitation"
        " of the source accurately reflected in the notes, or it remains unresolved. Give a brief specific"
        " reason in the reading language and the primary evidence excerpt number supporting your judgment."
        " A missing supported claim, mistaken attribution or unsupported conclusion must be corrected or kept open."
        " For each failed PDF citation select a listed excerpt supporting the same claim in its original."
        " Use keep_changes to retain all other fields. Use revised_audit when any substantive edit is needed,"
        " or none of the offered excerpts supports the claim. Report outstanding defects honestly.")
    decision = obj({"status": {"type": "string", "enum": ["addressed", "source_limitation", "unresolved"]},
                    "reason": TEXT, "evidence_excerpt": _index(len(selection.audit_evidence))})
    patch = obj({slot.name: _index(len(slot.choices)) for slot in slots})
    schema = obj({"findings": obj({name: decision for name in issues}), "correction": {"anyOf": [
        obj({"keep_changes": patch}), obj({"revised_audit": selection.schema})]}})

    def restore(response: str) -> str:
        reply = json.loads(response)
        validate_schema(reply, schema)
        correction = reply["correction"]
        if "revised_audit" in correction:
            result = correction["revised_audit"]
        else:
            result = deepcopy(proposed)
            result["unresolved_issues"] = []
            for slot in slots:
                index = int(correction["keep_changes"][slot.name]) - 1
                literal = slot.choices[index]
                citations = result["changes"][slot.change]["replacement"]["quotes"]
                if isinstance(citations[slot.quote], dict):
                    citations[slot.quote]["text"] = literal  # Keep its original source number.
                else:
                    citations[slot.quote] = literal
        _record_findings(result, issues, reply["findings"], selection.audit_evidence)
        return encoded(result)

    return OutputRepair(encoded(request), schema, restore)
