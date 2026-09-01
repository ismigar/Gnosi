#!/usr/bin/env python3
"""Explicit migration of legacy references JSON; reports never include its contents."""

from __future__ import annotations

import argparse
import json
import sys
from logging import getLogger as get_logger
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

log = get_logger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "migrate", "status", "rollback"))
    parser.add_argument("source", help="Absolute path to the preserved legacy JSON")
    parser.add_argument("data_dir", help="Absolute GNOSI_DATA_DIR path")
    parser.add_argument("--writers-stopped", action="store_true")
    args = parser.parse_args(argv)
    from backend.services.reference_config_migration import (
        migrate_reference_config,
        plan_reference_migration,
        reference_migration_status,
        rollback_reference_migration,
    )
    from backend.services.reference_migration_io import ReferenceMigrationError

    try:
        if args.command == "plan":
            result = plan_reference_migration(args.source, args.data_dir)
        elif args.command == "migrate":
            result = migrate_reference_config(
                args.source,
                args.data_dir,
                writers_stopped=args.writers_stopped,
            )
        elif args.command == "rollback":
            result = rollback_reference_migration(
                args.source,
                args.data_dir,
                writers_stopped=args.writers_stopped,
            )
        else:
            result = reference_migration_status(args.source, args.data_dir)
    except ReferenceMigrationError as error:
        log.error("%s", error)
        return 1
    except OSError:
        log.error("Migration filesystem operation failed; preserve files and inspect permissions")
        return 1
    sys.stdout.write(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
