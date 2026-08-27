"""Frozen public HTTP contract for behavior-preserving backend extraction."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from backend.server import app


EXPECTED_HASH_PATH = Path(__file__).parent / "contracts" / "openapi.sha256"


def test_openapi_is_byte_stable_during_backend_modularization() -> None:
    payload = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
    actual = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    expected = EXPECTED_HASH_PATH.read_text(encoding="utf-8").strip()

    assert actual == expected, (
        "The public OpenAPI contract changed during a structural backend move. "
        "Generate both documents and review their exact diff before updating the hash."
    )
