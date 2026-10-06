"""Mechanical publication checks; these do not certify semantic correctness."""
from __future__ import annotations

import re
import unicodedata

from backend.domains.llm_wiki.chunking import records


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
                for i, note in enumerate(notes) if (issues := prose_issues(note, evidence, language))]
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
