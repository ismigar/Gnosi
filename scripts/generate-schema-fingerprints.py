#!/usr/bin/env python3
"""Generate synthetic fingerprints by applying every Alembic revision."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.migrations.families import FAMILIES
from backend.migrations.runner import _run_alembic
from backend.migrations.schema_audit import database_fingerprint


REVIEWED_VARIANT_FINGERPRINTS = {
    ("vault", "vault_0001"): (
        "40c728fccb59d6f02a0590d7c86ba4ce6b78f20ea720fc17545c78b979d919cb",
    ),
}


def generate() -> dict[str, object]:
    families: dict[str, object] = {}
    with tempfile.TemporaryDirectory(prefix="gnosi-schema-fingerprints-") as raw_dir:
        root = Path(raw_dir)
        for family in FAMILIES.values():
            revisions: dict[str, list[str]] = {}
            for revision in family.revisions:
                path = root / f"{family.name}-{revision}.sqlite"
                _run_alembic(path, "upgrade", revision)
                revisions[revision] = [
                    database_fingerprint(path),
                    *REVIEWED_VARIANT_FINGERPRINTS.get(
                        (family.name, revision),
                        (),
                    ),
                ]
            families[family.name] = {
                "branch": family.branch,
                "head": family.head,
                "revisions": revisions,
            }
    return {"format": "gnosi-schema-fingerprints-v1", "families": families}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.dumps(generate(), indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
