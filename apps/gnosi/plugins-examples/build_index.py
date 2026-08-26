#!/usr/bin/env python3
"""Builds the remote index of OFFICIAL (signed) plugins for distribution.

Meant to run in the release pipeline (`build-release.yml`): it takes each plugin
folder, compresses it, computes its SHA-256, signs it with the official
private key (from the environment), and writes:

  <out>/<id>.zip            — each plugin's artifact
  <out>/plugins-index.json  — the index (list of `source:"url"` entries with
                              `url`, `sha256`, and, if a key is present, `signature`)

This index is published as a release asset; the app consumes it via
`registry_url` (e.g. `.../releases/latest/download/plugins-index.json`) and
verifies each signature against the bundled `gnosi-official` key.

The private key is NEVER written to disk or to the repo: it arrives via the
`GNOSI_PLUGIN_SIGNING_KEY` environment variable (base64 of the raw Ed25519 key, like the one in the keyfile).
If it's absent, an index is generated WITHOUT a signature (which the app will mark "unverified").

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
import os
import sys
import zipfile
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
except Exception:  # noqa: BLE001
    Ed25519PrivateKey = None


def _zip_dir(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, str(f.relative_to(src)))
    return buf.getvalue()


def _load_signer():
    """Returns a signing function (bytes→sig b64), or None if there's no key."""
    key_b64 = os.environ.get("GNOSI_PLUGIN_SIGNING_KEY", "").strip()
    if not key_b64:
        return None
    if Ed25519PrivateKey is None:
        raise RuntimeError("cryptography no instal·lada però hi ha clau de signatura")
    # Accepts both the raw base64 key and a JSON {"private": "..."} (keyfile).
    if key_b64.startswith("{"):
        key_b64 = json.loads(key_b64)["private"]
    priv = Ed25519PrivateKey.from_private_bytes(base64.b64decode(key_b64))
    return lambda data: base64.b64encode(priv.sign(data)).decode()


def build(plugins_dir: Path, base_url: str, out: Path, include: list) -> dict:
    signer = _load_signer()
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
    args = p.parse_args()
    include = [s.strip() for s in args.include.split(",") if s.strip()]
    build(Path(args.plugins_dir), args.base_url, Path(args.out), include)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
