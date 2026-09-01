"""Fail-closed signing policy shared by official marketplace builders."""

from __future__ import annotations

import base64
import json
import os

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

OFFICIAL_PUBLIC_KEY_B64 = "E2CjszyBQSLgm0D1FejG/1j835WBmGRoghnyiXAOrk0="


def _decode_private_key(raw: str) -> Ed25519PrivateKey:
    value = raw.strip()
    if value.startswith("{"):
        document = json.loads(value)
        if not isinstance(document, dict) or not isinstance(document.get("private"), str):
            raise RuntimeError("GNOSI_PLUGIN_SIGNING_KEY JSON must contain a private string")
        value = document["private"]
    try:
        key_bytes = base64.b64decode(value, validate=True)
        return Ed25519PrivateKey.from_private_bytes(key_bytes)
    except (ValueError, TypeError) as error:
        raise RuntimeError("GNOSI_PLUGIN_SIGNING_KEY is not a raw Ed25519 private key") from error


def load_official_private_key(
    *,
    expected_public_key: str = OFFICIAL_PUBLIC_KEY_B64,
) -> Ed25519PrivateKey:
    """Load the CI key and prove it corresponds to the bundled public key."""

    raw = os.environ.get("GNOSI_PLUGIN_SIGNING_KEY", "")
    if not raw.strip():
        raise RuntimeError("GNOSI_PLUGIN_SIGNING_KEY is required for official release indexes")
    private_key = _decode_private_key(raw)
    actual_public_key = base64.b64encode(
        private_key.public_key().public_bytes_raw()
    ).decode("ascii")
    if actual_public_key != expected_public_key:
        raise RuntimeError(
            "GNOSI_PLUGIN_SIGNING_KEY does not match the bundled gnosi-official public key"
        )
    return private_key
