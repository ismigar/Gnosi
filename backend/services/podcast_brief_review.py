"""One bounded whole-day review before an optional corrective rewrite and speech."""
from __future__ import annotations

from typing import Any, TYPE_CHECKING

from backend.services.podcast_review import _schema
from backend.services.podcast_audit_repair import audit_quote_repair

if TYPE_CHECKING:
    from backend.services.podcast_briefing import _Briefing


def review(context: _Briefing, briefs: list[dict[str, Any]], narration: str,
           subjects: list[list[str]]) -> list[dict[str, Any]]:
    from backend.services.podcast_automatic import _request
    from backend.services.podcast_outline import _digest, _digest_part_ids

    expected = _digest_part_ids(briefs)
    records = briefs
    schema = _schema({'briefs': briefs})

    def request() -> Any:
        return _request(context, 'audit', {'brief_review': True, 'narration': narration,
            'subjects': subjects, 'source_summaries': records}, schema)

    current = request()
    while context.cost(current) > min(80_000, context.budget):
        before = context.cost(current)
        records = _digest(context, records)
        if _digest_part_ids(records) != expected:
            raise ValueError('podcast_brief_review_source_scope_changed')
        current = request()
        if context.cost(current) >= before:
            raise RuntimeError('podcast_brief_review_context_insufficient')

    def checked(value: dict[str, Any]) -> None:
        for issue in value['issues']:
            quotes = issue['narration_quotes']
            count = {'omission': 0, 'distortion': 1, 'production': 1, 'duplicate': 2}[issue['kind']]
            if len(quotes) != count:
                raise ValueError('podcast_audit_quote_count')
            if any(quote not in narration for quote in quotes):
                raise ValueError('podcast_audit_invented_narration_quote')
            ids, evidence = issue['source_part_ids'], issue['evidence_quote']
            if issue['kind'] in {'production', 'duplicate'}:
                if ids or evidence:
                    raise ValueError('podcast_brief_review_unexpected_source_claim')
            elif (not ids or not evidence or not any(
                    set(ids) & set(record.get('part_ids', [record.get('part_id')]))
                    and any(evidence in str(record.get(key, '')) for key in ('summary', 'quote', 'title'))
                    for record in records)):
                raise ValueError('podcast_audit_invented_evidence_quote')

    # Repair only literal quotations against the supplied day summaries. This
    # does not present those summaries as an exhaustive original-source audit.
    repair_data = {'narration': narration, 'briefs': [
        {'part_id': identifier, 'title': str(record.get('title', '')),
         'source_text': '\n'.join(str(record.get(key, '')) for key in ('summary', 'quote'))}
        for record in records for identifier in record.get('part_ids', [record.get('part_id')])]}
    result = context.stage(current, checked, output_repair=audit_quote_repair(repair_data, schema))
    issues: list[dict[str, Any]] = result['issues']
    return issues
