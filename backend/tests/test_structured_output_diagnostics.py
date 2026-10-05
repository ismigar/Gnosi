"""Repairs identify invalid fields without echoing document/schema dumps."""
import jsonschema
from backend.domains.llm_wiki.reading_action_contracts import ACTION_SCHEMA
from backend.services.structured_output_diagnostics import repair_diagnostic, reading_error


def test_read_array_error_is_concise_and_identifies_singular_chunk_id():
    try:
        jsonschema.validate({'action': 'read', 'arguments': {'chunk_ids': ['chunk-5', 'chunk-6']}}, ACTION_SCHEMA)
    except jsonschema.ValidationError as error:
        diagnostic = repair_diagnostic(reading_error(error, '{"action":"read","arguments":{"chunk_ids":["chunk-5","chunk-6"]}}', ACTION_SCHEMA))
        assert len(diagnostic) < 2400
        assert 'chunk_id' in diagnostic and 'arguments' in diagnostic
        assert 'properties' not in diagnostic and 'On instance' not in diagnostic
    else:
        raise AssertionError('Invalid read passed')


def test_large_invalid_document_is_not_repeated_in_repair():
    try:
        jsonschema.validate('sensitive passage ' * 10000, {'type': 'object'})
    except jsonschema.ValidationError as error:
        diagnostic = repair_diagnostic(error)
        assert 'object' in diagnostic and 'type' in diagnostic
        assert 'sensitive passage' not in diagnostic
        assert len(diagnostic) < 100
    assert repair_diagnostic(ValueError('global_memory_required')) == 'global_memory_required'
