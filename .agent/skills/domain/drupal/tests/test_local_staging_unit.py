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
        self.assertIn("['enable_html5_validation'] = FALSE", settings)
        self.assertNotIn("temenosismael.org", settings)

    def test_web_server_uses_drupal_web_document_root(self):
        command = MODULE.web_server_command()

        document_root_index = command.index("-t") + 1
        self.assertEqual(command[document_root_index], str(MODULE.SITE_ROOT / "web"))
        self.assertEqual(command[-1], str(MODULE.STAGING_ROOT / "router.php"))

    def test_harden_rewrites_local_settings(self):
        source = SCRIPT.read_text(encoding="utf-8")
        harden = source[source.index("def harden()") : source.index("def rotate_credentials()")]

        self.assertIn("state = load_state()", harden)
        self.assertIn("write_local_configuration(state)", harden)

    def test_drush_uses_php_entrypoint_instead_of_shell_wrapper(self):
        command = MODULE.drush_command("status")

        self.assertEqual(command[0], str(MODULE.PHP_BIN))
        self.assertEqual(
            command[3],
            str(MODULE.SITE_ROOT / "vendor" / "drush" / "drush" / "drush.php"),
        )
        self.assertNotIn(str(MODULE.SITE_ROOT / "vendor" / "bin" / "drush"), command)

    def test_router_decodes_url_encoded_static_file_paths(self):
        router = MODULE.router_contents()

        self.assertIn("rawurldecode(parse_url", router)


if __name__ == "__main__":
    unittest.main()
