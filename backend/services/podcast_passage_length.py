"""Fit a podcast draft by selecting complete, independently compressed passages."""

from __future__ import annotations

import re

_MAX_PASSAGES = 64


def split_passages(draft: str) -> dict[str, str]:
    """Keep paragraph boundaries and cap the number of choices for a long episode."""
    paragraphs = [part.strip() for part in re.split(r'\r?\n[ \t]*\r?\n', draft) if part.strip()]
    size = max(1, (len(paragraphs) + _MAX_PASSAGES - 1) // _MAX_PASSAGES)
    return {
        f'passage:{number}': '\n\n'.join(paragraphs[start:start + size])
        for number, start in enumerate(range(0, len(paragraphs), size))
    }


def fit_passages(
    originals: dict[str, str], alternatives: dict[str, str], *,
    preferred: range, accepted: range, target: int,
) -> str:
    """Pick complete alternatives near the target without dropping any passage."""
    if alternatives.keys() != originals.keys():
        raise ValueError('podcast_length_repair_passage_scope_mismatch')
    original_words = sum(len(text.split()) for text in originals.values())
    maximum_savings = original_words - accepted.start
    # Keep one selection for each achievable word reduction. An original
    # passage is always available when its alternative saves too many words.
    selections = {0: 0}
    for index, (key, original) in enumerate(originals.items()):
        alternative_words = len(alternatives[key].split())
        if not alternative_words:
            raise ValueError('podcast_empty_compressed_passage')
        saving = len(original.split()) - alternative_words
        if saving <= 0:
            continue
        for saved, mask in tuple(selections.items()):
            new_savings = saved + saving
            if new_savings > maximum_savings:
                continue
            proposed = mask | (1 << index)
            previous = selections.get(new_savings)
            if previous is None or proposed.bit_count() < previous.bit_count():
                selections[new_savings] = proposed
    minimum_savings = original_words - (accepted.stop - 1)
    best = min(
        (saved for saved in selections if saved >= minimum_savings),
        key=lambda saved: (
            original_words - saved not in preferred,
            abs(original_words - saved - target), selections[saved].bit_count(), saved,
        ),
        default=None,
    )
    if best is None:
        raise ValueError(
            f'podcast_word_budget: compressed passages cannot reach {accepted.start}..{accepted.stop - 1} words'
        )
    mask = selections[best]
    return '\n\n'.join(
        (alternatives[key] if mask & (1 << index) else original).strip()
        for index, (key, original) in enumerate(originals.items())
    )
