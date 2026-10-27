"""Disposable HTTP and SMTP contracts; no production service is accessed."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT.parent / "public"
PHP = shutil.which("php") or "php"


class ServiceHTTP(unittest.TestCase):
    """Exercise the real public scripts with isolated private storage."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="gnosi-sites-http-")
        self.private = Path(self.temporary.name)
        self.public = self.private / "public"
        shutil.copytree(PUBLIC / "api", self.public / "api")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.origin = f"http://127.0.0.1:{port}"
        self.config = {
            "site_id": "http-test", "public_base_url": self.origin,
            "db_path": str(self.private / "state.sqlite"),
            "spool_path": str(self.private / "spool"),
            "library_path": str(ROOT / "library.php"), "test_mode": True,
            "forms": [{
                "id": "contact", "revision": 1, "enabled": True,
                "fields": [
                    {"id": "email", "type": "email", "label": {"ca": "Correu"}, "required": True, "max_length": 254},
                    {"id": "message", "type": "textarea", "label": {"ca": "Missatge"}, "required": True, "max_length": 1000},
                ],
                "confirmation": {"ca": "Gràcies!"}, "require_privacy": True,
            }],
            "form_delivery": {"contact": {"recipients": ["owner@example.invalid"], "subject": "Contact"}},
        }
        self.config_path = self.private / "config.json"
        self.config_path.write_text(json.dumps(self.config))
        env = dict(os.environ, GNOSI_SITES_SERVICE_CONFIG=str(self.config_path))
        self.log = (self.private / "http.log").open("wb")
        self.process = subprocess.Popen([PHP, "-S", f"127.0.0.1:{port}", "-t", str(self.public)], env=env, stdout=self.log, stderr=self.log)
        for _ in range(80):
            try:
                with urllib.request.urlopen(self.origin + "/api/newsletter.php?action=confirm", timeout=0.5):
                    break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.025)
        else:
            raise RuntimeError("Disposable PHP server failed to start")

    def tearDown(self) -> None:
        self.process.terminate()
        self.process.wait(timeout=5)
        self.log.close()
        self.temporary.cleanup()

    def request(self, path: str, data: object | None = None, *, origin: str | None = None, json_response: bool = True) -> tuple[int, str, object]:
        headers = {"Accept": "application/json" if json_response else "text/html"}
        encoded: bytes | None = None
        if data is not None:
            headers.update({"Content-Type": "application/json", "Origin": origin or self.origin})
            encoded = json.dumps(data).encode()
        req = urllib.request.Request(self.origin + path, data=encoded, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read().decode(), response.headers

    def contact(self) -> dict[str, object]:
        return {"form_id": "contact", "revision": 1, "language": "ca", "_request_id": "synthetic-http-request", "values": {"email": "reader@example.invalid", "message": "<script>example</script>"}, "privacy": "1"}

    def test_contact_and_privacy(self) -> None:
        status, body, headers = self.request("/api/contact.php", self.contact())
        self.assertEqual(status, 200)
        self.assertIn("Gràcies", body)
        self.assertIn("no-store", str(headers))
        self.assertNotIn("owner@example.invalid", body)
        self.assertNotIn(str(self.private), body)
        with sqlite3.connect(self.config["db_path"]) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT status FROM queue").fetchone()[0], "pending")
        self.assertEqual(self.request("/api/contact.php", self.contact(), origin="https://other.invalid")[0], 403)
        self.assertEqual(self.request("/api/contact.php")[0], 405)
        changed = self.contact()
        changed["values"] = {"email": "invalid", "message": "<script>keep me</script>"}
        status, body, _ = self.request("/api/contact.php", changed, json_response=False)
        self.assertEqual(status, 422)
        self.assertIn("&lt;script&gt;keep me&lt;/script&gt;", body)
        self.assertNotIn("<script>", body)
        self.assertIn('value="invalid"', body)

    def test_lifecycle_get_is_read_only_and_post_confirm(self) -> None:
        request = {"action": "subscribe", "email": "reader@example.invalid", "language": "es", "consent": "1"}
        self.assertEqual(self.request("/api/newsletter.php", request)[0], 200)
        env = dict(os.environ, GNOSI_SITES_SERVICE_CONFIG=str(self.config_path))
        subprocess.run([PHP, str(ROOT / "cli.php")], input=json.dumps({"action": "worker"}), text=True, env=env, check=True, capture_output=True)
        captures = [json.loads(file.read_text()) for file in (self.private / "spool").glob("*.json")]
        import re
        token = re.search(r"action=confirm&(?:amp;)?token=([a-f0-9]{64})", captures[0]["body_html"]).group(1)
        status, body, _ = self.request(f"/api/newsletter.php?action=confirm&token={token}&language=es", json_response=False)
        self.assertEqual(status, 200)
        self.assertIn('method="post"', body)
        self.assertIn("Confirma la suscripción", body)
        with sqlite3.connect(self.config["db_path"]) as db:
            self.assertEqual(db.execute("SELECT status FROM subscribers").fetchone()[0], "pending")
        self.assertEqual(self.request("/api/newsletter.php", {"action": "confirm", "token": token, "language": "es"})[0], 200)
        with sqlite3.connect(self.config["db_path"]) as db:
            self.assertEqual(db.execute("SELECT status FROM subscribers").fetchone()[0], "active")
        self.assertEqual(self.request("/api/newsletter.php", {"action": "status"})[0], 404)

    def test_missing_config_fails_without_paths(self) -> None:
        self.config_path.unlink()
        status, body, _ = self.request("/api/contact.php", self.contact())
        self.assertEqual(status, 503)
        self.assertNotIn(str(self.private), body)

    def test_cli_cwd_may_contain_private_state(self) -> None:
        env = dict(os.environ, GNOSI_SITES_SERVICE_CONFIG=str(self.config_path))
        result = subprocess.run([PHP, str(ROOT / "cli.php")], input=json.dumps({"action": "status"}), cwd=self.private, env=env, capture_output=True, text=True, check=True, timeout=3)
        self.assertEqual(json.loads(result.stdout)["site_id"], "http-test")

    def test_http_private_boundaries_fail_closed(self) -> None:
        # Even a private environment variable must not point through a symlink
        # to a configuration that the HTTP server can serve.
        served_config = self.public / "config.json"
        served_config.write_text(json.dumps(self.config))
        self.config_path.unlink()
        self.config_path.symlink_to(served_config)
        status, body, _ = self.request("/api/contact.php", self.contact())
        self.assertEqual(status, 503)
        self.assertNotIn(str(self.private), body)
        self.config_path.unlink()
        self.config_path.write_text(json.dumps(self.config))
        for key, name in [("db_path", "exposed.sqlite"), ("spool_path", "exposed-captures")]:
            with self.subTest(key=key):
                changed = dict(self.config)
                exposed = self.public / name
                changed[key] = str(exposed)
                self.config_path.write_text(json.dumps(changed))
                status, body, _ = self.request("/api/contact.php", self.contact())
                self.assertEqual(status, 503)
                self.assertNotIn(str(self.private), body)
                self.assertFalse(exposed.exists())
        self.config_path.write_text(json.dumps(self.config))
        for root in ["", " ", str(self.private / "missing-document-root")]:
            with self.subTest(document_root=root):
                # The disposable wrapper models a misconfigured HTTP SAPI.
                (self.public / "unknown-root.php").write_text("<?php $_SERVER['DOCUMENT_ROOT']=" + json.dumps(root) + "; require __DIR__.'/api/contact.php';")
                status, body, _ = self.request("/unknown-root.php", self.contact())
                self.assertEqual(status, 503)
                self.assertNotIn(str(self.private), body)

    def test_daemon_capture_lock_heartbeat_and_private_stop(self) -> None:
        self.assertEqual(self.request("/api/contact.php", self.contact())[0], 200)
        env = dict(os.environ, GNOSI_SITES_SERVICE_CONFIG=str(self.config_path))
        once = subprocess.run([PHP, str(ROOT / "daemon.php"), "--once"], env=env, capture_output=True, text=True, check=True, timeout=5)
        self.assertEqual(json.loads(once.stdout)["delivery"]["captured"], 1)
        spool = self.private / "spool"
        self.assertFalse((spool / "daemon.pid").exists())
        daemon = subprocess.Popen([PHP, str(ROOT / "daemon.php")], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for _ in range(40):
                status = subprocess.run([PHP, str(ROOT / "cli.php")], input=json.dumps({"action": "status"}), env=env, capture_output=True, text=True, check=True, timeout=3)
                if json.loads(status.stdout)["worker"]["running"]:
                    break
                time.sleep(0.025)
            else:
                self.fail("Private daemon did not acquire its lock")
            self.assertEqual(int((spool / "daemon.pid").read_text()), daemon.pid)
            status_file = json.loads((spool / "daemon-status.json").read_text())
            self.assertTrue(status_file["running"])
            duplicate = subprocess.run([PHP, str(ROOT / "daemon.php"), "--once"], env=env, capture_output=True, text=True, check=True, timeout=3)
            self.assertEqual(duplicate.stdout, "")
            self.assertEqual(int((spool / "daemon.pid").read_text()), daemon.pid)
            (spool / ".daemon-stop").write_text("stop\n")
            daemon.communicate(timeout=4)
            self.assertEqual(daemon.returncode, 0)
            self.assertFalse((spool / "daemon.pid").exists())
            self.assertFalse(json.loads((spool / "daemon-status.json").read_text())["running"])
            stopped = subprocess.run([PHP, str(ROOT / "daemon.php"), "--once"], env=env, capture_output=True, text=True, check=True, timeout=3)
            self.assertEqual(stopped.stdout, "")
            self.assertEqual((spool / "daemon-status.json").stat().st_mode & 0o777, 0o600)
        finally:
            if daemon.poll() is None:
                daemon.terminate()
                daemon.communicate(timeout=5)


class SmtpSubmission(unittest.TestCase):
    """A fake SMTP peer demonstrates acceptance, refusal and uncertain DATA."""

    def smtp_case(self, mode: str) -> tuple[str, str]:
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        port = listener.getsockname()[1]
        captured: list[str] = []
        failures: list[BaseException] = []

        def peer() -> None:
            try:
                connection, _ = listener.accept()
                with connection:
                    connection.settimeout(5)
                    stream = connection.makefile("rwb", buffering=0)
                    stream.write(b"220 fixture\r\n")
                    while True:
                        line = stream.readline()
                        if not line:
                            break
                        if line.startswith(b"EHLO"):
                            stream.write(b"250-fixture\r\n250 OK\r\n")
                        elif line.startswith(b"MAIL"):
                            stream.write(b"250 OK\r\n")
                        elif line.startswith(b"RCPT"):
                            stream.write(b"550 rejected\r\n" if mode == "reject" else b"250 OK\r\n")
                            if mode == "reject":
                                break
                        elif line.startswith(b"DATA"):
                            stream.write(b"354 ready\r\n")
                            while True:
                                data = stream.readline()
                                if data == b".\r\n" or not data:
                                    break
                                captured.append(data.decode())
                            if mode == "drop":
                                break
                            stream.write(b"250 accepted\r\n")
                        elif line.startswith(b"QUIT"):
                            break
            except BaseException as error:
                failures.append(error)
            finally:
                listener.close()

        thread = threading.Thread(target=peer, daemon=True)
        thread.start()
        with tempfile.TemporaryDirectory(prefix="gnosi-smtp-") as temporary:
            payload = Path(temporary) / "request.json"
            payload.write_text(json.dumps({
                "smtp": {"host": "127.0.0.1", "port": port, "security": "none", "allow_insecure_loopback": True, "from": "site@example.invalid"},
                "message": {"id": "synthetic-message-id", "to_email": "reader@example.invalid", "reply_to": "visitor@example.invalid", "subject": "Fixture", "body_html": "<p>Body</p>", "body_text": "Body"},
            }))
            code = "require $argv[1];$p=json_decode(file_get_contents($argv[2]),true);try{(new SiteSmtp($p['smtp']))->send($p['message']);echo 'accepted';}catch(SiteSmtpFailure $e){echo $e->deliveryState;}"
            result = subprocess.run([PHP, "-r", code, str(ROOT / "smtp.php"), str(payload)], text=True, capture_output=True, check=True, timeout=10)
        thread.join(timeout=5)
        if failures:
            raise failures[0]
        return result.stdout, "".join(captured)

    def test_smtp_states(self) -> None:
        accepted, content = self.smtp_case("accept")
        self.assertEqual(accepted, "accepted")
        self.assertIn("Reply-To: <visitor@example.invalid>", content)
        self.assertIn("multipart/alternative", content)
        self.assertEqual(self.smtp_case("reject")[0], "rejected")
        self.assertEqual(self.smtp_case("drop")[0], "uncertain")


if __name__ == "__main__":
    unittest.main()
