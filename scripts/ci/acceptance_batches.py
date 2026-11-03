"""Bound browser lifetimes without dropping or retrying acceptance cases."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

Case = tuple[str, str]
ACCESSIBILITY_BATCH_SIZE = 6


def report_cases(report: Path, projects: Sequence[str]) -> dict[Case, str]:
    """Use Playwright's stable IDs for coverage and documented test-list labels."""
    cases: dict[Case, str] = {}

    def visit(suite: dict[str, Any], titles: list[str]) -> None:
        nested = titles + ([suite['title']] if suite.get('title') != suite.get('file') else [])
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                project = test['projectName']
                if project not in projects:
                    continue
                key = (project, spec['id'])
                label = ' › '.join([f'[{project}]', spec['file'], *nested, spec['title']])
                if key in cases or '\n' in label or '\r' in label:
                    raise ValueError('Ambiguous browser acceptance case')
                cases[key] = label
        for child in suite.get('suites', []):
            visit(child, nested)

    document = json.loads(report.read_text())
    for suite in document['suites']:
        visit(suite, [])
    if not cases:
        raise ValueError('Browser acceptance collection is empty')
    return cases


def case_batches(cases: dict[Case, str], projects: Sequence[str]) -> list[dict[Case, str]]:
    batches: list[dict[Case, str]] = []
    for project in projects:
        selected = [(key, label) for key, label in cases.items() if key[0] == project]
        if not selected:
            raise ValueError(f'Browser project collected no cases: {project}')
        size = ACCESSIBILITY_BATCH_SIZE if project == 'accessibility' else len(selected)
        batches.extend(dict(selected[start:start + size]) for start in range(0, len(selected), size))
    return batches


def require_coverage(expected: set[Case], observed: set[Case], seen: set[Case]) -> None:
    if observed != expected or seen.intersection(observed):
        raise ValueError('Browser batch omitted, added or repeated acceptance cases')
    seen.update(observed)


def run_projects(node: str, playwright: Path, projects: Sequence[str], phase: str,
                 output: Path, cwd: Path, environment: Mapping[str, str],
                 run: Callable[..., None], counts: Callable[..., dict[str, int]],
                 before_project: Callable[[], None] | None = None) -> dict[str, int]:
    """Close each Playwright process before starting the next planned batch."""
    base = [node, str(playwright), 'test', '--workers=1', '--retries=0']
    collection = output / f'{phase}-collection.json'
    env = {**environment, 'PLAYWRIGHT_JSON_OUTPUT_FILE': str(collection)}
    run([*base, '--list', '--reporter=json', *(f'--project={p}' for p in projects)], cwd, env, output / f'{phase}-collection.log')
    planned = report_cases(collection, projects)
    seen: set[Case] = set()
    aggregate: dict[str, Any] = {'suites': [], 'stats': dict.fromkeys(('expected', 'unexpected', 'flaky', 'skipped'), 0)}
    previous_project = None
    for index, batch in enumerate(case_batches(planned, projects), 1):
        project = next(iter(batch))[0]
        if project != previous_project and before_project is not None:
            before_project()
        previous_project = project
        name = f'{phase}-{index:02}'
        selection = output / f'{name}-tests.txt'
        selection.write_text('\n'.join(batch.values()) + '\n')
        report = output / f'{name}-report.json'
        env['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(report)
        selected_projects = sorted({key[0] for key in batch})
        run([*base, '--reporter=line,json', '--test-list', str(selection), '--output', str(output / name),
             *(f'--project={p}' for p in selected_projects)], cwd, env, output / f'{name}-browser.log')
        actual_counts = counts(report, selected_projects)
        require_coverage(set(batch), set(report_cases(report, projects)), seen)
        document = json.loads(report.read_text())
        aggregate['suites'].extend(document['suites'])
        for key, value in actual_counts.items():
            aggregate['stats'][key] += value
    if seen != set(planned):
        raise ValueError('Browser acceptance did not execute the complete collected matrix')
    report = output / f'{phase}-report.json'
    report.write_text(json.dumps(aggregate, indent=2) + '\n')
    return counts(report, projects)
