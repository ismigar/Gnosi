"""One bounded whole-day review before an optional corrective rewrite and speech."""
from __future__ import annotations

from typing import Any, TYPE_CHECKING

from backend.services.podcast_review import _schema
from backend.services.podcast_audit_repair import audit_quote_repair
from backend.services.podcast_policy import synthesis_context_limit
from backend.services.agent_behavior import resource
from backend.services.podcast_coverage_checks import CONTRACT, coverage_request, coverage_findings

if TYPE_CHECKING:
    from backend.services.podcast_briefing import _Briefing


def policy_revision() -> str:
    """Bind final approval to the complete current editorial review contract."""
    from backend.services.agent_behavior import revision
    from backend.services.podcast_automatic import resource as policy_resource
    return revision([CONTRACT, *[policy_resource('operations/podcast/' + name) for name in (
        'brief-review-contract.md', 'brief-review-compact-contract.md', 'material-coverage-contract.md')]])


def _validate_review(value: dict[str, Any], records: list[dict[str, Any]], narration: str) -> None:
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



def review(context: _Briefing, briefs: list[dict[str, Any]], narration: str,
           subjects: list[list[str]]) -> list[dict[str, Any]]:
    from backend.services.podcast_automatic import _request
    from backend.services.podcast_outline import _digest, _digest_part_ids

    expected = _digest_part_ids(briefs)
    records = briefs
    schema = _schema({'briefs': briefs, 'brief_review': True})

    def request(*, coverage: bool = False) -> Any:
        active_schema, blocks = coverage_request(schema, records, narration) if coverage else (schema, {})
        data = {'brief_review': True, 'subjects': subjects, 'source_summaries': records}
        data.update({'narration_blocks': blocks} if coverage else {'narration': narration})
        current = _request(context, 'audit', data, active_schema)
        if coverage:
            current = current.model_copy(update={'options': {**current.options, 'coverage_checks_contract': CONTRACT}})
        if context.cost(current) > synthesis_context_limit(context):
            options = {k: v for k, v in current.options.items() if k != 'material_coverage_contract'}
            options['automatic_contract'] = resource('operations/podcast/brief-review-compact-contract.md')
            current = current.model_copy(update={'options': options})
        return current

    current = request()
    while context.cost(current) > synthesis_context_limit(context):
        before = context.cost(current)
        records = _digest(context, records)
        if _digest_part_ids(records) != expected:
            raise ValueError('podcast_brief_review_source_scope_changed')
        current = request()
        if context.cost(current) >= before:
            raise RuntimeError('podcast_brief_review_context_insufficient')
    # Broad days need an explicit topic-by-topic decision. Retain the existing
    # complete-source digest path when a smaller model cannot fit this schema.
    if len(records) > 32:
        expanded = request(coverage=True)
        if context.cost(expanded) <= synthesis_context_limit(context):
            current = expanded

    # Repair only literal quotations against the supplied day summaries. This
    # does not present those summaries as an exhaustive original-source audit.
    repair_data = {'narration': narration, 'briefs': [
        {'part_id': identifier, 'title': str(record.get('title', '')),
         'source_text': str(record.get('summary', '')), 'source_quote': str(record.get('quote', ''))}
        for record in records for identifier in record.get('part_ids', [record.get('part_id')])]}
    result = context.stage(current, lambda value: _validate_review(value, records, narration),
        output_repair=audit_quote_repair(repair_data, current.output_schema))
    return coverage_findings(result, records)
