#!/usr/bin/env python3
"""Build signed official Vault template packages as GitHub Release assets."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SCHEMA_VERSION = 1


def _private_key() -> Ed25519PrivateKey:
    raw = os.environ.get("GNOSI_PLUGIN_SIGNING_KEY", "").strip()
    if not raw:
        raise RuntimeError("GNOSI_PLUGIN_SIGNING_KEY is required for official templates")
    if raw.startswith("{"):
        raw = json.loads(raw)["private"]
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw))


def _sign(key: Ed25519PrivateKey, payload: bytes) -> str:
    return base64.b64encode(key.sign(payload)).decode("ascii")


def _write(archive: zipfile.ZipFile, name: str, payload: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, payload)


def _starter_package() -> tuple[bytes, dict]:
    registry = {
        "databases": [{
            "id": "research-workspace",
            "name": "Research",
            "folder": "BD/Research",
        }],
        "tables": [{
            "id": "research-sources",
            "name": "Sources",
            "folder": "Sources",
            "database_id": "research-workspace",
            "properties": [
                {"id": "source-title", "name": "Title", "type": "title"},
                {"id": "source-key", "name": "Citation Key", "type": "text"},
                {
                    "id": "source-type",
                    "name": "Item Type",
                    "type": "select",
                    "config": {"options": ["report", "book", "journalArticle", "webpage"]},
                },
                {"id": "source-authors", "name": "Authors", "type": "text"},
                {"id": "source-year", "name": "Any", "type": "number"},
                {"id": "source-url", "name": "URL", "type": "url"},
            ],
        }],
        "views": [{
            "id": "research-sources-main",
            "table_id": "research-sources",
            "name": "Sources",
            "type": "table",
            "is_main": True,
            "filters": [],
            "sort": {"field": "title", "direction": "asc"},
            "visible_fields": [
                "title", "Citation Key", "Item Type", "Authors", "Any", "URL",
            ],
        }],
    }

    payloads = {
        "BD/vault_db_registry.json": (
            json.dumps(registry, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        ),
        "BD/Research/Sources/Gnosi research workflow.md": (
            "---\n"
            "id: 79612d30-6775-47d8-bc2f-6307c1557730\n"
            "table_id: research-sources\n"
            "Title: Gnosi research workflow\n"
            "Citation Key: gnosi2026\n"
            "Item Type: report\n"
            "Authors: Gnosi Community\n"
            "Any: 2026\n"
            "URL: https://gnosi.temenosismael.org/\n"
            "---\n\n"
            "# Gnosi research workflow\n\n"
            "A trustworthy knowledge workflow keeps every synthesis connected to the "
            "evidence that supports it while leaving the underlying files portable.\n\n"
            "This sample source exists only to demonstrate Gnosi's citation and "
            "evidence chain. Replace it with a real source after completing the tour.\n"
        ),
        "Wiki/Start here.md": (
            "---\n"
            "id: 5f9afec2-6641-42d9-8c87-76701030df0b\n"
            "title: Start here\n"
            "---\n\n"
            "# Start here\n\n"
            "This workspace demonstrates one complete path without AI or external accounts.\n\n"
            "1. Open [[Gnosi research workflow]] in the **Sources** table.\n"
            "2. Read [[Reading note - Evidence chain]] and follow its exact quotation back to the source.\n"
            "3. Open [[Synthesis - Research without duplication]] to see evidence become a connected idea.\n"
            "4. Open [[Manuscript - First paragraph]] and use the citation picker (Cmd/Ctrl+Shift+I) to insert `gnosi2026`.\n"
            "5. Try the Word or LibreOffice connector when you are ready to write outside Gnosi.\n\n"
            "Other languages: [[Comença aquí]] · [[Empieza aquí]]\n"
        ),
        "Wiki/Comença aquí.md": (
            "---\n"
            "id: bd5ef0ba-7f01-4413-8df1-3f0ea22ca638\n"
            "title: Comença aquí\n"
            "---\n\n"
            "# Comença aquí\n\n"
            "Aquest espai mostra un recorregut complet sense IA ni comptes externs.\n\n"
            "1. Obre [[Gnosi research workflow]] a la taula **Sources**.\n"
            "2. Llegeix [[Nota de lectura - Cadena de custòdia]] i torna des de la citació exacta fins a la font.\n"
            "3. Obre [[Síntesi - Recerca sense duplicació]] per veure com l'evidència es converteix en una idea connectada.\n"
            "4. Obre [[Manuscrit - Primer paràgraf]] i utilitza el selector de cites (Cmd/Ctrl+Maj+I) per inserir `gnosi2026`.\n"
            "5. Prova el connector de Word o LibreOffice quan vulguis escriure fora de Gnosi.\n\n"
            "Altres idiomes: [[Start here]] · [[Empieza aquí]]\n"
        ),
        "Wiki/Empieza aquí.md": (
            "---\n"
            "id: 3bf64fc1-d7cd-4ce5-890a-da43fa23e293\n"
            "title: Empieza aquí\n"
            "---\n\n"
            "# Empieza aquí\n\n"
            "Este espacio muestra un recorrido completo sin IA ni cuentas externas.\n\n"
            "1. Abre [[Gnosi research workflow]] en la tabla **Sources**.\n"
            "2. Lee [[Nota de lectura - Cadena de evidencia]] y vuelve desde la cita exacta hasta la fuente.\n"
            "3. Abre [[Síntesis - Investigar sin duplicar]] para ver cómo la evidencia se convierte en una idea conectada.\n"
            "4. Abre [[Manuscrito - Primer párrafo]] y utiliza el selector de citas (Cmd/Ctrl+Mayús+I) para insertar `gnosi2026`.\n"
            "5. Prueba el conector de Word o LibreOffice cuando quieras escribir fuera de Gnosi.\n\n"
            "Otros idiomas: [[Start here]] · [[Comença aquí]]\n"
        ),
        "Wiki/Reading note - Evidence chain.md": (
            "---\n"
            "id: 9a4c86ae-c9a3-4e9b-9851-f643a7242d30\n"
            "title: Reading note - Evidence chain\n"
            "source: '[[Gnosi research workflow]]'\n"
            "citation_key: gnosi2026\n"
            "---\n\n"
            "# Reading note - Evidence chain\n\n"
            "> A trustworthy knowledge workflow keeps every synthesis connected to the evidence that supports it while leaving the underlying files portable.\n\n"
            "— [[Gnosi research workflow]] [@gnosi2026]\n\n"
            "**Observation:** portability is not enough on its own; a research system must also preserve provenance.\n"
        ),
        "Wiki/Nota de lectura - Cadena de custòdia.md": (
            "---\n"
            "id: d8019385-7781-46a0-a387-27073517c9af\n"
            "title: Nota de lectura - Cadena de custòdia\n"
            "source: '[[Gnosi research workflow]]'\n"
            "citation_key: gnosi2026\n"
            "---\n\n"
            "# Nota de lectura - Cadena de custòdia\n\n"
            "> A trustworthy knowledge workflow keeps every synthesis connected to the evidence that supports it while leaving the underlying files portable.\n\n"
            "— [[Gnosi research workflow]] [@gnosi2026]\n\n"
            "**Observació:** la portabilitat no és suficient per si mateixa; un sistema de recerca també ha de preservar la procedència.\n"
        ),
        "Wiki/Nota de lectura - Cadena de evidencia.md": (
            "---\n"
            "id: 108cd1cc-e822-44a0-8130-858c0b4950c0\n"
            "title: Nota de lectura - Cadena de evidencia\n"
            "source: '[[Gnosi research workflow]]'\n"
            "citation_key: gnosi2026\n"
            "---\n\n"
            "# Nota de lectura - Cadena de evidencia\n\n"
            "> A trustworthy knowledge workflow keeps every synthesis connected to the evidence that supports it while leaving the underlying files portable.\n\n"
            "— [[Gnosi research workflow]] [@gnosi2026]\n\n"
            "**Observación:** la portabilidad no basta por sí sola; un sistema de investigación también debe preservar la procedencia.\n"
        ),
        "Wiki/Synthesis - Research without duplication.md": (
            "---\n"
            "id: f7556f81-ea65-43ef-a99f-437c33f71598\n"
            "title: Synthesis - Research without duplication\n"
            "---\n\n"
            "# Synthesis - Research without duplication\n\n"
            "Open formats solve ownership; linked evidence solves trust. A useful research workspace needs both [[Reading note - Evidence chain]] [@gnosi2026].\n"
        ),
        "Wiki/Síntesi - Recerca sense duplicació.md": (
            "---\n"
            "id: 0c8557c3-af19-4d21-a814-a406b9190c3a\n"
            "title: Síntesi - Recerca sense duplicació\n"
            "---\n\n"
            "# Síntesi - Recerca sense duplicació\n\n"
            "Els formats oberts resolen la propietat; l'evidència connectada resol la confiança. Un espai de recerca útil necessita totes dues coses [[Nota de lectura - Cadena de custòdia]] [@gnosi2026].\n"
        ),
        "Wiki/Síntesis - Investigar sin duplicar.md": (
            "---\n"
            "id: 61a40e8b-1713-4a2d-9513-1ade984994ed\n"
            "title: Síntesis - Investigar sin duplicar\n"
            "---\n\n"
            "# Síntesis - Investigar sin duplicar\n\n"
            "Los formatos abiertos resuelven la propiedad; la evidencia conectada resuelve la confianza. Un espacio de investigación útil necesita ambas cosas [[Nota de lectura - Cadena de evidencia]] [@gnosi2026].\n"
        ),
        "Wiki/Manuscript - First paragraph.md": (
            "---\n"
            "id: 0caa74f8-fc5d-4778-86b2-9bf9dddb0c55\n"
            "title: Manuscript - First paragraph\n"
            "---\n\n"
            "# Manuscript - First paragraph\n\n"
            "A sovereign research workflow should preserve both open files and the path from interpretation to evidence [@gnosi2026].\n"
        ),
        "Wiki/Manuscrit - Primer paràgraf.md": (
            "---\n"
            "id: 1f561b01-8152-41d1-8811-c5d4ea1418fb\n"
            "title: Manuscrit - Primer paràgraf\n"
            "---\n\n"
            "# Manuscrit - Primer paràgraf\n\n"
            "Un flux de recerca sobirà ha de preservar tant els arxius oberts com el camí que porta de la interpretació fins a l'evidència [@gnosi2026].\n"
        ),
        "Wiki/Manuscrito - Primer párrafo.md": (
            "---\n"
            "id: 3275081f-af4c-4a70-84a7-a0c96d81f684\n"
            "title: Manuscrito - Primer párrafo\n"
            "---\n\n"
            "# Manuscrito - Primer párrafo\n\n"
            "Un flujo de investigación soberano debe preservar tanto los archivos abiertos como el camino que lleva desde la interpretación hasta la evidencia [@gnosi2026].\n"
        ),
    }
    encoded_payloads = {
        path: content.encode("utf-8") for path, content in payloads.items()
    }
    files = [
        {
            "path": path,
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        for path, content in sorted(encoded_payloads.items())
    ]
    manifest = {
        "id": "starter-vault",
        "version": "2.0.0",
        "schemaVersion": SCHEMA_VERSION,
        "name": "Research Starter Workspace",
        "description": (
            "A multilingual source-to-manuscript workspace with a citable source, "
            "evidence notes, connected synthesis, and manuscript examples."
        ),
        "author": "Gnosi",
        "license": "CC-BY-4.0",
        "minGnosiVersion": "1.0.0",
        "categories": ["starter", "research", "writing"],
        "languages": ["ca", "en", "es"],
        "recommendedPlugins": [],
        "preview": "",
        "files": files,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        _write(
            archive,
            "template.json",
            json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8"),
        )
        for path, content in sorted(encoded_payloads.items()):
            _write(archive, f"vault/{path}", content)
    return buffer.getvalue(), manifest


def build(out: Path, base_url: str) -> dict:
    """Write the starter package, signed index, and detached index signature."""

    key = _private_key()
    out.mkdir(parents=True, exist_ok=True)
    package, manifest = _starter_package()
    package_name = f"{manifest['id']}-{manifest['version']}.gnosi-vault.zip"
    (out / package_name).write_bytes(package)
    entry = {
        key: manifest[key]
        for key in (
            "id", "version", "name", "description", "author", "license",
            "categories", "languages", "recommendedPlugins", "preview",
        )
    }
    entry.update({
        "url": f"{base_url.rstrip('/')}/{package_name}",
        "sha256": hashlib.sha256(package).hexdigest(),
        "signature": _sign(key, package),
        "size": len(package),
    })
    index = {
        "schemaVersion": 1,
        "vaultTemplates": [entry],
    }
    index_bytes = json.dumps(
        index, indent=2, ensure_ascii=False, sort_keys=True
    ).encode("utf-8")
    (out / "vault-templates-index.json").write_bytes(index_bytes)
    (out / "vault-templates-index.sig").write_text(_sign(key, index_bytes), encoding="ascii")
    return {"templates": 1, "package": package_name, "out": str(out)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build signed official Vault templates")
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--base-url",
        default="https://github.com/ismigar/Gnosi/releases/latest/download",
    )
    args = parser.parse_args()
    result = build(Path(args.out), args.base_url)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
