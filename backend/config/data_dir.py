"""Canonical per-device data directory resolution for Gnosi 3.x."""

from __future__ import annotations

import os
import platform
import warnings
from collections.abc import Mapping, MutableMapping
from pathlib import Path


_legacy_warning_emitted = False


def is_docker_runtime(environ: Mapping[str, str] | None = None) -> bool:
    """Return whether the current process is running in a container."""
    env = os.environ if environ is None else environ
    return Path("/.dockerenv").exists() or bool(env.get("DOCKER_CONTAINER"))


def default_data_dir(
    *,
    system_name: str | None = None,
    environ: Mapping[str, str] | None = None,
    home: Path | None = None,
    docker: bool | None = None,
) -> Path:
    """Return the platform-native Gnosi data directory without creating it."""
    env = os.environ if environ is None else environ
    in_docker = docker if docker is not None else is_docker_runtime(env)
    if in_docker:
        return Path("/data")

    system = system_name or platform.system()
    user_home = (home or Path.home()).expanduser()
    if system == "Darwin":
        return user_home / "Library" / "Application Support" / "Gnosi"
    if system == "Windows":
        appdata = env.get("APPDATA")
        if appdata:
            return Path(appdata).expanduser() / "Gnosi"
        return user_home / "AppData" / "Roaming" / "Gnosi"

    xdg_data_home = env.get("XDG_DATA_HOME")
    base = Path(xdg_data_home).expanduser() if xdg_data_home else user_home / ".local" / "share"
    return base / "gnosi"


def resolve_data_dir(
    *,
    environ: MutableMapping[str, str] | None = None,
    system_name: str | None = None,
    home: Path | None = None,
    docker: bool | None = None,
    create: bool = False,
    warn_deprecated: bool = True,
) -> Path:
    """Resolve `GNOSI_DATA_DIR`, retaining the 3.x legacy alias."""
    global _legacy_warning_emitted

    env = os.environ if environ is None else environ
    configured = env.get("GNOSI_DATA_DIR")
    legacy_name = None
    if not configured:
        for candidate in ("GNOSI_LOCAL_DATA", "LOCAL_DATA_DIR"):
            if env.get(candidate):
                configured = env[candidate]
                legacy_name = candidate
                break

    path = (
        Path(configured).expanduser()
        if configured
        else default_data_dir(
            system_name=system_name,
            environ=env,
            home=home,
            docker=docker,
        )
    )
    if not path.is_absolute():
        path = Path.cwd() / path
    path = Path(os.path.abspath(path))

    if legacy_name:
        env["GNOSI_DATA_DIR"] = str(path)
        if warn_deprecated and not _legacy_warning_emitted:
            warnings.warn(
                f"{legacy_name} is deprecated; configure GNOSI_DATA_DIR instead. "
                "The alias remains supported throughout Gnosi 3.x.",
                FutureWarning,
                stacklevel=2,
            )
            _legacy_warning_emitted = True

    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def reset_data_dir_warning_for_tests() -> None:
    """Reset process-wide warning state for isolated unit tests."""
    global _legacy_warning_emitted
    _legacy_warning_emitted = False
