#!/usr/bin/env python3
"""Plan, execute, inspect or roll back a Gnosi data-directory migration."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.services.data_dir_migration import (
    DataMigrationError,
    finalize_data_migration,
    load_migration_journal,
    migrate_data_dir,
    plan_data_migration,
    rollback_data_migration,
)


def parser() -> argparse.ArgumentParser:
    command_parser = argparse.ArgumentParser(description=__doc__)
    subcommands = command_parser.add_subparsers(dest="command", required=True)

    plan = subcommands.add_parser("plan")
    plan.add_argument("source")
    plan.add_argument("destination")
    plan.add_argument("--force-copy", action="store_true")

    migrate = subcommands.add_parser("migrate")
    migrate.add_argument("source")
    migrate.add_argument("destination")
    migrate.add_argument("--journal")
    migrate.add_argument("--force-copy", action="store_true")
    migrate.add_argument("--writers-stopped", action="store_true", required=True)

    rollback = subcommands.add_parser("rollback")
    rollback.add_argument("journal")
    rollback.add_argument("--writers-stopped", action="store_true", required=True)

    status = subcommands.add_parser("status")
    status.add_argument("journal")

    finalize = subcommands.add_parser("finalize")
    finalize.add_argument("journal")
    return command_parser


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "plan":
            result = plan_data_migration(
                args.source,
                args.destination,
                force_copy=args.force_copy,
            )
        elif args.command == "migrate":
            result = migrate_data_dir(
                args.source,
                args.destination,
                journal_path=args.journal,
                force_copy=args.force_copy,
                writers_stopped=args.writers_stopped,
            )
        elif args.command == "rollback":
            result = rollback_data_migration(args.journal, writers_stopped=args.writers_stopped)
        elif args.command == "finalize":
            result = finalize_data_migration(args.journal)
        else:
            result = load_migration_journal(args.journal)
    except (DataMigrationError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
