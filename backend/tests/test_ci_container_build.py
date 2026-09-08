from __future__ import annotations

import json
from pathlib import Path
import subprocess
from typing import Sequence
from uuid import UUID

import pytest

from scripts.ci import build_container_image as build


REVISION = "a" * 40
BUILD_ID = "b" * 32
TAG = "gnosi-frontend:ci"


class Engine:
    """Model stale tags and failed operations without running container tools."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []
        self.labels: dict[str, str] | None = None
        self.build_status = 0
        self.install_image = True
        self.remove_status = 0
        self.list_status = 0
        self.inspect_status = 0
        self.revision = REVISION
        self.revision_status = 0
        self.inspection: str | None = None
        self.wrong_label: str | None = None

    def __call__(
        self, command: Sequence[str], *, check: bool, capture_output: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        args = tuple(command)
        self.calls.append(args)
        status, stdout = 0, ""
        if args[0] == "git":
            status, stdout = self.revision_status, self.revision + "\n"
        elif args[:3] == ("docker", "image", "ls"):
            status, stdout = self.list_status, "old-image\n" if self.labels else ""
        elif args[:3] == ("docker", "image", "rm"):
            status = self.remove_status
            if status == 0:
                self.labels = None
        elif args[:2] == ("docker", "build"):
            status = self.build_status
            if self.install_image:
                self.labels = dict(
                    args[index + 1].split("=", 1)
                    for index, value in enumerate(args) if value == "--label"
                )
                if self.wrong_label:
                    self.labels[self.wrong_label] = "wrong"
        elif args[:3] == ("docker", "image", "inspect"):
            status = self.inspect_status or (1 if self.labels is None else 0)
            stdout = self.inspection if self.inspection is not None else json.dumps(
                [{"Config": {"Labels": self.labels}}]
            )
        else:
            raise AssertionError(f"Unexpected command: {args}")
        if check and status:
            raise subprocess.CalledProcessError(status, args, output=stdout)
        return subprocess.CompletedProcess(args, status, stdout=stdout)


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> Engine:
    instance = Engine()
    monkeypatch.setattr(build, "_run", instance)
    monkeypatch.setattr(build, "uuid4", lambda: UUID(hex=BUILD_ID))
    return instance


def invoke(tmp_path: Path, tag: str = TAG) -> None:
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text("FROM scratch\n", encoding="utf-8")
    build.build_image(dockerfile=dockerfile, tag=tag, context=tmp_path)


def test_successful_build_verifies_revision_and_unique_build_id(
    engine: Engine, tmp_path: Path,
) -> None:
    invoke(tmp_path)
    assert engine.labels == {build.REVISION_LABEL: REVISION, build.BUILD_LABEL: BUILD_ID}
    assert engine.calls[-1] == ("docker", "image", "inspect", TAG)
    assert not any(call[:3] == ("docker", "image", "rm") for call in engine.calls)


def test_old_tag_is_removed_without_forcing_in_use_images(engine: Engine, tmp_path: Path) -> None:
    engine.labels = {build.BUILD_LABEL: "previous-build"}
    invoke(tmp_path)
    assert ("docker", "image", "rm", TAG) in engine.calls
    assert all("--force" not in call for call in engine.calls)


def test_failed_removal_and_build_cannot_reuse_an_old_tag(engine: Engine, tmp_path: Path) -> None:
    engine.labels = {build.REVISION_LABEL: REVISION, build.BUILD_LABEL: "previous-build"}
    engine.remove_status = 17
    engine.build_status = 23
    engine.install_image = False
    with pytest.raises(subprocess.CalledProcessError) as error:
        invoke(tmp_path)
    assert error.value.returncode == 17
    assert not any(call[:2] == ("docker", "build") for call in engine.calls)


def test_failed_image_listing_cannot_be_treated_as_absence(engine: Engine, tmp_path: Path) -> None:
    engine.list_status = 19
    with pytest.raises(subprocess.CalledProcessError) as error:
        invoke(tmp_path)
    assert error.value.returncode == 19
    assert not any(call[:2] == ("docker", "build") for call in engine.calls)


def test_post_load_failure_requires_matching_new_image(engine: Engine, tmp_path: Path) -> None:
    engine.build_status = 23
    invoke(tmp_path)
    assert engine.labels == {build.REVISION_LABEL: REVISION, build.BUILD_LABEL: BUILD_ID}


def test_two_builds_of_the_same_revision_have_distinct_identifiers(
    engine: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    identifiers = iter([UUID(hex=BUILD_ID), UUID(hex="c" * 32)])
    monkeypatch.setattr(build, "uuid4", lambda: next(identifiers))
    invoke(tmp_path)
    first = engine.labels
    invoke(tmp_path)
    assert first == {build.REVISION_LABEL: REVISION, build.BUILD_LABEL: BUILD_ID}
    assert engine.labels == {build.REVISION_LABEL: REVISION, build.BUILD_LABEL: "c" * 32}


def test_failed_build_without_new_image_propagates_original_status(
    engine: Engine, tmp_path: Path,
) -> None:
    engine.build_status = 23
    engine.install_image = False
    with pytest.raises(subprocess.CalledProcessError) as error:
        invoke(tmp_path)
    assert error.value.returncode == 23


@pytest.mark.parametrize("label", [build.REVISION_LABEL, build.BUILD_LABEL])
@pytest.mark.parametrize("status", [0, 23])
def test_wrong_revision_or_nonce_is_rejected_even_after_exit_zero(
    engine: Engine, tmp_path: Path, label: str, status: int,
) -> None:
    engine.wrong_label = label
    engine.build_status = status
    with pytest.raises((RuntimeError, subprocess.CalledProcessError)):
        invoke(tmp_path)


@pytest.mark.parametrize("payload", [
    "not-json", "null", "{}", "[]", "[{}, {}]", "[null]", "[{}]",
    '[{"Config": null}]', '[{"Config": {"Labels": null}}]',
    '[{"Config": {"Labels": {}}}]',
])
def test_missing_or_malformed_metadata_is_never_accepted(
    engine: Engine, tmp_path: Path, payload: str,
) -> None:
    engine.inspection = payload
    with pytest.raises((ValueError, RuntimeError)):
        invoke(tmp_path)


@pytest.mark.parametrize("status", [0, 23])
def test_failed_inspection_preserves_failure(engine: Engine, tmp_path: Path, status: int) -> None:
    engine.inspect_status = 19
    engine.build_status = status
    with pytest.raises(subprocess.CalledProcessError) as error:
        invoke(tmp_path)
    assert error.value.returncode == (status or 19)


@pytest.mark.parametrize("status", [0, 23])
def test_inspection_timeout_never_recovers_a_build(
    engine: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: int,
) -> None:
    engine.build_status = status

    def run(
        command: Sequence[str], *, check: bool, capture_output: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        if tuple(command)[:3] == ("docker", "image", "inspect"):
            raise subprocess.TimeoutExpired(command, 60)
        return engine(command, check=check, capture_output=capture_output)

    monkeypatch.setattr(build, "_run", run)
    with pytest.raises((subprocess.CalledProcessError, subprocess.TimeoutExpired)):
        invoke(tmp_path)


@pytest.mark.parametrize("revision", ["", "main", "a" * 39, "a" * 41, "bad\nrevision"])
def test_invalid_revision_stops_before_docker(engine: Engine, tmp_path: Path, revision: str) -> None:
    engine.revision = revision
    with pytest.raises(RuntimeError, match="Git revision"):
        invoke(tmp_path)
    assert len(engine.calls) == 1


def test_failed_git_lookup_stops_before_docker(engine: Engine, tmp_path: Path) -> None:
    engine.revision_status = 128
    with pytest.raises(subprocess.CalledProcessError):
        invoke(tmp_path)
    assert len(engine.calls) == 1


@pytest.mark.parametrize("tag", ["", "bad tag", "bad\ntag", "--all"])
def test_invalid_tag_is_rejected_before_running_commands(
    engine: Engine, tmp_path: Path, tag: str,
) -> None:
    with pytest.raises(ValueError, match="Image tag"):
        invoke(tmp_path, tag)
    assert engine.calls == []


def test_invalid_paths_are_rejected_before_running_commands(engine: Engine, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Dockerfile"):
        build.build_image(dockerfile=tmp_path / "missing", tag=TAG, context=tmp_path)
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.touch()
    with pytest.raises(ValueError, match="context"):
        build.build_image(dockerfile=dockerfile, tag=TAG, context=tmp_path / "missing")
    assert engine.calls == []
