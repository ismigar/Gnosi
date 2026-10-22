"""Editor-scoped bridge to the administrator-configured staging publisher."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import threading
import time
from typing import Annotated, Any, Literal, TypeVar, cast

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.services.workspace_service import WorkspaceContext, require_role


JsonObject = dict[str, Any]
ResponseT = TypeVar("ResponseT", bound=BaseModel)


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WebSelection(StrictRequest):
    page_ids: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=500)
    withdraw_ids: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=500)


class WebPreviewReference(StrictRequest):
    preview_id: str = Field(min_length=1, max_length=200)


class WebRollback(StrictRequest):
    release_id: str = Field(min_length=1, max_length=200)


class NewsletterDraft(StrictRequest):
    subject: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=100000)
    language: Literal["ca", "es", "en-gb"]


class WebPage(BaseModel):
    id: str
    title: str
    language: str
    type: str
    url: str | None = None
    published: bool
    eligible: bool
    reason: str | None = None


class WebRelease(BaseModel):
    id: str
    url: str
    created_at: str
    current: bool


class WebStatus(BaseModel):
    configured: bool
    target: Literal["staging"] = "staging"
    staging_url: str | None = None
    pages: list[WebPage] = Field(default_factory=list)
    releases: list[WebRelease] = Field(default_factory=list)


class WebChange(BaseModel):
    kind: Literal["create", "update", "withdraw", "translation"]
    title: str
    language: str
    url: str


class WebPreview(BaseModel):
    preview_id: str
    expires_at: str
    target: Literal["staging"]
    changes: list[WebChange]
    warnings: list[str] = Field(default_factory=list)


class WebPublished(BaseModel):
    release_id: str
    staging_url: str
    target: Literal["staging"]
    changes: list[WebChange] = Field(default_factory=list)


class SubscriberCounts(BaseModel):
    pending: int = Field(ge=0)
    active: int = Field(ge=0)
    unsubscribed: int = Field(ge=0)


class NewsletterCampaign(BaseModel):
    id: str
    subject: str
    language: str
    status: str
    recipient_count: int
    created_at: str


class NewsletterStatus(BaseModel):
    subscribers: SubscriberCounts
    campaigns: list[NewsletterCampaign]
    test_mode: Literal[True]


class NewsletterPreview(BaseModel):
    preview_id: str
    subject: str
    body_html: str
    recipient_count: int
    test_mode: Literal[True]


class NewsletterQueued(BaseModel):
    campaign_id: str
    queued: int
    test_mode: Literal[True]


# Tokens never expose driver state and cannot cross account/workspace/vault boundaries.
_previews: dict[str, tuple[tuple[str, str, str], str, str, float]] = {}
_lock = threading.Lock()


def _scope(context: WorkspaceContext) -> tuple[str, str, str]:
    return context.user_id, context.workspace_id, str(context.vault_path.resolve())


def _driver(action: str, context: WorkspaceContext, request: JsonObject) -> JsonObject:
    from .api import dependencies
    dependencies(context).validate_access()
    driver = Path(os.environ.get("GNOSI_WEB_PUBLISH_DRIVER", ""))
    interpreter = os.environ.get("GNOSI_WEB_PUBLISH_PYTHON") or shutil.which("python3")
    if not driver.is_absolute() or driver.suffix != ".py" or not driver.is_file() or not interpreter:
        raise HTTPException(503, "Staging publishing is not configured")
    # Only runtime essentials cross the process boundary; application credentials do not.
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "TMPDIR", "SSH_AUTH_SOCK") if key in os.environ}
    try:
        result = subprocess.run([interpreter, str(driver)], input=json.dumps({
            "action": action, "vault_path": str(context.vault_path.resolve()), "request": request,
        }), text=True, capture_output=True, timeout=600, env=environment, check=False)
        if len(result.stdout) > 4_000_000:
            raise HTTPException(502, "Staging publishing could not complete")
        data: object = json.loads(result.stdout)
        if not isinstance(data, dict):
            raise ValueError("Invalid driver response")
        if "error" in data:
            raise HTTPException(409, "The preview expired or the staging state changed. Review a new preview.")
        if result.returncode:
            raise HTTPException(502, "Staging publishing could not complete")
        return cast(JsonObject, data)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Staging publishing timed out; refresh status before retrying") from None
    except (OSError, ValueError):
        raise HTTPException(502, "Staging publishing returned an invalid response") from None


def _validated(
    model: type[ResponseT], action: str, context: WorkspaceContext, request: JsonObject,
) -> ResponseT:
    try:
        return model.model_validate(_driver(action, context, request))
    except ValidationError:
        raise HTTPException(502, "Staging publishing returned an invalid response") from None


def _remember(context: WorkspaceContext, action: str, driver_id: str) -> str:
    token = secrets.token_urlsafe(32)
    with _lock:
        now = time.monotonic()
        for key in list(_previews):
            if _previews[key][3] < now:
                del _previews[key]
        if len(_previews) >= 1000:
            raise HTTPException(429, "Too many pending previews")
        _previews[token] = (_scope(context), action, driver_id, now + 900)
    return token


def _consume(context: WorkspaceContext, action: str, token: str) -> str:
    with _lock:
        item = _previews.get(token)
        if not item or item[:2] != (_scope(context), action) or item[3] < time.monotonic():
            raise HTTPException(409, "The preview expired. Review a new preview.")
        del _previews[token]
    return item[2]


def web_editor(
    context: Annotated[WorkspaceContext, Depends(require_role("editor"))],
    expected_user_id: Annotated[str, Header(alias="X-Gnosi-Web-Expected-User-ID")],
) -> WorkspaceContext:
    """Restrict an already-resolved identity without supplying an account."""
    if expected_user_id != context.user_id:
        raise HTTPException(409, {"code": "account_changed"})
    return context


Editor = Annotated[WorkspaceContext, Depends(web_editor)]
router = APIRouter(prefix="/web-publishing", tags=["web-publishing"])


@router.get("/status", response_model=WebStatus)
def status(context: Editor) -> WebStatus:
    if not os.environ.get("GNOSI_WEB_PUBLISH_DRIVER"):
        return WebStatus(configured=False)
    return _validated(WebStatus, "status", context, {})


@router.post("/preview", response_model=WebPreview)
def preview(request: WebSelection, context: Editor) -> WebPreview:
    if set(request.page_ids) & set(request.withdraw_ids):
        raise HTTPException(422, "A page cannot be published and withdrawn together")
    result = _validated(WebPreview, "preview", context, request.model_dump())
    result.preview_id = _remember(context, "publish", result.preview_id)
    return result


@router.post("/publish", response_model=WebPublished)
def publish(request: WebPreviewReference, context: Editor) -> WebPublished:
    return _validated(WebPublished, "publish", context, {"preview_id": _consume(context, "publish", request.preview_id)})


@router.post("/rollback", response_model=WebPublished)
def rollback(request: WebRollback, context: Editor) -> WebPublished:
    return _validated(WebPublished, "rollback", context, request.model_dump())


@router.get("/newsletter", response_model=NewsletterStatus)
def newsletter_status(context: Editor) -> NewsletterStatus:
    return _validated(NewsletterStatus, "newsletter_status", context, {})


@router.post("/newsletter/preview", response_model=NewsletterPreview)
def newsletter_preview(request: NewsletterDraft, context: Editor) -> NewsletterPreview:
    result = _validated(NewsletterPreview, "newsletter_preview", context, request.model_dump())
    result.preview_id = _remember(context, "newsletter_send", result.preview_id)
    return result


@router.post("/newsletter/send", response_model=NewsletterQueued)
def newsletter_send(request: WebPreviewReference, context: Editor) -> NewsletterQueued:
    return _validated(NewsletterQueued, "newsletter_send", context, {"preview_id": _consume(context, "newsletter_send", request.preview_id)})
