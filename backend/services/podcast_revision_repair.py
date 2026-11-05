"""Repair reviewed edits inside their original call and complete word budget."""
from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any

import jsonschema

from backend.services.agent_output_repair import OutputRepair, RepairBuilder
from backend.services.podcast_brief_edits import apply_edits
from backend.services.podcast_length_edits import composition_digest, word_stream_repair


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


def revision_word_repair(data: dict[str, Any], schema: dict[str, Any],
                         minimum: int, maximum: int) -> RepairBuilder:
    frozen, contract = deepcopy(data), deepcopy(schema)
    previous, findings = frozen['previous_draft'], frozen['feedback']

    def build(rejected: str, error: Exception) -> OutputRepair | None:
        if not isinstance(error, ValueError):
            return None
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
            if any(item['error'] in {'podcast_revision_overlapping_edits',
                    'podcast_revision_must_address_all_findings',
                    'podcast_revision_anchor_must_include_affected_quote'} for item in detail['errors']):
                from backend.services.podcast_anchor_repair import anchored_revision_repair
                return anchored_revision_repair(frozen, contract, minimum, maximum)
            if (detail['errors'] != [{'error': 'podcast_revision_word_budget'}]
                    or detail['word_budget']['scope'] != 'complete'):
                return None
        except (ValueError, KeyError, TypeError, jsonschema.ValidationError):
            return None
        base = {'paragraphs': {'episode': {'text': previous, 'non_editorial': False}}}
        length_data = {'composition_groups': [{'key': 'episode'}], 'previous_composition': base}
        length_proposal = {'composition_sha256': composition_digest(base), 'edits': [
            {'group_key': 'episode', 'before': e['before'], 'after': e['after']} for e in fixed['edits']]}
        # Reuse the word codec for exactly this already validated edit set;
        # the semantic contract, not a synthetic single group, owns its size.
        repair = word_stream_repair(length_data, minimum, maximum,
            edit_limit=len(fixed['edits']))(json.dumps(length_proposal), error)
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
