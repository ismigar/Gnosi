"""Signatura i confiança de plugins (fase 3 de plugin_system.md).

Model de confiança per a plugins DISTRIBUÏTS (galeria/índex remot), a l'estil de
les extensions signades: un editor signa el `.zip` amb una clau privada Ed25519;
Gnosi verifica la signatura contra el seu MAGATZEM DE CONFIANÇA de claus
públiques (oficials + afegides per l'usuari). Signatura DETACHED sobre els bytes
del zip (no viu dins del zip → evita el problema de l'ou i la gallina).

Política d'instal·lació (aplicada a `plugin_catalog`/`plugin_system`):
  * entrada amb `signature` que verifica amb una clau de confiança → instal·la.
  * entrada amb `signature` que NO verifica amb cap clau de confiança → REBUTJA
    (manipulació o editor desconegut).
  * entrada SENSE `signature` → s'instal·la però queda marcada com a "no signada"
    (com els plugins "no verificats" d'Obsidian). La UI ho pot advertir.

Format de clau/sig: base64 de la clau pública/signatura Ed25519 crua (32/64 bytes).
Magatzem: `.gnosi/plugins_trust.json` = {"keys": {"<nom>": "<pubkey_b64>"}}.
"""
from __future__ import annotations

import base64
import json
import threading
from pathlib import Path
from typing import Dict, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

_trust_lock = threading.Lock()

# Claus PÚBLIQUES de confiança que viatgen amb Gnosi (editors "oficials"). La
# clau `gnosi-official` verifica els plugins signats per l'equip de Gnosi; la
# seva PRIVADA viu fora del repo (a `~/.gnosi-local/plugin_signing_key.json`,
# permisos 600) i s'usa amb `plugins-examples/sign_plugin.py`. L'usuari pot
# afegir més editors de confiança al seu magatzem (`.gnosi/plugins_trust.json`).
BUNDLED_TRUSTED_KEYS: Dict[str, str] = {
    "gnosi-official": "E2CjszyBQSLgm0D1FejG/1j835WBmGRoghnyiXAOrk0=",
}


def _trust_path(config_dir: Path) -> Path:
    return Path(config_dir) / "plugins_trust.json"


# --- Primitives Ed25519 ------------------------------------------------------
def generate_keypair() -> Dict[str, str]:
    """Genera un parell de claus Ed25519. Retorna {'private','public'} en base64.

    Per a eines d'autor/tests. La privada MAI ha de viatjar amb Gnosi.
    """
    priv = Ed25519PrivateKey.generate()
    raw_priv = priv.private_bytes_raw()
    raw_pub = priv.public_key().public_bytes_raw()
    return {
        "private": base64.b64encode(raw_priv).decode(),
        "public": base64.b64encode(raw_pub).decode(),
    }


def sign(private_key_b64: str, data: bytes) -> str:
    """Signa `data` amb una clau privada Ed25519 (base64 crua). Retorna sig base64."""
    raw = base64.b64decode(private_key_b64)
    priv = Ed25519PrivateKey.from_private_bytes(raw)
    return base64.b64encode(priv.sign(data)).decode()


def verify(public_key_b64: str, signature_b64: str, data: bytes) -> bool:
    """True si `signature_b64` és una signatura vàlida de `data` per `public_key_b64`."""
    try:
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        pub.verify(base64.b64decode(signature_b64), data)
        return True
    except (InvalidSignature, ValueError):
        return False
    except Exception:  # noqa: BLE001 — base64/format inesperat → no vàlida
        return False


# --- Magatzem de confiança ---------------------------------------------------
def load_trust_store(config_dir: Path) -> Dict[str, str]:
    """Claus de confiança: bundled (oficials) + les de `.gnosi/plugins_trust.json`."""
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
    """Afegeix (o actualitza) una clau pública de confiança al magatzem d'usuari."""
    # Valida que és una clau Ed25519 vàlida abans de desar-la.
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"clau pública Ed25519 invàlida: {e}") from e
    with _trust_lock:
        path = _trust_path(config_dir)
        data = {"keys": {}}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8")) or {"keys": {}}
            except Exception:  # noqa: BLE001
                data = {"keys": {}}
        data.setdefault("keys", {})
        data["keys"][str(name)] = public_key_b64
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
    """Retorna el NOM de la clau de confiança que verifica la signatura, o None."""
    if not signature_b64:
        return None
    for name, pub in load_trust_store(config_dir).items():
        if verify(pub, signature_b64, data):
            return name
    return None
