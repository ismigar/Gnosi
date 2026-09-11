"""Validate the help catalog, translation structure and local Markdown links."""

from __future__ import annotations

import json
from pathlib import Path
import re

import yaml

ROOT = Path(__file__).resolve().parents[1]


def validate(root: Path = ROOT) -> list[str]:
    catalog = json.loads((root / "desktop/help-links.json").read_text())
    expected = {"index", *catalog["topics"]}
    errors: list[str] = []
    structures: dict[str, tuple[list[str], int]] = {}
    for locale in catalog["locales"]:
        folder = root / "docs/learn" / locale
        found = {path.stem for path in folder.glob("*.md")}
        if found != expected:
            errors.append(f"{locale}: missing/extra articles {found ^ expected}")
        for path in folder.glob("*.md"):
            content = path.read_text()
            anchors = re.findall(r"\{#([^}]+)\}", content)
            steps = len(re.findall(r"^\d+\. ", content, re.MULTILINE))
            structure = (anchors, steps)
            previous = structures.setdefault(path.stem, structure)
            if previous != structure:
                errors.append(f"{path}: translated sections or steps differ")
            if path.stem != "index" and (steps < 4 or len(anchors) != 5):
                errors.append(f"{path}: incomplete guide")
            for target in re.findall(r"\]\(([^)]+)\)", content):
                if "://" in target:
                    continue
                filename, _, fragment = target.partition("#")
                destination = path.parent / filename if filename else path
                if not destination.is_file():
                    errors.append(f"{path}: missing link {target}")
                elif fragment and f"{{#{fragment}}}" not in destination.read_text():
                    errors.append(f"{path}: missing anchor {target}")
        config_name = "mkdocs-learn.yml" if locale == "en" else f"mkdocs-learn-{locale}.yml"
        config = yaml.safe_load((root / config_name).read_text())
        suffix = "" if locale == "en" else f"{locale}/"
        if config["site_url"] != catalog["origin"] + catalog["learnPath"] + suffix:
            errors.append(f"{locale}: public URL differs from app catalog")
        if config["docs_dir"] != f"docs/learn/{locale}":
            errors.append(f"{locale}: wrong source directory")
        if config["site_dir"] != f"site/learn/{suffix}":
            errors.append(f"{locale}: unsafe output directory")
        if {"search": {"lang": "en" if locale == "ca" else locale}} not in config["plugins"]:
            errors.append(f"{locale}: missing localized search")
    if (set(catalog["sections"].values()) | set(catalog["knowledgeSections"].values())) - set(catalog["topics"]):
        errors.append("App contextual links refer to missing topics")
    return errors


if __name__ == "__main__":
    failures = validate()
    if failures:
        raise SystemExit("\n".join(failures))
    print("Help: 52 pages, four locales, stable sections and local links verified")
