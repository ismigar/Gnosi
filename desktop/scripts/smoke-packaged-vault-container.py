"""Verify multi-vault discovery in the real frozen executable, in isolation."""
import http.client
import json
import os
from pathlib import Path
import runpy
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

helpers = runpy.run_path(str(Path(__file__).with_name("smoke-packaged-backend.py")))


def request(port, route, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    try:
        connection.request("GET", route, headers=headers or {})
        response = connection.getresponse()
        data = response.read()
        if response.status != 200:
            raise RuntimeError(f"{route}: HTTP {response.status}: {data[:300]!r}")
        return json.loads(data), dict(response.getheaders())
    finally:
        connection.close()


def main():
    executable = helpers["packaged_executable"](Path(sys.argv[1])).resolve()
    with tempfile.TemporaryDirectory(prefix="gnosi-vault-acceptance-") as directory:
        root = Path(directory).resolve()
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        environment = helpers["probe_environment"](root, port, "personal", os.environ)
        environment.update(GNOSI_VAULTS_ROOT=str(root), GNOSI_DESKTOP_VAULT_DISCOVERY="1")
        wiki = root / "vault/Wiki"
        wiki.mkdir()
        page_id = "4a8acde2-b643-4685-b06d-81b21f393f31"
        (wiki / "Demand check.md").write_text(
            f"---\nid: {page_id}\ntitle: Demand check\nfavorite: true\n---\n"
            "Packaged page content is readable.\n", encoding="utf-8",
        )
        for name in ("Proves", "Marketplace Smoke Test"):
            (root / name / ".gnosi").mkdir(parents=True)
        # The strict validation harness calls its primary library "vault".
        # Principal preference itself is exercised by vault-folders.test.js.
        (root / "Assets").mkdir()
        (root / "BD").mkdir()
        with tempfile.TemporaryFile() as log:
            child = subprocess.Popen([str(executable)], cwd=root, env=environment, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline and child.poll() is None:
                    if helpers["health_matches"](port, "personal", 1):
                        break
                    time.sleep(.1)
                _, headers = request(port, "/api/health")
                assert headers.get("x-gnosi-desktop-instance") == environment["GNOSI_DESKTOP_INSTANCE"]
                catalog, _ = request(port, "/api/vaults")
                assert {v["name"] for v in catalog["vaults"]} == {"vault", "Proves", "Marketplace Smoke Test"}, catalog
                assert catalog["active_path"] == str(root / "vault"), catalog
                with sqlite3.connect(root / "data/system/management.sqlite") as database:
                    workspace = database.execute("SELECT workspace_id FROM vaults LIMIT 1").fetchone()[0]
                    database.execute("INSERT INTO vaults (id, workspace_id, name, path_override) VALUES (?, ?, ?, ?)",
                                     ("old-container-fixture", workspace, "Previous library", str(root / "old-container/Previous library")))
                refreshed, _ = request(port, "/api/vaults")
                assert len(refreshed["vaults"]) == 3, refreshed
                config, _ = request(port, "/api/config/editor")
                assert config["paths"]["vaults_root"] == str(root), config["paths"]
                deadline = time.monotonic() + 30
                while True:
                    sidebar, _ = request(port, "/api/vault/sidebar/tree")
                    favorite = next((page for page in sidebar if page["id"] == page_id), None)
                    if favorite is not None or time.monotonic() >= deadline:
                        break
                    time.sleep(.2)
                assert favorite and favorite.get("metadata", {}).get("favorite") is True, sidebar
                page, _ = request(port, f"/api/vault/pages/{page_id}")
                assert page["content"] == "Packaged page content is readable.", page
                proves = next(v for v in catalog["vaults"] if v["name"] == "Proves")
                selected, _ = request(port, "/api/vaults", {"X-Vault-Id": proves["id"]})
                assert selected["active_path"] == str(root / "Proves"), selected
                assert [v["name"] for v in selected["vaults"] if v["active"]] == ["Proves"], selected
                assert not list((root / "Assets").iterdir())
                assert not list((root / "BD").iterdir())
                print("PASS: frozen backend discovers three vaults, exposes the full container, loads a favorite and its page content, switches to Proves, and leaves container-level folders untouched.")
            finally:
                helpers["stop_process"](child)


if __name__ == "__main__":
    main()
