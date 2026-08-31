"""Direct-call media payloads, separate from HTTP response validation.

Unsplash leaves are deliberately object: the historical proxy passed them
through unchanged and left validation to the existing Pydantic response model.
"""

from typing import Protocol, TypedDict

from fastapi import UploadFile


class MediaServicePort(Protocol):
    """Checked media dependency surface, without normalizing legacy records.

    Service dictionaries remain open. The HTTP models, not this port, validate
    their wire shapes. The concrete MediaService must satisfy this interface
    statically; no service or result cast is used to assert compatibility.
    """

    def get_roots(self) -> list[dict[str, object]]: ...
    def get_all_media(
        self,
        album: str | None = None,
        limit: int = 50,
        offset: int = 0,
        root: str = "images",
        *,
        kinds: str | None = None,
        extensions: str | None = None,
        q: str | None = None,
        desc_contains: str | None = None,
        tags_any: str | None = None,
        tags_all: str | None = None,
        tags_none: str | None = None,
        size_min: int | None = None,
        size_max: int | None = None,
        mtime_from: str | None = None,
        mtime_to: str | None = None,
        sort: str = "mtime",
        dir_: str = "desc",
    ) -> dict[str, object]: ...
    def get_albums(self) -> list[str]: ...
    def get_tree_node(
        self, path: str | None = None, root: str = "images"
    ) -> list[dict[str, object]]: ...
    def upload_media(self, file: UploadFile, album: str = "General") -> dict[str, object]: ...
    def update_metadata(
        self, path_in_root: str, metadata: dict[str, object], root: str = "images"
    ) -> bool: ...
    def list_views(self) -> list[dict[str, object]]: ...
    def create_view(self, data: dict[str, object]) -> dict[str, object]: ...
    def update_view(self, view_id: str, data: dict[str, object]) -> dict[str, object] | None: ...
    def delete_view(self, view_id: str) -> bool: ...


class MediaMutation(TypedDict):
    status: str


class PickedFolder(TypedDict):
    path: str


class PickedFile(PickedFolder):
    name: str
    size: int


class UnsplashPhoto(TypedDict):
    id: object
    url: object
    thumb: object
    author: object
    author_url: object


class UnsplashSearch(TypedDict):
    results: list[UnsplashPhoto]
    total_pages: object
