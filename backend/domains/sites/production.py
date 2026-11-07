"""Explicit delivery boundaries shared by previews, publishing and private settings."""
from urllib.parse import urlsplit

from fastapi import HTTPException

from .models import ServiceSettings, SiteTarget


def validate_delivery(target: SiteTarget, settings: ServiceSettings) -> None:
    if target.environment != "production":
        if not settings.test_mode:
            raise HTTPException(409, "Real delivery is only available for a production destination")
        return
    if target.adapter == "local" or urlsplit(target.base_url).scheme != "https":
        raise HTTPException(409, "Production requires a remote HTTPS destination")
    if settings.test_mode or not settings.sender_email:
        raise HTTPException(409, "Configure production delivery and its sender before publication")
    if settings.delivery_transport == "smtp" and (not settings.smtp_host or settings.smtp_security == "none"):
        raise HTTPException(409, "Production SMTP requires a host and TLS")
