#!/usr/bin/env python3
"""Verify the data-free Git evidence behind the Gnosi 2.x schema matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import TypedDict


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = (
    REPOSITORY_ROOT / "backend" / "migrations" / "gnosi_2x_schema_variants.json"
)


class ReleaseEvidence(TypedDict):
    commit: str
    ddl_blob_set_sha256: str


def _git(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", *arguments),
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _load_inventory() -> dict[str, object]:
    value = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("2.x schema inventory root must be an object")
    return value


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _strings(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{label} must be a list of strings")
    return value


def _source_paths(inventory: dict[str, object]) -> dict[str, list[str]]:
    sources = _object(inventory["ddl_sources"], "ddl_sources")
    return {
        family: _strings(raw_paths, f"ddl_sources.{family}")
        for family, raw_paths in sources.items()
    }


def _tag_evidence(
    tag: str,
    expected_commit: str,
    source_prefix: str,
    source_paths: dict[str, list[str]],
) -> tuple[ReleaseEvidence, dict[str, tuple[str, ...]]]:
    commit = _git("rev-parse", f"{tag}^{{commit}}")
    if commit != expected_commit:
        raise RuntimeError(f"{tag} resolves to {commit}, expected {expected_commit}")
    family_blobs: dict[str, tuple[str, ...]] = {}
    ordered_blobs: list[str] = []
    for family, paths in source_paths.items():
        blobs = tuple(
            _git("rev-parse", f"{tag}:{source_prefix}{source_file}")
            for source_file in paths
        )
        family_blobs[family] = blobs
        ordered_blobs.extend(blobs)
    digest = hashlib.sha256(
        "".join(f"{blob}\n" for blob in ordered_blobs).encode("ascii")
    ).hexdigest()
    return {"commit": commit, "ddl_blob_set_sha256": digest}, family_blobs


def audit() -> dict[str, object]:
    inventory = _load_inventory()
    release_groups = _object(inventory["release_groups"], "release_groups")
    source_paths = _source_paths(inventory)
    report: dict[str, ReleaseEvidence] = {}
    blobs_by_tag: dict[str, dict[str, tuple[str, ...]]] = {}

    for group_name, raw_group in release_groups.items():
        group = _object(raw_group, f"release_groups.{group_name}")
        tags = _object(group["tags"], f"release_groups.{group_name}.tags")
        source_prefix = group["source_prefix"]
        if not isinstance(source_prefix, str):
            raise ValueError(f"release_groups.{group_name}.source_prefix must be text")
        for tag, expected_commit in tags.items():
            if not isinstance(expected_commit, str):
                raise ValueError(f"release_groups.{group_name}.tags.{tag} must be text")
            evidence, blobs = _tag_evidence(
                tag, expected_commit, source_prefix, source_paths
            )
            report[tag] = evidence
            blobs_by_tag[tag] = blobs

    early_group = _object(
        release_groups["v2.0.0-v2.0.5"], "release_groups.v2.0.0-v2.0.5"
    )
    expected_digest = early_group["ddl_blob_set_sha256"]
    if not isinstance(expected_digest, str):
        raise ValueError("early release DDL digest must be text")
    for patch in range(6):
        tag = f"v2.0.{patch}"
        if report[tag]["ddl_blob_set_sha256"] != expected_digest:
            raise RuntimeError(f"{tag} no longer matches the reviewed DDL blob set")

    changed_families = sorted(
        family
        for family in source_paths
        if blobs_by_tag["v2.0.5"][family] != blobs_by_tag["v2.0.6"][family]
    )
    if changed_families != ["management"]:
        raise RuntimeError(
            "Expected only management DDL to differ in v2.0.6; found "
            + ", ".join(changed_families)
        )
    if _git("show", "-s", "--format=%P", "v2.0.6"):
        raise RuntimeError("v2.0.6 was reviewed as a parentless synchronized snapshot")

    return {
        "format": "gnosi-2x-schema-history-audit-v1",
        "tags": report,
        "v2.0.6_changed_families": changed_families,
        "v2.0.6_parentless_snapshot": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate silently instead of printing the data-free report.",
    )
    arguments = parser.parse_args()
    report = audit()
    if not arguments.check:
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
