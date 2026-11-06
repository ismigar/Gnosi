"""Device-only website connection secrets, scoped to the exact remote account."""
from __future__ import annotations

from fastapi import HTTPException

from .models import TargetConnection, TargetConnectionSecret
from .storage import SiteStore, fingerprint

SERVICE = "gnosi-websites-ssh"


def _key(store: SiteStore, site_id: str, target_id: str, settings: TargetConnection) -> str:
    site = store.load(site_id)
    if not any(target.id == target_id for target in site.targets):
        raise HTTPException(404, "Website destination not found")
    return fingerprint([store.private_root.name, site_id, target_id,
                        settings.host, settings.port, settings.username])


def password(store: SiteStore, site_id: str, target_id: str, settings: TargetConnection) -> str | None:
    if settings.authentication != "password":
        return None
    import keyring
    key = _key(store, site_id, target_id, settings)
    try:
        return keyring.get_password(SERVICE, key)
    except Exception:
        raise HTTPException(503, "The system credential store is unavailable") from None


def decorated(store: SiteStore, site_id: str, target_id: str, settings: TargetConnection) -> TargetConnection:
    secret = password(store, site_id, target_id, settings)
    value = settings.model_copy(update={"password_configured": bool(secret)})
    value._password = secret
    return value


def save_secret(store: SiteStore, site_id: str, target_id: str, request: TargetConnectionSecret) -> None:
    from .runtime import connection
    import keyring
    settings = connection(store, site_id, target_id)
    key = _key(store, site_id, target_id, settings)
    if settings.authentication != "password" or not settings.host or not settings.username:
        raise HTTPException(409, "Save the password-authenticated server connection first")
    value = request.password.get_secret_value() if request.password is not None else ""
    if request.clear == bool(value):
        raise HTTPException(422, "Choose a password or clear the saved password")
    try:
        if request.clear:
            if keyring.get_password(SERVICE, key) is not None:
                keyring.delete_password(SERVICE, key)
        else:
            keyring.set_password(SERVICE, key, value)
    except Exception:
        raise HTTPException(503, "The system credential store is unavailable") from None
