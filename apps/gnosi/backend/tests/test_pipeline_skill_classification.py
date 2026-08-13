"""Every pipeline skill is classified outside the agent runtime catalog."""

from pathlib import Path

import yaml


def test_every_pipeline_skill_has_an_explicit_non_runtime_classification():
    root = Path(__file__).resolve().parents[2] / "pipeline" / "skills"
    catalog = yaml.safe_load((root / "catalog.yaml").read_text(encoding="utf-8"))
    packages = catalog["packages"]
    directories = {
        path.parent.name for path in root.glob("*/SKILL.md")
    }

    assert set(packages) == directories
    assert catalog["agent_assignable_default"] is False
    assert all(value.get("kind") for value in packages.values())
