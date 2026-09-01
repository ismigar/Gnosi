"""Comment and sync import-order checks in disposable isolated child runtimes."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


PROBE = """
import importlib
import json
import socket
import sys

def forbidden(*args, **kwargs):
    raise AssertionError('Unexpected network access during import')

socket.socket.connect = forbidden
socket.create_connection = forbidden
importlib.import_module(sys.argv[1])
from backend.api import vault_routes as facade
from backend.domains.vault.comments import composition
from backend.domains.vault.pages import sync_routes
from fastapi.openapi.utils import get_openapi

assert facade._load_comments is composition._load_comments
assert facade._save_comments is composition._save_comments
assert facade._load_inline_comments is sync_routes._load_inline_comments
assert facade._COMMENTS_DEPENDENCIES.resolve_page_loader() is facade._load_comments
assert facade._COMMENTS_DEPENDENCIES.resolve_inline_loader() is facade._load_inline_comments
assert facade._COMMENTS_DEPENDENCIES.resolve_json_writer() is facade.safe_write_json
assert sync_routes.ImportRequest.model_validate({'files': [{'name': 'note', 'content': 'body'}]}).files[0].name == 'note'
result = get_openapi(title='Synthetic comment bootstrap', version='1', routes=facade.router.routes)
sys.stdout.write(json.dumps(result, sort_keys=True) + '\\n')
"""


def test_sync_and_comment_first_imports_preserve_complete_openapi(tmp_path: Path) -> None:
    reports: list[object] = []
    for index, first in enumerate((
        "backend.api.vault_routes",
        "backend.domains.vault.comments.composition",
        "backend.domains.vault.pages.sync_routes",
    )):
        fixture = tmp_path / str(index)
        for name in ("data", "vault", "host"):
            (fixture / name).mkdir(parents=True)
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(fixture),
            "GNOSI_DATA_DIR": str(fixture / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(fixture / "vault"),
            "VAULT_HOST_PATH": str(fixture / "vault"),
            "HOME_HOST_PATH": str(fixture / "host"),
            "GNOSI_SHARED_ENV_FILE": str(fixture / "disabled.env"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
        }
        result = subprocess.run(
            [sys.executable, "-c", PROBE, first],
            cwd=Path(__file__).resolve().parents[2],
            env=environment,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        reports.append(json.loads(result.stdout.splitlines()[-1]))
    assert reports[0] == reports[1] == reports[2]
