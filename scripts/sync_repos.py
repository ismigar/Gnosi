"""Publish the allowlisted Gnosi source snapshot to its public repository."""

from __future__ import annotations

import argparse
import os
from pathlib import Path, PurePosixPath
import shlex
import shutil
import subprocess
import sys
from typing import Iterable, Sequence


PUBLIC_EXPORT_PATHS = (
    ".github",
    ".gitignore",
    "AGENTS.md",
    "LICENSE",
    "README.md",
    "apps/gnosi",
    "package-lock.json",
    "package.json",
    "packages",
    "tsconfig.json",
)

REQUIRED_PUBLIC_PATHS = (
    ".github/workflows",
    "apps/gnosi",
    "LICENSE",
    "README.md",
)

FORBIDDEN_PUBLIC_PATHS = (
    "apps/mcp-drupal-proxy",
    "apps/gnosi/frontend/vendor/zotero-reader",
    "apps/gnosi/pipeline/brain",
    "apps/gnosi/pipeline/private_skills",
    "apps/sandbox",
    "scripts",
    "temenos",
)


def run_cmd(
    cmd: Sequence[str],
    error_msg: str,
    *,
    cwd: Path,
    display_cmd: Sequence[str] | None = None,
    print_stdout: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run a command and stop publication after an unexpected failure."""
    print(f"Running: {shlex.join(display_cmd or cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.stdout and print_stdout:
        print(result.stdout)
    if result.returncode != 0:
        if result.stderr:
            print(f"STDERR: {result.stderr}")
        print(f"ERROR: {error_msg}")
        raise RuntimeError(error_msg)
    print("OK\n")
    return result


def get_remote_url(repo_path: str) -> str:
    """Return a tokenized CI URL or an SSH URL for local inspection."""
    pat = os.environ.get("SYNC_PAT", "")
    if pat:
        return f"https://x-access-token:{pat}@github.com/{repo_path}.git"
    return f"git@github.com:{repo_path}.git"


def ensure_remote(name: str, url: str, *, repo_root: Path) -> None:
    """Create or update the publication remote."""
    check = subprocess.run(
        ["git", "remote", "get-url", name],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )
    if check.returncode != 0:
        run_cmd(
            ["git", "remote", "add", name, url],
            f"Could not add remote {name}",
            cwd=repo_root,
            display_cmd=["git", "remote", "add", name, "[REDACTED]"],
        )
        return
    run_cmd(
        ["git", "remote", "set-url", name, url],
        f"Could not update remote {name}",
        cwd=repo_root,
        display_cmd=["git", "remote", "set-url", name, "[REDACTED]"],
    )


def _is_within(path: str, parent: str) -> bool:
    return path == parent or path.startswith(f"{parent}/")


def is_public_path(path: str) -> bool:
    """Return whether a public-root path is covered by the allowlist."""
    normalized = PurePosixPath(path).as_posix().removeprefix("./")
    return any(_is_within(normalized, allowed) for allowed in PUBLIC_EXPORT_PATHS)


def is_forbidden_public_path(path: str) -> bool:
    """Return whether a path is explicitly excluded from public snapshots."""
    normalized = PurePosixPath(path).as_posix().removeprefix("./")
    return any(
        _is_within(normalized, denied) for denied in FORBIDDEN_PUBLIC_PATHS
    )


def source_pathspecs() -> tuple[str, ...]:
    """Return the private-repository pathspecs allowed into the snapshot."""
    return tuple(f"monorepo/{path}" for path in PUBLIC_EXPORT_PATHS)


def existing_source_pathspecs(repo_root: Path, ref: str) -> tuple[str, ...]:
    """Return allowlisted source pathspecs that exist at the selected ref."""
    existing = []
    for pathspec in source_pathspecs():
        result = subprocess.run(
            ["git", "cat-file", "-e", f"{ref}:{pathspec}"],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            existing.append(pathspec)
    return tuple(existing)


def public_manifest_from_source_paths(source_paths: Iterable[str]) -> tuple[str, ...]:
    """Map allowlisted `monorepo` paths to their public-root locations."""
    prefix = "monorepo/"
    manifest = []
    for source_path in source_paths:
        normalized = PurePosixPath(source_path).as_posix().removeprefix("./")
        if not normalized.startswith(prefix):
            continue
        public_path = normalized[len(prefix) :]
        if is_public_path(public_path) and not is_forbidden_public_path(public_path):
            manifest.append(public_path)
    return tuple(sorted(set(manifest)))


def validate_public_manifest(paths: Iterable[str]) -> tuple[str, ...]:
    """Validate that a manifest contains only the explicit public surface."""
    manifest = tuple(
        sorted(
            {
                PurePosixPath(path).as_posix().removeprefix("./")
                for path in paths
                if path
            }
        )
    )
    unexpected = [path for path in manifest if not is_public_path(path)]
    forbidden = [path for path in manifest if is_forbidden_public_path(path)]
    missing = [
        required
        for required in REQUIRED_PUBLIC_PATHS
        if not any(_is_within(path, required) for path in manifest)
    ]
    errors = []
    if unexpected:
        errors.append(f"unexpected paths: {', '.join(unexpected[:10])}")
    if forbidden:
        errors.append(f"forbidden paths: {', '.join(forbidden[:10])}")
    if missing:
        errors.append(f"missing required paths: {', '.join(missing)}")
    if errors:
        raise ValueError("Invalid public manifest; " + "; ".join(errors))
    return manifest


def read_source_manifest(repo_root: Path, ref: str) -> tuple[str, ...]:
    """Read and validate the source manifest selected from a Git ref."""
    result = run_cmd(
        ["git", "ls-tree", "-r", "--name-only", ref, "--", *source_pathspecs()],
        f"Could not inspect public source paths at {ref}",
        cwd=repo_root,
        print_stdout=False,
    )
    return validate_public_manifest(
        public_manifest_from_source_paths(result.stdout.splitlines())
    )


def read_staged_manifest(repo_root: Path) -> tuple[str, ...]:
    """Read the exact file manifest staged for the orphan snapshot."""
    result = run_cmd(
        ["git", "ls-files", "-z"],
        "Could not inspect the staged public snapshot",
        cwd=repo_root,
        print_stdout=False,
    )
    return validate_public_manifest(result.stdout.split("\0"))


def promote_monorepo_snapshot(repo_root: Path) -> None:
    """Move the checked-out allowlist from `monorepo` to the public root."""
    source_root = repo_root / "monorepo"
    if not source_root.is_dir():
        raise RuntimeError("The checked-out monorepo export directory is missing")
    for source in source_root.iterdir():
        destination = repo_root / source.name
        if destination.exists():
            raise RuntimeError(f"Public destination already exists: {destination}")
        shutil.move(str(source), destination)
    source_root.rmdir()


def prepare_public_snapshot(repo_root: Path, ref: str = "main") -> tuple[str, ...]:
    """Prepare and validate an orphan snapshot without committing or pushing it."""
    expected_manifest = read_source_manifest(repo_root, ref)
    checkout_pathspecs = existing_source_pathspecs(repo_root, ref)
    if not checkout_pathspecs:
        raise RuntimeError(f"No allowlisted public source paths exist at {ref}")
    run_cmd(
        ["git", "checkout", "--orphan", "sync-gnosi-tmp"],
        "Could not create the orphan publication branch",
        cwd=repo_root,
    )
    run_cmd(
        ["git", "rm", "-rf", ".", "--quiet"],
        "Could not clear the isolated publication branch",
        cwd=repo_root,
    )
    run_cmd(
        ["git", "checkout", ref, "--", *checkout_pathspecs],
        "Could not check out the allowlisted Gnosi sources",
        cwd=repo_root,
    )
    promote_monorepo_snapshot(repo_root)
    run_cmd(["git", "add", "."], "Could not stage the public snapshot", cwd=repo_root)

    staged_manifest = read_staged_manifest(repo_root)
    if staged_manifest != expected_manifest:
        missing = sorted(set(expected_manifest) - set(staged_manifest))
        unexpected = sorted(set(staged_manifest) - set(expected_manifest))
        raise RuntimeError(
            "Staged public snapshot differs from the preflight manifest; "
            f"missing={missing[:10]}, unexpected={unexpected[:10]}"
        )
    return staged_manifest


def publish(repo_root: Path) -> None:
    """Build and force-push the isolated public Gnosi snapshot."""
    print("Synchronizing Projectes to the public Gnosi repository\n")
    ensure_remote("gnosi", get_remote_url("ismigar/Gnosi"), repo_root=repo_root)
    prepare_public_snapshot(repo_root)

    run_cmd(
        ["git", "commit", "-m", "Sync from Projectes"],
        "Could not commit the public snapshot",
        cwd=repo_root,
    )
    run_cmd(
        ["git", "push", "gnosi", "sync-gnosi-tmp:main", "--force"],
        "Could not push the public Gnosi snapshot",
        cwd=repo_root,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-ref",
        metavar="REF",
        help="Validate the public manifest for REF without modifying the repository",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path(__file__).resolve().parent.parent
    if args.check_ref:
        manifest = read_source_manifest(repo_root, args.check_ref)
        print(f"Validated {len(manifest)} public paths from {args.check_ref}")
        return 0

    if os.environ.get("GITHUB_ACTIONS") != "true":
        print("Publication is restricted to an isolated GitHub Actions checkout.")
        print("Use --check-ref HEAD for a read-only local validation.")
        return 0

    publish(repo_root)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
