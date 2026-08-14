"""Regression tests for Drupal 11 post-upgrade health remediation."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
CRON_SCRIPT = SCRIPTS / "ensure_cron_schedule.py"
SPEC = importlib.util.spec_from_file_location("ensure_cron_schedule", CRON_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {CRON_SCRIPT}")
CRON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CRON)


class PostUpgradeHealthTests(unittest.TestCase):
    def test_cron_merge_preserves_unrelated_lines_and_is_idempotent(self) -> None:
        old = "MAILTO=admin@example.invalid\n0 2 * * * /usr/local/bin/backup\n"
        entry = CRON.build_entry(Path("/srv/temenos"), Path("/usr/bin/php8.4"))

        merged = CRON.merge_crontab(old, entry)
        repeated = CRON.merge_crontab(merged, entry)

        self.assertEqual(merged, repeated)
        self.assertIn("/usr/local/bin/backup", merged)
        self.assertEqual(merged.count(CRON.MARKER), 1)
        self.assertIn("* * * * *", merged)

    def test_cron_merge_replaces_only_the_owned_entry(self) -> None:
        existing = (
            "*/30 * * * * old-command # temenos-drupal-cron\n"
            "5 3 * * * unrelated-command\n"
        )
        entry = CRON.build_entry(Path("/srv/temenos"), Path("/usr/bin/php8.4"))

        merged = CRON.merge_crontab(existing, entry)

        self.assertNotIn("old-command", merged)
        self.assertIn("unrelated-command", merged)
        self.assertEqual(merged.count(CRON.MARKER), 1)

    def test_php_remediation_contains_data_loss_guards(self) -> None:
        script = (SCRIPTS / "remediate_post_upgrade_health.php").read_text(
            encoding="utf-8"
        )

        self.assertIn("AI log entities exist", script)
        self.assertIn("AI assistants exist", script)
        self.assertIn("ai_chatbot_block", script)
        self.assertIn("The public Contacta menu link was not found", script)
        self.assertIn("['internal:/contact', 'internal:/form/contact']", script)
        self.assertIn("$mail_interface === 'SMTPMailSystem'", script)
        self.assertIn("'webform_open' => $webform->isOpen()", script)
        self.assertIn("enabled_handlers < 2", script)
        self.assertIn("'mail_interface' => $mail_interface", script)

    def test_php_remediation_migrates_contact_before_uninstall(self) -> None:
        script = (SCRIPTS / "remediate_post_upgrade_health.php").read_text(
            encoding="utf-8"
        )

        migrate_at = script.index("internal:/form/contact")
        uninstall_at = script.index("module_installer")
        self.assertLess(migrate_at, uninstall_at)
        self.assertIn("webform_terms_of_service", script)
        self.assertIn("set('archive', FALSE)", script)
        self.assertIn("/ca/politica-de-privacitat", script)
        self.assertIn("/es/politica-de-privacidad", script)
        self.assertIn("/en/privacy-policy", script)
        self.assertIn("read('webform.webform.contact') ?: []", script)
        self.assertIn("temenos_translate_contact_elements", script)
        self.assertIn("'Tu nombre'", script)

    def test_php_verifier_checks_every_remediated_requirement(self) -> None:
        script = (SCRIPTS / "verify_post_upgrade_health.php").read_text(
            encoding="utf-8"
        )

        self.assertIn("enabled_retired_modules", script)
        self.assertIn("webform_open", script)
        self.assertIn("email_handlers", script)
        self.assertIn("enable_html5_validation", script)
        self.assertIn("interface.default", script)
        self.assertIn("isBehindSchedule", script)
        self.assertIn("language.en-gb", script)
        self.assertIn("groq_provider_usable", script)
        self.assertIn("$groq_key_id !== 'ai_agent'", script)


if __name__ == "__main__":
    unittest.main()
