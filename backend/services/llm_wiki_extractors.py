"""Ordered, provenance-preserving source extraction for LLM Wiki.

Every adapter returns the same JSON-friendly shape: an origin contains ordered
segments, and every segment has a stable id, text, and source-specific locator.
No adapter truncates source content.  LLM-sized chunking happens afterwards.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urljoin, urlparse

import requests

from backend.config.logger_config import get_logger
from backend.domains.llm_wiki import documents as document_domain
from backend.domains.llm_wiki import origins as origin_domain
from backend.domains.vault.registry.records import RecordReader
from backend.services import llm_wiki_config
from backend.services.optional_module_capabilities import module_available
from backend.utils.open_values import append_value, iterable_values

logger = get_logger(__name__)

_HTTP_TIMEOUT = (10, 90)
_USER_AGENT = "Gnosi-LLM-Wiki/2.0"
_MAX_DOWNLOAD_BYTES = int(os.environ.get("GNOSI_LLM_WIKI_MAX_DOWNLOAD_MB", "500")) * 1024 * 1024

PDF_EXTENSIONS = {".pdf"}
TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".rst"}
HTML_EXTENSIONS = {".html", ".htm"}
DOCX_EXTENSIONS = {".docx"}
EPUB_EXTENSIONS = {".epub"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".heic"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".mpeg", ".mpg", ".webm"}


class ExtractionError(RuntimeError):
    """A source exists but cannot be converted into readable segments."""


def capability_report() -> dict[str, object]:
    """Report optional runtime capabilities for Settings diagnostics."""
    modules = {
        module: module_available(module)
        for module in ("pypdfium2", "docx", "ebooklib", "yt_dlp", "faster_whisper")
    }
    binaries = {
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ffprobe": bool(shutil.which("ffprobe")),
        "tesseract": bool(shutil.which("tesseract")),
    }
    tesseract_languages = (
        sorted(_available_tesseract_languages(shutil.which("tesseract") or ""))
        if binaries["tesseract"]
        else []
    )
    required_ocr_languages = {"cat", "spa", "eng", "fra"}
    return {
        "modules": modules,
        "binaries": binaries,
        "supported_extensions": sorted(
            PDF_EXTENSIONS
            | TEXT_EXTENSIONS
            | HTML_EXTENSIONS
            | DOCX_EXTENSIONS
            | EPUB_EXTENSIONS
            | IMAGE_EXTENSIONS
            | AUDIO_EXTENSIONS
            | VIDEO_EXTENSIONS
        ),
        "streaming": modules["yt_dlp"] and binaries["ffmpeg"],
        "ocr": binaries["tesseract"],
        "ocr_languages": tesseract_languages,
        "ocr_missing_languages": sorted(required_ocr_languages - set(tesseract_languages)),
        "transcription": modules["faster_whisper"],
    }


def extract_resource_sources(
    metadata: dict[str, object],
    body: str,
    vault_root: Path,
    source_table: RecordReader,
    source_config: dict[str, object],
) -> tuple[list[dict[str, object]], list[str]]:
    """Extract every configured attachment followed by every configured URL.

    Exact duplicate content is represented once and records all equivalent
    origins under ``aliases``.  The page body is a fallback when no configured
    attachment or URL yielded readable content.
    """
    props_by_id = {
        str(prop.get("id") or ""): prop
        for prop in iterable_values(source_table.get("properties") or [])
        if isinstance(prop, dict) and prop.get("id")
    }
    raw_inputs: list[tuple[str, str]] = []
    for prop_id in iterable_values(source_config.get("attachment_property_ids") or []):
        prop = props_by_id.get(str(prop_id))
        for value in _values_for_property(metadata, prop):
            raw_inputs.append(("attachment", value))
    for prop_id in iterable_values(source_config.get("url_property_ids") or []):
        prop = props_by_id.get(str(prop_id))
        for value in _values_for_property(metadata, prop):
            if value.lower().startswith(("http://", "https://")):
                raw_inputs.append(("url", value))

    origins: list[dict[str, object]] = []
    warnings: list[str] = []
    for input_order, (input_kind, value) in enumerate(raw_inputs):
        try:
            if input_kind == "url":
                extracted = _extract_url(value, input_order)
            else:
                path = _resolve_attachment_path(value, Path(vault_root))
                if not path:
                    raise ExtractionError(
                        f"Attachment not found or outside configured roots: {value}"
                    )
                _materialize(path)
                extracted = _extract_path(path, input_order, label=Path(path).name)
                # Keep the trusted resolved path only for this ingest process.
                # Snapshot persistence intentionally excludes these private fields.
                for origin in extracted:
                    if origin.get("kind") == "pdf":
                        origin["_annotation_source_uri"] = value
                        origin["_annotation_pdf_path"] = str(path)
            origins.extend(extracted)
        except Exception as exc:  # noqa: BLE001
            message = f"{input_kind} {value}: {exc}"
            logger.warning("llm_wiki source extraction skipped: %s", message)
            warnings.append(message)

    if not origins and source_config.get("include_body", False) and str(body or "").strip():
        segments = _paragraph_segments(str(body), locator_prefix="body")
        if segments:
            origins.append(
                _finalize_origin(
                    {
                        "kind": "body",
                        "label": str(metadata.get("title") or "Resource body"),
                        "source_url": "",
                        "input_order": len(raw_inputs),
                        "segments": segments,
                    }
                )
            )

    return _deduplicate_origins(origins), warnings


def chunk_origins(
    origins: list[dict[str, object]],
    *,
    max_chars: int = 12000,
) -> list[dict[str, object]]:
    """Create complete ordered LLM chunks without dropping any segment."""
    return origin_domain.chunk_origins(origins, max_chars=max_chars)


def _values_for_property(metadata: RecordReader, prop: RecordReader | None) -> list[str]:
    if not prop:
        return []
    names = [str(prop.get("name") or ""), str(prop.get("id") or "")]
    raw = next(
        (
            metadata.get(name)
            for name in names
            if name and metadata.get(name) not in (None, "", [], {})
        ),
        None,
    )
    values = raw if isinstance(raw, list) else ([] if raw in (None, "") else [raw])
    out: list[str] = []
    for value in values:
        if isinstance(value, dict):
            value = value.get("url") or value.get("path") or value.get("name") or ""
        cleaned = str(value or "").strip()
        if cleaned.startswith("[[") and cleaned.endswith("]]"):
            cleaned = cleaned[2:-2].split("|", 1)[0].strip()
        if cleaned:
            out.append(cleaned)
    return out


def _resolve_attachment_path(raw: str, vault_root: Path) -> Optional[Path]:
    value = unquote(str(raw or "").strip())
    if value.lower().startswith("file://"):
        value = unquote(urlparse(value).path)
    try:
        from backend.domains.vault.registry.runtime import (
            _reroot_attachment_under_current_host,
        )

        rerooted = _reroot_attachment_under_current_host(value)
        if rerooted and rerooted.exists():
            return Path(rerooted).resolve()
    except Exception:
        pass

    root = vault_root.resolve()
    candidate = Path(value)
    target = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if target != root and root not in target.parents:
        return None
    return target if target.exists() else None


def _materialize(path: Path) -> None:
    from backend.platform.files import get_files_provider

    provider = get_files_provider()
    if not provider.is_online_only(path):
        return
    try:
        ok = asyncio.run(provider.materialize(path))
    except RuntimeError:
        # Extraction runs in a worker thread, but keep a safe fallback for tests
        # that invoke it from an event-loop owner.
        result: list[bool] = []

        def _runner() -> None:
            result.append(asyncio.run(provider.materialize(path)))

        import threading

        thread = threading.Thread(target=_runner, daemon=True)
        thread.start()
        thread.join()
        ok = bool(result and result[0])
    if not ok:
        raise ExtractionError(f"Cloud file could not be materialized: {path.name}")


def _extract_path(path: Path, input_order: int, *, label: str = "") -> list[dict[str, object]]:
    suffix = path.suffix.lower()
    if suffix in PDF_EXTENSIONS:
        kind, segments = "pdf", _extract_pdf(path)
    elif suffix in DOCX_EXTENSIONS:
        kind, segments = "docx", _extract_docx(path)
    elif suffix in EPUB_EXTENSIONS:
        kind, segments = "epub", _extract_epub(path)
    elif suffix in HTML_EXTENSIONS:
        kind, segments = "html", _extract_html(path.read_text(encoding="utf-8", errors="replace"))
    elif suffix in TEXT_EXTENSIONS:
        kind, segments = suffix.lstrip("."), _extract_text_file(path)
    elif suffix in IMAGE_EXTENSIONS:
        kind, segments = "image", _extract_image(path)
    elif suffix in VIDEO_EXTENSIONS:
        kind, segments = "video", _extract_video(path)
    elif suffix in AUDIO_EXTENSIONS:
        kind, segments = "audio", _extract_audio(path)
    else:
        guessed = mimetypes.guess_type(path.name)[0] or ""
        if guessed.startswith("text/"):
            kind, segments = "text", _extract_text_file(path)
        else:
            raise ExtractionError(f"Unsupported source format: {suffix or guessed or path.name}")
    if not segments:
        raise ExtractionError(f"No readable content found in {path.name}")
    return [
        _finalize_origin(
            {
                "kind": kind,
                "label": label or path.name,
                "source_url": "",
                "input_order": input_order,
                "segments": segments,
            }
        )
    ]


def _extract_pdf(path: Path) -> list[dict[str, object]]:
    return document_domain.extract_pdf(
        path,
        run_tesseract=_run_tesseract,
        temporary_root=_temporary_root,
        logger=logger,
    )


def _extract_docx(path: Path) -> list[dict[str, object]]:
    return document_domain.extract_docx(path)


def _extract_epub(path: Path) -> list[dict[str, object]]:
    return document_domain.extract_epub(path)


def _extract_html(raw_html: str) -> list[dict[str, object]]:
    return document_domain.extract_html(raw_html)


def _extract_text_file(path: Path) -> list[dict[str, object]]:
    return document_domain.extract_text_file(path)


def _paragraph_segments(raw: str, *, locator_prefix: str) -> list[dict[str, object]]:
    return document_domain.paragraph_segments(raw, locator_prefix=locator_prefix)


def _extract_image(path: Path) -> list[dict[str, object]]:
    return document_domain.extract_image(path, run_tesseract=_run_tesseract)


def _run_tesseract(path: Path) -> str:
    return document_domain.run_tesseract(path, extraction_error=ExtractionError)


def _available_tesseract_languages(binary: str) -> set[str]:
    return document_domain.available_tesseract_languages(binary)


def _extract_audio(path: Path) -> list[dict[str, object]]:
    return document_domain.extract_audio(path)


def _extract_video(path: Path) -> list[dict[str, object]]:
    return document_domain.extract_video(
        path,
        extract_audio_segments=_extract_audio,
        run_tesseract=_run_tesseract,
        temporary_root=_temporary_root,
        logger=logger,
    )


def _http_source_metadata(
    response: requests.Response,
    *,
    requested_url: str,
    final_url: str,
) -> dict[str, str]:
    return {
        "requested_url": requested_url,
        "final_url": final_url,
        "etag": str(response.headers.get("etag") or "")[:1_000],
        "last_modified": str(response.headers.get("last-modified") or "")[:1_000],
        "content_hash": hashlib.sha256(response.content).hexdigest(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def _attach_http_source(
    origins: list[dict[str, object]],
    metadata: dict[str, str],
) -> list[dict[str, object]]:
    for origin in origins:
        if origin.get("requested_url") and origin.get("requested_url") != metadata["requested_url"]:
            append_value(
                origin.setdefault("http_sources", []),
                {
                    "requested_url": origin.get("requested_url"),
                    "final_url": origin.get("http_final_url"),
                    "etag": origin.get("http_etag"),
                    "last_modified": origin.get("http_last_modified"),
                    "content_hash": origin.get("http_content_hash"),
                    "checked_at": origin.get("http_checked_at"),
                },
            )
        origin["requested_url"] = metadata["requested_url"]
        origin["http_final_url"] = metadata["final_url"]
        origin["http_etag"] = metadata["etag"]
        origin["http_last_modified"] = metadata["last_modified"]
        origin["http_content_hash"] = metadata["content_hash"]
        origin["http_checked_at"] = metadata["checked_at"]
    return origins


def is_streaming_url(url: str) -> bool:
    """Return whether URL extraction uses the streaming media adapter."""
    return _looks_like_streaming_page(url)


def _streaming_metadata_fingerprint(info: dict[str, object]) -> str:
    """Build a stable fingerprint without downloading streaming media bytes."""
    payload = {
        key: info.get(key)
        for key in (
            "extractor_key",
            "id",
            "webpage_url",
            "title",
            "duration",
            "upload_date",
            "timestamp",
            "release_timestamp",
            "modified_timestamp",
            "live_status",
            "filesize",
            "filesize_approx",
        )
        if info.get(key) not in (None, "")
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def probe_streaming_url(url: str, *, fingerprint: str = "") -> dict[str, object]:
    """Probe streaming metadata without downloading or transcribing the media."""
    from backend.agent.web_context import is_public_http_url

    ok, reason = is_public_http_url(str(url))
    if not ok:
        raise ExtractionError(f"Unsafe URL blocked: {reason}")
    try:
        import yt_dlp  # type: ignore[import-untyped]
    except Exception as exc:
        raise ExtractionError("yt-dlp is not installed") from exc
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "socket_timeout": max(_HTTP_TIMEOUT),
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(str(url), download=False)
    if not isinstance(info, dict):
        raise ExtractionError("The streaming source metadata is unavailable")
    current_fingerprint = _streaming_metadata_fingerprint(info)
    return {
        "changed": not bool(fingerprint) or current_fingerprint != str(fingerprint),
        "requested_url": str(url),
        "final_url": str(info.get("webpage_url") or url),
        "stream_fingerprint": current_fingerprint,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def probe_public_url(
    url: str,
    *,
    etag: str = "",
    last_modified: str = "",
    content_hash: str = "",
) -> dict[str, object]:
    """Conditionally revalidate a public URL through the secure downloader."""
    request_headers = {}
    if str(etag).strip():
        request_headers["If-None-Match"] = str(etag).strip()[:1_000]
    if str(last_modified).strip():
        request_headers["If-Modified-Since"] = str(last_modified).strip()[:1_000]
    response, final_url = _download_public_url(
        url,
        request_headers=request_headers,
        allow_not_modified=True,
    )
    checked_at = datetime.now(timezone.utc).isoformat()
    if response.status_code == 304:
        return {
            "changed": False,
            "requested_url": str(url),
            "final_url": final_url,
            "etag": str(response.headers.get("etag") or etag)[:1_000],
            "last_modified": str(response.headers.get("last-modified") or last_modified)[:1_000],
            "content_hash": str(content_hash),
            "checked_at": checked_at,
        }
    current_hash = hashlib.sha256(response.content).hexdigest()
    return {
        "changed": not bool(content_hash) or current_hash != str(content_hash),
        "requested_url": str(url),
        "final_url": final_url,
        "etag": str(response.headers.get("etag") or "")[:1_000],
        "last_modified": str(response.headers.get("last-modified") or "")[:1_000],
        "content_hash": current_hash,
        "checked_at": checked_at,
    }


def _extract_url(url: str, input_order: int) -> list[dict[str, object]]:
    if _looks_like_streaming_page(url):
        origins = _extract_streaming_url(url, input_order)
        checked_at = datetime.now(timezone.utc).isoformat()
        for origin in origins:
            origin["requested_url"] = url
            origin["http_final_url"] = str(origin.get("source_url") or url)
            origin["http_etag"] = ""
            origin["http_last_modified"] = ""
            origin["http_content_hash"] = str(origin.get("content_hash") or "")
            origin["http_stream_fingerprint"] = str(origin.get("stream_fingerprint") or "")
            origin["http_checked_at"] = checked_at
        return origins

    response, final_url = _download_public_url(url)
    http_metadata = _http_source_metadata(
        response,
        requested_url=url,
        final_url=final_url,
    )
    content_type = str(response.headers.get("content-type") or "").split(";", 1)[0].lower()
    suffix = _suffix_for_response(final_url, content_type)
    if content_type in {
        "application/rss+xml",
        "application/atom+xml",
        "application/xml",
        "text/xml",
    }:
        media_url = _embedded_media_url(response.content, final_url, xml=True)
        if not media_url:
            raise ExtractionError("The feed did not contain a public media enclosure")
        origins = _extract_url(media_url, input_order)
        for origin in origins:
            append_value(
                origin.setdefault("aliases", []),
                {
                    "kind": "feed",
                    "label": final_url,
                    "source_url": final_url,
                    "input_order": input_order,
                },
            )
        return _attach_http_source(origins, http_metadata)
    if content_type in {"text/html", "application/xhtml+xml"} or suffix in HTML_EXTENSIONS:
        raw_html = response.content.decode(response.encoding or "utf-8", errors="replace")
        segments = _extract_html(raw_html)
        if not segments:
            try:
                return _attach_http_source(
                    _extract_streaming_url(final_url, input_order),
                    http_metadata,
                )
            except Exception as exc:
                raise ExtractionError(
                    "The web page did not contain extractable article text or public media"
                ) from exc
        origins = [
            _finalize_origin(
                {
                    "kind": "url",
                    "label": final_url,
                    "source_url": final_url,
                    "input_order": input_order,
                    "segments": segments,
                }
            )
        ]
        media_url = _embedded_media_url(response.content, final_url)
        if media_url and media_url != final_url:
            try:
                origins.extend(_extract_url(media_url, input_order))
            except Exception as exc:  # noqa: BLE001
                logger.warning("llm_wiki embedded public media extraction failed: %s", exc)
        return _attach_http_source(origins, http_metadata)

    with tempfile.NamedTemporaryFile(
        suffix=suffix or ".bin",
        delete=False,
        dir=_temporary_root(),
    ) as tmp:
        tmp.write(response.content)
        tmp_path = Path(tmp.name)
    try:
        origins = _extract_path(
            tmp_path, input_order, label=Path(urlparse(final_url).path).name or final_url
        )
        for origin in origins:
            origin["source_url"] = final_url
            origin["origin_id"] = _origin_id(origin)
        return _attach_http_source(origins, http_metadata)
    finally:
        tmp_path.unlink(missing_ok=True)


def _download_public_url(
    url: str,
    *,
    request_headers: Optional[dict[str, str]] = None,
    allow_not_modified: bool = False,
) -> tuple[requests.Response, str]:
    from backend.agent.web_context import is_public_http_url

    current = str(url).strip()
    for _ in range(6):
        ok, reason = is_public_http_url(current)
        if not ok:
            raise ExtractionError(f"Unsafe URL blocked: {reason}")
        response = requests.get(
            current,
            timeout=_HTTP_TIMEOUT,
            headers={
                "User-Agent": _USER_AGENT,
                "Accept-Language": "ca,es,en,fr",
                **(request_headers or {}),
            },
            allow_redirects=False,
            stream=True,
        )
        if response.is_redirect and response.headers.get("location"):
            current = urljoin(current, response.headers["location"])
            continue
        if allow_not_modified and response.status_code == 304:
            return response, current
        response.raise_for_status()
        declared = int(response.headers.get("content-length") or 0)
        if declared and declared > _MAX_DOWNLOAD_BYTES:
            raise ExtractionError("Remote source exceeds the configured download limit")
        chunks = []
        total = 0
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > _MAX_DOWNLOAD_BYTES:
                raise ExtractionError("Remote source exceeds the configured download limit")
            chunks.append(chunk)
        response._content = b"".join(chunks)  # requests exposes content through this cache.
        return response, current
    raise ExtractionError("Too many URL redirects")


def _looks_like_streaming_page(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(
        marker in host for marker in ("youtube.com", "youtu.be", "vimeo.com", "soundcloud.com")
    )


def _extract_streaming_url(url: str, input_order: int) -> list[dict[str, object]]:
    from backend.agent.web_context import is_public_http_url

    ok, reason = is_public_http_url(str(url))
    if not ok:
        raise ExtractionError(f"Unsafe URL blocked: {reason}")
    try:
        import yt_dlp
    except Exception as exc:
        raise ExtractionError("yt-dlp is not installed") from exc
    with tempfile.TemporaryDirectory(
        prefix="gnosi-llm-wiki-stream-",
        dir=_temporary_root(),
    ) as tmp:
        template = str(Path(tmp) / "source.%(ext)s")
        options = {
            "format": "bestaudio/best",
            "outtmpl": template,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "max_filesize": _MAX_DOWNLOAD_BYTES,
            "restrictfilenames": True,
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
            path = Path(ydl.prepare_filename(info))
        if not path.exists():
            candidates = list(Path(tmp).glob("source.*"))
            path = candidates[0] if candidates else path
        if not path.exists():
            raise ExtractionError("The streaming source could not be downloaded")
        segments = _extract_audio(path)
        if not segments:
            raise ExtractionError("The streaming source did not produce a transcript")
        return [
            _finalize_origin(
                {
                    "kind": "stream",
                    "label": str(info.get("title") or url),
                    "source_url": str(info.get("webpage_url") or url),
                    "stream_fingerprint": _streaming_metadata_fingerprint(info),
                    "input_order": input_order,
                    "segments": segments,
                }
            )
        ]


def _embedded_media_url(content: bytes, base_url: str, *, xml: bool = False) -> str:
    """Return the first public audio/video enclosure referenced by a page."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(content, "xml" if xml else "html.parser")
    candidates = []
    if xml:
        for node in soup.find_all(["enclosure", "content"]):
            media_type = str(node.get("type") or "").lower()
            if media_type.startswith(("audio/", "video/")) or node.name == "enclosure":
                candidates.append(node.get("url"))
    else:
        for node in soup.find_all(["audio", "video", "source"]):
            candidates.append(node.get("src"))
        for node in soup.find_all("meta"):
            prop = str(node.get("property") or node.get("name") or "").lower()
            if prop in {"og:audio", "og:audio:url", "og:video", "og:video:url"}:
                candidates.append(node.get("content"))
    for candidate in candidates:
        value = str(candidate or "").strip()
        if value:
            return urljoin(base_url, value)
    return ""


def _temporary_root() -> Path:
    """Keep extraction temporaries in local Gnosi data, never in the vault."""
    from backend.domains.vault.pages.runtime import get_p

    root = Path(get_p("LOCAL_DATA")) / "llm_wiki" / "tmp"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _suffix_for_response(url: str, content_type: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix:
        return suffix
    guessed = mimetypes.guess_extension(content_type or "") or ""
    return ".jpg" if guessed == ".jpe" else guessed


def _split_paragraphs(text: str) -> list[str]:
    return document_domain.split_paragraphs(text)


def _finalize_origin(origin: dict[str, object]) -> dict[str, object]:
    return origin_domain.finalize_origin(origin)


def _origin_id(origin: dict[str, object]) -> str:
    return origin_domain.origin_id(origin)


def _deduplicate_origins(
    origins: list[dict[str, object]],
) -> list[dict[str, object]]:
    return origin_domain.deduplicate_origins(origins)
