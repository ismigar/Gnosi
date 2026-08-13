"""Unit tests for the native Drupal staging helper."""

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "local_staging.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("local_staging", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class LocalStagingUnitTest(unittest.TestCase):
    """Verify secret escaping and isolation settings."""

    def test_sql_literal_escapes_quotes_and_backslashes(self):
        self.assertEqual(MODULE.sql_literal("a'b\\c"), "'a''b\\\\c'")

    def test_default_project_root_is_repository_root(self):
        self.assertTrue((MODULE.DEFAULT_PROJECT_ROOT / ".git").exists())

    def test_settings_replace_connection_and_disable_outputs(self):
        settings = MODULE.settings_local_contents(
            {
                "database": "stage_db",
                "database_user": "stage_user",
                "database_password": "local-secret",
                "hash_salt": "local-salt",
            }
        )
        self.assertIn("'host' => '127.0.0.1'", settings)
        self.assertIn("'port' => '3307'", settings)
        self.assertIn("['smtp_on'] = FALSE", settings)
        self.assertIn("['interval'] = 0", settings)
        self.assertIn("proxy'] = 'http://127.0.0.1:9'", settings)
        self.assertNotIn("temenosismael.org", settings)


if __name__ == "__main__":
    unittest.main()
