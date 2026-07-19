"""Shared pytest fixtures.

Includes a session-scoped sweep that removes any `pytest-*` page leftover at
the end of a run. Per-test fixtures already DELETE the pages they create,
but if the backend dies mid-test, the cleanup never runs and pages keep
piling up in the vault sidebar over time.
"""
from __future__ import annotations

import os

import pytest
import requests

BACKEND = os.environ.get("GNOSI_BACKEND_URL", "http://127.0.0.1:5002")

# E2E helpers talk to a LIVE backend. Unauthenticated calls only work while it
# still falls back to the legacy account; against one running with
# GNOSI_REQUIRE_AUTH they get a 401. Export a Personal Access Token as
# GNOSI_API_TOKEN to run them there. Absent, nothing is sent and behaviour is
# unchanged.
_API_TOKEN = os.environ.get("GNOSI_API_TOKEN", "").strip()
AUTH_HEADERS = {"Authorization": f"Bearer {_API_TOKEN}"} if _API_TOKEN else {}


def _backend_alive() -> bool:
    try:
        return (
            requests.get(f"{BACKEND}/api/health", timeout=2).status_code == 200
        )
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def _cleanup_pytest_pages():
    """Remove `pytest-*` titled pages after the whole session finishes.

    This is a safety net: each test's own fixture should still try to clean
    up its own page, but if a previous run crashed those orphans accumulate
    in the vault. We only delete pages whose title starts with `pytest-`
    so user content is never affected.
    """
    yield

    if not _backend_alive():
        return

    try:
        r = requests.get(f"{BACKEND}/api/vault/pages", headers=AUTH_HEADERS, timeout=15)
        r.raise_for_status()
        pages = r.json()
    except Exception:
        return

    removed = 0
    for page in pages:
        title = (page.get("title") or "")
        if not title.startswith("pytest-"):
            continue
        page_id = page.get("id")
        if not page_id:
            continue
        try:
            requests.delete(
                f"{BACKEND}/api/vault/pages/{page_id}", headers=AUTH_HEADERS, timeout=5
            )
            removed += 1
        except Exception:
            pass

    if removed:
        print(f"\n[conftest] Cleaned up {removed} leftover pytest-* pages.")
