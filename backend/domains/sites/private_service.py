"""Bounded private PHP service bridge; no browser-selected commands or paths."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import cast

from fastapi import HTTPException
from pydantic import JsonValue

from .models import ServiceSettings, ServiceSettingsResponse, SiteConfig
from .storage import SiteStore, private_json
from .paths import extension_root


SERVICE_ROOT = extension_root() / "server"
ALLOWED_ACTIONS = frozenset({"status", "messages_list", "messages_update", "messages_delete", "messages_export", "subscribers_list", "subscribers_import", "subscribers_update", "subscribers_export", "campaign_preview", "campaign_queue", "campaigns_list", "campaign_pause", "worker", "reconcile", "queue_list", "captured_get", "captured_apply", "retention", "maintenance"})


def service_root(store: SiteStore, site_id: str, target_id: str) -> Path:
    site = store.load(site_id)
    if target_id not in {target.id for target in site.targets}:
        raise HTTPException(404, "Website destination not found")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", target_id):
        raise HTTPException(422, "Invalid destination identity")
    path = store.site_dir(site_id) / "services" / target_id
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def read_settings(store: SiteStore, site_id: str, target_id: str = "local") -> ServiceSettings:
    path = service_root(store, site_id, target_id) / "settings.json"
    if not path.exists():
        return ServiceSettings()
    return ServiceSettings.model_validate_json(path.read_text())


def settings_response(store: SiteStore, site_id: str, target_id: str = "local") -> ServiceSettingsResponse:
    settings = read_settings(store, site_id, target_id)
    credential = service_root(store, site_id, target_id) / "credential-reference.json"
    apply_path = service_root(store, site_id, target_id) / "apply-state.json"
    state = json.loads(apply_path.read_text()) if apply_path.exists() else {}
    return ServiceSettingsResponse(configured=(service_root(store, site_id, target_id) / "settings.json").exists(), password_configured=credential.exists(), applied=bool(state.get("applied")), apply_error=state.get("error"), **settings.model_dump(exclude={"smtp_password"}))


def save_settings(store: SiteStore, site_id: str, settings: ServiceSettings, target_id: str = "local") -> ServiceSettingsResponse:
    root = service_root(store, site_id, target_id)
    addresses = [settings.sender_email] + [email for delivery in settings.forms.values() for email in delivery.recipients]
    if any(value and not re.fullmatch(r"[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+", value) for value in addresses):
        raise HTTPException(422, "Invalid delivery address")
    if any("\r" in form.subject or "\n" in form.subject for form in settings.forms.values()):
        raise HTTPException(422, "Invalid notification subject")
    if settings.smtp_password is not None:
        from backend.security.keychain_manager import get_keychain
        reference = "website-" + root.parent.parent.name + "-" + target_id + "-" + store.private_root.name[:20]
        if not get_keychain().save_credential(reference, settings.smtp_password):
            raise HTTPException(503, "The credential store could not save the SMTP credential")
        private_json(root / "credential-reference.json", {"key": reference})
    private_json(root / "settings.json", settings.model_dump(mode="json", exclude={"smtp_password"}))
    site = store.load(site_id)
    active = store.active_bundle(site_id, target_id)
    target = next(target for target in site.targets if target.id == target_id)
    applied = False
    apply_error: str | None = None
    if target.adapter == "local" or active:
        forms_site = SiteConfig.model_validate(active["site"]) if active else site
        try:
            if target.adapter != "local":
                from .runtime import sync_service_settings
                sync_service_settings(store, site, target, forms_site)
            invoke(store, site, "forms_sync", {"forms": cast(JsonValue, [form.model_dump(mode="json") for form in forms_site.forms if form.enabled]), "form_delivery": cast(JsonValue, {key: value.model_dump(mode="json") for key, value in settings.forms.items()})}, target_id, internal=True)
            applied = True
        except HTTPException:
            apply_error = "service_settings_sync_failed"
    private_json(root / "apply-state.json", {"applied": applied, "error": apply_error})
    return settings_response(store, site_id, target_id)


def configuration(store: SiteStore, site: SiteConfig, target_id: str, *, forms_site: SiteConfig | None = None) -> Path:
    root = service_root(store, site.id, target_id)
    settings = read_settings(store, site.id, target_id)
    target = next(target for target in site.targets if target.id == target_id)
    if target.environment == "production":
        raise HTTPException(409, "Production services require pilot validation")
    base_url = target.base_url
    if target.adapter == "local":
        from .runtime import connection
        base_url = "http://127.0.0.1:" + str(connection(store, site.id, target_id).local_port)
    # Test mode deliberately never reads or materializes SMTP passwords.
    config = {
        "schema_version": 1, "site_id": site.id, "test_mode": True, "public_base_url": base_url, "languages": site.languages,
        "db_path": str(root / "state.sqlite"), "spool_path": str(root / "captures"),
        "library_path": str(SERVICE_ROOT / "library.php"),
        "forms": [form.model_dump(mode="json") for form in (forms_site or site).forms if form.enabled],
        "form_delivery": {key: value.model_dump(mode="json") for key, value in settings.forms.items()},
        "retention_days": settings.retention_days,
        "email_theme": {"primary": (forms_site or site).theme.tokens.get("primary", "#264653"), "background": (forms_site or site).theme.tokens.get("background", "#f5efe7")},
        "smtp": {"host": settings.smtp_host, "port": settings.smtp_port, "security": settings.smtp_security, "username": settings.smtp_username, "from": settings.sender_email, "from_name": settings.sender_name},
    }
    path = root / "config.json"
    private_json(path, config)
    return path


def invoke(store: SiteStore, site: SiteConfig, action: str, request: dict[str, JsonValue], target_id: str = "local", *, internal: bool = False) -> dict[str, JsonValue]:
    if action not in ALLOWED_ACTIONS and not (internal and action == "forms_sync"):
        raise HTTPException(422, "Unsupported website service operation")
    target = next((target for target in site.targets if target.id == target_id), None)
    if target is None:
        raise HTTPException(404, "Website destination not found")
    if action in {"captured_get", "captured_apply"} and target.environment == "production":
        raise HTTPException(409, "Captured email testing is unavailable for production")
    if target.adapter != "local":
        from .runtime import remote_service
        return remote_service(store, site, target_id, action, request)
    php = shutil.which("php")
    cli = SERVICE_ROOT / "cli.php"
    if not php or not cli.is_file():
        raise HTTPException(503, "The private website service runtime is unavailable")
    payload = json.dumps({"action": action, "request": request}, ensure_ascii=False)
    if len(payload.encode()) > 1_000_000:
        raise HTTPException(413, "The website service request is too large")
    active = store.active_bundle(site.id, target_id)
    forms_site = SiteConfig.model_validate(active["site"]) if active else site
    config = configuration(store, site, target_id, forms_site=forms_site)
    environment = {key: value for key, value in os.environ.items() if key in {"PATH", "HOME", "TMPDIR", "LANG"}}
    environment["GNOSI_SITES_SERVICE_CONFIG"] = str(config)
    try:
        result = subprocess.run([php, str(cli)], input=payload, capture_output=True, text=True, timeout=45, env=environment, check=False)
        data: object = json.loads(result.stdout)
        if result.returncode or not isinstance(data, dict) or data.get("error") or data.get("test_mode", True) is not True:
            raise ValueError("Service error")
        return cast(dict[str, JsonValue], data)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise HTTPException(503, "The private website service could not complete the operation") from None
