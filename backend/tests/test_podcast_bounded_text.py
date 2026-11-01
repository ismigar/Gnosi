"""Compact provider bounds and local scope checks protect the same whole episode."""
import copy
import json

import jsonschema
import pytest

from backend.services.podcast_composition import BOUNDED_TEXT, schema, spoken_text
from backend.tests.test_podcast_word_text import broad_day


@pytest.mark.parametrize('words', [1241, 1242, 1380, 1504, 1505, 2117])
@pytest.mark.parametrize('separator', [' ', '\n', '\t', '\u00a0'])
def test_compact_global_bounds_preserve_complete_prose(words, separator):
    data, result = broad_day(words, groups=12)
    data['composition_encoding'] = BOUNDED_TEXT
    result['token_text'] = separator.join(result['token_text'].split())
    before = copy.deepcopy(result)
    contract = schema(data)
    if 1242 <= words <= 1504:
        jsonschema.validate(result, contract)
        assert len(spoken_text(result, data).split()) == words
    else:
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(result, contract)
    assert result == before
    assert set(contract['properties']) == {'paragraphs', 'token_text'}
    # No JSON string/comma pair per spoken word.
    legacy = {'paragraphs': result['paragraphs'], 'tokens': result['token_text'].split()}
    assert len(json.dumps(result, ensure_ascii=False)) < len(json.dumps(legacy, ensure_ascii=False))


@pytest.mark.parametrize('mutation', ['duplicate', 'missing', 'reordered', 'unknown'])
def test_provider_count_bound_never_replaces_exact_local_marker_validation(mutation):
    data, result = broad_day(1380, groups=12)
    data['composition_encoding'] = BOUNDED_TEXT
    items = result['token_text'].split()
    marker = '__gnosi_group__:group:1'
    index = items.index(marker)
    if mutation == 'duplicate':
        items.insert(index, marker)
    elif mutation == 'missing':
        items.pop(index)
    elif mutation == 'reordered':
        items[0], items[index] = items[index], items[0]
    else:
        items[index] = '__gnosi_group__:unknown'
    result['token_text'] = ' '.join(items)
    jsonschema.validate(result, schema(data))
    with pytest.raises(ValueError, match='podcast_composition_group_marker'):
        spoken_text(result, data)


def test_empty_non_editorial_groups_count_only_structural_markers():
    data, result = broad_day(1, groups=12, minimum=1, maximum=1)
    data['composition_encoding'] = BOUNDED_TEXT
    jsonschema.validate(result, schema(data))
    assert spoken_text(result, data) == 'notícia'
