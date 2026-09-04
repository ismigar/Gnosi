from __future__ import annotations

from pathlib import Path
import pytest

from scripts.ci import prepare_docker_runner


def test_capacity_gate_does_not_prune_when_space_is_sufficient(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        prepare_docker_runner,
        "_free_bytes",
        lambda _path: prepare_docker_runner.MINIMUM_FREE_BYTES,
    )
    prune = monkeypatch.setattr(prepare_docker_runner, "_prune_unused_docker", None)

    assert prepare_docker_runner.prepare({"RUNNER_TEMP": str(tmp_path)}) == (
        prepare_docker_runner.MINIMUM_FREE_BYTES
    )
    assert prune is None


def test_capacity_gate_prunes_only_docker_and_rechecks(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    values = iter((1, prepare_docker_runner.MINIMUM_FREE_BYTES + 1))
    monkeypatch.setattr(
        prepare_docker_runner,
        "_free_bytes",
        lambda _path: next(values),
    )
    calls: list[tuple[tuple[str, ...], bool]] = []
    monkeypatch.setattr(
        prepare_docker_runner,
        "_prune_unused_docker",
        lambda: calls.append((("docker", "system", "prune", "--all", "--force", "--volumes"), True)),
    )

    prepare_docker_runner.prepare({"RUNNER_TEMP": str(tmp_path)})

    assert calls == [
        (("docker", "system", "prune", "--all", "--force", "--volumes"), True)
    ]


def test_capacity_gate_fails_if_pruning_is_insufficient(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        prepare_docker_runner,
        "_free_bytes",
        lambda _path: 1,
    )
    monkeypatch.setattr(prepare_docker_runner, "_prune_unused_docker", lambda: None)

    with pytest.raises(RuntimeError, match="less than 12 GiB"):
        prepare_docker_runner.prepare({"RUNNER_TEMP": str(tmp_path)})
