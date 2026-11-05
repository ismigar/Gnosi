"""Address immutable reviewed clauses by IDs without copying literal anchors."""
from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Any
import json

import jsonschema

from backend.services.agent_output_repair import OutputRepair, RepairBuilder
from backend.services.podcast_brief_edits import _quote_overlaps
from backend.services.podcast_briefing import _object


@dataclass(frozen=True)
class EditTransport:
    data: dict[str, Any]
    schema: dict[str, Any]
    decode: Callable[[dict[str, Any]], dict[str, Any]]
    encode: Callable[[dict[str, Any]], dict[str, Any]]

    def repair(self, builder: RepairBuilder) -> RepairBuilder:
        def build(rejected: str, error: Exception) -> OutputRepair | None:
            try:
                original = self.decode(json.loads(rejected))
            except (ValueError, KeyError, TypeError, jsonschema.ValidationError):
                return None
            repair = builder(json.dumps(original), error)
            if repair is None:
                return None
            if 'replacement_tokens' in repair.output_schema.get('properties', {}):
                return self.alternatives(repair)
            def restore(text: str) -> str:
                return json.dumps(self.encode(json.loads(repair.restore(text))), ensure_ascii=False)
            return OutputRepair(repair.input, repair.output_schema, restore)
        return build


    def alternatives(self, repair: OutputRepair) -> OutputRepair:
        """Let the server restore markers and select complete bounded phrases."""
        from backend.services.podcast_passage_length import select_passages
        payload = json.loads(repair.input)
        fixed = payload['anchors']
        by_text = {text: key for key, text in self.data['anchor_clauses'].items()}
        keyed = {by_text[anchor['before']]: anchor for anchor in fixed}
        properties = {}
        for key, anchor in keyed.items():
            phrase = deepcopy(self.schema['$defs']['change']['anyOf'][0])
            if any(payload['feedback'][index]['kind'] == 'omission' for index in anchor['finding_indices']):
                phrase['minLength'] = 1
            properties[key] = _object({'compact': deepcopy(phrase), 'full': deepcopy(phrase)})
        wire = _object({'alternatives': _object(properties)})
        payload.update(revision_encoding='grounded_edit_alternatives_v1',
            anchors=[{'id': key, 'before': anchor['before'], 'finding_indices': anchor['finding_indices']}
                     for key, anchor in keyed.items()],
            instructions='This remaining-call alternatives schema supersedes the earlier marker/token and '
                'changes/hash response forms. Return BOTH a compact and a fuller COMPLETE replacement '
                'for EVERY supplied fixed clause ID. Each version must independently resolve ALL its '
                'assigned findings using the supplied evidence and preserve substantive facts, attribution '
                'and qualifications. Clauses without findings are only for budget concision. Both versions '
                'for a required finding must actually differ from the original clause. The COMPACT '
                'versions together should fit the shared replacement_word_range, with some headroom. '
                'There are no per-clause word caps; keep the existing character bound. Do not return '
                'markers, words arrays, before strings, hashes or finding indices. The server selects '
                'one COMPLETE offered phrase per clause without truncation, restores every original '
                'anchor and finding binding and validates the unchanged COMPLETE episode word range. '
                'Unedited prose stays byte-for-byte unchanged. The same final semantic review follows.')

        def restore(text: str) -> str:
            value = json.loads(text)
            jsonschema.validate(value, wire)
            full, compact = {}, {}
            for key, anchor in keyed.items():
                choices = value['alternatives'][key]
                valid = [choices[name] for name in ('full', 'compact')
                         if not anchor['finding_indices'] or choices[name] != anchor['before']]
                if not valid:
                    raise ValueError('podcast_revision_unchanged_alternatives')
                full[key], compact[key] = max(valid, key=lambda text: len(text.split())), min(
                    valid, key=lambda text: len(text.split()))
            bounds = payload['replacement_word_range']
            accepted = range(bounds['minimum'], bounds['maximum'] + 1)
            target = (self.data['revision_budget'].get('target') or (
                self.data['revision_budget']['minimum'] + self.data['revision_budget']['maximum']) // 2
            ) - payload['untouched_words']
            selected = select_passages(full, compact, preferred=accepted, accepted=accepted,
                                       target=max(accepted.start, min(target, accepted.stop - 1)), allow_empty=True)
            tokens = [token for key, anchor in keyed.items()
                      for token in [anchor['marker'], *selected[key].split()]]
            original = json.loads(repair.restore(json.dumps({'replacement_tokens': tokens})))
            return json.dumps(self.encode(original), ensure_ascii=False)

        return OutputRepair(json.dumps(payload, ensure_ascii=False), wire, restore)


def anchor_ids(data: dict[str, Any], schema: dict[str, Any]) -> EditTransport | None:
    frozen, original_schema = deepcopy(data), deepcopy(schema)
    previous, findings = frozen['previous_draft'], frozen['feedback']
    choices = schema['properties']['edits']['items']['properties']['before'].get('enum')
    if not choices:
        return None
    anchors = {f'a{i}': text for i, text in enumerate(choices)}
    positions = sorted((previous.find(text), previous.find(text) + len(text)) for text in choices)
    if any(previous.count(text) != 1 for text in choices) or any(start < 0 for start, _ in positions) or any(a[1] > b[0] for a, b in zip(positions, positions[1:])):
        return None
    assignments: dict[str, Any] = {}
    ids = list(anchors)
    for index, finding in enumerate(findings):
        allowed = [key for key, text in anchors.items() if finding['kind'] == 'omission' or any(
            _quote_overlaps(previous, previous.index(text), previous.index(text) + len(text), quote)
            for quote in finding.get('narration_quotes', []))]
        if not allowed:
            return None
        item = {'$ref': '#/$defs/anchor_id'} if allowed == ids else {'type': 'string', 'enum': allowed}
        assignments[str(index)] = {'type': 'array', 'minItems': 1, 'maxItems': len(allowed),
                                   'uniqueItems': True, 'items': item}
    wire = _object({'draft_sha256': deepcopy(schema['properties']['draft_sha256']),
        'finding_anchors': _object(assignments),
        'changes': _object({key: {'$ref': '#/$defs/change'} for key in anchors})})
    wire['$defs'] = {'anchor_id': {'type': 'string', 'enum': ids}, 'change': {'anyOf': [
        deepcopy(schema['properties']['edits']['items']['properties']['after']), {'type': 'null'}]}}
    payload = {**frozen, 'revision_encoding': 'grounded_anchor_ids_v1', 'anchor_clauses': anchors,
               'anchor_word_counts': {key: len(text.split()) for key, text in anchors.items()},
               'maximum_edits': schema['properties']['edits']['maxItems']}

    def decode(value: dict[str, Any]) -> dict[str, Any]:
        jsonschema.validate(value, wire)
        edits = []
        for key, before in anchors.items():
            assigned = [int(index) for index, keys in value['finding_anchors'].items() if key in keys]
            after = value['changes'][key]
            if after is None:
                if assigned:
                    raise ValueError('podcast_revision_finding_requires_changed_anchor:' + key)
                continue
            edits.append({'before': before, 'after': after, 'finding_indices': assigned})
        result = {'draft_sha256': value['draft_sha256'], 'edits': edits}
        jsonschema.validate(result, original_schema)
        return result

    def encode(value: dict[str, Any]) -> dict[str, Any]:
        jsonschema.validate(value, original_schema)
        by_text = {text: key for key, text in anchors.items()}
        result: dict[str, Any] = {'draft_sha256': value['draft_sha256'], 'changes': dict.fromkeys(anchors),
                  'finding_anchors': {str(index): [] for index in range(len(findings))}}
        seen = set()
        for edit in value['edits']:
            key = by_text[edit['before']]
            if key in seen:
                raise ValueError('podcast_revision_duplicate_original_anchor')
            seen.add(key)
            result['changes'][key] = edit['after']
            for index in edit['finding_indices']:
                result['finding_anchors'][str(index)].append(key)
        jsonschema.validate(result, wire)
        return result

    return EditTransport(payload, wire, decode, encode)
