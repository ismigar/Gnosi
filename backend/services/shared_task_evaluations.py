"""Read a bounded public bank; export only new, reproducible public samples.

GitHub review attestations are community evidence, not local execution proofs.
No vault paths, agent identifiers, credentials or private review notes are sent.
"""
from __future__ import annotations
from datetime import datetime, timezone
import json
import statistics
import threading
import time
from typing import Any
import httpx
from pydantic import BaseModel, Field
from backend.config.data_dir import resolve_data_dir
from backend.services.public_evaluation_contract import (
    SCHEMA, MAX_BYTES, PUBLIC_URL, REPOSITORY, ENDPOINTS, digest, require, validate_submission, passed,
)
from backend.services.agent_task_evaluation_models import TaskEvaluationReport, TaskCaseResult
from backend.services.agent_work_samples import WORK_CASES, suite_version, suite_mode


class SharedRouteSummary(BaseModel):
    provider: str
    model: str
    observations: int
    contributors: int
    passed: int
    failed: int
    inconclusive: int
    median_latency_ms: float | None
    median_cost_usd: float | None
    cost_sources: list[str]
    minimum_latency_ms: int
    maximum_latency_ms: int
    minimum_cost_usd: float | None
    maximum_cost_usd: float | None


class SharedEvaluationBank(BaseModel):
    state: str
    source_url: str = PUBLIC_URL
    repository_url: str = REPOSITORY
    fetched_at: str = ''
    reports: list[TaskEvaluationReport] = Field(default_factory=list)
    summaries: list[SharedRouteSummary] = Field(default_factory=list)


_lock = threading.Lock()
_attempts: dict[str, float] = {}


def public_suite() -> dict[str, Any]:
    return {'schema': SCHEMA, 'version': suite_version('work'), 'mode': suite_mode('work'), 'max_output_tokens': 1024,
        'criteria': [{'id': c.id, 'metric': c.metric, 'tasks': list(c.tasks), 'title': c.title, 'source': c.source,
            'prompt': c.prompt, 'expected': c.expected, 'requires_review': c.requires_review} for c in WORK_CASES]}


def public_parameters(provider: str, model: str, base_url: str | None = None) -> dict[str, Any] | None:
    """Custom endpoints and unrecorded legacy calls are not equivalent public evidence."""
    endpoint = ENDPOINTS.get(provider)
    if endpoint is None or (base_url and base_url.rstrip('/') != endpoint):
        return None
    from backend.services.model_reasoning import reasoning_client_kwargs
    from importlib.metadata import version, PackageNotFoundError
    try:
        sdk_version = version('langchain-openai')
    except PackageNotFoundError:
        # Frozen desktop bundles retain the module version even without wheel metadata.
        from langchain_openai import __version__
        sdk_version = __version__
    return {'client': 'gnosi_bounded_v1', 'sdk_version': sdk_version, 'endpoint': endpoint, 'reasoning': reasoning_client_kwargs(provider, model, None),
            'max_output_tokens': 1024, 'validator': 'work_json_v1'}


def validate_bank(value: Any) -> dict[str, Any]:
    require(isinstance(value, dict) and set(value) == {'schema', 'suite', 'records'})
    require(type(value['schema']) is int and value['schema'] == SCHEMA and value['suite'] == public_suite())
    require(isinstance(value['records'], list) and len(value['records']) <= 1000)
    seen: set[str] = set()
    import re
    for record in value['records']:
        require(isinstance(record, dict) and set(record) == {'evaluation', 'attestation'})
        evaluation = validate_submission(record['evaluation'], public_suite())
        require(evaluation['id'] not in seen)
        seen.add(evaluation['id'])
        attestation = record['attestation']
        require(isinstance(attestation, dict) and set(attestation) == {'contributor', 'review_url', 'approved_cases'})
        require(isinstance(attestation['contributor'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', attestation['contributor']) is not None)
        require(isinstance(attestation['review_url'], str) and re.fullmatch(r'https://github.com/ismigar/ismigar.github.io/pull/[1-9][0-9]*', attestation['review_url']) is not None)
        require(isinstance(attestation['approved_cases'], list) and len(set(attestation['approved_cases'])) == len(attestation['approved_cases'])
                and set(attestation['approved_cases']) <= {c['id'] for c in evaluation['cases']})
    return dict(value)


def aggregate(value: dict[str, Any], state: str, fetched_at: str) -> SharedEvaluationBank:
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for record in value['records']:
        report = record['evaluation']
        if report['parameters'] != public_parameters(report['provider'], report['model']):
            continue
        groups.setdefault((report['provider'], report['model'], digest(report['parameters'])), []).append(record)
    bank = SharedEvaluationBank(state=state, fetched_at=fetched_at)
    criteria = {c.id: c for c in WORK_CASES}
    for (provider, model, protocol), records in groups.items():
        all_cases = [case for record in records for case in record['evaluation']['cases']]
        bank.summaries.append(SharedRouteSummary(provider=provider, model=model, observations=len(all_cases),
            contributors=len({r['attestation']['contributor'].lower() for r in records}),
            passed=sum(c['failure'] == '' for c in all_cases), failed=sum(c['failure'] == 'contract_mismatch' for c in all_cases),
            inconclusive=sum(c['failure'] not in {'', 'contract_mismatch'} for c in all_cases),
            median_latency_ms=statistics.median(c['latency_ms'] for c in all_cases),
            median_cost_usd=statistics.median(c['cost_usd'] for c in all_cases if c['cost_usd'] is not None)
                if any(c['cost_usd'] is not None for c in all_cases) else None,
            cost_sources=sorted({c['cost_source'] for c in all_cases}),
            minimum_latency_ms=min(c['latency_ms'] for c in all_cases), maximum_latency_ms=max(c['latency_ms'] for c in all_cases),
            minimum_cost_usd=min((c['cost_usd'] for c in all_cases if c['cost_usd'] is not None), default=None),
            maximum_cost_usd=max((c['cost_usd'] for c in all_cases if c['cost_usd'] is not None), default=None)))
        reusable: list[TaskCaseResult] = []
        for identifier, criterion in criteria.items():
            latest: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
            for record in records:
                contributor = record['attestation']['contributor'].lower()
                for case in record['evaluation']['cases']:
                    if case['id'] == identifier and (contributor not in latest or datetime.fromisoformat(case['checked_at']) > datetime.fromisoformat(latest[contributor][0]['checked_at'])):
                        latest[contributor] = case, record['attestation']
            # Disagreement or an inconclusive latest attempt needs local checking.
            if len(latest) < 2 or not all(not case['failure'] and
                    (not criterion.requires_review or (case['review'] == 'accepted' and identifier in att['approved_cases']))
                    for case, att in latest.values()):
                continue
            case = min((item[0] for item in latest.values()), key=lambda c: datetime.fromisoformat(c['checked_at']))
            reusable.append(TaskCaseResult(id=identifier, metric=criterion.metric, tasks=list(criterion.tasks), passed=True,
                checked_at=case['checked_at'], latency_ms=case['latency_ms'], cost_usd=case['cost_usd'], cost_source=case['cost_source'],
                output=case['output'], task_prompt=criterion.prompt, expected=criterion.expected, requires_review=criterion.requires_review,
                review=case['review'], reviewed_at=case['reviewed_at'], reused_from='shared:' + protocol,
                evidence_origin='shared', observations=len(latest), contributors=len(latest)))
        if reusable:
            bank.reports.append(TaskEvaluationReport(id='shared:' + protocol + ':' + model, agent_id='', provider=provider, model=model,
                version=suite_version('work'), mode=suite_mode('work'), created_at=max(c.checked_at for c in reusable),
                tasks=list(dict.fromkeys(task for case in reusable for task in case.tasks)), cases=reusable,
                model_calls=0, reused_cases=len(reusable), budget_usd=0, cost_usd=0, public_parameters=records[0]['evaluation']['parameters']))
    return bank


def load_bank(*, refresh: bool = False, force: bool = False) -> SharedEvaluationBank:
    path = resolve_data_dir() / 'public-model-evaluations.json'
    cached: dict[str, Any] | None = None
    stamp = ''
    with _lock:
        try:
            require(path.stat().st_size <= MAX_BYTES)
            cached = validate_bank(json.loads(path.read_text()))
            stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
        except (OSError, ValueError, TypeError, KeyError):
            pass
        key = str(path)
        now = time.monotonic()
        failed_refresh = False
        fresh = cached is not None and time.time() - path.stat().st_mtime < 21600
        if refresh and (force or not fresh) and now - _attempts.get(key, -1e9) > (10 if force else 300):
            _attempts[key] = now
            try:
                with httpx.Client(timeout=3, follow_redirects=False, trust_env=False) as client:
                    with client.stream('GET', PUBLIC_URL, headers={'Accept': 'application/json', 'User-Agent': 'Gnosi-public-evaluations/1'}) as response:
                        response.raise_for_status()
                        raw = bytearray()
                        for chunk in response.iter_bytes():
                            raw.extend(chunk)
                            require(len(raw) <= MAX_BYTES and time.monotonic() - now <= 5)
                new = validate_bank(json.loads(raw))
                from backend.utils.safe_io import safe_write_text
                path.parent.mkdir(parents=True, exist_ok=True)
                safe_write_text(path, json.dumps(new, ensure_ascii=False))
                cached = new
                stamp = datetime.now(timezone.utc).isoformat()
                return aggregate(cached, 'ready', stamp)
            except (httpx.HTTPError, OSError, ValueError, TypeError, KeyError):
                failed_refresh = True
        if cached is not None:
            return aggregate(cached, 'ready' if fresh and not failed_refresh else 'cached', stamp)
        return SharedEvaluationBank(state='unavailable')


def cached_cases(provider: str, model: str, parameters: dict[str, Any] | None) -> dict[str, TaskCaseResult]:
    if parameters is None:
        return {}
    return {case.id: case for report in load_bank().reports if (report.provider, report.model, report.public_parameters) ==
            (provider, model, parameters) for case in report.cases}


def export_report(report: TaskEvaluationReport) -> dict[str, Any]:
    require(report.public_parameters is not None and report.version == suite_version('work') and report.mode == suite_mode('work'))
    cases = []
    criteria = {case.id: case for case in WORK_CASES}
    for case in report.cases:
        if case.reused_from or case.evidence_origin != 'local':
            continue
        original = criteria.get(case.id)
        require(original is not None and case.task_prompt == original.prompt and case.expected == original.expected)
        cases.append({key: getattr(case, key) for key in ('id', 'output', 'checked_at', 'latency_ms', 'cost_usd', 'cost_source', 'review', 'reviewed_at')}
                     | {'failure': case.failure if case.failure in {'', 'contract_mismatch', 'output_limit', 'unknown_cost', 'cancelled'} else 'provider_error'})
    value = {'schema': SCHEMA, 'provider': report.provider, 'model': report.model, 'version': report.version, 'mode': report.mode,
             'parameters': report.public_parameters, 'created_at': report.created_at, 'cases': cases}
    value['id'] = digest(value)
    return validate_submission(value, public_suite())
