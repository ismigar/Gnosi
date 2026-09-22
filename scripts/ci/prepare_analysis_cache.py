"""Persist only analyzer results, scoped by platform, tools, and configuration."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import platform
import shutil
from typing import Mapping


def prepare(environment: Mapping[str, str], project: Path) -> dict[str, str]:
    root = Path(environment["RUNNER_TOOL_CACHE"]).resolve(strict=True) / "gnosi-analysis-v1"
    if root.is_symlink():
        raise ValueError("Analyzer cache root must not be a symlink")
    root.mkdir(exist_ok=True)
    identity = hashlib.sha256(f"{platform.system()}:{platform.machine()}".encode())
    for name in ("uv.lock", "pnpm-lock.yaml", "pyproject.toml", "mypy.ini",
                 "frontend/eslint.config.js", "frontend/tsconfig.json"):
        path = project / name
        identity.update(name.encode())
        if path.is_file():
            identity.update(path.read_bytes())
    target = root / identity.hexdigest()
    if target.is_symlink():
        target.unlink()
    target.mkdir(exist_ok=True)
    target.touch()
    for child in (target / "mypy", target / "eslint"):
        if child.is_symlink():
            child.unlink()
    # Tool version changes invalidate both caches. Bound old versions on disk.
    others = sorted((p for p in root.iterdir() if p.is_dir() and p != target),
                    key=lambda p: p.stat().st_mtime, reverse=True)
    for old in others[1:]:
        if not old.is_symlink():
            shutil.rmtree(old)
    return {"MYPY_CACHE_DIR": str(target / "mypy"), "GNOSI_ESLINT_CACHE": str(target / "eslint")}


def main() -> None:
    values = prepare(os.environ, Path.cwd())
    with Path(os.environ["GITHUB_ENV"]).open("a") as stream:
        for name, value in values.items():
            stream.write(f"{name}={value}\n")


if __name__ == "__main__":
    main()
