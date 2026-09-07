from __future__ import annotations

from pathlib import Path
from subprocess import CalledProcessError, CompletedProcess, TimeoutExpired
from unittest.mock import Mock, call
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
    calls: list[str] = []
    monkeypatch.setattr(
        prepare_docker_runner,
        "_prune_unused_docker",
        lambda: calls.append("scoped-cleanup"),
    )

    prepare_docker_runner.prepare({"RUNNER_TEMP": str(tmp_path)})

    assert calls == ["scoped-cleanup"]


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


def test_cleanup_removes_only_existing_ci_image_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = Mock(side_effect=[
        CompletedProcess((), 0, stdout=""),
        CompletedProcess((), 0, stdout="sha256:synthetic\n"),
        CompletedProcess((), 0),
    ])
    monkeypatch.setattr(prepare_docker_runner, "run", runner)

    prepare_docker_runner._remove_ci_images()

    assert runner.call_args_list == [
        call(("docker", "image", "ls", "--quiet", "gnosi-frontend:ci"),
             check=True, capture_output=True, text=True, timeout=30),
        call(("docker", "image", "ls", "--quiet", "gnosi-backend:ci"),
             check=True, capture_output=True, text=True, timeout=30),
        call(("docker", "image", "rm", "gnosi-backend:ci"), check=True, timeout=60),
    ]


def test_cleanup_does_not_force_remove_an_in_use_image(monkeypatch: pytest.MonkeyPatch) -> None:
    error = CalledProcessError(1, ("docker", "image", "rm", "gnosi-frontend:ci"))
    runner = Mock(side_effect=[CompletedProcess((), 0, stdout="sha256:synthetic\n"), error])
    monkeypatch.setattr(prepare_docker_runner, "run", runner)

    with pytest.raises(CalledProcessError) as caught:
        prepare_docker_runner._remove_ci_images()

    assert caught.value is error
    assert runner.call_count == 2
    assert "--force" not in runner.call_args.args[0]


@pytest.mark.parametrize("absent_after_wait", [False, True])
def test_image_removal_timeout_accepts_only_verified_absence(
    monkeypatch: pytest.MonkeyPatch, absent_after_wait: bool,
) -> None:
    present = CompletedProcess((), 0, stdout="sha256:synthetic\n")
    absent = CompletedProcess((), 0, stdout="")
    error = TimeoutExpired(("docker", "image", "rm", "gnosi-frontend:ci"), 60)
    outcomes = [present, error, present, absent] if absent_after_wait else [present, error, absent]
    runner = Mock(side_effect=outcomes)
    waits = Mock()
    monkeypatch.setattr(prepare_docker_runner, "run", runner)
    monkeypatch.setattr(prepare_docker_runner, "sleep", waits)

    prepare_docker_runner._remove_ci_image("gnosi-frontend:ci")

    removals = [entry.args[0] for entry in runner.call_args_list if entry.args[0][2] == "rm"]
    assert removals == [("docker", "image", "rm", "gnosi-frontend:ci")]
    assert waits.call_count == int(absent_after_wait)


def test_image_removal_retries_a_timeout_when_tag_remains(monkeypatch: pytest.MonkeyPatch) -> None:
    present = CompletedProcess((), 0, stdout="sha256:synthetic\n")
    error = TimeoutExpired((), 60)
    runner = Mock(side_effect=[present, error, present, present, CompletedProcess((), 0)])
    waits = Mock()
    monkeypatch.setattr(prepare_docker_runner, "run", runner)
    monkeypatch.setattr(prepare_docker_runner, "sleep", waits)

    prepare_docker_runner._remove_ci_image("gnosi-frontend:ci")

    removals = [entry for entry in runner.call_args_list if entry.args[0][2] == "rm"]
    assert removals == [call(("docker", "image", "rm", "gnosi-frontend:ci"),
                             check=True, timeout=60)] * 2
    waits.assert_called_once_with(5.0)


def test_image_removal_still_fails_after_second_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    present = CompletedProcess((), 0, stdout="sha256:synthetic\n")
    error = TimeoutExpired((), 60)
    runner = Mock(side_effect=[present, error, present, present, error, present])
    waits = Mock()
    monkeypatch.setattr(prepare_docker_runner, "run", runner)
    monkeypatch.setattr(prepare_docker_runner, "sleep", waits)

    with pytest.raises(TimeoutExpired) as caught:
        prepare_docker_runner._remove_ci_image("gnosi-frontend:ci")

    assert caught.value is error
    assert runner.call_count == 6
    waits.assert_called_once_with(5.0)


@pytest.mark.parametrize("inspection_error", [CalledProcessError(1, ()), TimeoutExpired((), 30)])
def test_image_removal_never_treats_failed_inspection_as_absence(
    monkeypatch: pytest.MonkeyPatch, inspection_error: Exception,
) -> None:
    runner = Mock(side_effect=[
        CompletedProcess((), 0, stdout="sha256:synthetic\n"),
        TimeoutExpired((), 60),
        inspection_error,
    ])
    waits = Mock()
    monkeypatch.setattr(prepare_docker_runner, "run", runner)
    monkeypatch.setattr(prepare_docker_runner, "sleep", waits)

    with pytest.raises(type(inspection_error)) as caught:
        prepare_docker_runner._remove_ci_image("gnosi-frontend:ci")

    assert caught.value is inspection_error
    waits.assert_not_called()


@pytest.mark.parametrize("failures", [1, 2])
def test_build_cache_cleanup_retries_only_completed_deadline_failures(
    monkeypatch: pytest.MonkeyPatch, failures: int,
) -> None:
    command = ("docker", "builder", "prune", "--all", "--force")
    error = CalledProcessError(1, command, stderr="error: context deadline exceeded\n")
    runner = Mock(side_effect=[error] * failures + [CompletedProcess(command, 0, stderr="")])
    waits: list[float] = []
    monkeypatch.setattr(prepare_docker_runner, "run", runner)
    monkeypatch.setattr(prepare_docker_runner, "sleep", waits.append)

    prepare_docker_runner._prune_build_cache()

    assert runner.call_count == failures + 1
    assert waits == [5.0] * failures
    for invocation in runner.call_args_list:
        assert invocation.args == (command,)
        assert invocation.kwargs["check"] is True
        assert invocation.kwargs["timeout"] == 120


def test_build_cache_cleanup_still_fails_after_three_deadlines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    error = CalledProcessError(1, (), stderr="context deadline exceeded")
    runner = Mock(side_effect=error)
    waits: list[float] = []
    monkeypatch.setattr(prepare_docker_runner, "run", runner)
    monkeypatch.setattr(prepare_docker_runner, "sleep", waits.append)

    with pytest.raises(CalledProcessError) as caught:
        prepare_docker_runner._prune_build_cache()

    assert caught.value is error
    assert runner.call_count == 3
    assert waits == [5.0, 5.0]


@pytest.mark.parametrize("error", [
    CalledProcessError(1, (), stderr="permission denied"),
    CalledProcessError(1, (), stderr="connection refused"),
    CalledProcessError(1, ()),
    TimeoutExpired((), 180),
    FileNotFoundError("docker"),
])
def test_build_cache_cleanup_never_retries_other_errors(
    monkeypatch: pytest.MonkeyPatch, error: Exception,
) -> None:
    runner = Mock(side_effect=error)
    waits: list[float] = []
    monkeypatch.setattr(prepare_docker_runner, "run", runner)
    monkeypatch.setattr(prepare_docker_runner, "sleep", waits.append)

    with pytest.raises(type(error)) as caught:
        prepare_docker_runner._prune_build_cache()

    assert caught.value is error
    assert runner.call_count == 1
    assert waits == []


def test_scoped_cleanup_removes_ci_images_before_unused_build_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(prepare_docker_runner, "_remove_ci_images", lambda: calls.append("images"))
    monkeypatch.setattr(prepare_docker_runner, "_prune_build_cache", lambda: calls.append("cache"))

    prepare_docker_runner._prune_unused_docker()

    assert calls == ["images", "cache"]


@pytest.mark.parametrize("available", [1, 12 * 1024**3])
def test_final_cleanup_always_runs_and_enforces_capacity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, available: int,
) -> None:
    prune = Mock()
    monkeypatch.setattr(prepare_docker_runner, "_prune_unused_docker", prune)
    monkeypatch.setattr(prepare_docker_runner, "_free_bytes", lambda _path: available)

    if available < prepare_docker_runner.MINIMUM_FREE_BYTES:
        with pytest.raises(RuntimeError, match="less than 12 GiB"):
            prepare_docker_runner.cleanup({"RUNNER_TEMP": str(tmp_path)})
    else:
        assert prepare_docker_runner.cleanup({"RUNNER_TEMP": str(tmp_path)}) == available
    prune.assert_called_once_with()


def test_cleanup_requires_valid_runner_temp_before_mutating(monkeypatch: pytest.MonkeyPatch) -> None:
    prune = Mock()
    monkeypatch.setattr(prepare_docker_runner, "_prune_unused_docker", prune)

    with pytest.raises(ValueError, match="RUNNER_TEMP"):
        prepare_docker_runner.cleanup({})

    prune.assert_not_called()
