"""Build reviewed website snapshots with the packaged Astro/Pagefind renderer."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from contextvars import ContextVar
from pathlib import Path

from markdown_it import MarkdownIt
from pydantic import JsonValue

from .paths import extension_root
from .models import SiteTheme
from .stylesheets import website_stylesheet

preview_work_root: ContextVar[Path | None] = ContextVar("preview_work_root", default=None)


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
    with tempfile.TemporaryDirectory(prefix="gnosi-site-build-", dir=preview_work_root.get()) as temporary:
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
        attachments: list[tuple[Path, Path, str]] = []
        for asset in payload.pop("assets", []):
            relative = Path(str(asset["path"]).lstrip("/"))
            if relative.is_absolute() or ".." in relative.parts or any(p.startswith(".") for p in relative.parts):
                raise ValueError("Invalid public asset path")
            if relative.parts[0] in {"api", "pagefind", "_astro"} or relative.suffix.lower() in {".php", ".html", ".htm", ".js", ".mjs", ".css"}:
                raise ValueError("Executable attachments cannot be published")
            source = Path(str(asset["private_source"]))
            attachments.append((source, relative, str(asset["sha256"])))
        payload.pop("source_hashes", None)
        # Generated, validated CSS is separate from executable attachment uploads.
        stylesheet = website_stylesheet(SiteTheme.model_validate(payload["site"]["theme"]))
        filename = "gnosi-styles-" + hashlib.sha256(stylesheet.encode()).hexdigest()[:20] + ".css"
        (public / "_astro").mkdir(exist_ok=True)
        (public / "_astro" / filename).write_text(stylesheet, encoding="utf-8")
        payload["stylesheet_path"] = "/_astro/" + filename
        parser = MarkdownIt("commonmark", {"html": False})
        for page in [*payload["site"]["pages"], *(payload["site"].get("footer_columns") or []), *(payload["site"].get("regions") or []), {"blocks": payload["site"].get("footer_blocks") or []}]:
            for block in [item for parent in page["blocks"] for item in [parent, *parent.get("children", [])]]:
                # HTML is sanitized by the public renderer, including imported fragments.
                block["body_html"] = block.get("body", "") if block.get("body_format") == "html" else parser.render(block.get("body", ""))
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
        # Astro/Pagefind consume the reviewed HTML and asset URLs, not the
        # attachment bytes. Stage verified files directly into the completed
        # disposable tree, avoiding Astro's second copy of large PDFs.
        from .asset_files import copy_reviewed_asset
        for source, relative, expected in attachments:
            target = work / "dist" / relative
            if target.exists() or target.is_symlink():
                raise ValueError("A generated website file conflicts with an attachment")
            target.parent.mkdir(parents=True, exist_ok=True)
            copy_reviewed_asset(source, target, expected)
        # Move the complete private tree without copying its attachments again.
        for generated in (work / "dist").iterdir():
            destination = output / generated.name
            if destination.exists() or destination.is_symlink():
                raise ValueError("Website output changed during construction")
            shutil.move(str(generated), destination)
