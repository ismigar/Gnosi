#!/usr/bin/env python3
"""Eina d'autor per signar un plugin de Gnosi (fase 3 de plugin_system.md).

Comprimeix una carpeta de plugin en un .zip, en calcula el SHA-256 i el signa
amb una clau privada Ed25519, i imprimeix una entrada de catàleg/índex a punt
per publicar (amb `sha256` i `signature`). L'usuari final afegeix la clau PÚBLICA
al seu magatzem de confiança (`POST /api/vault/plugins/trust`) i, en instal·lar
des de la galeria/índex, Gnosi verifica la signatura.

Ús:
  # genera un parell de claus (guarda la privada en un lloc segur!)
  python sign_plugin.py keygen

  # signa una carpeta de plugin i escriu el .zip + entrada de catàleg
  python sign_plugin.py sign <carpeta_plugin> <clau_privada_b64> \
      --url https://exemple.org/plugins/el-meu.zip --out el-meu.zip

Aquest script depèn NOMÉS de `cryptography` (no importa el backend de Gnosi), per
poder-lo distribuir tal qual als autors de plugins.
"""
import argparse
import base64
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def _zip_dir(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, str(f.relative_to(src)))
    return buf.getvalue()


def cmd_keygen(_args) -> int:
    priv = Ed25519PrivateKey.generate()
    print(json.dumps({
        "private": base64.b64encode(priv.private_bytes_raw()).decode(),
        "public": base64.b64encode(priv.public_key().public_bytes_raw()).decode(),
    }, indent=2))
    print("\n⚠️  Guarda la clau PRIVADA en un lloc segur i no la comparteixis mai.",
          file=sys.stderr)
    return 0


def cmd_sign(args) -> int:
    src = Path(args.folder).resolve()
    manifest_path = src / "manifest.json"
    if not manifest_path.exists():
        print(f"error: {src} no conté manifest.json", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    data = _zip_dir(src)
    sha256 = hashlib.sha256(data).hexdigest()
    priv = Ed25519PrivateKey.from_private_bytes(base64.b64decode(args.private_key))
    signature = base64.b64encode(priv.sign(data)).decode()

    out_zip = Path(args.out or f"{manifest['id']}.zip")
    out_zip.write_bytes(data)

    entry = {
        "id": manifest["id"],
        "name": manifest.get("name", manifest["id"]),
        "description": manifest.get("description", ""),
        "permissions": manifest.get("permissions", []),
        "source": "url",
        "url": args.url or f"https://EXEMPLE/{out_zip.name}",
        "sha256": sha256,
        "signature": signature,
    }
    print(f"✅ zip escrit a {out_zip} ({len(data)} bytes)", file=sys.stderr)
    print(json.dumps(entry, indent=2, ensure_ascii=False))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Signa plugins de Gnosi (Ed25519).")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("keygen", help="Genera un parell de claus Ed25519")
    s = sub.add_parser("sign", help="Signa una carpeta de plugin")
    s.add_argument("folder")
    s.add_argument("private_key", help="Clau privada Ed25519 en base64")
    s.add_argument("--url", help="URL on es publicarà el .zip")
    s.add_argument("--out", help="Ruta del .zip de sortida")
    args = p.parse_args()
    return {"keygen": cmd_keygen, "sign": cmd_sign}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
