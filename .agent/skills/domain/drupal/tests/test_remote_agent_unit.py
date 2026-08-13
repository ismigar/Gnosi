"""Unit tests for the Drupal SSH bridge safeguards."""

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from remote_agent import DrupalRemoteAgent  # noqa: E402


class DrupalRemoteAgentTest(unittest.TestCase):
    """Validate prompt matching and credential redaction."""

    def test_shell_prompt_requires_complete_prompt_line(self):
        self.assertIsNotNone(
            DrupalRemoteAgent.SHELL_PROMPT.search("user@host:/srv/drupal$ ")
        )
        self.assertIsNone(
            DrupalRemoteAgent.SHELL_PROMPT.search("Filesystem 42% used")
        )
        self.assertIsNone(
            DrupalRemoteAgent.SHELL_PROMPT.search("echo $HOME > output")
        )

    def test_redact_output_hides_common_secret_fields(self):
        output = (
            '{"db-password": "database-secret", '
            '"token": "api-secret", password=plain-secret}'
        )

        redacted = DrupalRemoteAgent._redact_output(output)

        self.assertNotIn("database-secret", redacted)
        self.assertNotIn("api-secret", redacted)
        self.assertNotIn("plain-secret", redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 3)


if __name__ == "__main__":
    unittest.main()
