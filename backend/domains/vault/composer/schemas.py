"""Public request and preview contract for Note Composer."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ComposerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(min_length=1, max_length=200, pattern=r"^[\w.-]+$")
    mode: Literal["extract", "merge"]
    selection: Literal["note", "heading", "lines"] = "note"
    heading: str = Field(default="", max_length=500)
    start_line: int | None = Field(default=None, ge=1)
    end_line: int | None = Field(default=None, ge=1)
    target_id: str | None = Field(default=None, max_length=200, pattern=r"^[\w.-]+$")
    title: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def validate_selection(self) -> "ComposerRequest":
        if self.source_id in {".", ".."} or self.target_id in {".", ".."}:
            raise ValueError("Invalid page identity")
        if self.mode == "merge" and not self.target_id:
            raise ValueError("A destination note is required")
        if self.mode == "extract" and not self.title.strip():
            raise ValueError("A title is required for the new note")
        if self.selection == "heading" and not self.heading.strip():
            raise ValueError("A heading is required")
        if self.selection == "lines" and (
            self.start_line is None or self.end_line is None or self.end_line < self.start_line
        ):
            raise ValueError("A valid line range is required")
        return self


class ComposerChange(BaseModel):
    id: str
    title: str
    before: str
    after: str
    etag: str | None
    created: bool = False


class ComposerPreview(BaseModel):
    request: ComposerRequest
    token: str
    changes: list[ComposerChange]
    rewritten_links: int


class ComposerApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request: ComposerRequest
    token: str = Field(pattern=r"^[a-f0-9]{64}$")


class ComposerResult(BaseModel):
    source_id: str
    target_id: str
    changes: list[ComposerChange]
