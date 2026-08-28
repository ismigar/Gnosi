"""Pydantic contracts for the public social API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class SocialPost(BaseModel):
    """Normalized post rendered in a social stream."""

    id: str
    network: str
    author: str
    handle: str
    content: str
    timestamp: str
    avatar: str | None = None
    is_reblog: bool = False
    reblog_by: str | None = None
    favourited: bool = False
    reblogged: bool = False
    favourites_count: int = 0
    reblogs_count: int = 0
    replies_count: int = 0
    url: str | None = None
    cid: str | None = None


class CreatePostRequest(BaseModel):
    content: str
    networks: list[str]


class NetworkPost(BaseModel):
    text: str
    # Local paths or pairs of local path and alternative text.
    media: list[str | tuple[str, str]] | None = None


class ComposeRequest(BaseModel):
    networks: list[str]
    content: str = ""
    title: str = ""
    url: str = ""
    source_page_id: str | None = None
    hint: str = ""
    regenerate_only: list[str] | None = None
    variation: int = 0


class PublishRequest(BaseModel):
    posts: dict[str, NetworkPost]
    source_page_id: str | None = None
    source_title: str = ""
    save_record: bool = True


class SchedulePublishRequest(BaseModel):
    posts: dict[str, NetworkPost]
    scheduled_time: datetime
    source_page_id: str | None = None
    source_title: str = ""


class Stream(BaseModel):
    id: str
    title: str
    icon: str
    network: str


class SocialNetwork(BaseModel):
    """Configured network plus live publisher capabilities."""

    id: str
    name: str
    icon: str
    enabled: bool
    configured: bool | None = None
    char_limit: int | None = None
    implemented: bool | None = None

    # Network-specific settings such as tone, hashtags and recipient are
    # intentionally retained in the response and settings round-trip.
    model_config = ConfigDict(extra="allow")


class InteractionRequest(BaseModel):
    post_id: str
    network: str
    action: str
    cid: str | None = None


class SocialSettingsUpdateResponse(BaseModel):
    status: Literal["ok"]


class InteractionResponse(BaseModel):
    status: Literal["success"]
    action: str
    post_id: str


class ComposeProposal(BaseModel):
    text: str
    hashtags: list[str]
    char_count: int
    over_limit: bool
    provider: str


class ComposeResponse(BaseModel):
    proposals: dict[str, ComposeProposal]
    source_lang: str
    provider: str | None


class PublicationNetworkResult(BaseModel):
    status: str
    url: str | None = None
    id: str | None = None
    error: str | None = None


class PublicationResponse(BaseModel):
    record_id: str | None
    status: str
    results: dict[str, PublicationNetworkResult]


class ScheduledPublicationResponse(BaseModel):
    status: Literal["scheduled"]
    id: str
    scheduled_time: str
    networks: list[str]


class ScheduledPostResponse(BaseModel):
    id: str
    content: str
    networks: list[str]
    scheduled_time: str
    status: Literal["pending"]


class CancelScheduledPostResponse(BaseModel):
    status: Literal["cancelled"]
    id: str


class ProcessedPublicationResponse(BaseModel):
    id: str
    status: str
    results: dict[str, PublicationNetworkResult]


class ProcessScheduledResponse(BaseModel):
    processed: int
    details: list[ProcessedPublicationResponse]


class PostHistoryResponse(BaseModel):
    id: str
    content: str
    networks: list[str]
    published_at: str
    status: str
