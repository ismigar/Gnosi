"""Shorten immutable grouped compositions through atomic model-proposed edits."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from backend.services.podcast_brief_edits import _replace
from backend.services.podcast_briefing import _object
from backend.services.podcast_composition import MARKER_PREFIX, composition_blocks, spoken_text


ENCODING = 'composition_length_edits_v1'


def composition_digest(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(encoded.encode()).hexdigest()


def schema(data: dict[str, Any]) -> dict[str, Any]:
    groups = data['composition_groups']
    edit = _object({'group_key': {'type': 'string', 'enum': [g['key'] for g in groups]},
                    'before': {'type': 'string', 'minLength': 1},
                    'after': {'type': 'string'}})
    return _object({'composition_sha256': {'type': 'string',
                        'enum': [composition_digest(data['previous_composition'])]},
                    'edits': {'type': 'array', 'minItems': 1,
                              'maxItems': 2 * len(groups) + 2, 'items': edit}})


def _splits_word(text: str, position: int) -> bool:
    def letter(index: int) -> bool:
        return 0 <= index < len(text) and (text[index].isalnum() or text[index] == '_')

    def part(index: int) -> bool:
        return letter(index) or (0 <= index < len(text) and text[index] in "'’‑-"
                                 and letter(index - 1) and letter(index + 1))

    return 0 < position < len(text) and part(position - 1) and part(position)


def _anchor(text: str, before: str, after: str) -> tuple[int, int]:
    start = text.find(before)
    if (not before.strip() or before == after or start < 0
            or text.find(before, start + 1) >= 0):
        raise ValueError('podcast_length_edit_requires_unique_original_anchor')
    end = start + len(before)
    if _splits_word(text, start) or _splits_word(text, end):
        raise ValueError('podcast_length_edit_splits_original_word')
    left, right = text[start - 1:start] if start else '', text[end:end + 1]
    if after:
        joined = (left and not left.isspace() and before[0].isspace() and not after[0].isspace()
                  or right and not right.isspace() and before[-1].isspace() and not after[-1].isspace())
    else:
        joined = (left and right and not left.isspace() and not right.isspace()
                  and any(char.isspace() for char in before))
    rendered = text[:start] + after + text[end:]
    if joined or _splits_word(rendered, start) or _splits_word(rendered, start + len(after)):
        raise ValueError('podcast_length_edit_joins_words')
    if MARKER_PREFIX in after:
        raise ValueError('podcast_length_edit_internal_marker')
    return start, end


def _intervals(result: dict[str, Any], blocks: dict[str, Any]) -> tuple[
        dict[str, list[tuple[int, int, str]]], list[dict[str, Any]], list[int]]:
    intervals: dict[str, list[tuple[int, int, str]]] = {key: [] for key in blocks}
    errors: list[dict[str, Any]] = []
    unresolved: list[int] = []
    for index, edit in enumerate(result['edits']):
        key = edit['group_key']
        try:
            if key not in blocks:
                raise ValueError('podcast_length_edit_unknown_group')
            start, end = _anchor(blocks[key]['text'], edit['before'], edit['after'])
            intervals[key].append((start, end, edit['after']))
        except ValueError as error:
            errors.append({'edit': index, 'group_key': key, 'error': str(error)})
            unresolved.append(index)
    for edits in intervals.values():
        edits.sort()
    return intervals, errors, unresolved


def apply_edits(result: dict[str, Any], previous: dict[str, Any], data: dict[str, Any],
                minimum: int, maximum: int) -> dict[str, Any]:
    """Validate one complete proposal against its original base; return no partial prose."""
    if result['composition_sha256'] != composition_digest(previous):
        raise ValueError('podcast_length_edit_composition_mismatch')
    original_words = len(spoken_text(previous, data).split())
    blocks = composition_blocks(previous, data)
    intervals, errors, unresolved = _intervals(result, blocks)
    overlapping = any(left[1] > right[0] for edits in intervals.values()
                      for left, right in zip(edits, edits[1:]))
    proposed_words = None
    candidate: dict[str, Any] = {}
    if overlapping:
        errors.append({'error': 'podcast_length_edit_overlapping_edits'})
    else:
        # Decode the original structure, never reconstruct groups from joined speech.
        candidate = {'paragraphs': {key: {
            'text': _replace(block['text'], intervals[key]),
            'non_editorial': block['non_editorial']} for key, block in blocks.items()}}
        proposed_words = sum(len(block['text'].split())
                             for block in candidate['paragraphs'].values())
        try:
            spoken_text(candidate, data)  # Every group and exclusion remains mandatory.
        except ValueError as error:
            errors.append({'error': str(error)})
        if not minimum <= proposed_words <= maximum:
            errors.insert(0, {'error': 'podcast_length_edit_word_budget'})
    if errors:
        budget = {'minimum': minimum, 'maximum': maximum, 'original_words': original_words,
                  'proposed_words': proposed_words,
                  'scope': 'unavailable_overlapping' if overlapping else
                           'valid_anchors_only' if unresolved else 'complete',
                  'unresolved_edit_indices': unresolved}
        raise ValueError(json.dumps({'word_budget': budget, 'errors': errors}, separators=(',', ':')))
    return candidate
