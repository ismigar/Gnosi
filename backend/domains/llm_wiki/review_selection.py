"""Select independent checks from source structure and saved reading observations."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.semantic_context import terms
from backend.domains.llm_wiki.source_structure import section_path

SAMPLE_INTERVAL = 12


def passage_key(segment: dict[str, object]) -> str:
    locator = record(segment.get("locator"))
    if "char_start" in locator and "char_end" in locator:
        return f"{segment['id']}@{locator['char_start']}-{locator['char_end']}"
    return str(segment["id"])


def sample_passages(chunks: list[dict[str, object]]) -> set[str]:
    chapters: dict[tuple[str, tuple[str, ...]], list[str]] = defaultdict(list)
    for chunk in chunks:
        origin = str(chunk.get("origin_id") or chunk.get("origin_label") or "")
        for segment in records(chunk.get("segments")):
            path = tuple(str(node["key"]) for node in section_path(segment.get("locator")))
            chapters[origin, path].append(passage_key(segment))
    return {block[len(block) // 2] for chapter in chapters.values()
            for block in (chapter[start:start + SAMPLE_INTERVAL] for start in range(0, len(chapter), SAMPLE_INTERVAL))}


def flagged_passages(passages: list[dict[str, object]], observations: dict[str, object]) -> set[str]:
    """Match each concern independently. Ambiguous concerns cover the tied originals."""
    selected: set[str] = set()
    words = [terms(str(segment["text"])) for segment in passages]
    for field in ("questions", "contradictions", "warnings"):
        signals = observations.get(field)
        if not isinstance(signals, list):
            continue
        for signal in signals:
            if not isinstance(signal, str) or not signal.strip():
                continue
            query = terms(signal)
            scores = [len(query & source) for source in words]
            best = max(scores, default=0)
            selected.update(passage_key(s) for s, score in zip(passages, scores) if score == best)
    return selected


def selected_passages(chunks: list[dict[str, object]], state: dict[str, Any]) -> set[str]:
    selected = sample_passages(chunks)
    observations = state.get("observations", {})
    if not observations:
        return selected
    # Existing paid batches already store their questions under a digest of their
    # contiguous chunk IDs. Recover that association on upgrade without new calls.
    for start in range(len(chunks)):
        ids: list[object] = []
        for chunk in chunks[start:start + 4]:
            ids.append(chunk["id"])
            key = "semantic-extract-" + fingerprint(ids)[:20]
            if key in observations:
                entry = observations[key]
                if isinstance(entry.get("review_passages"), list):
                    selected.update(entry["review_passages"])
                else:
                    passages = [s for c in chunks[start:start + len(ids)] for s in records(c.get("segments"))]
                    selected.update(flagged_passages(passages, entry))
    return selected
