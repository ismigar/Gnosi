"""Portable public-test contract, also reviewed in ismigar.github.io.

Only authored work samples and allowlisted fields cross the export boundary.
Never imports app configuration, user data, models, or executable responses.
"""
from __future__ import annotations
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from typing import Any

SCHEMA = 1
MAX_BYTES = 4_000_000
PUBLIC_URL = 'https://gnosi.temenosismael.org/data/model-evaluations/index.json'
REPOSITORY = 'https://github.com/ismigar/ismigar.github.io/tree/main/data/model-evaluations'
ENDPOINTS = {'openrouter': 'https://openrouter.ai/api/v1', 'openai': 'https://api.openai.com/v1',
             'deepseek': 'https://api.deepseek.com', 'mistral': 'https://api.mistral.ai/v1'}
PROSE = {'book_map': 'summary', 'code_review': 'fix', 'workflow_plan': 'plan', 'decision_review': 'analysis',
         'translation_document': 'translation', 'writing_document': 'text',
         'research_screening': 'synthesis', 'meeting_synthesis': 'summary'}


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def same(actual: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() and all(same(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(same(a, b) for a, b in zip(actual, expected))
    if type(expected) in (float, int):
        return type(actual) in (float, int) and actual == expected
    return type(actual) is type(expected) and actual == expected


def passed(case: dict[str, Any], output: str) -> bool:
    try:
        actual = json.loads(output.strip())
    except ValueError:
        return False
    expected = case['expected']
    prose = PROSE.get(case['id'])
    if not isinstance(actual, dict) or actual.keys() != expected.keys() | ({prose} if prose else set()):
        return False
    if prose and (not isinstance(actual[prose], str) or not actual[prose].strip()):
        return False
    if not same({key: actual[key] for key in expected}, expected):
        return False
    return case['id'] != 'translation_document' or all(token in actual['translation'] for token in
        ('**', '[[doc-42]]', 'https://example.org/manual', '`case-07`'))


def require(value: bool) -> None:
    if not value:
        raise ValueError('invalid_public_evaluation')


def timestamp(value: Any) -> None:
    require(isinstance(value, str) and len(value) < 50)
    parsed = datetime.fromisoformat(value)
    require(parsed.tzinfo is not None and parsed <= datetime.now(timezone.utc))


def parameters(value: Any, provider: str) -> None:
    require(isinstance(value, dict) and set(value) == {'client', 'sdk_version', 'endpoint', 'reasoning', 'max_output_tokens', 'validator'})
    require(value['client'] == 'gnosi_bounded_v1' and value['validator'] == 'work_json_v1'
            and value['endpoint'] == ENDPOINTS.get(provider) and type(value['max_output_tokens']) is int
            and value['max_output_tokens'] == 1024)
    require(isinstance(value['sdk_version'], str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+-]*', value['sdk_version']) is not None)
    require(value['reasoning'] in ({}, {'use_responses_api': True, 'use_previous_response_id': False,
            'store': False, 'include': ['reasoning.encrypted_content']}))


def validate_submission(value: Any, suite: dict[str, Any]) -> dict[str, Any]:
    require(isinstance(value, dict) and set(value) == {'schema', 'id', 'provider', 'model', 'version', 'mode', 'parameters', 'created_at', 'cases'})
    require(type(value['schema']) is int and value['schema'] == SCHEMA)
    require(isinstance(value['id'], str) and re.fullmatch('[0-9a-f]{64}', value['id']) is not None)
    require(isinstance(value['provider'], str) and value['provider'] in ENDPOINTS)
    require(isinstance(value['model'], str) and re.fullmatch(r'[A-Za-z0-9_.:/@+-]{1,192}', value['model']) is not None)
    require(value['version'] == suite['version'] and value['mode'] == suite['mode'])
    parameters(value['parameters'], value['provider'])
    timestamp(value['created_at'])
    require(isinstance(value['cases'], list) and 0 < len(value['cases']) <= 12)
    criteria = {case['id']: case for case in suite['criteria']}
    seen: set[str] = set()
    fields = {'id', 'output', 'failure', 'checked_at', 'latency_ms', 'cost_usd', 'cost_source', 'review', 'reviewed_at'}
    for item in value['cases']:
        require(isinstance(item, dict) and set(item) == fields and item['id'] in criteria and item['id'] not in seen)
        seen.add(item['id'])
        require(isinstance(item['output'], str) and len(item['output']) <= 16000)
        require(item['failure'] in {'', 'contract_mismatch', 'output_limit', 'provider_error', 'unknown_cost', 'cancelled'})
        timestamp(item['checked_at'])
        require(type(item['latency_ms']) is int and 0 <= item['latency_ms'] <= 86_400_000)
        cost = item['cost_usd']
        require(cost is None or (type(cost) in (float, int) and math.isfinite(cost) and 0 <= cost <= 1))
        require(item['cost_source'] in {'reported', 'estimated', 'unknown'} and (cost is None) == (item['cost_source'] == 'unknown'))
        require(item['review'] in {'pending', 'accepted', 'rejected', 'not_required'})
        if item['reviewed_at']:
            timestamp(item['reviewed_at'])
        case = criteria[item['id']]
        if not case['requires_review']:
            require(item['review'] == 'not_required' and not item['reviewed_at'])
        else:
            require(item['review'] != 'not_required')
            if item['review'] in {'accepted', 'rejected'}:
                require(bool(item['reviewed_at']) and not item['failure'] and passed(case, item['output']))
        if item['failure'] in {'', 'contract_mismatch'}:
            require(passed(case, item['output']) == (item['failure'] == ''))
    require(value['id'] == digest({k: v for k, v in value.items() if k != 'id'}))
    return dict(value)
