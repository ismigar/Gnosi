"""Docker must receive the reviewed shared-CI installer and download policy."""
from __future__ import annotations

from pathlib import Path
import re
import shlex

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]
BUDGETS = {
    "UV_HTTP_TIMEOUT": "120",
    "UV_HTTP_RETRIES": "3",
    "UV_CONCURRENT_DOWNLOADS": "4",
    "UV_CONCURRENT_INSTALLS": "2",
}


def verify_policy(dockerfile: str) -> None:
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    assert isinstance(workflow, dict)
    for job_name in ("frontend", "backend", "native-smoke", "documentation"):
        steps = workflow["jobs"][job_name]["steps"]
        installers = [
            step for step in steps
            if str(step.get("uses", "")).startswith("astral-sh/setup-uv@")
        ]
        assert len(installers) == 1
        version = installers[0]["with"]["version"]
        assert version == "0.10.0"
        assert f"COPY --from=ghcr.io/astral-sh/uv:{version} /uv /uvx /bin/" in dockerfile

    instructions = dockerfile.replace("\\\n", " ").splitlines()
    installs = [line for line in instructions if line.startswith("RUN ") and "uv sync" in line]
    assert len(installs) == 1
    arguments = shlex.split(installs[0])[1:]
    split = arguments.index("uv")
    actual: dict[str, str] = {}
    for item in arguments[:split]:
        name, value = item.split("=", 1)
        assert name not in actual
        actual[name] = value
    assert actual == BUDGETS
    assert actual == {name: workflow["env"][name] for name in BUDGETS}
    assert arguments[split:] == [
        "uv", "sync", "--frozen", "--no-cache", "--no-default-groups", "--no-install-workspace",
    ]
    assert not re.search(r"^ENV .*UV_", dockerfile, re.MULTILINE)


def test_backend_docker_install_matches_shared_ci_policy() -> None:
    verify_policy((ROOT / "Dockerfile.backend").read_text())


@pytest.mark.parametrize("name", BUDGETS)
def test_policy_rejects_missing_or_changed_download_budget(name: str) -> None:
    source = (ROOT / "Dockerfile.backend").read_text()
    assignment = f"{name}={BUDGETS[name]}"
    assert assignment in source
    for replacement in ("", f"{name}=999"):
        with pytest.raises((AssertionError, ValueError)):
            verify_policy(source.replace(assignment, replacement))


def test_policy_rejects_old_installer_and_unfrozen_install() -> None:
    source = (ROOT / "Dockerfile.backend").read_text()
    for old, new in (("uv:0.10.0", "uv:0.9.15"), ("--frozen", "")):
        assert old in source
        with pytest.raises(AssertionError):
            verify_policy(source.replace(old, new))


@pytest.mark.parametrize("name", BUDGETS)
def test_policy_rejects_duplicated_budget(name: str) -> None:
    source = (ROOT / "Dockerfile.backend").read_text()
    assignment = f"{name}={BUDGETS[name]}"
    with pytest.raises(AssertionError):
        verify_policy(source.replace(assignment, f"{assignment} {assignment}"))
