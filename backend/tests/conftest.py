"""Shared pytest fixtures.

Includes a session-scoped sweep that removes any `pytest-*` page leftover at
the end of a run. Per-test fixtures already DELETE the pages they create,
but if the backend dies mid-test, the cleanup never runs and pages keep
piling up in the vault sidebar over time.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
import requests

from backend.tests.live_e2e_cleanup import (
    cleanup_live_test_page,
    select_owned_active_page_ids,
    select_owned_trash_entry_ids,
    unique_page_ids,
)


log = logging.getLogger(__name__)

BACKEND = os.environ.get("GNOSI_BACKEND_URL", "http://127.0.0.1:5002")
RUN_LIVE_E2E = os.environ.get("GNOSI_RUN_LIVE_E2E", "").strip().lower() in {
    "1", "true", "yes",
}

# E2E helpers talk to a LIVE backend. Unauthenticated calls only work while it
# still falls back to the legacy account; against one running with
# GNOSI_REQUIRE_AUTH they get a 401. Export a Personal Access Token as
# GNOSI_API_TOKEN to run them there. Absent, nothing is sent and behaviour is
# unchanged.
_API_TOKEN = os.environ.get("GNOSI_API_TOKEN", "").strip()
AUTH_HEADERS = {"Authorization": f"Bearer {_API_TOKEN}"} if _API_TOKEN else {}


@pytest.fixture
def isolated_validation_runtime(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Path:
    """Provide a disposable, credential-free runtime only to tests that request it."""
    root = tmp_path / "validation-runtime"
    paths = {
        "GNOSI_DATA_DIR": root / "data",
        "DIGITAL_BRAIN_VAULT_PATH": root / "vault",
        "VAULT_HOST_PATH": root / "vault",
        "HOME_HOST_PATH": root / "host",
    }
    for path in {root, *paths.values()}:
        path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("GNOSI_VALIDATION_ROOT", str(root))
    for name, path in paths.items():
        monkeypatch.setenv(name, str(path))
    monkeypatch.setenv("GNOSI_RUN_LIVE_E2E", "0")
    monkeypatch.setenv("GNOSI_DISABLE_SCHEDULER", "1")
    monkeypatch.delenv("GNOSI_SHARED_ENV_FILE", raising=False)

    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()
    return root


def _backend_alive() -> bool:
    try:
        return (
            requests.get(f"{BACKEND}/api/health", timeout=2).status_code == 200
        )
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def _cleanup_pytest_pages() -> Iterator[None]:
    """Permanently remove artifacts owned by known opt-in live tests.

    This is a safety net: each test's own fixture should still try to clean
    up its own page, but if a previous run crashed those orphans accumulate
    in the Vault or its Trash. Selection requires an exact known title shape,
    a valid UUID, and—for Trash entries—the matching original filename.
    """
    yield

    if not RUN_LIVE_E2E or not _backend_alive():
        return

    active_ids: list[str] = []
    trash_ids: list[str] = []
    try:
        response = requests.get(
            f"{BACKEND}/api/vault/pages", headers=AUTH_HEADERS, timeout=15
        )
        response.raise_for_status()
        active_ids = select_owned_active_page_ids(response.json())
    except Exception as exc:
        log.warning("Could not inspect live-test pages for cleanup: %s", exc)

    try:
        response = requests.get(
            f"{BACKEND}/api/vault/trash", headers=AUTH_HEADERS, timeout=15
        )
        response.raise_for_status()
        trash_ids = select_owned_trash_entry_ids(response.json())
    except Exception as exc:
        log.warning("Could not inspect live-test Trash entries for cleanup: %s", exc)

    def _delete(url: str) -> requests.Response:
        return requests.delete(
            url,
            headers=AUTH_HEADERS,
            timeout=5,
        )

    removed = 0
    for page_id in unique_page_ids([active_ids, trash_ids]):
        try:
            cleanup_live_test_page(BACKEND, page_id, _delete)
            removed += 1
        except Exception as exc:
            log.warning("Could not remove live-test page %s: %s", page_id, exc)

    if removed:
        log.info("Cleaned up %d proven live-test page artifacts", removed)
