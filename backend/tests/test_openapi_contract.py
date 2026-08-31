"""Frozen public HTTP contract for behavior-preserving backend extraction."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from backend.server import app

EXPECTED_HASH_PATH = Path(__file__).parent / "contracts" / "openapi.sha256"
COMMITTED_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "openapi" / "openapi.json"


def test_openapi_is_byte_stable_during_backend_modularization() -> None:
    payload = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
    actual = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    expected = EXPECTED_HASH_PATH.read_text(encoding="utf-8").strip()

    assert actual == expected, (
        "The public OpenAPI contract changed during a structural backend move. "
        "Generate both documents and review their exact diff before updating the hash."
    )


def test_cross_domain_response_models_keep_stable_component_names() -> None:
    schemas = app.openapi()["components"]["schemas"]

    assert "ScheduledTaskResponse" in schemas
    assert "PlanningScheduledTaskResponse" in schemas


def test_runtime_openapi_matches_the_committed_document_byte_for_byte() -> None:
    payload = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
    assert payload.encode("utf-8") == COMMITTED_SCHEMA_PATH.read_bytes()


def test_vault_delete_description_keeps_file_removal_explicitly_optional() -> None:
    # Reviewed description-only change in 369a57a8c: the wire contract stays
    # unchanged, particularly the opt-in default for deleting files.
    operation = app.openapi()["paths"]["/api/vaults/{vault_id}"]["delete"]
    assert operation["description"] == (
        "Delete a vault registration and optionally its files with `delete_files=true`.\n\n"
        "The active vault and the main vault cannot be deleted."
    )
    assert operation["operationId"] == "delete_vault_api_vaults__vault_id__delete"
    deletion_parameters = [
        parameter for parameter in operation["parameters"] if parameter["name"] == "delete_files"
    ]
    assert deletion_parameters == [
        {
            "in": "query",
            "name": "delete_files",
            "required": False,
            "schema": {"default": False, "title": "Delete Files", "type": "boolean"},
        }
    ]
