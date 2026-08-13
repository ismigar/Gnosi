"""Unit tests for the Temenos Drupal theme machine-name migration."""

import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
THEME_ROOT = REPOSITORY_ROOT / "temenos" / "web" / "themes" / "custom" / "temenos"
MIGRATION_SCRIPT = (
    REPOSITORY_ROOT
    / ".agent"
    / "skills"
    / "domain"
    / "drupal"
    / "scripts"
    / "rename_theme_to_temenos.php"
)


class ThemeRenameUnitTest(unittest.TestCase):
    """Verify the renamed theme and migration invariants."""

    def test_theme_machine_named_files_exist(self):
        self.assertTrue((THEME_ROOT / "temenos.info.yml").is_file())
        self.assertTrue((THEME_ROOT / "temenos.libraries.yml").is_file())
        self.assertTrue((THEME_ROOT / "temenos.breakpoints.yml").is_file())
        self.assertTrue((THEME_ROOT / "temenos.theme").is_file())
        self.assertTrue((THEME_ROOT / "config/schema/temenos.schema.yml").is_file())

    def test_theme_declares_drupal_10_and_11_compatibility(self):
        info = (THEME_ROOT / "temenos.info.yml").read_text(encoding="utf-8")

        self.assertIn("name: 'Temenos'", info)
        self.assertIn("core_version_requirement: ^10 || ^11", info)

    def test_theme_text_files_have_no_legacy_machine_name(self):
        text_suffixes = {
            ".css",
            ".js",
            ".json",
            ".less",
            ".md",
            ".theme",
            ".twig",
            ".txt",
            ".yml",
        }
        legacy_references = []

        for path in THEME_ROOT.rglob("*"):
            if path.is_file() and path.suffix in text_suffixes:
                if "elraco" in path.read_text(encoding="utf-8", errors="ignore"):
                    legacy_references.append(str(path.relative_to(THEME_ROOT)))

        self.assertEqual(legacy_references, [])

    def test_migration_installs_target_before_uninstalling_source(self):
        script = MIGRATION_SCRIPT.read_text(encoding="utf-8")
        runtime = script[script.index("$theme_list =") :]

        self.assertLess(
            runtime.index("$theme_installer->install([TARGET_THEME])"),
            runtime.index("migrate_theme_blocks()"),
        )
        self.assertLess(
            runtime.index("migrate_theme_blocks()"),
            runtime.index("$theme_installer->uninstall([SOURCE_THEME])"),
        )


if __name__ == "__main__":
    unittest.main()
