"""Private newsletter drafts composed from an immutable published projection."""
from __future__ import annotations

import html
import math
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Literal, cast
from urllib.parse import quote, urlsplit

from fastapi import HTTPException
from pydantic import Field, JsonValue, field_validator

from . import private_service
from .models import Contract, PublicRecord, SiteBundle, SiteConfig, SiteRelease, SiteTarget, safe_path
from .storage import SiteStore


class SiteNewsletterDraft(Contract):
    revision: int = Field(default=0, ge=0)
    mode: Literal["contents", "manual"] = "contents"
    template: Literal["digest", "featured"] = "digest"
    subject: str = Field(default="", max_length=300)
    language: str = Field(default="ca", max_length=20)
    list_id: str = Field(default="default", max_length=128)
    interests: str = Field(default="", max_length=3000)
    introduction: str = Field(default="", max_length=10000)
    paths: list[str] = Field(default_factory=list, max_length=20)
    body_html: str = Field(default="", max_length=200000)
    body_text: str = Field(default="", max_length=200000)
    scheduled_at: str = Field(default="", max_length=40)

    @field_validator("paths")
    @classmethod
    def selected_paths(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Select each published page once")
        return [safe_path(path) for path in value]


class SiteNewsletterContent(Contract):
    path: str
    title: str
    language: str
    summary: str


class SiteNewsletterState(Contract):
    draft: SiteNewsletterDraft
    fingerprint: str
    contents: list[SiteNewsletterContent]


class SiteNewsletterReview(Contract):
    draft: SiteNewsletterDraft
    fingerprint: str


class SiteNewsletterQueue(Contract):
    preview_id: str = Field(min_length=1, max_length=100)
    scheduled_at: str | None = None


def target_for(site: SiteConfig, target_id: str) -> SiteTarget:
    target = next((target for target in site.targets if target.id == target_id), None)
    if target is None:
        raise HTTPException(404, "Website destination not found")
    return target


class _PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag in {"p", "br", "li", "h1", "h2", "h3"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.hidden:
            self.hidden -= 1
        self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def _summary(record: PublicRecord) -> str:
    parser = _PlainText()
    parser.feed(record.body_html)
    text = " ".join("".join(parser.parts).split())
    return text if len(text) <= 360 else text[:357].rstrip() + "…"


def _creation_time(record: PublicRecord) -> float:
    value = record.presentation.get("created")
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return float("-inf")
    try:
        result = float(value)
    except (ValueError, OverflowError):
        try:
            date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            result = date.replace(tzinfo=date.tzinfo or timezone.utc).timestamp()
        except (ValueError, OverflowError, OSError):
            return float("-inf")
    return result if math.isfinite(result) else float("-inf")


def published(store: SiteStore, site: SiteConfig, target_id: str) -> tuple[str, str, list[SiteNewsletterContent]]:
    target_for(site, target_id)
    # Read the active pointer and its bundle in one transaction; never rebuild
    # from current vault pages, field selections or unpublished configuration.
    with store.database() as db:
        row = db.execute("SELECT r.bundle,r.payload FROM active a JOIN releases r ON r.id=a.release_id WHERE a.site_id=? AND a.target_id=?", (site.id, target_id)).fetchone()
    if not row:
        return "", "", []
    bundle = SiteBundle.model_validate_json(row["bundle"])
    release = SiteRelease.model_validate_json(row["payload"])
    base = release.url.rstrip("/")
    url = urlsplit(base)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise HTTPException(409, "The published website has no usable URL")
    seen: set[str] = set()
    records: list[PublicRecord] = []
    for record in bundle.records:
        if record.path in seen or record.path in bundle.withdrawn_paths:
            continue
        seen.add(record.path)
        records.append(record)
    contents = [SiteNewsletterContent(path=safe_path(record.path), title=record.title, language=record.language, summary=_summary(record)) for record in sorted(records, key=_creation_time, reverse=True)]
    return bundle.fingerprint, base, contents


def load_draft(store: SiteStore, site: SiteConfig, target_id: str) -> SiteNewsletterDraft:
    target_for(site, target_id)
    with store.database() as db:
        row = db.execute("SELECT payload FROM newsletter_drafts WHERE site_id=? AND target_id=?", (site.id, target_id)).fetchone()
    return SiteNewsletterDraft.model_validate_json(row["payload"]) if row else SiteNewsletterDraft(language=site.default_language)


def save_draft(store: SiteStore, site: SiteConfig, target_id: str, draft: SiteNewsletterDraft) -> SiteNewsletterDraft:
    target_for(site, target_id)
    if draft.language not in site.languages:
        raise HTTPException(422, "Select an enabled newsletter language")
    with store.database() as db:
        row = db.execute("SELECT revision FROM newsletter_drafts WHERE site_id=? AND target_id=?", (site.id, target_id)).fetchone()
        if draft.revision != (row["revision"] if row else 0):
            raise HTTPException(409, "The newsletter draft changed; reload before editing")
        saved = draft.model_copy(update={"revision": draft.revision + 1})
        db.execute("INSERT INTO newsletter_drafts VALUES (?,?,?,?) ON CONFLICT(site_id,target_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload", (site.id, target_id, saved.revision, saved.model_dump_json()))
    return saved


def state(store: SiteStore, site: SiteConfig, target_id: str) -> SiteNewsletterState:
    fingerprint, _, contents = published(store, site, target_id)
    return SiteNewsletterState(draft=load_draft(store, site, target_id), fingerprint=fingerprint, contents=contents)


def compose(store: SiteStore, site: SiteConfig, target_id: str, review: SiteNewsletterReview) -> dict[str, JsonValue]:
    draft = review.draft
    if draft.language not in site.languages or not draft.subject.strip():
        raise HTTPException(422, "Choose a subject and an enabled newsletter language")
    body, text = draft.body_html, draft.body_text
    if draft.mode == "contents":
        fingerprint, base, contents = published(store, site, target_id)
        if not fingerprint or fingerprint != review.fingerprint:
            raise HTTPException(409, "The published website changed; refresh the newsletter contents")
        available = {item.path: item for item in contents if item.language == draft.language}
        if not draft.paths or any(path not in available for path in draft.paths):
            raise HTTPException(409, "Select pages published in the newsletter language")
        label = {"ca": "Llegeix al web", "es": "Leer en la web", "fr": "Lire sur le site"}.get(draft.language, "Read on the website")
        body = "".join("<p>" + html.escape(line) + "</p>" for line in draft.introduction.splitlines() if line.strip())
        text = draft.introduction.strip()
        for index, path in enumerate(draft.paths):
            item = available[path]
            url = base + quote(path, safe="/%:@-._~!$&'()*+,;=")
            title = html.escape(item.title)
            heading = "h1" if draft.template == "featured" and index == 0 else "h2"
            body += f'<{heading}>{title}</{heading}><p>{html.escape(item.summary)}</p><p><a href="{html.escape(url, quote=True)}">{label}</a></p>'
            text += f"\n\n{item.title}\n{item.summary}\n{url}"
            if draft.template == "featured" and index == 0:
                body += "<hr>"
        body += "<hr><p>" + html.escape(site.name) + "</p>"
        text += "\n\n" + site.name
    if not body.strip():
        raise HTTPException(422, "Add newsletter content before reviewing")
    return {"subject": draft.subject, "language": draft.language, "list_id": draft.list_id, "interests": cast(JsonValue, [value.strip() for value in draft.interests.replace("\n", ",").split(",") if value.strip()]), "body_html": body, "body_text": text.strip()}


def preview(store: SiteStore, site: SiteConfig, target_id: str, review: SiteNewsletterReview) -> dict[str, JsonValue]:
    result = private_service.invoke(store, site, "campaign_preview", compose(store, site, target_id, review), target_id)
    preview_id = result.get("preview_id")
    if not isinstance(preview_id, str) or not preview_id or len(preview_id) > 100:
        raise HTTPException(503, "The private service returned no newsletter review")
    with store.database() as db:
        db.execute("INSERT OR REPLACE INTO newsletter_reviews VALUES (?,?,?,?,?)", (site.id, target_id, preview_id, review.fingerprint, review.draft.mode))
    return result


def queue(store: SiteStore, site: SiteConfig, target_id: str, request: SiteNewsletterQueue) -> dict[str, JsonValue]:
    target_for(site, target_id)
    with store.database() as db:
        review = db.execute("SELECT fingerprint,mode FROM newsletter_reviews WHERE site_id=? AND target_id=? AND preview_id=?", (site.id, target_id, request.preview_id)).fetchone()
        publishing = db.execute("SELECT 1 FROM locks WHERE site_id=?", (site.id,)).fetchone()
        if not review or publishing:
            raise HTTPException(409, "Review the newsletter after website publication completes")
        row = db.execute("SELECT r.bundle FROM active a JOIN releases r ON r.id=a.release_id WHERE a.site_id=? AND a.target_id=?", (site.id, target_id)).fetchone()
        bundle = SiteBundle.model_validate_json(row["bundle"]) if row else None
        if review["mode"] == "contents":
            fingerprint = bundle.fingerprint if bundle else ""
            if fingerprint != review["fingerprint"]:
                raise HTTPException(409, "The published website changed; review the newsletter again")
        # Publication/rollback claims use this same transaction boundary. Hold it
        # through the bounded queue request so they cannot activate a withdrawal
        # between the check and queue creation. A crash releases the SQLite lock;
        # retrying the same remote preview remains idempotent.
        return private_service.invoke(store, site, "campaign_queue", cast(dict[str, JsonValue], request.model_dump(mode="json")), target_id, forms_site=bundle.site if bundle else site)
