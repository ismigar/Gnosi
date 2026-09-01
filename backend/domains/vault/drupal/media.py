"""Local file resolution and web-safe media preparation for Drupal."""

from __future__ import annotations

import asyncio
import importlib
import logging
import operator
import subprocess
import tempfile
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import unquote, urlparse

from backend.domains.vault.drupal.core import Metadata
from backend.domains.vault.registry.records import is_object_list, is_record
from backend.utils.open_values import get_value, mapping_items, unpack_pair

if TYPE_CHECKING:
    from PIL.Image import Image


DRUPAL_IMAGE_MAX_BYTES = 1_900_000
DRUPAL_IMAGE_WEB_TARGET = 450_000
DRUPAL_IMAGE_MAX_DIM = 1600
DRUPAL_JPEG_QUALITY = 82
DRUPAL_GS_PDF_SETTING = "/ebook"


@dataclass(frozen=True)
class DrupalPathDependencies:
    assets_root: Callable[[], Path]
    home_path: Callable[[], Path]


@dataclass(frozen=True)
class DrupalImageSettings:
    max_bytes: int = DRUPAL_IMAGE_MAX_BYTES
    web_target: int = DRUPAL_IMAGE_WEB_TARGET
    max_dimension: int = DRUPAL_IMAGE_MAX_DIM
    jpeg_quality: int = DRUPAL_JPEG_QUALITY


@dataclass(frozen=True)
class DrupalUploadDependencies:
    resolve_local_path: Callable[[object], Path | None]
    materialize: Callable[[Path, str], Awaitable[object]]
    shrink_pdf: Callable[[bytes, str], tuple[bytes, str]]
    shrink_image: Callable[[bytes, str], tuple[bytes, str]]
    find_existing_file: Callable[[str, int], Awaitable[object]]
    upload_image: Callable[[str, str, str, bytes], Awaitable[object]]


@dataclass(frozen=True)
class MediaSignatureDependencies:
    read_prop_value: Callable[[Metadata, Metadata | None], object]
    resolve_local_path: Callable[[object], Path | None]


def reanchor_home(path: Path, dependencies: DrupalPathDependencies) -> Path:
    """Re-anchor a stale macOS File Provider path to the current host home."""
    try:
        if path.exists():
            return path
        marker = "/Library/CloudStorage/"
        raw_path = str(path)
        marker_index = raw_path.find(marker)
        if marker_index < 0:
            return path
        candidate = dependencies.home_path() / raw_path[marker_index + 1 :]
        if candidate.exists():
            return candidate
    except Exception:
        pass
    return path


def resolve_local_path(
    value: object,
    dependencies: DrupalPathDependencies,
) -> Path | None:
    """Resolve a composite, absolute or Vault-relative file value."""
    if not value:
        return None
    raw_value = value[0] if is_object_list(value) else value
    raw = str(raw_value).strip()
    if not raw:
        return None
    if raw.startswith("file://"):
        return reanchor_home(Path(unquote(urlparse(raw).path)), dependencies)
    path = Path(raw)
    if path.is_absolute():
        return reanchor_home(path, dependencies)
    assets_index = raw.find("Assets/")
    relative = raw[assets_index + len("Assets/") :] if assets_index >= 0 else raw.lstrip("./")
    try:
        return (dependencies.assets_root() / relative).resolve()
    except Exception:
        return None


def _has_transparency(image: Image, source_format: str) -> bool:
    try:
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            return bool(operator.lt(image.convert("RGBA").getchannel("A").getextrema()[0], 255))
    except Exception:
        return source_format == "PNG"
    return False


def _is_flat_graphic(image: Image) -> bool:
    try:
        return bool(image.convert("RGB").getcolors(maxcolors=4096) is not None)
    except Exception:
        return False


def shrink_image(
    data: bytes,
    filename: str,
    settings: DrupalImageSettings = DrupalImageSettings(),
) -> tuple[bytes, str]:
    """Downscale and recompress an image only when the result is smaller."""
    try:
        # Keep optional loading inside the original catch; use Pillow's own static types.
        if TYPE_CHECKING:
            from PIL import Image as image_module
        else:
            image_module = importlib.import_module("PIL.Image")
        image: Image = image_module.open(BytesIO(data))
        image.load()
    except Exception:
        return data, filename
    source_format = str(image.format or "PNG").upper()
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    width, height = image.size
    too_big = max(width, height) > settings.max_dimension
    if not too_big and len(data) <= settings.web_target:
        return data, filename
    if too_big:
        scale = settings.max_dimension / float(max(width, height))
        image = image.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            # Pillow publishes the legacy alias dynamically; retain its runtime lookup.
            image_module.Resampling.LANCZOS if TYPE_CHECKING else image_module.LANCZOS,
        )

    def _png() -> bytes:
        buffer = BytesIO()
        mode = "RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB"
        image.convert(mode).save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()

    def _jpeg(quality: int) -> bytes:
        buffer = BytesIO()
        image.convert("RGB").save(
            buffer,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
        )
        return buffer.getvalue()

    has_alpha = _has_transparency(image, source_format)
    if has_alpha or _is_flat_graphic(image):
        output = _png()
        return (output, filename) if len(output) < len(data) else (data, filename)
    best = data
    for quality in (settings.jpeg_quality, 75, 65, 55):
        candidate = _jpeg(quality)
        best = candidate
        if len(candidate) <= settings.max_bytes:
            break
    return (best, f"{stem}.jpg") if len(best) < len(data) else (data, filename)


def shrink_pdf(
    data: bytes,
    filename: str,
    logger: logging.Logger,
    pdf_setting: str = DRUPAL_GS_PDF_SETTING,
) -> tuple[bytes, str]:
    """Compress a PDF with Ghostscript when a valid smaller output is produced."""
    if data[:5] != b"%PDF-":
        return data, filename
    try:
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "in.pdf"
            output_path = Path(directory) / "out.pdf"
            input_path.write_bytes(data)
            subprocess.run(
                [
                    "gs",
                    "-sDEVICE=pdfwrite",
                    "-dCompatibilityLevel=1.4",
                    f"-dPDFSETTINGS={pdf_setting}",
                    "-dNOPAUSE",
                    "-dQUIET",
                    "-dBATCH",
                    f"-sOutputFile={output_path}",
                    str(input_path),
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
            if output_path.exists() and output_path.stat().st_size > 0:
                output = output_path.read_bytes()
                if output[:5] == b"%PDF-" and len(output) < len(data):
                    return output, filename
    except Exception as error:
        logger.warning("drupal: PDF compression skipped (%s): %s", filename, error)
    return data, filename


async def upload_field_image(
    value: object,
    bundle: str,
    drupal_field: str,
    metadata: Metadata,
    image_cache: dict[str, object],
    dependencies: DrupalUploadDependencies,
) -> dict[str, object] | None:
    """Upload one image/file field, reusing files within and across runs."""
    if is_record(value):
        source = value.get("src") or value.get("url") or value.get("path")
        composite_alt = value.get("alt")
        composite_title = value.get("title")
    else:
        source, composite_alt, composite_title = value, None, None
    path = dependencies.resolve_local_path(source)
    if not path:
        return None
    await dependencies.materialize(path, "drupal-img")
    if not path.exists():
        raise RuntimeError(f"file not found: {path}")
    cache_key = str(path)
    file_uuid = image_cache.get(cache_key)
    if not file_uuid:
        data = await asyncio.to_thread(path.read_bytes)
        if data[:5] == b"%PDF-":
            data, upload_name = await asyncio.to_thread(
                dependencies.shrink_pdf,
                data,
                path.name,
            )
        else:
            data, upload_name = await asyncio.to_thread(
                dependencies.shrink_image,
                data,
                path.name,
            )
        file_uuid = await dependencies.find_existing_file(upload_name, len(data))
        if not file_uuid:
            file_uuid = await dependencies.upload_image(
                bundle,
                drupal_field,
                upload_name,
                data,
            )
        image_cache[cache_key] = file_uuid
    alt = str(composite_alt or metadata.get("title") or path.stem)
    image_metadata: dict[str, str] = {"alt": alt}
    if composite_title:
        image_metadata["title"] = str(composite_title)
    return {
        "data": {
            "type": "file--file",
            "id": file_uuid,
            "meta": image_metadata,
        }
    }


def media_signatures(
    mapping: object,
    properties_by_ref: dict[str, Metadata],
    field_metadata: Mapping[str, object],
    metadata: Metadata,
    dependencies: MediaSignatureDependencies,
) -> dict[str, str]:
    """Build stable signatures for file/image and taxonomy fields."""
    signatures: dict[str, str] = {}
    for pair in mapping_items(mapping):
        raw_ref, raw_drupal_field = unpack_pair(pair)
        drupal_field = str(raw_drupal_field or "")
        if not drupal_field:
            continue
        field_type = get_value(field_metadata.get(drupal_field) or {}, "type")
        prop = properties_by_ref.get(str(raw_ref))
        if not prop:
            continue
        value = dependencies.read_prop_value(metadata, prop)
        if value in (None, "", [], {}):
            continue
        if field_type in ("image", "file"):
            source = value.get("src") if is_record(value) else value
            try:
                path = dependencies.resolve_local_path(source)
                if path and path.exists():
                    stat_result = path.stat()
                    signatures[drupal_field] = f"{stat_result.st_size}:{int(stat_result.st_mtime)}"
            except Exception:
                pass
        elif field_type == "entity_reference":
            raw_names = value if is_object_list(value) else str(value).replace(";", ",").split(",")
            names = sorted(
                name for name in (str(item).strip().lower() for item in raw_names) if name
            )
            if names:
                signatures[drupal_field] = "tags:" + "|".join(names)
    return signatures


__all__ = [
    "DRUPAL_GS_PDF_SETTING",
    "DRUPAL_IMAGE_MAX_BYTES",
    "DRUPAL_IMAGE_MAX_DIM",
    "DRUPAL_IMAGE_WEB_TARGET",
    "DRUPAL_JPEG_QUALITY",
    "DrupalImageSettings",
    "DrupalPathDependencies",
    "DrupalUploadDependencies",
    "MediaSignatureDependencies",
    "media_signatures",
    "reanchor_home",
    "resolve_local_path",
    "shrink_image",
    "shrink_pdf",
    "upload_field_image",
]
