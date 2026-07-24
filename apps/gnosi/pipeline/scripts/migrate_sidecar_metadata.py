"""Idempotent migration: moves internal flags (`*_manual`, `is_template`,
`is_default_template`) from the `.md` frontmatter to the corresponding JSON sidecar at
`<vault>/.gnosi/page_meta/<id>.json`.

See `docs/dev_memory/directives/sidecar_internal_metadata.md`.

Usage:

    cd ~/Projectes/monorepo/apps/gnosi
    DIGITAL_BRAIN_VAULT_PATH=/path/vault \\
        python -m pipeline.scripts.migrate_sidecar_metadata --dry-run
    DIGITAL_BRAIN_VAULT_PATH=/path/vault \\
        python -m pipeline.scripts.migrate_sidecar_metadata

The traversal skips `.gnosi/`, `local_data/`, `.trash/`, and any hidden
folder starting with `.`. It's safe to run it multiple times: it only
rewrites pages that still contain internal flags in the frontmatter.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable, Tuple

import yaml


# Allows running as a standalone script (without `python -m`).
_HERE = Path(__file__).resolve()
_ROOT = _HERE.parents[3]  # .../monorepo/apps/gnosi
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.services.page_sidecar import (  # noqa: E402
    is_sidecar_key,
    split_metadata,
    write_sidecar,
)
from backend.utils.safe_io import safe_write_text  # noqa: E402


# Folders to skip (recursively).
SKIP_DIRS = {".gnosi", "local_data", ".trash", ".git"}

# Frontmatter regex (same as vault_routes.parse_frontmatter, to avoid
# circular dependency with the full backend).
_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def find_vault_root(start: Path) -> Path:
    """Searches for `.gnosi/` walking up from start; returns the first ancestor that
    contains it, or start itself if it's already the vault root."""
    current = start.resolve()
    if (current / ".gnosi").is_dir():
        return current
    while current != current.parent:
        if (current / ".gnosi").is_dir():
            return current
        current = current.parent
    raise SystemExit(
        f"No s'ha trobat `.gnosi/` partint de {start}. "
        f"Defineix DIGITAL_BRAIN_VAULT_PATH a l'arrel del vault."
    )


def iter_markdown_files(vault_root: Path) -> Iterable[Path]:
    """Generator over all `.md` files in the vault, excluding internal folders."""
    for path in vault_root.rglob("*.md"):
        rel = path.relative_to(vault_root)
        if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts[:-1]):
            continue
        yield path


def parse_frontmatter_raw(content: str) -> Tuple[dict, str]:
    """Simplified version — does NOT merge the sidecar (we're migrating toward the sidecar)."""
    m = _FM_RE.match(content)
    if not m:
        return {}, content
    try:
        meta = yaml.safe_load(m.group(1)) or {}
        if not isinstance(meta, dict):
            return {}, content
        return meta, content[m.end():]
    except yaml.YAMLError:
        return {}, content


def render_frontmatter(metadata: dict) -> str:
    if not metadata:
        return "---\n---\n"
    yaml_str = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    return f"---\n{yaml_str}---\n"


def migrate_file(path: Path, vault_root: Path, dry_run: bool) -> str:
    """Returns: 'no-frontmatter' | 'no-id' | 'clean' | 'migrated' | 'error:<msg>'."""
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return f"error:read:{exc}"

    metadata, body = parse_frontmatter_raw(raw)
    if not metadata:
        return "no-frontmatter"

    has_sidecar_keys = any(is_sidecar_key(k) for k in metadata.keys())
    if not has_sidecar_keys:
        return "clean"

    page_id = metadata.get("id")
    if not page_id:
        # Without a stable id we can't create a sidecar. We leave it as is and
        # report it so the user can resolve it manually.
        return "no-id"

    fm_meta, sc_meta = split_metadata(metadata)

    if dry_run:
        return "migrated"

    try:
        write_sidecar(vault_root, str(page_id), sc_meta)
    except Exception as exc:  # noqa: BLE001
        return f"error:sidecar:{exc}"

    new_content = f"{render_frontmatter(fm_meta)}\n{body.lstrip()}"
    try:
        safe_write_text(path, new_content)
    except Exception as exc:  # noqa: BLE001
        return f"error:write:{exc}"
    return "migrated"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migra flags internes del frontmatter al sidecar JSON."
    )
    parser.add_argument(
        "--vault",
        type=Path,
        default=None,
        help="Ruta del vault. Per defecte: $DIGITAL_BRAIN_VAULT_PATH.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No modifica fitxers; només reporta el que faria.",
    )
    args = parser.parse_args()

    vault_arg = args.vault or os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    if not vault_arg:
        print(
            "Defineix --vault o DIGITAL_BRAIN_VAULT_PATH",
            file=sys.stderr,
        )
        return 2

    vault_root = find_vault_root(Path(vault_arg))
    print(f"Vault root: {vault_root}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'WRITE'}")

    counters = {
        "scanned": 0,
        "clean": 0,
        "migrated": 0,
        "no-frontmatter": 0,
        "no-id": 0,
        "errors": 0,
    }
    no_id_paths: list[Path] = []
    error_paths: list[Tuple[Path, str]] = []

    for path in iter_markdown_files(vault_root):
        counters["scanned"] += 1
        result = migrate_file(path, vault_root, args.dry_run)
        if result == "clean":
            counters["clean"] += 1
        elif result == "migrated":
            counters["migrated"] += 1
        elif result == "no-frontmatter":
            counters["no-frontmatter"] += 1
        elif result == "no-id":
            counters["no-id"] += 1
            no_id_paths.append(path)
        else:
            counters["errors"] += 1
            error_paths.append((path, result))

    print("\n— Resum —")
    for k in ("scanned", "clean", "migrated", "no-frontmatter", "no-id", "errors"):
        print(f"  {k:>16}: {counters[k]}")

    if no_id_paths:
        print("\nPàgines sense `id` al frontmatter (no migrades):")
        for p in no_id_paths[:20]:
            print(f"  - {p}")
        if len(no_id_paths) > 20:
            print(f"  … i {len(no_id_paths) - 20} més")

    if error_paths:
        print("\nErrors:")
        for p, msg in error_paths[:20]:
            print(f"  - {p}: {msg}")
        if len(error_paths) > 20:
            print(f"  … i {len(error_paths) - 20} més")

    return 0 if counters["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
