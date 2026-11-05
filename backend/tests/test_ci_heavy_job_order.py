"""Keep Linux follow-up jobs ordered after the parallel validation."""
from pathlib import Path

import yaml


def test_parallel_validation_retains_all_downstream_checks() -> None:
    root = Path(__file__).resolve().parents[2]
    jobs = yaml.safe_load((root / '.github/workflows/ci.yml').read_text())['jobs']
    assert 'needs' not in jobs['backend']
    assert 'needs' not in jobs['frontend']
    assert jobs['native-smoke']['needs'] == ['backend', 'frontend']
    assert jobs['docker']['needs'] == 'native-smoke'
    for job in ('frontend', 'native-smoke', 'docker'):
        condition = jobs[job]['if']
        assert '!cancelled()' in condition
        assert 'github.event.pull_request.head.repo.full_name == github.repository' in condition
        assert 'self-hosted' in jobs[job]['runs-on']
    assert jobs['frontend']['env']['GNOSI_VITEST_MAX_WORKERS'] == '1'
