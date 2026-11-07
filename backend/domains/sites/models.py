"""Versioned contracts for website configuration and private operation state."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Iterator, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, JsonValue, PrivateAttr, SecretStr, field_validator, model_validator


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
    page_size: int = Field(default=16, ge=1, le=100)
    show_tag_filter: bool = False
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


class NavigationLink(Contract):
    label: str
    href: str
    language: str | None = None
    appearance: Literal["link", "button", "outline"] = "link"


class SiteBlock(Contract):
    # Recursive rows share the same wire shape for reads and writes.
    model_config = ConfigDict(extra="forbid", json_schema_mode_override="validation")
    id: str = Field(default_factory=identifier)
    type: Literal["text", "image", "split", "gallery", "selected", "collection", "collaborators", "form", "cta", "links", "social", "newsletter", "row"] = "text"
    children: list[SiteBlock] = Field(default_factory=list, max_length=4)
    title: str = ""
    body: str = ""
    body_format: Literal["markdown", "html"] = "markdown"
    width: int = Field(default=100, ge=20, le=100)
    alignment: Literal["left", "center", "right"] = "left"
    image_width: int = Field(default=100, ge=20, le=100)
    image_frame: Literal["none", "inset"] = "none"
    spacing: Literal["compact", "normal", "generous"] = "compact"
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
    actions: list[NavigationLink] | None = None
    links: list[NavigationLink] = Field(default_factory=list)
    css: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def row_columns(self) -> SiteBlock:
        if self.type == "row" and not self.children:
            raise ValueError("Rows need at least one column")
        if self.children and self.type != "row":
            raise ValueError("Only rows contain columns")
        if any(child.type == "row" for child in self.children):
            raise ValueError("Rows cannot be nested")
        if len({child.id for child in self.children}) != len(self.children):
            raise ValueError("Column identities must be unique")
        return self

    def walk(self) -> Iterator[SiteBlock]:
        yield self
        yield from self.children


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
    imported_record_id: str | None = None
    css: str = Field(default="", max_length=20000)

    @field_validator("path")
    @classmethod
    def valid_path(cls, value: str) -> str:
        return safe_path(value)


class SiteFont(Contract):
    family: str = Field(min_length=1, max_length=100)
    src: str
    weight: str = "400"
    style: Literal["normal", "italic"] = "normal"


class SiteThemeAsset(Contract):
    source: str
    media_type: str
    font: SiteFont | None = None


class SiteTheme(Contract):
    schema_version: Literal[1] = 1
    name: str = "Default"
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
    stylesheet_overrides: dict[Literal["base", "template", "layout"], Annotated[str, Field(max_length=100000)]] = Field(default_factory=dict)


class FormField(Contract):
    id: str = Field(default_factory=identifier)
    type: Literal["text", "textarea", "email", "tel", "select", "radio", "checkbox"] = "text"
    label: dict[str, str] = Field(default_factory=dict)
    help: dict[str, str] = Field(default_factory=dict)
    placeholder: dict[str, str] = Field(default_factory=dict)
    required: bool = False
    max_length: int = Field(default=2000, ge=1, le=20000)
    options: list[str] = Field(default_factory=list)
    option_labels: dict[str, dict[str, str]] = Field(default_factory=dict)


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
    privacy_label: dict[str, str] = Field(default_factory=dict)
    privacy_link_label: dict[str, str] = Field(default_factory=dict)
    newsletter_label: dict[str, str] = Field(default_factory=dict)
    required_message: dict[str, str] = Field(default_factory=dict)
    failure_message: dict[str, str] = Field(default_factory=dict)
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


class SiteFooterColumn(Contract):
    id: str = Field(default_factory=identifier)
    title: str = ""
    alignment: Literal["left", "center", "right"] = "left"
    language: str | None = None
    blocks: list[SiteBlock] = Field(default_factory=list)


class SiteRegion(SiteFooterColumn):
    position: Literal["header", "before_content", "after_content", "footer"] = "after_content"


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
    header_actions: list[NavigationLink] = Field(default_factory=list)
    navigation: list[NavigationLink] = Field(default_factory=list)
    footer: list[NavigationLink] = Field(default_factory=list)
    footer_columns: list[SiteFooterColumn] | None = Field(default=None, max_length=12)
    footer_blocks: list[SiteBlock] | None = None
    footer_bottom_links: list[NavigationLink] | None = None
    footer_copyright: str | None = Field(default=None, max_length=500)
    social_links: list[NavigationLink] = Field(default_factory=list)
    redirects: dict[str, str] = Field(default_factory=dict)
    targets: list[SiteTarget] = Field(default_factory=lambda: [SiteTarget(id="local")])
    regions: list[SiteRegion] = Field(default_factory=list, max_length=24)
    legacy_pilot: bool = False

    def editorial_blocks(self, *, enabled_only: bool = False) -> Iterator[tuple[str | None, SiteBlock]]:
        for page in self.pages:
            if not enabled_only or page.enabled:
                for block in page.blocks:
                    for item in block.walk():
                        yield page.language, item
        for column in [*(self.footer_columns or []), *self.regions]:
            for block in column.blocks:
                for item in block.walk():
                    yield column.language, item
        for block in self.footer_blocks or []:
            for item in block.walk():
                yield None, item

    @model_validator(mode="after")
    def identity_and_languages(self) -> SiteConfig:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", self.id):
            raise ValueError("Invalid site identity")
        if self.default_language not in self.languages or len(set(self.languages)) != len(self.languages):
            raise ValueError("Invalid website languages")
        for lang in self.languages:
            if not re.fullmatch(r"[a-z]{2,3}(?:-[a-z]{2,8})?", lang):
                raise ValueError("Invalid language")
        for group in (self.sources, self.pages, self.forms, self.targets, self.footer_columns or [], self.regions):
            if len({item.id for item in group}) != len(group):
                raise ValueError("Duplicate configuration identities")
            if any(not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", item.id) for item in group):
                raise ValueError("Invalid configuration identity")
        for page in self.pages:
            if page.language not in self.languages:
                raise ValueError("Page language is not enabled")
        if any(column.language and column.language not in self.languages for column in [*(self.footer_columns or []), *self.regions]):
            raise ValueError("Footer column language is not enabled")
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


class CatalogueSnapshot(Contract):
    items: list[CatalogueItem]
    pages_ready: bool


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
    _password: str | None = PrivateAttr(default=None)
    host: str = Field(default="", max_length=250)
    username: str = Field(default="", max_length=100)
    port: int = Field(default=22, ge=1, le=65535)
    remote_root: str = Field(default="", max_length=500)
    document_root: str = Field(default="", max_length=500)
    remote_private_root: str = Field(default="", max_length=500)
    ssh_key_reference: str = Field(default="", max_length=100)
    authentication: Literal["agent", "key", "password"] = "agent"
    identity_file: str = Field(default="", max_length=1000)
    transfer_protocol: Literal["ssh", "sftp"] = "ssh"
    password_configured: bool = False
    local_port: int = Field(default=4321, ge=1024, le=65535)


class TargetConnectionSecret(Contract):
    password: SecretStr | None = Field(default=None, max_length=4096)
    clear: bool = False


class ConnectionStatus(Contract):
    configured: bool
    reachable: bool
    detail: str


class LocalServeResponse(Contract):
    url: str
    running: bool


class RollbackRequest(Contract):
    expected_release_id: str | None = None
