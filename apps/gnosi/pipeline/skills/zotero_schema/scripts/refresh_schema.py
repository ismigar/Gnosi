#!/usr/bin/env python3
"""Descarrega `schema.json` del repo zotero/zotero-schema i el desa pinned.

Manual, no s'executa en runtime ni en CI. Quan vols pujar la versió:

    python3 refresh_schema.py [--ref <branch|sha>]

Si no es passa `--ref`, baixa la versió actual de `master`. Acaba mostrant
el SHA del commit i la nova versió, perquè els puguis registrar al
`SKILL.md` i regenerar les constants amb `build_constants.py`.
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
    """Wrapper a `gh api` que retorna stdout o aborta amb stderr."""
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

    # Resol el SHA real del commit que toca schema.json
    commits = json.loads(gh([
        f"repos/{REPO}/commits?path=schema.json&sha={args.ref}&per_page=1",
    ]))
    if not commits:
        print(f"ERROR: cap commit trobat per ref={args.ref}", file=sys.stderr)
        return 1
    sha = commits[0]["sha"]
    date = commits[0]["commit"]["committer"]["date"]

    # Descarrega contingut a la versió pinned
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
