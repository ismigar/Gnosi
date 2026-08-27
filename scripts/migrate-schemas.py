#!/usr/bin/env python3
"""Migrate all existing Gnosi-owned SQLite stores with verified backups."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config.data_dir import resolve_data_dir
from backend.migrations.coordinator import (
    migrate_existing_databases,
    verify_existing_databases,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify heads and integrity without changing any database",
    )
    args = parser.parse_args()
    data_dir = (args.data_dir or resolve_data_dir()).expanduser().resolve()
    records = (
        verify_existing_databases(data_dir)
        if args.check
        else migrate_existing_databases(data_dir)
    )
    print(json.dumps(records, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
