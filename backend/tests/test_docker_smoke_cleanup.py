"""Exercise cleanup retries without a Docker daemon or real containers."""
import os
from pathlib import Path
import subprocess

import pytest


@pytest.mark.parametrize('failures,expected_calls,success', [(2, 3, True), (3, 3, False)])
def test_cleanup_retries_are_bounded(tmp_path, failures, expected_calls, success):
    docker = tmp_path / 'docker'
    docker.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
n=$(wc -l < "$CALLS")
[ "$n" -gt "$FAILURES" ]
''')
    docker.chmod(0o755)
    sleeper = tmp_path / 'sleep'
    sleeper.write_text('#!/bin/sh\nexit 0\n')
    sleeper.chmod(0o755)
    calls = tmp_path / 'calls'
    project = 'gnosi-ci-test-1'
    script = Path(__file__).resolve().parents[2] / 'scripts/smoke_docker.sh'
    result = subprocess.run(
        ['bash', str(script), '--cleanup'],
        env={**os.environ, 'PATH': f'{tmp_path}:{os.environ["PATH"]}',
             'CALLS': str(calls), 'FAILURES': str(failures),
             'GNOSI_DOCKER_SMOKE_PROJECT': project},
        capture_output=True, text=True, timeout=10,
    )
    assert (result.returncode == 0) == success
    lines = calls.read_text().splitlines()
    assert len(lines) == expected_calls
    assert all(line.endswith('down --volumes --remove-orphans') for line in lines)
    assert 'up ' not in calls.read_text()
