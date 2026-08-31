"""Generate the existing English podcast from explicitly selected local paths.

With no arguments, read GNOSI_DATA_DIR/rss_to_audio/feeds.opml and write the
dated summary files in GNOSI_DATA_DIR/audio/rss_to_audio. --opml and
--output-dir override those paths; no output defaults to the source tree.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import xml.etree.ElementTree as ET
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
from typing import Protocol, TypedDict, TypeGuard, runtime_checkable

from bs4 import BeautifulSoup
from groq import Groq

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.config.data_dir import resolve_data_dir  # noqa: E402
from backend.config.env_config import load_env  # noqa: E402

load_env()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

TARGET_TAGS = ["Religió", "ESS", "Actualitat", "News"]


class Feed(TypedDict):
    title: str
    url: str
    category: str


class Article(TypedDict):
    source: str
    category: str
    title: object
    content: str


class _Arguments(argparse.Namespace):
    opml: Path
    output_dir: Path


@runtime_checkable
class _Audio(Protocol):
    def save(self, filename: str) -> None: ...


DateTuple = tuple[int, int, int, int, int, int, int, int, int]


def _is_date_tuple(value: object) -> TypeGuard[DateTuple]:
    # Feedparser permits registered date handlers returning ordinary 9-tuples,
    # as well as time.struct_time. Do not require only the latter.
    return (
        isinstance(value, tuple)
        and len(value) == 9
        and all(isinstance(part, int) for part in value)
    )


def _record(value: object) -> Mapping[object, object]:
    if not isinstance(value, Mapping):
        raise TypeError("RSS entry must be a mapping")
    # Retain the original mapping: FeedParserDict implements aliases in get().
    # Unknown keys/values are opaque and must not be filtered or coerced.
    return value


def _sequence(value: object) -> Sequence[object]:
    if not isinstance(value, (list, tuple)):
        raise TypeError("RSS entries/content must be a list or tuple")
    return value


def _fetch_feed(url: str) -> object:
    """Boundary for feedparser's untyped API; consumers validate its result."""
    parse: object = import_module("feedparser").parse
    if not callable(parse):
        raise TypeError("feedparser.parse must be callable")
    result: object = parse(url)
    return result


def parse_opml(filepath: str | Path) -> list[Feed]:
    """Reads the OPML and extracts the feed URLs that belong to the target folders."""
    feeds: list[Feed] = []
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        for outline in root.findall(".//outline"):
            if "xmlUrl" not in outline.attrib:
                folder_title = outline.attrib.get("title", outline.attrib.get("text", ""))
                if folder_title in TARGET_TAGS:
                    for sub_outline in outline.findall("./outline"):
                        feed_url = sub_outline.attrib.get("xmlUrl")
                        title = sub_outline.attrib.get("title", sub_outline.attrib.get("text", ""))
                        if feed_url:
                            feeds.append(
                                {"title": title, "url": feed_url, "category": folder_title}
                            )
    except Exception as e:
        print(f"Error reading OPML: {e}")
    return feeds


def fetch_rss_24h(feeds: Sequence[Feed]) -> list[Article]:
    """Downloads and filters articles published in the last 24 hours, cleaning the HTML."""
    target_time = datetime.now(timezone.utc) - timedelta(hours=24)
    articles: list[Article] = []

    for feed in feeds:
        print(f"Reading feed: {feed['title']} ({feed['url']})")
        try:
            parsed = _record(_fetch_feed(feed["url"]))
            for raw_entry in _sequence(parsed["entries"]):
                entry = _record(raw_entry)
                pub_date = None
                date = entry.get("published_parsed") or entry.get("updated_parsed")
                if date:
                    if not _is_date_tuple(date):
                        raise TypeError("RSS parsed date must contain nine integers")
                    pub_date = datetime.fromtimestamp(time.mktime(date), tz=timezone.utc)

                if pub_date and pub_date > target_time:
                    content = _sequence(entry.get("content", [{"value": entry.get("summary", "")}]))
                    content_raw = _record(content[0])["value"]
                    if not isinstance(content_raw, (str, bytes)):
                        raise TypeError("RSS content must be text or bytes")
                    soup = BeautifulSoup(content_raw, "html.parser")
                    text_content = soup.get_text(separator=" ", strip=True)

                    articles.append(
                        {
                            "source": feed["title"],
                            "category": feed["category"],
                            "title": entry["title"],
                            "content": text_content[:2000],  # Keep the existing per-article limit.
                        }
                    )
        except Exception as e:
            print(f"Error processing feed {feed['url']}: {e}")
            continue

    return articles


def generate_summary(articles: Sequence[Article]) -> str | None:
    """Join articles within the token budget and request the existing Groq summary."""
    if not GROQ_API_KEY:
        print("GROQ_API_KEY is missing!")
        return "Error: the Groq API key is missing."

    if not articles:
        return "Hello. There are no new articles from the last 24 hours in the selected categories."

    client = Groq(api_key=GROQ_API_KEY)

    prompt = (
        "You are a senior editorial assistant. Summarize the following articles for a listener "
        "with a background in engineering and philosophy. Avoid shallow headlines; focus on "
        "depth, connections between topics, and ethical implications. Structure the summary "
        "as a fluid 10–15 minute podcast script. Language: English.\n\nARTICLES:\n"
    )

    for idx, art in enumerate(articles):
        article_text = (
            f"--- Article {idx + 1} ---\nSource: {art['source']} (Category: {art['category']})\n"
            f"Title: {art['title']}\nContent: {art['content']}\n\n"
        )
        if len(prompt) + len(article_text) > 25000:
            print("Approximate token limit reached. Some articles were skipped for this run.")
            break
        prompt += article_text

    print("Calling the Groq API (Llama-3-70b)... This may take a few seconds.")
    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an intelligent podcast assistant. Write only the text that "
                        "will be read aloud, without notes or meta-commentary."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            model="llama3-70b-8192",
            temperature=0.7,
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Groq API error: {e}")
        return "The summary could not be generated because of an LLM provider error."


def text_to_audio(text: str | None, filename: str | Path) -> None:
    """Converts English text to audio using gTTS."""
    print(f"Generating audio with gTTS; it will be saved as {filename}...")
    try:
        # gTTS ships no typing marker. Validate its callable factory and save
        # interface at this boundary, without asserting a schema for its internals.
        factory: object = import_module("gtts").gTTS
        if not callable(factory):
            raise TypeError("gtts.gTTS must be callable")
        tts: object = factory(text=text, lang="en", slow=False)
        if not isinstance(tts, _Audio):
            raise TypeError("gtts.gTTS must provide save(filename)")
        tts.save(str(filename))
        print(f"Podcast saved successfully to: {filename}")
    except Exception as e:
        print(f"Error generating TTS audio: {e}")


def main(argv: Sequence[str] | None = None) -> None:
    data_dir = resolve_data_dir()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opml", type=Path, default=data_dir / "rss_to_audio" / "feeds.opml")
    parser.add_argument("--output-dir", type=Path, default=data_dir / "audio" / "rss_to_audio")
    args = parser.parse_args(argv, namespace=_Arguments())
    opml_path = args.opml.expanduser()

    if not os.path.exists(opml_path):
        print(f"{opml_path} does not exist. Check that you exported it from the RSS app.")
        sys.exit(1)

    feeds = parse_opml(opml_path)
    print(f"Found {len(feeds)} feeds in the selected categories.")

    articles = fetch_rss_24h(feeds)
    print(f"Downloaded {len(articles)} unique articles from the last 24 hours.")

    summary_text = generate_summary(articles)

    # Save script text for review
    output_dir = args.output_dir.expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    txt_filename = output_dir / f"summary_{datetime.now().strftime('%Y_%m_%d')}.txt"
    with open(txt_filename, "w", encoding="utf-8") as f:
        # A provider may return null content. Preserve the existing write failure
        # and do not silently turn it into an empty podcast or a success message.
        if summary_text is None:
            raise TypeError("write() argument must be str, not None")
        f.write(summary_text)

    # Generate Audio
    audio_filename = output_dir / f"summary_{datetime.now().strftime('%Y_%m_%d')}.mp3"
    text_to_audio(summary_text, audio_filename)


if __name__ == "__main__":
    main()
