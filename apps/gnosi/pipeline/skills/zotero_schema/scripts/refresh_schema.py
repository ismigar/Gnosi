#!/usr/bin/env python3
"""Downloads `schema.json` from the zotero/zotero-schema repo and saves it pinned.

Manual, not run at runtime or in CI. When you want to bump the version:

    python3 refresh_schema.py [--ref <branch|sha>]

If `--ref` isn't passed, it downloads the current version from `master`. It finishes by showing
the commit SHA and the new version, so you can record them in
`SKILL.md` and regenerate the constants with `build_constants.py`.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.json"
REPO = "zotero/zotero-schema"


def gh(cmd: list[str]) -> str:
    """Wrapper around `gh api` that returns stdout or aborts with stderr."""
    r = subprocess.run(["gh", "api", *cmd], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        print(f"ERROR gh api: {r.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return r.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ref", default="master",
                        help="Branch o SHA del commit (default: master)")
    args = parser.parse_args()

    # Resolves the actual SHA of the commit that touches schema.json
    commits = json.loads(gh([
        f"repos/{REPO}/commits?path=schema.json&sha={args.ref}&per_page=1",
    ]))
    if not commits:
        print(f"ERROR: cap commit trobat per ref={args.ref}", file=sys.stderr)
        return 1
    sha = commits[0]["sha"]
    date = commits[0]["commit"]["committer"]["date"]

    # Downloads content at the pinned version
    content_obj = json.loads(gh([f"repos/{REPO}/contents/schema.json?ref={sha}"]))
    import base64
    raw = base64.b64decode(content_obj["content"])
    SCHEMA_PATH.write_bytes(raw)

    schema = json.loads(raw)
    print(f"OK schema descarregat:")
    print(f"  Path:    {SCHEMA_PATH}")
    print(f"  Size:    {len(raw)} bytes")
    print(f"  Version: {schema.get('version')}")
    print(f"  Commit:  {sha} ({date})")
    print()
    print("Actualitza SKILL.md i regenera constants:")
    print("  python3 scripts/build_constants.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
