#!/usr/bin/env python3
"""Builds the remote index of OFFICIAL (signed) plugins for distribution.

Meant to run in the release pipeline (`build-release.yml`): it takes each plugin
folder, compresses it, computes its SHA-256, signs it with the official
private key (from the environment), and writes:

  <out>/<id>.zip            — each plugin's artifact
  <out>/plugins-index.json  — the index (list of `source:"url"` entries with
                              `url`, `sha256`, and `signature`)

This index is published as a release asset; the app consumes it via
`registry_url` (e.g. `.../releases/latest/download/plugins-index.json`) and
verifies each signature against the bundled `gnosi-official` key.

The private key is NEVER written to disk or to the repo: it arrives via the
`GNOSI_PLUGIN_SIGNING_KEY` environment variable (base64 of the raw Ed25519 key, like the one in the keyfile).
Official output fails closed if the key is absent or does not match the public
`gnosi-official` key bundled with the application. `--allow-unsigned` exists
only for disposable local fixtures that will never be published.

Depends only on `cryptography` (does not import Gnosi's backend).

Usage:
  GNOSI_PLUGIN_SIGNING_KEY=<b64> python build_index.py \
      --plugins-dir . --base-url https://github.com/ismigar/Gnosi/releases/latest/download \
      --out ./dist-plugins --include hello-command,clone-logger,vault-stats
"""
import argparse
import base64
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from extensions.marketplace.signing_policy import (
    OFFICIAL_PUBLIC_KEY_B64,
    load_official_private_key,
)


def _zip_dir(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, str(f.relative_to(src)))
    return buf.getvalue()


def _load_signer(*, allow_unsigned: bool, expected_public_key: str):
    """Return the official signer, or an explicitly requested local unsigned mode."""

    if allow_unsigned:
        return None
    priv = load_official_private_key(expected_public_key=expected_public_key)
    return lambda data: base64.b64encode(priv.sign(data)).decode()


def build(
    plugins_dir: Path,
    base_url: str,
    out: Path,
    include: list[str],
    *,
    allow_unsigned: bool = False,
    expected_public_key: str = OFFICIAL_PUBLIC_KEY_B64,
) -> dict:
    signer = _load_signer(
        allow_unsigned=allow_unsigned,
        expected_public_key=expected_public_key,
    )
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    for name in include:
        pdir = (plugins_dir / name).resolve()
        manifest_path = pdir / "manifest.json"
        if plugins_dir.resolve() not in pdir.parents or not manifest_path.exists():
            print(f"⚠️  s'omet {name}: no és un plugin vàlid", file=sys.stderr)
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        data = _zip_dir(pdir)
        (out / f"{name}.zip").write_bytes(data)
        entry = {
            "id": manifest["id"],
            "name": manifest.get("name", manifest["id"]),
            "description": manifest.get("description", ""),
            "icon": manifest.get("icon", "Puzzle"),
            "author": manifest.get("author", ""),
            "permissions": manifest.get("permissions", []),
            "source": "url",
            "url": f"{base_url.rstrip('/')}/{name}.zip",
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        if signer:
            entry["signature"] = signer(data)
        entries.append(entry)
        print(f"✅ {manifest['id']} ({len(data)} bytes){' [signat]' if signer else ' [SENSE signatura]'}",
              file=sys.stderr)

    index_path = out / "plugins-index.json"
    index_bytes = json.dumps(entries, indent=2, ensure_ascii=False).encode("utf-8")
    index_path.write_bytes(index_bytes)
    if signer:
        (out / "plugins-index.sig").write_text(signer(index_bytes), encoding="ascii")
    print(f"📦 índex escrit a {index_path} ({len(entries)} plugins, "
          f"{'signat' if signer else 'sense signatura'})", file=sys.stderr)
    return {"entries": entries, "index": str(index_path), "signed": bool(signer)}


def main() -> int:
    p = argparse.ArgumentParser(description="Construeix l'índex remot de plugins oficials.")
    p.add_argument("--plugins-dir", default=str(Path(__file__).parent))
    p.add_argument("--base-url", default="https://github.com/ismigar/Gnosi/releases/latest/download")
    p.add_argument("--out", default=str(Path(__file__).parent / "dist-plugins"))
    p.add_argument("--include", default="hello-command,clone-logger,vault-stats",
                   help="ids de plugins a incloure, separats per comes")
    p.add_argument(
        "--allow-unsigned",
        action="store_true",
        help="només per a artefactes locals no publicables; la release oficial falla sense clau",
    )
    args = p.parse_args()
    include = [s.strip() for s in args.include.split(",") if s.strip()]
    build(
        Path(args.plugins_dir),
        args.base_url,
        Path(args.out),
        include,
        allow_unsigned=args.allow_unsigned,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
