"""Document and media adapters for LLM Wiki source extraction."""

from __future__ import annotations

import html
import logging
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from contextlib import ExitStack
from pathlib import Path
from typing import Protocol

from backend.domains.llm_wiki.source_structure import HeadingContext



Segment = dict[str, object]
TextExtractor = Callable[[Path], str]
SegmentsExtractor = Callable[[Path], list[Segment]]
TemporaryRoot = Callable[[], Path]


class _PillowImage(Protocol):
    def save(self, path: str) -> object: ...
    def close(self) -> None: ...


class _PdfBitmap(Protocol):
    def to_pil(self) -> _PillowImage: ...
    def close(self) -> None: ...


class _PdfPage(Protocol):
    def render(self, *, scale: float) -> _PdfBitmap: ...
    def close(self) -> None: ...


class _PdfDocument(Protocol):
    def __getitem__(self, page_index: int) -> _PdfPage: ...
    def close(self) -> None: ...


def extract_pdf(
    path: Path,
    *,
    run_tesseract: TextExtractor,
    temporary_root: TemporaryRoot,
    logger: logging.Logger,
) -> list[Segment]:
    """Extract page and paragraph locators from a PDF, with bounded OCR fallback."""
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    from backend.domains.llm_wiki.media_structure import pdf_sections
    headings = pdf_sections(reader)
    section: dict[str, object] = {}
    segments: list[Segment] = []
    pdfium: _PdfDocument | None = None
    with ExitStack() as resources:
        for page_number, page in enumerate(reader.pages, start=1):
            if page_number in headings:
                section = headings[page_number]
            text = str(page.extract_text() or "").strip()
            if len(re.sub(r"\s+", "", text)) < 30 and shutil.which("tesseract"):
                try:
                    if pdfium is None:
                        import pypdfium2  # type: ignore[import-untyped]  # Third-party adapter lacks py.typed.

                        pdfium = pypdfium2.PdfDocument(str(path))
                        resources.callback(pdfium.close)
                    with ExitStack() as rendered:
                        pdf_page = pdfium[page_number - 1]
                        rendered.callback(pdf_page.close)
                        bitmap = pdf_page.render(scale=2.0)
                        rendered.callback(bitmap.close)
                        image = bitmap.to_pil()
                        rendered.callback(image.close)
                        with tempfile.NamedTemporaryFile(suffix=".png", dir=temporary_root()) as tmp:
                            image.save(tmp.name)
                            recognized = run_tesseract(Path(tmp.name))
                        if recognized.strip():
                            text = recognized
                        elif not text and page.images:
                            raise RuntimeError("OCR returned no text for an image page")
                except Exception as error:
                    logger.warning("llm_wiki PDF OCR failed on page %s: %s", page_number, error)
                    raise RuntimeError(f"PDF OCR incomplete on page {page_number}: {error}") from error
            elif not text and page.images:
                raise RuntimeError(f"PDF OCR is required on page {page_number}, but Tesseract is unavailable")
            for paragraph_number, paragraph in enumerate(split_paragraphs(text), start=1):
                segments.append(
                    {
                        "text": paragraph,
                        "locator": {"page": page_number, "paragraph": paragraph_number, **section},
                    }
                )
    return segments


def extract_docx(path: Path) -> list[Segment]:
    """Extract paragraphs with their most recent document heading."""
    from docx import Document
    from docx.table import Table

    document = Document(str(path))
    segments: list[Segment] = []
    structure = HeadingContext()
    paragraph_number = 0
    for paragraph in document.iter_inner_content():
        if isinstance(paragraph, Table):
            paragraph_number += 1
            segments.append({"text": "\n".join(" | ".join(cell.text for cell in row.cells)
                                                  for row in paragraph.rows),
                             "locator": {**structure.locator(), "paragraph": paragraph_number,
                                         "block": "table"}})
            continue
        text = str(paragraph.text or "").strip()
        if not text:
            continue
        style_name = str(getattr(paragraph.style, "name", "") or "")
        if style_name.lower().startswith("heading"):
            level = re.search(r"\d+", style_name)
            structure.push(int(level[0]) if level else 1, text)
            continue
        paragraph_number += 1
        segments.append(
            {
                "text": text,
                "locator": {**structure.locator(), "paragraph": paragraph_number},
            }
        )
    return segments


def extract_epub(path: Path) -> list[Segment]:
    """Extract ordered paragraph locators from EPUB document items."""
    from bs4 import BeautifulSoup
    from ebooklib import ITEM_DOCUMENT, epub  # type: ignore[import-untyped]  # Third-party adapter lacks py.typed.

    book = epub.read_epub(str(path))
    segments: list[Segment] = []
    chapter_number = 0
    documents = list(book.get_items_of_type(ITEM_DOCUMENT))
    by_id = {item.get_id(): item for item in documents}
    ordered = [by_id[item_id] for item_id, _linear in book.spine if item_id in by_id]
    ordered.extend(item for item in documents if item not in ordered)
    for item in ordered:
        chapter_number += 1
        soup = BeautifulSoup(item.get_content(), "html.parser")
        title_node = soup.find(["h1", "h2", "title"])
        chapter = title_node.get_text(" ", strip=True) if title_node else ""
        structure = HeadingContext(prefix=f"{item.get_name()}:")
        if title_node is not None and title_node.name == "title":
            structure.push(1, chapter)
        paragraph_number = 0
        for node in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "table"]):
            if node.find_parent(["li", "blockquote", "table"]):
                continue
            text = node.get_text(" ", strip=True)
            if re.fullmatch(r"h[1-6]", str(node.name)):
                if text:
                    structure.push(int(node.name[1]), text)
                continue
            if text:
                paragraph_number += 1
                segments.append(
                    {
                        "text": text,
                        "locator": {
                            "chapter": chapter,
                            "chapter_number": chapter_number,
                            **structure.locator(),
                            "paragraph": paragraph_number,
                        },
                    }
                )
    return segments


def extract_html(raw_html: str) -> list[Segment]:
    """Extract readable HTML blocks with heading context."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(raw_html, "html.parser")
    for node in soup(["script", "style", "noscript", "svg"]):
        node.decompose()
    segments: list[Segment] = []
    structure = HeadingContext()
    paragraph_number = 0
    for node in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "table"]):
        if node.find_parent(["li", "blockquote", "table"]):
            continue
        text = html.unescape(node.get_text(" ", strip=True))
        if not text:
            continue
        if re.fullmatch(r"h[1-6]", str(node.name)):
            structure.push(int(node.name[1]), text)
            continue
        paragraph_number += 1
        segments.append(
            {
                "text": text,
                "locator": {**structure.locator(), "paragraph": paragraph_number},
            }
        )
    return segments


def extract_text_file(path: Path) -> list[Segment]:
    """Extract paragraph and line locators from a UTF-8-compatible text file."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    return paragraph_segments(raw, locator_prefix="lines")


def paragraph_segments(raw: str, *, locator_prefix: str) -> list[Segment]:
    """Split text without losing stable line-range locators."""
    segments: list[Segment] = []
    structure = HeadingContext()
    lines: list[str] = []
    start = 1

    def flush(end: int, *, heading: bool = False) -> None:
        if not lines:
            return
        segments.append(
            {
                "text": " ".join(lines),
                "locator": {
                    "kind": locator_prefix,
                    **structure.locator(),
                    "line_start": start,
                    "line_end": end,
                    **({"block": "heading"} if heading else {}),
                },
            }
        )
        lines.clear()

    fenced = False
    raw_lines = str(raw or "").splitlines()
    for number, line in enumerate(raw_lines, start=1):
        text = line.strip()
        if text.startswith(("```", "~~~")):
            fenced = not fenced
        heading_match = re.match(r"^(#{1,6})\s+(.+?)(?:\s+#+)?$", text) if not fenced else None
        if heading_match:
            flush(number - 1)
            structure.push(len(heading_match[1]), heading_match[2].strip())
            start = number
            lines.append(text)
            flush(number, heading=True)
        elif not text:
            flush(number - 1)
        else:
            if not lines:
                start = number
            lines.append(text)
    flush(len(raw_lines))
    return segments


def extract_image(
    path: Path,
    *,
    run_tesseract: TextExtractor,
) -> list[Segment]:
    """Extract OCR paragraphs with visual locators."""
    text = run_tesseract(path)
    return [
        {"text": paragraph, "locator": {"image": path.name, "paragraph": index}}
        for index, paragraph in enumerate(split_paragraphs(text), start=1)
    ]


def run_tesseract(path: Path, *, extraction_error: type[RuntimeError]) -> str:
    """Run OCR using the languages available on the current host."""
    binary = shutil.which("tesseract")
    if not binary:
        raise extraction_error("Tesseract is not installed")
    languages = available_tesseract_languages(binary)
    requested = [language for language in ("cat", "spa", "eng", "fra") if language in languages]
    command = [binary, str(path), "stdout"]
    if requested:
        command.extend(["-l", "+".join(requested)])
    process = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if process.returncode != 0:
        raise extraction_error(process.stderr.strip() or "Tesseract failed")
    return process.stdout.strip()


def available_tesseract_languages(binary: str) -> set[str]:
    """Return installed OCR languages, or an empty set when probing fails."""
    try:
        process = subprocess.run(
            [binary, "--list-langs"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return {line.strip() for line in process.stdout.splitlines()[1:] if line.strip()}
    except Exception:
        return set()


def extract_audio(path: Path) -> list[Segment]:
    """Extract timed transcript segments from an audio file."""
    from backend.services.transcription import transcribe

    result = transcribe(str(path))
    raw_segments = result.get("segments") or []
    if not isinstance(raw_segments, list):
        return []
    segments: list[Segment] = [
        {
            "text": str(item.get("text") or "").strip(),
            "locator": {
                "start": float(item.get("start") or 0),
                "end": float(item.get("end") or 0),
            },
        }
        for item in raw_segments
        if isinstance(item, dict) and str(item.get("text") or "").strip()
    ]
    from backend.domains.llm_wiki.media_structure import file_chapters, timed_sections
    return timed_sections(segments, result.get("chapters") or file_chapters(path))


def extract_video(
    path: Path,
    *,
    extract_audio_segments: SegmentsExtractor,
    run_tesseract: TextExtractor,
    temporary_root: TemporaryRoot,
    logger: logging.Logger,
) -> list[Segment]:
    """Combine timed transcription with bounded visual keyframe OCR."""
    segments = extract_audio_segments(path)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not shutil.which("tesseract"):
        return segments
    with tempfile.TemporaryDirectory(
        prefix="gnosi-llm-wiki-frames-",
        dir=temporary_root(),
    ) as temporary_directory:
        pattern = str(Path(temporary_directory) / "frame-%04d.jpg")
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-vf",
            "fps=1/60,scale=1280:-2",
            "-frames:v",
            "40",
            pattern,
        ]
        process = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        if process.returncode != 0:
            logger.warning("llm_wiki keyframe extraction failed: %s", process.stderr.strip())
            return segments
        frames = sorted(Path(temporary_directory).glob("frame-*.jpg"))
        for frame_index, frame in enumerate(frames, start=1):
            try:
                text = run_tesseract(frame)
            except Exception:
                continue
            for paragraph in split_paragraphs(text):
                segments.append(
                    {
                        "text": paragraph,
                        "locator": {
                            "start": float((frame_index - 1) * 60),
                            "frame": frame_index,
                            "visual": True,
                        },
                    }
                )
    return sorted(segments, key=_segment_start)


def _segment_start(segment: Segment) -> float:
    locator = segment.get("locator")
    if not isinstance(locator, dict):
        return 0.0
    return float(locator.get("start") or 0)


def split_paragraphs(text: str) -> list[str]:
    """Normalize paragraphs while retaining their source order."""
    raw = str(text or "").strip()
    if not raw:
        return []
    return [
        " ".join(piece.split())
        for piece in re.split(r"\n\s*\n+|(?<=\.)\s*\n+", raw)
        if " ".join(piece.split())
    ]


__all__ = [
    "Segment",
    "available_tesseract_languages",
    "extract_audio",
    "extract_docx",
    "extract_epub",
    "extract_html",
    "extract_image",
    "extract_pdf",
    "extract_text_file",
    "extract_video",
    "paragraph_segments",
    "run_tesseract",
    "split_paragraphs",
]
