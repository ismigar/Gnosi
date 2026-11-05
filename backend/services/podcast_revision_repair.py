"""Repair reviewed edits inside their original call and complete word budget."""
from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any

import jsonschema

from backend.services.agent_output_repair import OutputRepair, RepairBuilder
from backend.services.podcast_brief_edits import apply_edits
from backend.services.podcast_length_edits import (
    REPAIR_MARKER_PREFIX, _stream_contract, composition_digest, word_stream_repair,
)


def _literal_anchors(proposal: dict[str, Any], previous: str) -> dict[str, Any] | None:
    fixed = deepcopy(proposal)
    for edit in fixed['edits']:
        before = edit['before']
        if before in previous:
            continue
        matches = list(re.finditer(re.escape(before), previous, re.IGNORECASE))
        if len(matches) != 1:
            return None
        # Supply the exact original occurrence to the repair, never accept the
        # rejected nonliteral anchor or guess between multiple occurrences.
        edit['before'] = matches[0].group()
    return fixed


def _fixed_original_stream(data: dict[str, Any], edits: list[dict[str, Any]],
                           minimum: int, maximum: int) -> OutputRepair | None:
    """An unchanged proposed after value does not invalidate its original anchor."""
    previous = data['previous_composition']['paragraphs']['episode']['text']
    anchors: list[dict[str, str]] = []
    intervals: list[tuple[int, int]] = []
    replaced = 0
    for index, edit in enumerate(edits):
        before = edit['before']
        start = previous.find(before)
        end = start + len(before)
        if (not before.strip() or before != before.strip() or start < 0 or previous.count(before) != 1
                or start and not previous[start - 1].isspace()
                or end < len(previous) and not previous[end].isspace()):
            return None
        intervals.append((start, end))
        replaced += len(before.split())
        anchors.append({'marker': REPAIR_MARKER_PREFIX + str(index),
                        'group_key': 'episode', 'before': before})
    intervals.sort()
    if any(left[1] > right[0] for left, right in zip(intervals, intervals[1:])):
        return None
    untouched = len(previous.split()) - replaced
    if maximum - untouched < max(0, minimum - untouched):
        return None
    return _stream_contract(data, anchors, untouched, minimum, maximum, edit_limit=len(edits))


def revision_word_repair(data: dict[str, Any], schema: dict[str, Any],
                         minimum: int, maximum: int) -> RepairBuilder:
    frozen, contract = deepcopy(data), deepcopy(schema)
    previous, findings = frozen['previous_draft'], frozen['feedback']

    def build(rejected: str, error: Exception) -> OutputRepair | None:
        if not isinstance(error, ValueError):
            return None
        unchanged_replacement = False
        try:
            proposal = json.loads(rejected)
            jsonschema.validate(proposal, contract)
            fixed = _literal_anchors(proposal, previous)
            if fixed is None:
                return None
            try:
                apply_edits(fixed, previous, findings, minimum, maximum)
            except ValueError as invalid:
                detail = json.loads(str(invalid))
            else:
                return None
            if (detail['errors'] != [{'error': 'podcast_revision_word_budget'}]
                    or detail['word_budget']['scope'] != 'complete'):
                unresolved = detail['word_budget']['unresolved_edit_indices']
                covered = {index for edit in fixed['edits'] for index in edit['finding_indices']}
                if (not unresolved or covered != set(range(len(findings)))
                        or any(fixed['edits'][index]['before'] != fixed['edits'][index]['after']
                               for index in unresolved)
                        or any(item['error'] not in {'podcast_revision_word_budget',
                            'podcast_revision_requires_unique_original_anchor',
                            'podcast_revision_must_address_all_findings'} for item in detail['errors'])):
                    return None
                unchanged_replacement = True
        except (ValueError, KeyError, TypeError, jsonschema.ValidationError):
            return None
        base = {'paragraphs': {'episode': {'text': previous, 'non_editorial': False}}}
        length_data = {'composition_groups': [{'key': 'episode'}], 'previous_composition': base}
        length_proposal = {'composition_sha256': composition_digest(base), 'edits': [
            {'group_key': 'episode', 'before': e['before'], 'after': e['after']} for e in fixed['edits']]}
        # Reuse the word codec for exactly this already validated edit set;
        # the semantic contract, not a synthetic single group, owns its size.
        repair = (_fixed_original_stream(length_data, fixed['edits'], minimum, maximum)
                  if unchanged_replacement else word_stream_repair(length_data, minimum, maximum,
                    edit_limit=len(fixed['edits']))(json.dumps(length_proposal), error))
        if repair is None:
            return None
        by_before = {e['before']: e for e in fixed['edits']}
        payload = json.loads(repair.input)
        affected = {identifier for finding in findings for identifier in finding['source_part_ids']}
        sources = [b for b in frozen['briefs'] if set(b.get('part_ids', [b.get('part_id')])) & affected]
        present = {identifier for source in sources for identifier in source.get('part_ids', [source.get('part_id')])}
        if not affected <= present:
            return None
        payload.update(revision_encoding='grounded_edit_word_repair_v1',
            draft_sha256=fixed['draft_sha256'], feedback=findings,
            source_summaries=sources,
            subject_groups=frozen['subject_groups'])
        for anchor in payload['anchors']:
            anchor['finding_indices'] = by_before[anchor['before']]['finding_indices']
        payload['instructions'] = ('Repair the reviewed edits using only the supplied original episode, '
            'fixed exact anchors, feedback and source summaries. This remaining-call replacement_tokens '
            'contract supersedes the previous hash/edits response shape and its no-word-array instruction. '
            'Emit every supplied marker once in order, then all replacement words for that anchor, '
            'ONE whitespace-free word per item. All replacements together must fit replacement_word_range. '
            'Resolve every assigned finding while preserving supported facts, qualifications and every '
            'substantive theme. Unedited prose, exact anchors and finding assignments are server-owned. '
            'Do not return hash fields, before strings, edits or finding indices. The server restores and '
            'validates the complete edit set and complete episode before speech; partial edits cannot pass.')
        wire_schema = deepcopy(repair.output_schema)
        # Keep whitespace validation in restore, without a provider regex that
        # the configured route has repeatedly failed to return within deadline.
        wire_schema['properties']['replacement_tokens']['items'] = {'type': 'string'}

        def restore(text: str) -> str:
            decoded = json.loads(repair.restore(text))
            restored = {'draft_sha256': fixed['draft_sha256'], 'edits': [
                {**by_before[e['before']], 'after': e['after']} for e in decoded['edits']]}
            jsonschema.validate(restored, contract)
            apply_edits(restored, previous, findings, minimum, maximum)
            return json.dumps(restored, ensure_ascii=False)

        return OutputRepair(json.dumps(payload, ensure_ascii=False), wire_schema, restore)

    return build
