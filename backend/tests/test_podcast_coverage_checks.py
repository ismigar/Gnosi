"""A small public-interest source cannot disappear behind the day's dominant story."""
import copy

import jsonschema
import pytest

from backend.services.podcast_coverage_checks import coverage_request, coverage_findings
from backend.services.podcast_review import _schema
from backend.services.podcast_brief_edits import _anchor_schema


def test_every_source_requires_a_coverage_decision_and_only_literal_evidence_becomes_a_finding():
    records = [{'part_id': 'major:0', 'topic': 'Major incident', 'summary': 'Investigation continues.'},
        {'part_id': 'guide:0', 'topic': 'Community vehicle incident guide',
         'summary': 'The app links incident reports and photographs to the reservation.'}]
    original = copy.deepcopy(records)
    schema, blocks = coverage_request(_schema({'brief_review': True, 'briefs': records}), records,
        'The incident remains under investigation.\n\nOther news follows.')
    result = {'coverage_checks': {'major:0': 'paragraph:0', 'guide:0': 'missing'}, 'issues': []}
    jsonschema.validate(result, schema)
    finding, = coverage_findings(result, records)
    assert finding == {'kind': 'omission',
        'detail': 'Absent substantive development: Community vehicle incident guide',
        'narration_quotes': [], 'source_part_ids': ['guide:0'],
        'evidence_quote': records[1]['summary']}
    assert blocks['paragraph:1'] == 'Other news follows.' and records == original
    del result['coverage_checks']['guide:0']
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, schema)


def test_covered_secondary_and_noneditorial_records_are_not_turned_into_omissions():
    records = [{'part_id': f's:{i}', 'topic': f'Topic {i}', 'summary': 'Exact source evidence.'}
               for i in range(3)]
    schema, _ = coverage_request(_schema({'brief_review': True, 'briefs': records}), records, 'Actual news.')
    result = {'coverage_checks': dict(zip([r['part_id'] for r in records],
        ['paragraph:0', 'secondary', 'non_editorial'])), 'issues': []}
    jsonschema.validate(result, schema)
    assert coverage_findings(result, records) == []
    result['coverage_checks']['s:0'] = 'invented-paragraph'
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, schema)


def test_native_edit_choices_are_unique_nonoverlapping_exact_original_sentences():
    previous = "An exact first sentence. Another sentence with a curly apostrophe: l’app. Closing news."
    schema = _anchor_schema(previous)
    assert schema['enum'] == ['An exact first sentence.',
        'Another sentence with a curly apostrophe: l’app.', 'Closing news.']
    for before in schema['enum']:
        jsonschema.validate(before, schema)
        assert previous.count(before) == 1
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate("Another sentence with a curly apostrophe: l'app.", schema)
