"""Unit tests for the deterministic local Drupal 11 upgrade."""

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "upgrade_local_to_drupal11.py"
)
REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
MCP_PATCH = REPOSITORY_ROOT / "temenos/patches/mcp-toolslist-inputschema-fix.patch"
SPEC = importlib.util.spec_from_file_location("upgrade_local_to_drupal11", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class UpgradeLocalToDrupal11Test(unittest.TestCase):
    """Verify manifest transitions and local-only safety checks."""

    def test_stage_one_updates_contrib_and_retires_blockers(self):
        original = {
            "require": {
                "drupal/file_delete_ui": "^1@beta",
                "drupal/layout_builder_st": "^1@alpha",
                "drupal/webform": "^6.2",
            },
            "config": {"allow-plugins": {}},
            "extra": {},
        }

        updated = MODULE.configure_stage_one(original)

        self.assertNotIn("drupal/file_delete_ui", updated["require"])
        self.assertNotIn("drupal/layout_builder_st", updated["require"])
        self.assertEqual(updated["require"]["drupal/webform"], "^6.3")
        self.assertEqual(updated["require"]["drush/drush"], "^13")
        self.assertEqual(updated["require-dev"]["drupal/core-dev"], "^10.6")
        self.assertTrue(updated["config"]["allow-plugins"]["tbachert/spi"])
        self.assertEqual(
            updated["extra"]["drupal-lenient"]["allowed-list"],
            ["drupal/multilingual_menu_urls"],
        )
        self.assertIn("drupal/file_delete_ui", original["require"])

    def test_stage_two_updates_all_core_constraints(self):
        updated = MODULE.configure_stage_two({"require": {}, "require-dev": {}})

        self.assertEqual(updated["require-dev"]["drupal/core-dev"], "^11")
        for package in MODULE.CORE_REQUIREMENTS:
            self.assertEqual(updated["require"][package], "^11")

    def test_patch_validation_rejects_stale_patch(self):
        with tempfile.TemporaryDirectory() as directory:
            site_root = Path(directory)
            patch = site_root / "patches/mcp-toolslist-inputschema-fix.patch"
            patch.parent.mkdir(parents=True)
            patch.write_text("old patch", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "stale MCP patch"):
                MODULE.validate_patch(site_root)

    def test_mcp_patch_applies_to_clean_upstream_source(self):
        """Reject patches generated from an already patched MCP checkout."""
        source = "\n".join(
            ["// Padding"] * 55
            + [
                "        function ($tool) use ($instance) {",
                "          $toolData = new Tool(",
                "            name: $instance->generateToolId(",
                "              $instance->getPluginId(),",
                "              $tool->name",
                "            ),",
                "            description: $tool->description,",
                "            inputSchema: $tool->inputSchema,",
                "            title: $tool->title ?? NULL,",
                "          );",
                "        }",
                "",
            ]
        )
        with tempfile.TemporaryDirectory() as directory:
            package_root = Path(directory)
            target = package_root / "src/Plugin/McpJsonRpc/ToolsList.php"
            target.parent.mkdir(parents=True)
            target.write_text(source, encoding="utf-8")

            result = subprocess.run(
                ["git", "apply", "--check", str(MCP_PATCH)],
                cwd=package_root,
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_safety_check_rejects_nonstandard_root(self):
        with tempfile.TemporaryDirectory() as directory:
            site_root = Path(directory)
            settings = site_root / "web/sites/default/settings.local.php"
            settings.parent.mkdir(parents=True)
            settings.write_text(
                "deployment_identifier'] = 'local-staging';\n"
                "'host' => '127.0.0.1';\n"
                "'port' => '3307';\n"
                "smtp_on'] = FALSE;\n"
                "interval'] = 0;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "non-standard site root"):
                MODULE.assert_local_stage(site_root)

    def test_default_stage_root_can_be_overridden(self):
        self.assertEqual(MODULE.DEFAULT_SITE_ROOT, MODULE.DEFAULT_STAGE_ROOT / "site")


if __name__ == "__main__":
    unittest.main()
