"""Unit tests for retiring unused Drupal integration modules."""

import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
RETIREMENT_SCRIPT = (
    REPOSITORY_ROOT
    / ".agent"
    / "skills"
    / "domain"
    / "drupal"
    / "scripts"
    / "retire_unused_modules.php"
)


class ModuleRetirementUnitTest(unittest.TestCase):
    """Verify safe and repeatable module retirement invariants."""

    def test_script_retires_both_unused_modules(self):
        script = RETIREMENT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("'n8n_helper'", script)
        self.assertIn("'notion_bridge'", script)

    def test_script_only_uninstalls_enabled_modules(self):
        script = RETIREMENT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("$module_handler->moduleExists($module)", script)
        self.assertIn("->uninstall($enabled_modules)", script)
        self.assertIn("$enabled_modules !== []", script)

    def test_script_verifies_modules_are_disabled(self):
        script = RETIREMENT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("$still_enabled", script)
        self.assertIn("Retired modules remain enabled", script)


if __name__ == "__main__":
    unittest.main()
