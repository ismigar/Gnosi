from __future__ import annotations

import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.security.plugin_trust_root import OFFICIAL_PLUGIN_PUBLIC_KEY_B64
from extensions.marketplace.signing_policy import (
    OFFICIAL_PUBLIC_KEY_B64,
    load_official_private_key,
)


def _keypair() -> tuple[str, str]:
    private_key = Ed25519PrivateKey.generate()
    return (
        base64.b64encode(private_key.private_bytes_raw()).decode("ascii"),
        base64.b64encode(private_key.public_key().public_bytes_raw()).decode("ascii"),
    )


def test_release_tooling_reuses_runtime_public_trust_root() -> None:
    assert OFFICIAL_PUBLIC_KEY_B64 == OFFICIAL_PLUGIN_PUBLIC_KEY_B64


def test_release_signing_key_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GNOSI_PLUGIN_SIGNING_KEY", raising=False)
    with pytest.raises(RuntimeError, match="is required"):
        load_official_private_key()


@pytest.mark.parametrize("value", ["not-base64", "{}", '{"private": 3}'])
def test_release_signing_key_rejects_malformed_values(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("GNOSI_PLUGIN_SIGNING_KEY", value)
    with pytest.raises((RuntimeError, json.JSONDecodeError)):
        load_official_private_key()


def test_release_signing_key_must_match_bundled_public_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, _public_key = _keypair()
    _other_private, other_public = _keypair()
    monkeypatch.setenv("GNOSI_PLUGIN_SIGNING_KEY", private_key)
    with pytest.raises(RuntimeError, match="does not match"):
        load_official_private_key(expected_public_key=other_public)


@pytest.mark.parametrize("as_json", [False, True])
def test_release_signing_key_accepts_raw_or_keyfile_format_for_matching_key(
    monkeypatch: pytest.MonkeyPatch,
    as_json: bool,
) -> None:
    private_key, public_key = _keypair()
    value = json.dumps({"private": private_key}) if as_json else private_key
    monkeypatch.setenv("GNOSI_PLUGIN_SIGNING_KEY", value)
    loaded = load_official_private_key(expected_public_key=public_key)
    assert loaded.private_bytes_raw() == base64.b64decode(private_key)
