"""Plugin signing and trust (phase 3 of plugin_system.md).

Trust model for DISTRIBUTED plugins (gallery/remote index), in the style of
signed extensions: a publisher signs the `.zip` with an Ed25519 private key;
Gnosi verifies the signature against its TRUST STORE of public keys (official
+ user-added). DETACHED signature over the zip bytes (it doesn't live inside
the zip → avoids the chicken-and-egg problem).

Installation policy (applied in `plugin_catalog`/`plugin_system`):
  * entry with a `signature` that verifies with a trusted key → install.
  * entry with a `signature` that does NOT verify with any trusted key → REJECT
    (tampering or unknown publisher).
  * entry WITHOUT a `signature` → installs but is marked as "unsigned"
    (like Obsidian's "unverified" plugins). The UI can warn about it.

Key/sig format: base64 of the raw Ed25519 public key/signature (32/64 bytes).
Store: `.gnosi/plugins_trust.json` = {"keys": {"<name>": "<pubkey_b64>"}}.
"""

from __future__ import annotations

import base64
import json
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Dict, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from backend.config.logger_config import get_logger
from extensions.marketplace.signing_policy import OFFICIAL_PUBLIC_KEY_B64

logger = get_logger(__name__)

_trust_lock = threading.Lock()

# Trusted PUBLIC keys that ship with Gnosi ("official" publishers). The
# `gnosi-official` key verifies plugins signed by the Gnosi team; the
# its PRIVATE lives outside the repo (at `~/.gnosi-local/plugin_signing_key.json`,
# 600 permissions) and is used with `extensions/examples/sign_plugin.py`. The user can
# add more trusted publishers to their store (`.gnosi/plugins_trust.json`).
BUNDLED_TRUSTED_KEYS: Dict[str, str] = {
    "gnosi-official": OFFICIAL_PUBLIC_KEY_B64,
}


def _trust_path(config_dir: Path) -> Path:
    return Path(config_dir) / "plugins_trust.json"


# --- Primitives Ed25519 ------------------------------------------------------
def generate_keypair() -> Dict[str, str]:
    """Generates an Ed25519 key pair. Returns {'private','public'} in base64.

    For authoring tools/tests. The private key must NEVER ship with Gnosi.

    """
    priv = Ed25519PrivateKey.generate()
    raw_priv = priv.private_bytes_raw()
    raw_pub = priv.public_key().public_bytes_raw()
    return {
        "private": base64.b64encode(raw_priv).decode(),
        "public": base64.b64encode(raw_pub).decode(),
    }


def sign(private_key_b64: str, data: bytes) -> str:
    """Signs `data` with an Ed25519 private key (raw base64). Returns the signature in base64."""
    raw = base64.b64decode(private_key_b64)
    priv = Ed25519PrivateKey.from_private_bytes(raw)
    return base64.b64encode(priv.sign(data)).decode()


def verify(public_key_b64: str, signature_b64: str, data: bytes) -> bool:
    """True if `signature_b64` is a valid signature of `data` for `public_key_b64`."""
    try:
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        pub.verify(base64.b64decode(signature_b64), data)
        return True
    except (InvalidSignature, ValueError):
        return False
    except Exception:  # noqa: BLE001 — unexpected base64/format → invalid
        return False


# --- Trust store ---------------------------------------------------------------
def load_trust_store(config_dir: Path) -> Dict[str, str]:
    """Trust keys: bundled (official) + those from `.gnosi/plugins_trust.json`."""
    keys = dict(BUNDLED_TRUSTED_KEYS)
    path = _trust_path(config_dir)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            user_keys = data.get("keys") if isinstance(data, dict) else None
            if isinstance(user_keys, dict):
                for name, pk in user_keys.items():
                    if isinstance(pk, str):
                        keys[str(name)] = pk
        except Exception:  # noqa: BLE001
            logger.warning("plugins_trust.json il·legible")
    return keys


def add_trusted_key(config_dir: Path, name: str, public_key_b64: str) -> None:
    """Adds (or updates) a trusted public key in the user's store."""
    # Validates that it's a valid Ed25519 key before saving it.
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"clau pública Ed25519 invàlida: {e}") from e
    with _trust_lock:
        path = _trust_path(config_dir)
        data: dict[str, Any] = {"keys": {}}
        if path.exists():
            try:
                loaded: object = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = {str(key): value for key, value in loaded.items()}
            except Exception:  # noqa: BLE001
                data = {"keys": {}}
        raw_keys = data.get("keys")
        keys = dict(raw_keys) if isinstance(raw_keys, Mapping) else {}
        keys[str(name)] = public_key_b64
        data["keys"] = keys
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def remove_trusted_key(config_dir: Path, name: str) -> None:
    with _trust_lock:
        path = _trust_path(config_dir)
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8")) or {"keys": {}}
        except Exception:  # noqa: BLE001
            return
        if isinstance(data.get("keys"), dict):
            data["keys"].pop(name, None)
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def verify_against_trust(config_dir: Path, signature_b64: str, data: bytes) -> Optional[str]:
    """Returns the NAME of the trusted key that verifies the signature, or None."""
    if not signature_b64:
        return None
    for name, pub in load_trust_store(config_dir).items():
        if verify(pub, signature_b64, data):
            return name
    return None
