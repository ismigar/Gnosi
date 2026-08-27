#!/usr/bin/env python3
"""Validate local and GitHub prerequisites before a Gnosi release build."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib
from datetime import datetime, timedelta, timezone


REQUIRED_NODE = "22.22.2"
REQUIRED_RUNNERS = {
    ("macOS", "ARM64"),
    ("macOS", "X64"),
    ("Linux", "ARM64"),
    ("Windows", "X64"),
}
ACTIVE_RUN_STATES = {"queued", "in_progress", "waiting", "pending"}


def run_json(command: list[str]) -> object:
    """Run a command and decode its JSON output."""
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def read_json(path: Path) -> dict:
    """Read a JSON object from disk."""
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--github-repo", default="ismigar/Gnosi")
    return parser.parse_args()


def main() -> int:
    """Run all release gates and persist a machine-readable report."""
    args = parse_args()
    root = args.repo_root.resolve()
    errors: list[str] = []
    warnings: list[str] = []
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        errors.append(f"Invalid version: {args.version}")

    app_root = root
    manifests = [
        app_root / "package.json",
        app_root / "frontend/package.json",
        app_root / "desktop/package.json",
    ]
    versions: dict[str, str | None] = {}
    for path in manifests:
        versions[str(path.relative_to(root))] = read_json(path).get("version")
    with (root / "pyproject.toml").open("rb") as handle:
        versions["pyproject.toml"] = tomllib.load(handle).get("project", {}).get("version")
    for path, version in versions.items():
        if version != args.version:
            errors.append(f"Version mismatch in {path}: {version!r} != {args.version!r}")

    workflow_path = root / ".github/workflows/build-release.yml"
    workflow = workflow_path.read_text(encoding="utf-8")
    node_versions = re.findall(r"node-version:\s*['\"]?([^'\"\s]+)", workflow)
    if not node_versions or any(version != REQUIRED_NODE for version in node_versions):
        errors.append(f"Workflow Node versions must all be {REQUIRED_NODE}: {node_versions}")
    if "concurrency:" not in workflow:
        errors.append("Workflow has no release concurrency guard")
    if "max-parallel: 1" not in workflow:
        errors.append("macOS matrix must run one architecture at a time")
    windows_job = workflow.split("  build-windows:", 1)[-1].split("\n  release:", 1)[0]
    if not any("build-macos" in line for line in windows_job.splitlines()[0:5]):
        errors.append("Windows build must wait for all macOS builds")
    if "pnpm install --frozen-lockfile" not in workflow:
        errors.append("Release workflow must use the frozen pnpm lock")

    runners_payload = run_json(["gh", "api", f"repos/{args.github_repo}/actions/runners", "--paginate"])
    runners = runners_payload.get("runners", []) if isinstance(runners_payload, dict) else []
    runner_states: list[dict] = []
    available_labels: set[tuple[str, str]] = set()
    for runner in runners:
        labels = {label["name"] for label in runner.get("labels", [])}
        runner_states.append({
            "name": runner.get("name"),
            "status": runner.get("status"),
            "busy": runner.get("busy"),
            "labels": sorted(labels),
        })
        for os_name, arch in REQUIRED_RUNNERS:
            if {"self-hosted", os_name, arch}.issubset(labels):
                if runner.get("status") == "online" and not runner.get("busy"):
                    available_labels.add((os_name, arch))
                else:
                    errors.append(f"Required runner is unavailable: {runner.get('name')}")
    missing = REQUIRED_RUNNERS - available_labels
    if missing:
        errors.append(f"Missing free runners: {sorted(missing)}")

    runs = run_json([
        "gh", "run", "list", "--repo", args.github_repo, "--limit", "50",
        "--json", "databaseId,status,workflowName,url,updatedAt",
    ])
    stale_before = datetime.now(timezone.utc) - timedelta(hours=2)
    release_candidates = [run for run in runs if run.get("workflowName") == "Build and Release"]
    active_releases = []
    stale_releases = []
    for run in release_candidates:
        if run.get("status") not in ACTIVE_RUN_STATES:
            continue
        updated_at = datetime.fromisoformat(run["updatedAt"].replace("Z", "+00:00"))
        if run.get("status") == "queued" and updated_at < stale_before:
            stale_releases.append(run)
        else:
            active_releases.append(run)
    if active_releases:
        errors.append(f"Active release runs detected: {[run['databaseId'] for run in active_releases]}")
    if stale_releases:
        warnings.append(f"Stale GitHub run records ignored: {[run['databaseId'] for run in stale_releases]}")

    disk = shutil.disk_usage(root)
    free_gib = round(disk.free / 1024**3, 2)
    if free_gib < 25:
        errors.append(f"Insufficient local disk: {free_gib} GiB free")

    report = {
        "ok": not errors,
        "version": args.version,
        "versions": versions,
        "workflow_node_versions": node_versions,
        "runners": runner_states,
        "active_release_runs": active_releases,
        "local_free_gib": free_gib,
        "warnings": warnings,
        "errors": errors,
    }
    output_path = root / ".tmp/release-preflight.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
