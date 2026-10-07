"""Mechanical publication checks; these do not certify semantic correctness."""
from __future__ import annotations

import re
import unicodedata

from backend.domains.llm_wiki.chunking import records

REVIEW_QUALITY_VERSION = 8
# Version 7 already performed the same semantic and citation review. Revalidate
# its accepted batches against the tightened mechanical checks before reuse.
REVALIDATABLE_REVIEW_VERSIONS = {7, REVIEW_QUALITY_VERSION}

_SOURCE_BOUNDARY = re.compile(r"\b(?:fragment\w*|passatg\w*|pasaj\w*|passage\w*|excerpt\w*|text\w*|original\w*|cita\w*|oraci[oó]n|frase|sentence)\b", re.I)
_UNFINISHED = re.compile(r"\b(?:incomplet\w*|inconclu\w*|trunc\w*|tronqu\w*|interrump\w*|interromp\w*|cortad\w*|cort[ae]\w*|tallat\w*|coup[ée]\w*|mitad|meitat|cut\s+(?:off|short)|missing\s+continuation)\b", re.I)
_MISSING_EXPLANATION = re.compile(r"\b(?:sin|sense|without|sans)\s+(?:(?:una?|an?|une?)\s+)?(?:explicaci\w*|explanation|explication|continuaci\w*|continuation)\s+(?:complet\w*|compl[eè]\w*|full)\b", re.I)
_ABSENT_CONTINUATION = re.compile(r"\b(?:no\s+(?:contiene|conté|incluye|inclou)|does\s+not\s+(?:include|contain)|ne\s+contient\s+pas)\s+(?:la\s+|the\s+)?(?:continuaci\w*|continuation)\b", re.I)


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
    if language and any(_SOURCE_BOUNDARY.search(sentence)
                        and any(pattern.search(sentence) for pattern in (_UNFINISHED, _MISSING_EXPLANATION, _ABSENT_CONTINUATION))
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


def adjacent_originals(chunks: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    """Full neighbouring passages remain available across PDF page boundaries."""
    origins: dict[str, list[dict[str, object]]] = {}
    for chunk in chunks:
        origins.setdefault(str(chunk.get("origin_id", "")), []).extend(
            {**segment, "origin_label": chunk.get("origin_label", "")}
            for segment in records(chunk.get("segments")))
    result: dict[str, list[dict[str, object]]] = {}
    for segments in origins.values():
        for index, segment in enumerate(segments):
            result.setdefault(str(segment["id"]), []).extend(segments[max(0, index - 1):index] + segments[index + 1:index + 2])
    return result
