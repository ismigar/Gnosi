#!/usr/bin/env python3
"""Automate SSH access to Drupal through the interactive ``suweb`` bridge.

Requires ``pexpect`` and ``python-dotenv``. The agent can run remote Drush or
shell commands and upload files through the privileged web-user session.

Usage:
    python remote_agent.py drush cr
    python remote_agent.py exec --timeout 900 composer update
    python remote_agent.py upload local_file remote_path
"""

import os
import re
import sys
from pathlib import Path

import pexpect
from dotenv import load_dotenv


def load_envs():
    """Load variables from the nearest parent ``.env_shared`` file."""
    current = Path(__file__).resolve()
    # Search parent directories for the shared environment filename.
    for _ in range(8):
        current = current.parent
        env_file = current / ".env_shared"
        if env_file.exists():
            load_dotenv(env_file)
            return True
    return False


class DrupalRemoteAgent:
    SHELL_PROMPT = re.compile(
        r"(?m)^[^\r\n]*@[^\r\n]*:[^\r\n]*[#$%>] ?$"
    )
    EXIT_MARKER = "__DRUPAL_AGENT_EXIT__"

    def __init__(self):
        load_envs()
        self.host = os.getenv("SSH_HOST")
        self.user = os.getenv("SSH_USER")
        self.password = os.getenv("SSH_PASSWORD")
        self.suweb_pass = os.getenv("SSH_SUWEB_PASSWORD")
        self.port = os.getenv("SSH_PORT", "22")
        self.drupal_root = os.getenv("DRUPAL_PATH", "/var/www/html")
        
        if not self.host or not self.user:
            raise ValueError("SSH_HOST or SSH_USER is missing from the environment")

    def _execute_command(self, cmd, timeout):
        """Execute a remote command and return its success state and output."""
        print(f"🤖 AGENT: Connecting to {self.user}@{self.host}...")
        
        ssh_cmd = f"ssh -p {self.port} {self.user}@{self.host}"
        
        try:
            child = pexpect.spawn(ssh_cmd, encoding="utf-8", timeout=timeout)
            
            # Authenticate the initial SSH session.
            i = child.expect([
                "(?i)password:",
                "yes/no",
                self.SHELL_PROMPT,
                pexpect.EOF,
                pexpect.TIMEOUT,
            ])
            
            if i == 0:
                child.sendline(self.password)
            elif i == 1:
                child.sendline("yes")
                child.expect("password:")
                child.sendline(self.password)
            elif i == 2:
                pass
            elif i == 3:
                return False, self._redact_output(child.before)
            elif i == 4:
                return False, "Initial SSH connection timed out."

            if i <= 1:
                login_result = child.expect(
                    [self.SHELL_PROMPT, pexpect.EOF, pexpect.TIMEOUT]
                )
                if login_result != 0:
                    return False, "SSH login did not reach a shell prompt."
                
            # Enter the privileged web-user session when configured.
            if self.suweb_pass:
                # Consume a residual prompt if one is still buffered.
                try:
                    child.expect(self.SHELL_PROMPT, timeout=1)
                except pexpect.TIMEOUT:
                    pass

                child.sendline("suweb")
                j = child.expect(
                    [
                        "(?i)password:",
                        "(?i)contrase",
                        "(?i)contrasenya",
                        "(?i)(authentication failure|fallo de auten|fallida)",
                        pexpect.TIMEOUT,
                    ],
                    timeout=10,
                )
                
                if j < 3:
                    child.sendline(self.suweb_pass)
                    child.expect(self.SHELL_PROMPT, timeout=10)
                elif j == 3:
                    return False, "suweb authentication failed."
                else:
                    # Some hosts switch users without asking for a password.
                    child.sendline('echo "CHECK_ROOT"')
                    child.expect("CHECK_ROOT")
                    child.expect(self.SHELL_PROMPT)

            # Commands must run from the Composer project root.
            child.sendline(f"cd {self.drupal_root}")
            child.expect(self.SHELL_PROMPT)

            # Disable echo in the remote terminal so commands and any
            # command-line secrets are not copied into captured output.
            child.sendline("stty -echo")
            child.expect(self.SHELL_PROMPT)
            
            print("🔧 AGENT: Executing remote command.")
            wrapped_cmd = (
                f"{cmd}; __drupal_agent_status=$?; "
                f"printf '\\n{self.EXIT_MARKER}%s\\n' \"$__drupal_agent_status\""
            )
            child.sendline(wrapped_cmd)
            child.expect(self.SHELL_PROMPT)
            
            output = child.before.strip()
            exit_match = re.search(rf"{self.EXIT_MARKER}(\d+)", output)
            exit_code = int(exit_match.group(1)) if exit_match else 1
            clean_output = re.sub(
                rf"\s*{self.EXIT_MARKER}\d+\s*$", "", output
            ).strip()
            clean_output = self._redact_output(clean_output)
            child.sendline("stty echo")
            child.expect(self.SHELL_PROMPT)
            child.sendline("exit")
            child.close()
            return exit_code == 0, clean_output
            
        except Exception as error:
            return False, self._redact_output(str(error))

    @staticmethod
    def _redact_output(output):
        """Remove common credential fields from captured command output."""
        sensitive_field = re.compile(
            r'(?i)(["\']?(?:db[-_]?password|password|passwd|secret|token)'
            r'["\']?\s*[:=]\s*)(["\'][^"\']*["\']|[^\s,}]+)'
        )
        return sensitive_field.sub(r'\1"[REDACTED]"', output)

    def run_command(self, cmd, timeout=30):
        """Execute a command, print its redacted output, and return success."""
        success, output = self._execute_command(cmd, timeout)
        if output:
            print("✅ Output:" if success else "❌ Output:")
            print(output)
        return success

    def run_command_output(self, cmd, timeout=30):
        """Execute a command and return ``(success, redacted_output)``."""
        return self._execute_command(cmd, timeout)

    def upload_file(self, local_path, remote_path):
        """Upload a file with SCP and move it through ``suweb`` if needed."""
        if not os.path.exists(local_path):
            print(f"❌ Error: Local file does not exist: {local_path}")
            return False
            
        filename = os.path.basename(local_path)
        temp_remote_path = f"/tmp/{filename}"
        
        print(f"📤 AGENT: Uploading {filename} to /tmp/...")
        
        scp_cmd = f"scp -P {self.port} {local_path} {self.user}@{self.host}:{temp_remote_path}"
        
        try:
            child = pexpect.spawn(scp_cmd, encoding="utf-8")
            i = child.expect(["password:", "yes/no", pexpect.EOF])
            
            if i == 0:
                child.sendline(self.password)
            elif i == 1:
                child.sendline("yes")
                child.expect("password:")
                child.sendline(self.password)
                
            child.expect(pexpect.EOF)
            print("✅ Upload to /tmp completed.")
            
            move_cmd = f"mv {temp_remote_path} {remote_path}"
            if self.suweb_pass:
                print("🚚 AGENT: Moving file through the privileged session.")
            return self.run_command(move_cmd)

        except Exception as error:
            print(f"❌ Upload failed: {self._redact_output(str(error))}")
            return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python remote_agent.py exec [--timeout SECONDS] <command>")
        print("  python remote_agent.py drush <cmd>")
        print("  python remote_agent.py upload <local_file> <remote_path>")
        sys.exit(1)
        
    action = sys.argv[1]
    agent = DrupalRemoteAgent()
    
    if action == "drush":
        cmd = f"drush {' '.join(sys.argv[2:])}"
        success = agent.run_command(cmd)
        sys.exit(0 if success else 1)
    elif action == "upload":
        if len(sys.argv) < 4:
            print("The local and remote paths are required.")
            sys.exit(1)
        local = sys.argv[2]
        remote = sys.argv[3]
        success = agent.upload_file(local, remote)
        sys.exit(0 if success else 1)
    elif action == "exec":
        args = sys.argv[2:]
        timeout = 30
        if args[:1] == ["--timeout"]:
            if len(args) < 3:
                print("The timeout and command are required.")
                sys.exit(1)
            timeout = int(args[1])
            args = args[2:]
        cmd = " ".join(args)
        success = agent.run_command(cmd, timeout=timeout)
        sys.exit(0 if success else 1)
    else:
        print("Unknown action.")
        sys.exit(1)
