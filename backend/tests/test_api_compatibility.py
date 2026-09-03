from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.check_api_compatibility import (
    Operation,
    compatibility_failures,
    current_inventory,
    historical_inventory,
    load_allowlist,
    load_baseline,
    normalize_path,
    verify_baseline_provenance,
)


ROOT = Path(__file__).resolve().parents[2]


def test_committed_v2_baseline_is_reproducible_and_current_api_is_compatible() -> None:
    payload, baseline = load_baseline()
    verify_baseline_provenance(payload, baseline)

    assert payload["source"] == {
        "ref": "v2.0.6",
        "commit": "fcfb4efc32abd5a27207c7be04b1bad13628fda1",
        "tree": "f3f67592c04dae2e0c264e176360ea29a2042d0b",
    }
    assert len(baseline) == 551
    assert {category: sum(item.category == category for item in baseline) for category in {
        "json", "stream", "download", "redirect", "websocket"
    }} == {
        "json": 522,
        "stream": 5,
        "download": 17,
        "redirect": 6,
        "websocket": 1,
    }
    assert compatibility_failures(baseline, current_inventory(), load_allowlist()) == []


def test_historical_extraction_uses_the_immutable_tag() -> None:
    commit, tree, operations = historical_inventory("v2.0.6")

    assert commit == "fcfb4efc32abd5a27207c7be04b1bad13628fda1"
    assert tree == "f3f67592c04dae2e0c264e176360ea29a2042d0b"
    assert Operation("GET", "/api/mail/events", "stream") in operations
    assert Operation("GET", "/api/vault/images/{param}", "download") in operations
    assert Operation("WEBSOCKET", "/api/vault/collab/{param}", "websocket") in operations


def test_parameter_names_and_fastapi_converters_share_one_public_identity() -> None:
    assert normalize_path("/files/{old_name:path}") == "/files/{param}"
    assert normalize_path("/files/{new_name}") == "/files/{param}"
    assert normalize_path("/files/static/{name}") != normalize_path("/other/static/{name}")


def test_missing_recategorized_and_stale_exceptions_all_fail() -> None:
    historical = [
        Operation("GET", "/json", "json"),
        Operation("GET", "/events", "stream"),
    ]
    current = [Operation("GET", "/events", "json")]
    stale = Operation("DELETE", "/retired", "json")
    failures = compatibility_failures(
        historical,
        current,
        {stale: {"disposition": "removed", "reason": "reviewed"}},
    )

    assert failures == [
        "missing: GET /json [json]",
        "category changed: GET /events [stream -> json]",
        "stale allowlist entry: DELETE /retired [json]",
    ]


def test_replacement_exception_requires_the_named_replacement() -> None:
    old = Operation("GET", "/old", "json")
    replacement = Operation("GET", "/new", "json")
    exception = {
        old: {
            "disposition": "replaced",
            "reason": "reviewed migration",
            "replacement": replacement.to_json(),
        }
    }

    assert compatibility_failures([old], [], exception) == [
        "allowlisted replacement is absent: Operation(method='GET', path='/new', category='json')"
    ]
    assert compatibility_failures([old], [replacement], exception) == []


@pytest.mark.parametrize(
    "payload",
    [
        {"exceptions": [{"method": "GET", "path": "/x", "category": "json", "reason": ""}]},
        {"exceptions": [{"method": "GET", "path": "/x", "category": "json", "reason": "x", "disposition": "replaced"}]},
        {"exceptions": [{"method": "GET", "path": "/x/*", "category": "json", "reason": "x", "disposition": "removed"}]},
        {"exceptions": [], "wildcard": "forbidden"},
    ],
)
def test_malformed_allowlist_is_rejected(tmp_path: Path, payload: dict[str, object]) -> None:
    path = tmp_path / "allowlist.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError):
        load_allowlist(path)
