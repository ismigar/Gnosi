"""Bounded input and snapshot-only output for multi-note publication."""

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PublicationPage(BaseModel):
    id: str
    title: str
    markdown: str
    omissions: int


class PublicationBundle(BaseModel):
    title: str
    pages: list[PublicationPage]
    published_at: int
    expires_at: int | None
    revision: int


class PublicationCandidate(BaseModel):
    id: str
    title: str


class PublicationSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=160)
    page_ids: list[str] = Field(min_length=1, max_length=100)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)
    site_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    expected_revision: int | None = Field(default=None, ge=1, le=100)

    @model_validator(mode="after")
    def validate_selection(self) -> "PublicationSelection":
        self.title = self.title.strip()
        if not self.title or len(set(self.page_ids)) != len(self.page_ids):
            raise ValueError("Choose a title and distinct notes")
        if any(not item or len(item) > 200 for item in self.page_ids):
            raise ValueError("Invalid page identity")
        if (self.site_id is None) != (self.expected_revision is None):
            raise ValueError("An update requires the current site revision")
        return self


class PublicationPreviewResponse(BaseModel):
    preview_id: str
    preview_expires_at: int
    bundle: PublicationBundle


class PublicationCommit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_id: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")


class PublicationRevoke(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1, le=100)


class PublicationSummary(BaseModel):
    id: str
    token: str
    title: str
    page_ids: list[str]
    revision: int
    created_at: int
    updated_at: int
    expires_at: int | None
    revoked: bool
