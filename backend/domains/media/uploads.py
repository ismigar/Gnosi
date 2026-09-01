"""Contained media uploads, EXIF extraction, and API file serialization."""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import ContextManager, Protocol, cast

from fastapi import UploadFile

from backend.domains.media.types import (
    Coordinates,
    ExifData,
    HydratedUserMetadata,
    MediaInfo,
    MediaRootDefinition,
)


class RationalValue(Protocol):
    """Numerator/denominator pair exposed by Pillow EXIF values."""

    numerator: int
    denominator: int


class ExifImage(Protocol):
    """Pillow image behavior required by the EXIF adapter."""

    def _getexif(self) -> Mapping[int, object] | None: ...


class ImageModule(Protocol):
    """Pillow module boundary used without leaking its dynamic types."""

    def open(self, path: Path) -> ContextManager[ExifImage]: ...


class HttpExceptionFactory(Protocol):
    """FastAPI exception constructor required by upload validation."""

    def __call__(self, *, status_code: int, detail: str) -> Exception: ...


class UploadService(Protocol):
    """Late-bound facade methods required by upload orchestration."""

    @property
    def media_dir(self) -> Path: ...

    def invalidate_cache(self, target_dir: Path | None = None) -> None: ...

    def _get_file_info(
        self,
        path: Path,
        fast: bool = False,
        root: str = "images",
    ) -> MediaInfo: ...


class FileInfoService(Protocol):
    """Late-bound facade methods required by media serialization."""

    @classmethod
    def classify_kind(cls, ext: str) -> str: ...

    def _root_dir(self, root: str = "images") -> Path | None: ...

    def _get_exif_data(self, path: Path) -> ExifData: ...

    def _get_user_meta_for(
        self,
        root: str,
        rel_path_in_root: str,
    ) -> HydratedUserMetadata: ...


def upload_media(
    service: UploadService,
    file: UploadFile,
    album: str,
    *,
    split_album: Callable[[str], list[str]],
    sanitize_segment: Callable[[str, str], str],
    safe_write: Callable[[Path, bytes], None],
    http_exception: HttpExceptionFactory,
) -> MediaInfo:
    """Validate containment and atomically save one uploaded media file."""
    media_dir = service.media_dir
    segments: list[str] = []
    for raw_segment in split_album(album or ""):
        segment = raw_segment.strip()
        if not segment:
            continue
        if set(segment) <= {"."}:
            raise http_exception(status_code=400, detail="Invalid album name")
        segments.append(sanitize_segment(segment, "General"))
    if not segments:
        segments = ["General"]
    target_dir = media_dir.joinpath(*segments)

    try:
        target_dir.resolve().relative_to(media_dir.resolve())
    except ValueError:
        raise http_exception(status_code=400, detail="Invalid album name")
    target_dir.mkdir(parents=True, exist_ok=True)

    content = file.file.read()
    fallback_name = f"upload-{hashlib.sha256(content).hexdigest()[:8]}"
    filename = sanitize_segment(file.filename or "", fallback_name)
    target_path = target_dir / filename
    if target_path.exists():
        file_hash = hashlib.sha256(content).hexdigest()[:8]
        filename = f"{file_hash}_{filename}"
        target_path = target_dir / filename

    safe_write(target_path, content)
    service.invalidate_cache(target_dir)
    service.invalidate_cache(media_dir)
    return service._get_file_info(target_path)


def convert_to_degrees(value: Sequence[RationalValue]) -> float:
    """Convert the historical three-part GPS rational sequence to degrees."""
    degrees = float(value[0].numerator) / float(value[0].denominator)
    minutes = float(value[1].numerator) / float(value[1].denominator)
    seconds = float(value[2].numerator) / float(value[2].denominator)
    return degrees + (minutes / 60.0) + (seconds / 3600.0)


def _gps_coordinates(
    value: object,
    gps_tags: Mapping[int, str | int],
    convert_degrees: Callable[[Sequence[RationalValue]], float],
) -> tuple[float, float] | None:
    raw_gps = cast(Mapping[int, object], value)
    gps_data = {gps_tags.get(tag, tag): raw_gps[tag] for tag in raw_gps}
    latitude = gps_data.get("GPSLatitude")
    latitude_ref = gps_data.get("GPSLatitudeRef")
    longitude = gps_data.get("GPSLongitude")
    longitude_ref = gps_data.get("GPSLongitudeRef")
    if not (latitude and latitude_ref and longitude and longitude_ref):
        return None
    lat_sequence = cast(Sequence[RationalValue], latitude)
    lng_sequence = cast(Sequence[RationalValue], longitude)
    lat = convert_degrees(lat_sequence) * (1 if latitude_ref == "N" else -1)
    lng = convert_degrees(lng_sequence) * (1 if longitude_ref == "E" else -1)
    return lat, lng


def get_exif_data(
    path: Path,
    *,
    image: ImageModule | None,
    tags: Mapping[int, str | int],
    gps_tags: Mapping[int, str | int],
    parse_exif_date: Callable[[object], str],
    convert_degrees: Callable[[Sequence[RationalValue]], float],
    logger: logging.Logger,
) -> ExifData:
    """Extract the exact EXIF subset historically returned by MediaService."""
    if image is None:
        return {"date_taken": None, "lat": None, "lng": None}
    results: ExifData = {"date_taken": None, "lat": None, "lng": None}
    try:
        with image.open(path) as opened:
            exif = opened._getexif()
            if not exif:
                return results
            for tag, value in exif.items():
                decoded = tags.get(tag, tag)
                if decoded == "DateTimeOriginal":
                    try:
                        results["date_taken"] = parse_exif_date(value)
                    except (ValueError, TypeError) as error:
                        logger.debug(f"EXIF date parse failed for {path}: {error}")
                elif decoded == "GPSInfo":
                    coordinates = _gps_coordinates(value, gps_tags, convert_degrees)
                    if coordinates is not None:
                        results["lat"], results["lng"] = coordinates
    except Exception as error:
        logger.debug(f"EXIF read failed for {path}: {error}")
    return results


def get_file_info(
    service: FileInfoService,
    path: Path,
    fast: bool,
    root: str,
    *,
    active_vault_path: Callable[[], Path],
    media_roots: Mapping[str, MediaRootDefinition],
    from_timestamp: Callable[[float], str],
) -> MediaInfo:
    """Serialize one media path using the historical field and URL order."""
    vault_path = active_vault_path()
    try:
        relative_path = path.relative_to(vault_path)
    except ValueError:
        relative_path = path
    album = path.parent.name
    root_directory = service._root_dir(root)

    prefix = media_roots.get(root, media_roots["images"])["url_prefix"]
    try:
        url_relative = path.relative_to(root_directory).as_posix() if root_directory else path.name
        url = f"{prefix}{url_relative}"
    except ValueError:
        url_relative = path.name
        url = f"{prefix}{path.name}"

    exif: ExifData = {"date_taken": None, "lat": None, "lng": None}
    if not fast:
        exif = service._get_exif_data(path)
    stat = path.stat()
    extension = path.suffix.lower()
    user_metadata = service._get_user_meta_for(root, url_relative)
    location: Coordinates | None = None
    if not fast:
        location = {"lat": exif.get("lat"), "lng": exif.get("lng")}
    return {
        "id": path.stem,
        "filename": path.name,
        "url": url,
        "path": str(relative_path),
        "path_in_root": url_relative,
        "album": album,
        "root": root,
        "kind": service.classify_kind(extension),
        "size": stat.st_size,
        "last_modified": from_timestamp(stat.st_mtime),
        "extension": extension,
        "date_taken": exif.get("date_taken"),
        "location": location,
        "tags": user_metadata["tags"],
        "description": user_metadata["description"],
    }
