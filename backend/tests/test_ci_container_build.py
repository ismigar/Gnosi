from __future__ import annotations

from pathlib import Path
import subprocess
from typing import Sequence

import pytest

from scripts.ci import build_container_image


class CommandRunner:
    def __init__(self, return_codes: Sequence[int]) -> None:
        self._return_codes = iter(return_codes)
        self.calls: list[tuple[tuple[str, ...], bool]] = []

    def __call__(
        self, command: Sequence[str], *, check: bool
    ) -> subprocess.CompletedProcess[bytes]:
        normalized = tuple(command)
        self.calls.append((normalized, check))
        return subprocess.CompletedProcess(normalized, next(self._return_codes))


def inputs(tmp_path: Path) -> tuple[Path, Path]:
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text("FROM scratch\n", encoding="utf-8")
    return dockerfile, tmp_path


def test_successful_build_removes_stale_tag_first(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dockerfile, context = inputs(tmp_path)
    runner = CommandRunner((0, 0))
    monkeypatch.setattr(build_container_image, "_run", runner)

    build_container_image.build_image(
        dockerfile=dockerfile, tag="gnosi-frontend:ci", context=context
    )

    assert runner.calls[0] == (
        ("docker", "image", "rm", "--force", "gnosi-frontend:ci"),
        False,
    )
    assert runner.calls[1][0][:2] == ("docker", "build")


def test_post_load_failure_requires_new_image(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dockerfile, context = inputs(tmp_path)
    runner = CommandRunner((0, 1, 0))
    monkeypatch.setattr(build_container_image, "_run", runner)

    build_container_image.build_image(
        dockerfile=dockerfile, tag="gnosi-frontend:ci", context=context
    )

    assert runner.calls[-1] == (
        ("docker", "image", "inspect", "gnosi-frontend:ci"),
        False,
    )


def test_failed_build_without_new_image_propagates_original_status(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dockerfile, context = inputs(tmp_path)
    runner = CommandRunner((0, 23, 1))
    monkeypatch.setattr(build_container_image, "_run", runner)

    with pytest.raises(subprocess.CalledProcessError) as error:
        build_container_image.build_image(
            dockerfile=dockerfile, tag="gnosi-backend:ci", context=context
        )

    assert error.value.returncode == 23


@pytest.mark.parametrize("tag", ("", "bad tag", "bad\ntag"))
def test_invalid_tag_is_rejected_before_running_commands(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tag: str
) -> None:
    dockerfile, context = inputs(tmp_path)
    runner = CommandRunner(())
    monkeypatch.setattr(build_container_image, "_run", runner)

    with pytest.raises(ValueError, match="Image tag"):
        build_container_image.build_image(dockerfile=dockerfile, tag=tag, context=context)
    assert runner.calls == []
