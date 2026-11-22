"""Mechanical publication checks; these do not certify semantic correctness."""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable

from backend.domains.llm_wiki.chunking import records

REVIEW_QUALITY_VERSION = 10
# Version 10 rejects unresolved truncation rationales in coverage, including
# cached interpretations. Retain paid source work, but recheck old reviews.
REVALIDATABLE_REVIEW_VERSIONS = {REVIEW_QUALITY_VERSION}

_SOURCE_UNIT = r"(?:fragments?|fragmentos?|passatges?|pasajes?|passages?|excerpts?|texts?|textos?|textes?|original(?:es|s)?|citas?|citations?|oracion(?:es)?|frases?|phrases?|sentences?)"
_CUT_STATE = r"(?:incomplet\w*|inconclu\w*|truncad\w*|truncat\w*|tronqu\w*|interrumpid\w*|interromp\w*|interrupt\w*|cortad\w*|talla[dt]\w*|coupee?s?|cut (?:off|short))"
_UNIT_MODIFIERS = r"(?:\s+(?:disponibles?|facilitad[oa]s?|originals?|posterior|siguiente|seguent|suivant\w*|final|available|supplied|provided|itself))*"
_LINKING_VERB = (r"(?:is|was|were|are|remains?|ends?|(?:has|have|had) been|esta|es|queda|resta|est|reste|se ve"
                 r"|(?:ha|han) (?:sido|estat|quedad[oa]s?|quedats?)|(?:a|ont) ete)")
_UNFINISHED_SOURCE = re.compile(
    rf"\b{_SOURCE_UNIT}\b{_UNIT_MODIFIERS}\s+(?:"
    rf"(?:{_LINKING_VERB}\s+)?{_CUT_STATE}\b"
    r"|(?:se |s['’])(?:interrump\w*|interromp\w*|cort[ae]|atura|arrete)\b"
    r"|(?:ends?|termina|acaba|s'acaba|finit)\s+(?:mid[- ](?:sentence|list)|(?:in the middle|a (?:la )?(?:mitad|meitat)|au milieu)\b)"
    r"|no (?:contiene|conte|incluye|inclou)\s+(?:la )?continuaci\w*"
    r"|(?:does not (?:include|contain)|ne contient pas)\s+(?:the |la )?continuation\b)",
    re.I,
)
_BOUNDARY_ONLY = re.compile(rf"^(?:(?:a|an|the)\s+)?{_CUT_STATE}\s+{_SOURCE_UNIT}[.!?]?$", re.I)
_MISSING_EXPLANATION = re.compile(
    rf"\b{_SOURCE_UNIT}\b(?:\s+\w+){{0,5}}\s+{_LINKING_VERB}\s+(?:sin|sense|without|sans)\s+"
    r"(?:(?:una?|an?|une?)\s+)?(?:(?:explicaci\w*|explanation|explication|continuaci\w*|continuation)\s+complet\w*"
    r"|(?:complete|full)\s+(?:explanation|continuation))\b", re.I,
)


def _boundary_caveat(sentence: str) -> bool:
    text = ''.join(c for c in unicodedata.normalize('NFKD', sentence) if not unicodedata.combining(c)).strip()
    return bool(_UNFINISHED_SOURCE.search(text) or _BOUNDARY_ONLY.fullmatch(text) or _MISSING_EXPLANATION.search(text))


def validate_boundary_coverage(reason: object) -> None:
    """Fail closed on processing-boundary rationales, not on the original text.

    This is a diagnostic requiring source-grounded correction, not a semantic
    completeness classifier. Never delete a claim or invent the missing tail.
    """
    if any(_boundary_caveat(sentence) for sentence in re.split(r"(?<=[.!?])\s+|[;\n]+", str(reason))):
        raise ValueError(
            "Reading coverage requires source-grounded review: a truncated sentence or list does not erase "
            "complete claims before its boundary. Preserve those claims, their attribution and their "
            "qualifications using evidence from the supplied originals. "
            "Do not invent the missing continuation. Replace the processing-boundary rationale with "
            "the substantive claims retained or a source-grounded reason why none can be supported. "
            "Report any unresolved claim for this passage so it can be reviewed before completion.")


def validate_coverage_rows(coverage: object) -> None:
    for row in records(coverage):
        validate_boundary_coverage(row.get('reason', ''))


def prose_issues(note: dict[str, object], evidence: list[dict[str, object]], language: str = "") -> list[str]:
    """Reject leaked transport references, undefined footnotes and mixed-script corruption."""
    text = str(note.get("title", "")) + "\n" + str(note.get("body_md", ""))
    issues = []
    if re.search(r"\[\[(?:#?quote:)?\d+\]\]|\b(?:quote_id|note_\d+|passage_\d+)\b", text):
        issues.append("Unresolved internal source IDs in prose; use meaningful prose and the selected citation list, not transport IDs.")
    references = set(re.findall(r"\[\^([^\]\n]+)\](?!:)", text))
    definitions = set(re.findall(r"(?m)^\[\^([^\]\n]+)\]:", text))
    if references - definitions:
        issues.append("Undefined Markdown footnotes; supply their definitions or use the selected citation list.")
    originals = "\n".join(str(s.get("text", "")) for s in evidence)
    # A final reading note explains the source, not an unfinished processing
    # boundary. This flags residual wording for source-grounded correction;
    # it never reconstructs or deletes the uncertain claim automatically.
    if language and any(_boundary_caveat(sentence)
                        and sentence.casefold() not in originals.casefold()
                        for sentence in re.split(r"(?<=[.!?])\s+|\n+", str(note.get("body_md", "")))):
        issues.append("Residual processing-boundary caveat in the note. Read the complete adjacent originals and"
            " express the supported meaning, preserving author attribution and substantive uncertainty. Do not"
            " merely remove the caveat while leaving its claim unexamined. If the continuation is genuinely"
            " unavailable, request its pages or report an unresolved issue instead of accepting this note.")
    latin_output = language.casefold() in {"catalan", "català", "ca", "spanish", "español", "es", "english", "en", "french", "français", "fr"}
    if language == "the main language detected in the source":
        source_letters = [unicodedata.name(char, "") for char in originals if char.isalpha()]
        latin_output = bool(source_letters) and all("LATIN" in name for name in source_letters)
    # Detect foreign letters embedded inside a Latin word, not legitimate
    # multilingual quotations, names or languages written in another script.
    for word in re.findall(r"[^\W\d_]+", text):
        names = [unicodedata.name(char, "") for char in word]
        if (latin_output or any("LATIN" in name for name in names)) and any("HANGUL" in name for name in names) and word not in originals:
            issues.append("Corrupt mixed-script word absent from the original evidence; rewrite it in the requested language.")
            break
    return issues


def validate_reviewed_prose(notes: list[dict[str, object]], evidence: list[dict[str, object]], language: str = "") -> None:
    failures = [f"note_{i + 1}: {'; '.join(issues)}"
                for i, note in enumerate(notes) if "_review_omission" not in note
                and (issues := prose_issues(note, evidence, language))]
    if failures:
        raise ValueError("Reading quality validation failed: " + " | ".join(failures))


def adjacent_originals(chunks: list[dict[str, object]], *, key: Callable[[dict[str, object]], str] | None = None,
                       ) -> dict[str, list[dict[str, object]]]:
    """Full neighbouring passages remain available across PDF page boundaries."""
    origins: dict[str, list[dict[str, object]]] = {}
    for chunk in chunks:
        origins.setdefault(str(chunk.get("origin_id", "")), []).extend(
            {**segment, "origin_label": chunk.get("origin_label", "")}
            for segment in records(chunk.get("segments")))
    result: dict[str, list[dict[str, object]]] = {}
    for segments in origins.values():
        for index, segment in enumerate(segments):
            identifier = key(segment) if key else str(segment["id"])
            result.setdefault(identifier, []).extend(segments[max(0, index - 1):index] + segments[index + 1:index + 2])
    return result
