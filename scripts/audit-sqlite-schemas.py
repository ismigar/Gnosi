#!/usr/bin/env python3
"""Command-line entry point for Gnosi's data-free SQLite schema auditor."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.migrations.schema_audit import main


if __name__ == "__main__":
    raise SystemExit(main())
