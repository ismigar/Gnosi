"""Real subprocess/loopback fixtures for the packaged acceptance probe."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / "desktop/scripts/smoke-packaged-backend.py"
SPEC = importlib.util.spec_from_file_location("packaged_backend_smoke", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)

CHILD = r'''
import http.server, json, os, signal, sys, time
from pathlib import Path
mode = sys.argv[1]
root = Path(os.environ['GNOSI_VALIDATION_ROOT'])
assert os.environ['GNOSI_DISABLE_SCHEDULER'] == '1'
assert 'OPENAI_API_KEY' not in os.environ
assert 'GNOSI_SHARED_ENV_FILE' not in os.environ
config = json.loads((root / 'vault/.gnosi/params.yaml').read_text())
if mode == 'exit':
    sys.stderr.write('address already in use\n')
    sys.exit(1)
if mode in ('hang', 'ignore-stop'):
    if mode == 'ignore-stop' and os.name != 'nt':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    time.sleep(60)
if mode == 'noisy':
    sys.stderr.write('synthetic log\n' * 100000)
    sys.stderr.flush()
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if mode == 'trickle-headers':
            for byte in b'HTTP/1.1 200 OK\r\nContent-Length: 200\r\n\r\n':
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
                time.sleep(0.15)
            return
        if mode == 'silent-http':
            time.sleep(60)
            return
        payload = {'status': 'ok', 'mode': 'FastAPI',
                   'gnosi_mode': os.environ['GNOSI_MODE']}
        if mode == 'foreign': payload['gnosi_mode'] = 'personal'
        if mode == 'wrong-status': payload['status'] = 'error'
        if mode == 'wrong-mode': payload['mode'] = 'another-app'
        raw = json.dumps(payload).encode()
        if mode == 'malformed': raw = b'{'
        if mode == 'oversized': raw += b' ' * 5000
        self.send_response(302 if mode == 'redirect' else 200)
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def log_message(self, *args): pass
http.server.HTTPServer(('127.0.0.1', config['server']['backend_port']), Handler).serve_forever()
'''


@pytest.fixture
def child_launcher(monkeypatch):
    original = subprocess.Popen
    children = []
    roots = []

    def install(mode):
        def launch(command, **kwargs):
            assert command == [str(Path(sys.executable).resolve())]
            roots.append(Path(kwargs['cwd']))
            process = original([sys.executable, '-c', CHILD, mode], **kwargs)
            children.append(process)
            return process
        monkeypatch.setattr(smoke.subprocess, 'Popen', launch)

    monkeypatch.setattr(smoke, 'STARTUP_TIMEOUT_SECONDS', 0.6)
    monkeypatch.setattr(smoke, 'SHUTDOWN_TIMEOUT_SECONDS', 0.2)
    monkeypatch.setenv('OPENAI_API_KEY', 'must-not-reach-probe')
    monkeypatch.setenv('GNOSI_SHARED_ENV_FILE', '/not-a-real-shared-env')
    yield install
    assert children and all(child.poll() is not None for child in children)
    assert all(not root.exists() for root in roots)


@pytest.mark.parametrize('mode', ['healthy', 'noisy'])
def test_real_http_child_passes_and_is_reaped(child_launcher, mode):
    child_launcher(mode)
    smoke.verify_backend(Path(sys.executable))


@pytest.mark.parametrize('mode', [
    'exit', 'hang', 'foreign', 'wrong-status', 'wrong-mode',
    'malformed', 'oversized', 'redirect', 'silent-http',
])
def test_real_unhealthy_child_never_passes(child_launcher, mode):
    child_launcher(mode)
    with pytest.raises(RuntimeError, match='before (readiness|timeout)'):
        smoke.verify_backend(Path(sys.executable))


@pytest.mark.skipif(os.name == 'nt', reason='Windows terminate is not a catchable SIGTERM')
def test_uncooperative_child_is_killed_and_reaped(child_launcher):
    child_launcher('ignore-stop')
    with pytest.raises(RuntimeError, match='timeout'):
        smoke.verify_backend(Path(sys.executable))


def test_nonexistent_executable_fails_before_spawn(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('must not spawn')
    monkeypatch.setattr(smoke.subprocess, 'Popen', forbidden)
    with pytest.raises(RuntimeError, match='does not exist'):
        smoke.verify_backend(tmp_path / 'missing')


def test_trickled_headers_cannot_extend_the_deadline(child_launcher):
    child_launcher('trickle-headers')
    started = time.monotonic()
    with pytest.raises(RuntimeError, match='timeout'):
        smoke.verify_backend(Path(sys.executable))
    assert time.monotonic() - started < 2


def test_child_environment_is_allowlisted_and_data_is_private(tmp_path):
    environment = smoke.probe_environment(tmp_path, 43123, 'fixture-nonce', {
        'PATH': '/runtime', 'HOME': '/unchanged-home', 'SystemRoot': 'C:\\Windows',
        'PYTHONPATH': '/injected', 'HTTPS_PROXY': 'http://unwanted',
        'GNOSI_DATA_DIR': '/real-data', 'GNOSI_API_TOKEN': 'do-not-inherit',
    })
    assert environment['HOME'] == '/unchanged-home'
    assert environment['SystemRoot'] == 'C:\\Windows'
    assert 'PYTHONPATH' not in environment and 'HTTPS_PROXY' not in environment
    assert 'GNOSI_API_TOKEN' not in environment
    assert environment['GNOSI_DATA_DIR'] == str(tmp_path / 'data')
    assert environment['GNOSI_MODE'] == 'fixture-nonce'
    params = json.loads((tmp_path / 'vault/.gnosi/params.yaml').read_text())
    assert params['server'] == {'host': '127.0.0.1', 'backend_port': 43123}


def test_cli_reports_failure_without_child_output(monkeypatch, capsys):
    monkeypatch.setattr(sys, 'argv', [str(SCRIPT), '/fixture'])
    def failure(_):
        raise RuntimeError('Packaged backend exited before readiness: 1')
    monkeypatch.setattr(smoke, 'verify_backend', failure)
    assert smoke.main() == 1
    assert 'before readiness' in capsys.readouterr().err
