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
from collections.abc import Iterator

import pytest
import requests

from backend.domains.vault.registry.records import is_record
from backend.tests.live_e2e_cleanup import cleanup_live_test_page

BACKEND = os.environ.get("GNOSI_BACKEND_URL", "http://127.0.0.1:5002")
RUN_LIVE_E2E = os.environ.get("GNOSI_RUN_LIVE_E2E", "").strip().lower() in {
    "1", "true", "yes",
}


def _alive() -> bool:
    try:
        return requests.get(f"{BACKEND}/api/health", timeout=2).status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not RUN_LIVE_E2E or not _alive(),
    reason="live E2E not enabled or backend not reachable",
)


@pytest.fixture
def page_id() -> Iterator[str]:
    """Create a throwaway page and permanently remove it after the test."""
    pid = str(_uuid.uuid4())
    payload = {
        "title": f"pytest-etag-{pid[:8]}",
        "content": "initial body",
        "metadata": {"id": pid},
    }
    r = requests.put(f"{BACKEND}/api/vault/pages/{pid}", json=payload, timeout=30)
    r.raise_for_status()
    yield pid

    def _delete(url: str) -> requests.Response:
        return requests.delete(url, timeout=5)

    try:
        cleanup_live_test_page(BACKEND, pid, _delete)
    except Exception:
        pass


def _get(pid: str) -> dict[object, object]:
    r = requests.get(f"{BACKEND}/api/vault/pages/{pid}", timeout=5)
    r.raise_for_status()
    payload: object = r.json()
    assert is_record(payload)
    return payload


def test_etag_present_in_get_response(page_id: str) -> None:
    page = _get(page_id)
    assert page.get("etag"), "GET /pages/{id} should return an etag"


def test_save_with_correct_etag_succeeds(page_id: str) -> None:
    page = _get(page_id)
    etag = page["etag"]
    assert isinstance(etag, str)
    payload = {
        "title": page["title"],
        "content": "edited body v2",
        "metadata": page["metadata"],
        "expected_etag": etag,
    }
    r = requests.put(f"{BACKEND}/api/vault/pages/{page_id}", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    response_payload: object = r.json()
    assert is_record(response_payload)
    new_etag = response_payload.get("etag")
    assert new_etag and new_etag != etag, "save response must include refreshed etag"


def test_save_with_stale_etag_returns_409(page_id: str) -> None:
    """Simulate concurrent edit by saving once, then re-saving with the OLD etag."""
    page = _get(page_id)
    old_etag = page["etag"]
    assert isinstance(old_etag, str)
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
    response_payload: object = r.json()
    assert is_record(response_payload)
    detail = response_payload.get("detail")
    assert is_record(detail)
    assert detail.get("error") == "etag_mismatch"
    assert "current_etag" in detail


def test_force_overrides_etag_check(page_id: str) -> None:
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


def test_save_without_expected_etag_skips_check(page_id: str) -> None:
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
