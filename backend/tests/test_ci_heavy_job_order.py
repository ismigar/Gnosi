"""Keep the shared physical host from running heavy validation jobs together."""
from pathlib import Path

import yaml


def test_heavy_jobs_are_serial_but_failures_do_not_skip_later_checks() -> None:
    root = Path(__file__).resolve().parents[2]
    jobs = yaml.safe_load((root / '.github/workflows/ci.yml').read_text())['jobs']
    for job, predecessor in [('frontend', 'backend'), ('docker', 'frontend')]:
        assert jobs[job]['needs'] == predecessor
        condition = jobs[job]['if']
        assert '!cancelled()' in condition
        assert 'github.event.pull_request.head.repo.full_name == github.repository' in condition
        assert 'self-hosted' in jobs[job]['runs-on']
    assert jobs['frontend']['env']['GNOSI_VITEST_MAX_WORKERS'] == '1'
