"""Build reviewed website snapshots with the packaged Astro/Pagefind renderer."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from markdown_it import MarkdownIt
from pydantic import JsonValue

from .paths import extension_root


def render_bundle(bundle: dict[str, JsonValue], output: Path) -> None:
    """Keep source filenames and private publication state outside the public output."""
    renderer = extension_root() / "renderer"
    modules = renderer / "node_modules"
    node = modules / "node/bin" / ("node.exe" if os.name == "nt" else "node")
    if not node.is_file():
        raise ValueError("Install the pinned website renderer dependencies before publishing")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Website output must be an empty private build directory")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="gnosi-site-build-") as temporary:
        work = Path(temporary)
        for entry in ("src", "scripts", "astro.config.mjs", "package.json"):
            source = renderer / entry
            destination = work / entry
            if source.is_dir():
                shutil.copytree(source, destination)
            else:
                shutil.copy2(source, destination)
        (work / "node_modules").symlink_to(modules.resolve(), target_is_directory=True)
        public = work / "public"
        public.mkdir()
        payload = json.loads(json.dumps(bundle))
        for asset in payload.pop("assets", []):
            relative = Path(str(asset["path"]).lstrip("/"))
            if relative.is_absolute() or ".." in relative.parts or any(p.startswith(".") for p in relative.parts):
                raise ValueError("Invalid public asset path")
            if relative.parts[0] in {"api", "pagefind", "_astro"} or relative.suffix.lower() in {".php", ".html", ".htm", ".js", ".mjs", ".css"}:
                raise ValueError("Executable attachments cannot be published")
            source = Path(str(asset["private_source"]))
            raw = source.read_bytes()
            if hashlib.sha256(raw).hexdigest() != asset["sha256"]:
                raise ValueError("A reviewed asset changed before construction")
            target = public / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        payload.pop("source_hashes", None)
        parser = MarkdownIt("commonmark", {"html": False})
        for page in payload["site"]["pages"]:
            for block in page["blocks"]:
                block["body_html"] = parser.render(block.get("body", ""))
        (work / "bundle.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        service_public = renderer.parent / "public"
        if service_public.exists():
            shutil.copytree(service_public, public, dirs_exist_ok=True)
        environment = {key: value for key, value in os.environ.items() if key in {"PATH", "HOME", "TMPDIR", "LANG"}}
        environment["PATH"] = str(node.parent) + os.pathsep + environment.get("PATH", "")
        environment["ASTRO_TELEMETRY_DISABLED"] = "1"
        result = subprocess.run([str(node), "scripts/build.mjs"], cwd=work, env=environment,
                                capture_output=True, text=True, timeout=300, check=False)
        log = output.parent / (output.name + ".build.log")
        log.write_text(result.stdout[-200000:] + result.stderr[-200000:], encoding="utf-8")
        log.chmod(0o600)
        if result.returncode:
            raise ValueError("Website construction failed; check the renderer installation and reviewed content")
        shutil.copytree(work / "dist", output, dirs_exist_ok=True)
