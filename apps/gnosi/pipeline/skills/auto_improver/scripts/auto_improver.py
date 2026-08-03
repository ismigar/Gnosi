#!/usr/bin/env python3
"""Guarded native quality-loop coordinator for Gnosi."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

APP_ROOT = Path(__file__).resolve().parents[4]
REPO_ROOT = APP_ROOT.parents[2]
STATE_ROOT = APP_ROOT / "local_data" / "auto_improver"
SECRETS_ENV = APP_ROOT / "local_data" / "secrets" / "auto_improver.env"
E2E_ROOT = APP_ROOT / "e2e"
API_URL = os.environ.get("GNOSI_API_URL", "http://localhost:5002")


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def api_json(path: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = Request(f"{API_URL}{path}", headers=headers or {})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def resolve_proves_vault() -> str:
    headers = {
        "X-Workspace-Id": "personal",
        "X-User-Email": os.environ.get("GNOSI_AUTOMATION_USER", "ismigar@gmail.com"),
        "X-Role": "admin",
    }
    payload = api_json("/api/vaults", headers)
    matches = [item for item in payload.get("vaults", []) if item.get("name") == "Proves"]
    if len(matches) != 1 or not matches[0].get("id"):
        raise RuntimeError("Expected exactly one vault named 'Proves'; refusing to run.")
    return str(matches[0]["id"])


def run(command: list[str], *, env: dict[str, str], cwd: Path) -> dict[str, Any]:
    started = time.monotonic()
    completed = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True, timeout=1800)
    return {"command": command, "exit_code": completed.returncode, "stdout": completed.stdout[-12000:],
            "stderr": completed.stderr[-12000:], "duration_seconds": round(time.monotonic() - started, 2)}


def fingerprint(finding: dict[str, Any]) -> str:
    stable = json.dumps(finding, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(stable).hexdigest()[:20]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_env_file(SECRETS_ENV)
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    lock_path = STATE_ROOT / "run.lock"
    with lock_path.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        vault_id = resolve_proves_vault()
        env = os.environ.copy()
        env["GNOSI_TEST_VAULT_ID"] = vault_id
        scout = run(["npm", "exec", "playwright", "test", "tests/e2e/automation-scout.spec.ts", "--project=chromium-auth"], env=env, cwd=E2E_ROOT)
        finding = {"kind": "browser_scout", "severity": "critical" if scout["exit_code"] else "none",
                   "vault_id": vault_id, "scout": scout}
        finding["fingerprint"] = fingerprint({"kind": finding["kind"], "exit_code": scout["exit_code"], "stderr": scout["stderr"]})
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        (STATE_ROOT / f"run-{stamp}.json").write_text(json.dumps(finding, indent=2, ensure_ascii=False), encoding="utf-8")
        if scout["exit_code"] == 0 or args.dry_run:
            return scout["exit_code"]
        command_template = os.environ.get("GNOSI_AUTOMATION_AGENT_COMMAND")
        if not command_template:
            return scout["exit_code"]
        task_file = STATE_ROOT / f"task-{finding['fingerprint']}.json"
        task_file.write_text(json.dumps(finding, indent=2, ensure_ascii=False), encoding="utf-8")
        command = shlex.split(command_template.format(task_file=str(task_file)))
        result = run(command, env=env, cwd=REPO_ROOT)
        (STATE_ROOT / f"agent-{stamp}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        return result["exit_code"]


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HTTPError, URLError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"Auto improver stopped safely: {exc}", file=sys.stderr)
        raise SystemExit(2)
