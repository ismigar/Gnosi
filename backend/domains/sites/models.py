"""Versioned contracts for website configuration and private operation state."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator


def identifier() -> str:
    return uuid.uuid4().hex


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Localized(Contract):
    values: dict[str, str] = Field(default_factory=dict)


class SourceFilter(Contract):
    field_id: str
    operator: Literal["equals", "not_equals", "contains", "in", "not_empty"] = "equals"
    value: JsonValue = None


class SiteSource(Contract):
    id: str = Field(default_factory=identifier)
    kind: Literal["table", "view", "page"] = "table"
    source_id: str = Field(min_length=1, max_length=200)
    enabled: bool = False
    title: str = ""
    field_ids: list[str] = Field(default_factory=list)
    include_body: bool = False
    attachment_field_ids: list[str] = Field(default_factory=list)
    filters: list[SourceFilter] = Field(default_factory=list)
    sort_field_id: str | None = None
    sort_descending: bool = False
    presentation: Literal["list", "cards", "table"] = "cards"
    path_prefix: str = "/content"
    page_ids: list[str] = Field(default_factory=list)
    selection_mode: Literal["all", "selected"] = "all"
    withdrawn_ids: list[str] = Field(default_factory=list)
    withdrawn_versions: dict[str, list[str]] = Field(default_factory=dict)

    @field_validator("path_prefix")
    @classmethod
    def safe_prefix(cls, value: str) -> str:
        return safe_path(value)


def safe_path(value: str) -> str:
    if not value.startswith("/") or value.startswith("//") or "\\" in value or ".." in value.split("/") or any(c in value for c in ("?", "#", "%", "\x00")):
        raise ValueError("A plain absolute website path is required")
    return value


class SiteBlock(Contract):
    id: str = Field(default_factory=identifier)
    type: Literal["text", "image", "split", "gallery", "selected", "collection", "collaborators", "form", "cta"] = "text"
    title: str = ""
    body: str = ""
    image: str = ""
    alt: str = ""
    source_id: str | None = None
    form_id: str | None = None
    page_ids: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)
    image_position: Literal["left", "right"] = "right"
    columns: int = Field(default=3, ge=1, le=4)
    limit: int = Field(default=3, ge=1, le=100)
    href: str = ""
    css: str = Field(default="", max_length=10000)


class SitePage(Contract):
    id: str = Field(default_factory=identifier)
    translation_id: str | None = None
    language: str = "ca"
    title: str = Field(min_length=1, max_length=300)
    path: str = "/"
    enabled: bool = False
    description: str = ""
    template: Literal["home", "page", "article", "listing"] = "page"
    blocks: list[SiteBlock] = Field(default_factory=list)
    css: str = Field(default="", max_length=20000)

    @field_validator("path")
    @classmethod
    def valid_path(cls, value: str) -> str:
        return safe_path(value)


class NavigationLink(Contract):
    label: str
    href: str
    language: str | None = None


class SiteFont(Contract):
    family: str = Field(min_length=1, max_length=100)
    src: str
    weight: str = "400"
    style: Literal["normal", "italic"] = "normal"


class SiteTheme(Contract):
    schema_version: Literal[1] = 1
    name: str = "Temenos"
    tokens: dict[str, str] = Field(default_factory=lambda: {
        "primary": "#264653", "accent": "#c75b35", "background": "#f5efe7", "surface": "#ffffff",
        "text": "#2c3e50", "muted": "#555555", "font-body": "Georgia, serif", "font-heading": "system-ui, sans-serif",
        "content-width": "76rem", "reading-width": "46rem", "radius": "0.75rem", "spacing": "1.5rem",
    })
    logo: str = ""
    logo_alt: str = ""
    favicon: str = ""
    fonts: list[SiteFont] = Field(default_factory=list)
    advanced_css: str = Field(default="", max_length=100000)


class FormField(Contract):
    id: str = Field(default_factory=identifier)
    type: Literal["text", "textarea", "email", "tel", "select", "radio", "checkbox"] = "text"
    label: dict[str, str] = Field(default_factory=dict)
    help: dict[str, str] = Field(default_factory=dict)
    placeholder: dict[str, str] = Field(default_factory=dict)
    required: bool = False
    max_length: int = Field(default=2000, ge=1, le=20000)
    options: list[str] = Field(default_factory=list)


class SiteForm(Contract):
    id: str = Field(default_factory=identifier)
    revision: int = Field(default=1, ge=1)
    name: str = "Contact"
    enabled: bool = False
    title: dict[str, str] = Field(default_factory=lambda: {"ca": "Contacta", "es": "Contacto", "en-gb": "Contact"})
    intro: dict[str, str] = Field(default_factory=dict)
    fields: list[FormField] = Field(default_factory=lambda: [
        FormField(id="name", label={"ca": "Nom", "es": "Nombre", "en-gb": "Name"}),
        FormField(id="email", type="email", required=True, label={"ca": "Correu electrònic", "es": "Correo electrónico", "en-gb": "Email"}),
        FormField(id="subject", label={"ca": "Assumpte", "es": "Asunto", "en-gb": "Subject"}),
        FormField(id="message", type="textarea", required=True, label={"ca": "Missatge", "es": "Mensaje", "en-gb": "Message"}),
    ])
    submit_label: dict[str, str] = Field(default_factory=lambda: {"ca": "Envia", "es": "Enviar", "en-gb": "Send"})
    confirmation: dict[str, str] = Field(default_factory=lambda: {"ca": "Hem rebut el teu missatge.", "es": "Hemos recibido tu mensaje.", "en-gb": "Your message has been received."})
    privacy_text: dict[str, str] = Field(default_factory=dict)
    privacy_url: str = ""
    require_privacy: bool = False
    redirect_path: str | None = None
    newsletter_list: str | None = None

    @model_validator(mode="after")
    def unique_fields(self) -> SiteForm:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", self.id) or any(not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", field.id) for field in self.fields):
            raise ValueError("Invalid form or field identity")
        if len({f.id for f in self.fields}) != len(self.fields):
            raise ValueError("Duplicate field identities")
        if self.redirect_path:
            safe_path(self.redirect_path)
        return self


class SiteTarget(Contract):
    id: str = Field(default_factory=identifier)
    name: str = "Local"
    environment: Literal["local", "staging", "production"] = "local"
    adapter: Literal["local", "ssh", "legacy-pangea"] = "local"
    base_url: str = "http://127.0.0.1:4321"
    enabled: bool = False

    @field_validator("base_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("An HTTP(S) URL without credentials is required")
        return value.rstrip("/")


class SiteConfig(Contract):
    schema_version: Literal[1] = 1
    id: str = Field(default_factory=identifier)
    revision: int = Field(default=1, ge=1)
    name: str = Field(min_length=1, max_length=200)
    languages: list[str] = Field(default_factory=lambda: ["ca", "es", "en-gb"], min_length=1, max_length=20)
    default_language: str = "ca"
    origin: str = "http://127.0.0.1:4321"
    sources: list[SiteSource] = Field(default_factory=list)
    pages: list[SitePage] = Field(default_factory=list)
    forms: list[SiteForm] = Field(default_factory=lambda: [SiteForm(id="contact")])
    theme: SiteTheme = Field(default_factory=SiteTheme)
    navigation: list[NavigationLink] = Field(default_factory=list)
    footer: list[NavigationLink] = Field(default_factory=list)
    social_links: list[NavigationLink] = Field(default_factory=list)
    redirects: dict[str, str] = Field(default_factory=dict)
    targets: list[SiteTarget] = Field(default_factory=lambda: [SiteTarget(id="local")])
    legacy_pilot: bool = False

    @model_validator(mode="after")
    def identity_and_languages(self) -> SiteConfig:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", self.id):
            raise ValueError("Invalid site identity")
        if self.default_language not in self.languages or len(set(self.languages)) != len(self.languages):
            raise ValueError("Invalid website languages")
        for lang in self.languages:
            if not re.fullmatch(r"[a-z]{2,3}(?:-[a-z]{2,8})?", lang):
                raise ValueError("Invalid language")
        for group in (self.sources, self.pages, self.forms, self.targets):
            if len({item.id for item in group}) != len(group):
                raise ValueError("Duplicate configuration identities")
            if any(not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", item.id) for item in group):
                raise ValueError("Invalid configuration identity")
        for page in self.pages:
            if page.language not in self.languages:
                raise ValueError("Page language is not enabled")
        for path, destination in self.redirects.items():
            safe_path(path)
            safe_path(destination)
        return self


class SiteCreate(Contract):
    name: str = Field(min_length=1, max_length=200)
    import_pilot: bool = False


class CatalogueItem(Contract):
    id: str
    kind: Literal["table", "view", "page", "record"]
    title: str
    table_id: str | None = None
    fields: list[dict[str, str]] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)


class PublicRecord(Contract):
    id: str
    language: str
    path: str
    title: str
    body_html: str = ""
    fields: dict[str, JsonValue] = Field(default_factory=dict)
    field_labels: dict[str, str] = Field(default_factory=dict)
    source_ids: list[str] = Field(default_factory=list)
    source_order: dict[str, int] = Field(default_factory=dict)
    translation_id: str | None = None
    presentation: dict[str, JsonValue] = Field(default_factory=dict)


class BundleAsset(Contract):
    path: str
    sha256: str
    private_source: str


class SiteBundle(Contract):
    schema_version: Literal[1] = 1
    site: SiteConfig
    records: list[PublicRecord] = Field(default_factory=list)
    assets: list[BundleAsset] = Field(default_factory=list)
    withdrawn_paths: list[str] = Field(default_factory=list)
    feed_aliases: dict[str, str] = Field(default_factory=dict)
    source_hashes: dict[str, str] = Field(default_factory=dict)
    fingerprint: str = ""
    created_at: str = Field(default_factory=timestamp)

    @field_validator("feed_aliases")
    @classmethod
    def safe_feed_aliases(cls, value: dict[str, str]) -> dict[str, str]:
        for origin, destination in value.items():
            safe_path(origin)
            safe_path(destination)
            if not origin.endswith(".xml") or not destination.endswith(".xml"):
                raise ValueError("Feed aliases must use plain XML website paths")
        return value


class SiteChange(Contract):
    kind: Literal["create", "update", "withdraw", "configuration"]
    path: str
    title: str


class SitePreviewRequest(Contract):
    target_id: str = "local"


class SitePreview(Contract):
    id: str
    site_id: str
    target_id: str
    fingerprint: str
    expires_at: str
    changes: list[SiteChange]
    warnings: list[str] = Field(default_factory=list)
    preview_url: str | None = None


class SitePublishRequest(Contract):
    preview_id: str
    scheduled_at: str | None = None


class SiteJob(Contract):
    id: str
    site_id: str
    target_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"] = "queued"
    phase: str = "prepare"
    created_at: str = Field(default_factory=timestamp)
    updated_at: str = Field(default_factory=timestamp)
    error: str | None = None
    release_id: str | None = None
    scheduled_at: str | None = None


class SiteRelease(Contract):
    id: str
    site_id: str
    target_id: str
    created_at: str
    fingerprint: str
    current: bool = False
    url: str


class SiteStatus(Contract):
    site: SiteConfig
    jobs: list[SiteJob]
    releases: list[SiteRelease]
    service_available: bool = False


class FormDeliverySettings(Contract):
    recipients: list[str] = Field(default_factory=list)
    subject: str = "Website contact"
    autoresponse: bool = False
    autoresponse_text: dict[str, str] = Field(default_factory=dict)


class ServiceSettings(Contract):
    test_mode: Literal[True] = True
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = ""
    smtp_password: str | None = None
    smtp_security: Literal["starttls", "tls", "none"] = "starttls"
    sender_email: str = ""
    sender_name: str = ""
    retention_days: int | None = Field(default=None, ge=1, le=36500)
    forms: dict[str, FormDeliverySettings] = Field(default_factory=dict)


class ServiceSettingsResponse(Contract):
    configured: bool
    test_mode: Literal[True] = True
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_security: str = "starttls"
    sender_email: str = ""
    sender_name: str = ""
    password_configured: bool = False
    applied: bool = False
    apply_error: str | None = None
    retention_days: int | None = None
    forms: dict[str, FormDeliverySettings] = Field(default_factory=dict)


class PrivateServiceRequest(Contract):
    action: str
    target_id: str = "local"
    request: dict[str, JsonValue] = Field(default_factory=dict)


class PrivateServiceResponse(Contract):
    data: dict[str, JsonValue]
    test_mode: Literal[True] = True


class TargetConnection(Contract):
    host: str = Field(default="", max_length=250)
    username: str = Field(default="", max_length=100)
    port: int = Field(default=22, ge=1, le=65535)
    remote_root: str = Field(default="", max_length=500)
    document_root: str = Field(default="", max_length=500)
    remote_private_root: str = Field(default="", max_length=500)
    ssh_key_reference: str = Field(default="", max_length=100)
    local_port: int = Field(default=4321, ge=1024, le=65535)


class ConnectionStatus(Contract):
    configured: bool
    reachable: bool
    detail: str


class LocalServeResponse(Contract):
    url: str
    running: bool


class RollbackRequest(Contract):
    expected_release_id: str | None = None
