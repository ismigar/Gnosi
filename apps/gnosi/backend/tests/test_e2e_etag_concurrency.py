"""E2E test for the optimistic-concurrency etag flow on /api/vault/pages.

Scenario this protects against:
    1. Client A opens a note → receives etag E1.
    2. Client B (or external sync from another device) modifies the file.
    3. Client A saves with `expected_etag=E1` → server must respond 409.
    4. Client A re-fetches → receives new etag E2.
    5. Client A saves with `expected_etag=E2` → success.
    6. Client A saves with `force=true` → success even with stale etag.
"""
from __future__ import annotations

import os
import time
import uuid as _uuid

import pytest
import requests

BACKEND = os.environ.get("GNOSI_BACKEND_URL", "http://127.0.0.1:5002")


def _alive() -> bool:
    try:
        return requests.get(f"{BACKEND}/api/health", timeout=2).status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _alive(), reason="backend not reachable")


@pytest.fixture
def page_id():
    """Create a throwaway page and yield its id; delete after the test."""
    pid = str(_uuid.uuid4())
    payload = {
        "title": f"pytest-etag-{pid[:8]}",
        "content": "initial body",
        "metadata": {"id": pid},
    }
    r = requests.put(f"{BACKEND}/api/vault/pages/{pid}", json=payload, timeout=30)
    r.raise_for_status()
    yield pid
    try:
        requests.delete(f"{BACKEND}/api/vault/pages/{pid}", timeout=5)
    except Exception:
        pass


def _get(pid):
    r = requests.get(f"{BACKEND}/api/vault/pages/{pid}", timeout=5)
    r.raise_for_status()
    return r.json()


def test_etag_present_in_get_response(page_id):
    page = _get(page_id)
    assert page.get("etag"), "GET /pages/{id} should return an etag"


def test_save_with_correct_etag_succeeds(page_id):
    page = _get(page_id)
    etag = page["etag"]
    payload = {
        "title": page["title"],
        "content": "edited body v2",
        "metadata": page["metadata"],
        "expected_etag": etag,
    }
    r = requests.put(f"{BACKEND}/api/vault/pages/{page_id}", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    new_etag = r.json().get("etag")
    assert new_etag and new_etag != etag, "save response must include refreshed etag"


def test_save_with_stale_etag_returns_409(page_id):
    """Simulate concurrent edit by saving once, then re-saving with the OLD etag."""
    page = _get(page_id)
    old_etag = page["etag"]
    # First save bumps the etag
    requests.put(
        f"{BACKEND}/api/vault/pages/{page_id}",
        json={
            "title": page["title"], "content": "first edit",
            "metadata": page["metadata"], "expected_etag": old_etag,
        },
        timeout=30,
    ).raise_for_status()
    # Second save with the OLD etag must conflict
    r = requests.put(
        f"{BACKEND}/api/vault/pages/{page_id}",
        json={
            "title": page["title"], "content": "stale-edit attempt",
            "metadata": page["metadata"], "expected_etag": old_etag,
        },
        timeout=30,
    )
    assert r.status_code == 409, f"expected 409 etag_mismatch; got {r.status_code} {r.text}"
    detail = r.json().get("detail", {})
    assert detail.get("error") == "etag_mismatch"
    assert "current_etag" in detail


def test_force_overrides_etag_check(page_id):
    page = _get(page_id)
    # Save once (so we know the next etag would mismatch)
    requests.put(
        f"{BACKEND}/api/vault/pages/{page_id}",
        json={
            "title": page["title"], "content": "v2",
            "metadata": page["metadata"], "expected_etag": page["etag"],
        },
        timeout=30,
    ).raise_for_status()
    # Stale etag + force=True must succeed
    r = requests.put(
        f"{BACKEND}/api/vault/pages/{page_id}",
        json={
            "title": page["title"], "content": "force-overwrite",
            "metadata": page["metadata"],
            "expected_etag": page["etag"],  # stale
            "force": True,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text


def test_save_without_expected_etag_skips_check(page_id):
    """Backwards compat: clients that don't send expected_etag still work."""
    page = _get(page_id)
    r = requests.put(
        f"{BACKEND}/api/vault/pages/{page_id}",
        json={
            "title": page["title"], "content": "no-etag-field",
            "metadata": page["metadata"],
        },
        timeout=30,
    )
    assert r.status_code == 200
