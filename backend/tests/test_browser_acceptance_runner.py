"""Acceptance evidence must reject skipped, flaky or empty browser runs."""

from __future__ import annotations

import http.client
import json
import threading
from contextlib import closing, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from scripts.ci.acceptance_proxy import owned_proxy
from scripts.ci.browser_acceptance import file_inventory, report_counts


@pytest.mark.parametrize("stats", [
    {"expected": 0, "unexpected": 0, "flaky": 0, "skipped": 0},
    {"expected": 2, "unexpected": 0, "flaky": 0, "skipped": 1},
    {"expected": 2, "unexpected": 0, "flaky": 1, "skipped": 0},
    {"expected": 2, "unexpected": 1, "flaky": 0, "skipped": 0},
    {"expected": True, "unexpected": 0, "flaky": 0, "skipped": 0},
    {"expected": 2, "unexpected": 0, "flaky": 0},
])
def test_incomplete_browser_report_cannot_become_acceptance(tmp_path: Path, stats: dict[str, object]) -> None:
    report = tmp_path / "report.json"
    report.write_text(json.dumps({"stats": stats}))
    with pytest.raises(ValueError):
        report_counts(report)


def test_success_requires_actual_completed_tests(tmp_path: Path) -> None:
    report = tmp_path / "report.json"
    report.write_text(json.dumps({"stats": {"expected": 7, "unexpected": 0, "flaky": 0, "skipped": 0}}))
    assert report_counts(report)["expected"] == 7


def test_each_mandatory_project_must_execute_its_own_passing_case(tmp_path: Path) -> None:
    report = tmp_path / 'report.json'
    document = {'stats': {'expected': 2, 'unexpected': 0, 'flaky': 0, 'skipped': 0}, 'suites': [
        {'suites': [{'specs': [{'tests': [{'projectName': 'anonymous', 'expectedStatus': 'passed', 'status': 'expected'}]}]}]},
    ]}
    report.write_text(json.dumps(document))
    with pytest.raises(ValueError, match='critical'):
        report_counts(report, ('anonymous', 'critical'))
    document['suites'].append({'specs': [{'tests': [{'projectName': 'critical', 'expectedStatus': 'passed', 'status': 'expected'}]}]})
    report.write_text(json.dumps(document))
    assert report_counts(report, ('anonymous', 'critical'))['expected'] == 2


def test_compiled_build_identity_changes_for_content_and_names(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("build one")
    initial = file_inventory(tmp_path)
    (tmp_path / "index.html").write_text("build two")
    assert file_inventory(tmp_path) != initial
    current = file_inventory(tmp_path)
    (tmp_path / "index.html").rename(tmp_path / "another.html")
    assert file_inventory(tmp_path) != current


@contextmanager
def synthetic_service():
    class Service(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:
            body = b'owned synthetic service'
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    with ThreadingHTTPServer(('127.0.0.1', 0), Service) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield server.server_port
        finally:
            server.shutdown()
            worker.join(timeout=5)


def test_proxy_tunnels_to_both_owned_services_and_rejects_unowned_destinations() -> None:
    with synthetic_service() as frontend, synthetic_service() as backend, synthetic_service() as unowned:
        with owned_proxy(frontend, backend) as endpoint:
            proxy = urlsplit(endpoint)
            for port in (frontend, backend):
                with closing(http.client.HTTPConnection(proxy.hostname, proxy.port, timeout=5)) as client:
                    client.set_tunnel('127.0.0.1', port)
                    client.request('GET', '/')
                    response = client.getresponse()
                    assert response.status == 200
                    assert response.read() == b'owned synthetic service'
            for host, port in (('example.org', 443), ('127.0.0.1', unowned), ('localhost', frontend)):
                with closing(http.client.HTTPConnection(proxy.hostname, proxy.port, timeout=5)) as client:
                    client.set_tunnel(host, port)
                    with pytest.raises(OSError, match='403'):
                        client.request('GET', '/')


def test_proxy_rejects_absolute_external_http_requests() -> None:
    with owned_proxy(5198, 5008) as endpoint:
        proxy = urlsplit(endpoint)
        with closing(http.client.HTTPConnection(proxy.hostname, proxy.port, timeout=5)) as client:
            client.request('GET', 'http://example.org/private')
            assert client.getresponse().status == 403


def test_browser_batches_keep_serial_projects_whole_and_bound_accessibility() -> None:
    from scripts.ci.acceptance_batches import case_batches
    cases = {(project, str(index)): f'{project}-{index}'
             for project, length in [('disposable-web', 10), ('accessibility', 14)]
             for index in range(length)}
    batches = case_batches(cases, ('disposable-web', 'accessibility'))
    assert [len(batch) for batch in batches] == [10, 6, 6, 2]
    assert [case for batch in batches for case in batch] == list(cases)


@pytest.mark.parametrize('observed,seen', [
    ({('accessibility', 'other')}, set()),
    (set(), set()),
    ({('accessibility', 'required')}, {('accessibility', 'required')}),
])
def test_browser_batch_rejects_missing_extra_or_repeated_cases(observed, seen) -> None:
    from scripts.ci.acceptance_batches import require_coverage
    with pytest.raises(ValueError, match='omitted, added or repeated'):
        require_coverage({('accessibility', 'required')}, observed, seen)


def test_collected_case_identity_retains_project_file_and_nested_title(tmp_path: Path) -> None:
    from scripts.ci.acceptance_batches import report_cases
    report = tmp_path / 'collection.json'
    report.write_text(json.dumps({'suites': [{'title': 'accessibility/a.spec.ts', 'file': 'accessibility/a.spec.ts', 'suites': [
        {'title': 'WCAG', 'file': 'accessibility/a.spec.ts', 'specs': [
            {'id': 'stable-id', 'title': '/graph in dark mode', 'file': 'accessibility/a.spec.ts',
             'tests': [{'projectName': 'accessibility'}]},
        ]},
    ]}]}))
    assert report_cases(report, ('accessibility',)) == {
        ('accessibility', 'stable-id'): '[accessibility] › accessibility/a.spec.ts › WCAG › /graph in dark mode',
    }


def test_browser_batches_keep_fail_closed_report_validation(tmp_path: Path) -> None:
    from scripts.ci.acceptance_batches import run_projects
    from unittest.mock import Mock
    runner = Mock()
    runner.side_effect = RuntimeError('browser failed')
    with pytest.raises(RuntimeError, match='browser failed'):
        run_projects('node', Path('playwright'), ('accessibility',), 'functional', tmp_path,
                     tmp_path, {}, runner, report_counts)
    assert runner.call_count == 1
