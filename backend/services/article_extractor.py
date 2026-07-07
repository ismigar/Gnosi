"""
Full-text extraction for RSS articles whose feed only ships an excerpt.

Many publishers (El Salto, Religión Digital, Jornal.cat, ...) put just the
intro paragraph plus a "Read full article" link in the RSS body, hoping to
drive traffic to their site. For our reader to feel useful we need the
full text. We use `trafilatura` to fetch the canonical URL and pull out
the article body as clean HTML.

This module is intentionally narrow:

- A single sync function `extract_full_content(url)` that returns a
  cleaned HTML string or `None`.
- Hard timeout via the `requests` session — trafilatura's own fetch is
  blocking and we don't want a slow domain to stall ingest.
- We respect a sensible UA and never retry; the caller decides whether
  to schedule a re-attempt later.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

import requests

log = logging.getLogger(__name__)

_HTTP_TIMEOUT = 8  # seconds; the ingester runs many of these in sequence
_USER_AGENT = (
    "Mozilla/5.0 (compatible; GnosiReader/1.0; "
    "+https://github.com/ismigar/Gnosi)"
)

# Threshold under which we consider RSS content to be a teaser/excerpt
# rather than the full article. Tuned from observed feed sizes — see the
# stats in PR description for #21 follow-up.
EXCERPT_LEN_THRESHOLD = 800


def looks_like_excerpt(rss_content: Optional[str]) -> bool:
    """Heuristic: short content or trailing CTA strongly suggests the
    feed only ships an excerpt.

    Returns True when extraction is worth attempting.
    """
    if not rss_content:
        return True
    # Strip HTML tags for the length comparison so a short body padded
    # with markup still counts as short. Removing only the `<`/`>` chars
    # (the old approach) kept every tag name and attribute — a short teaser
    # wrapped in verbose markup (nested `<div class="…long…">` from modern
    # CMS templates) inflated past the threshold and was wrongly treated as
    # a full article, so its full text was never fetched.
    text_only = re.sub(r"<[^>]*>", "", rss_content)
    if len(text_only) < EXCERPT_LEN_THRESHOLD:
        return True
    cta_markers = (
        "Leer artículo completo",
        "Llegeix l'article complet",
        "Read full article",
        "Continue reading",
        "Read more",
    )
    tail = rss_content[-300:].lower()
    return any(m.lower() in tail for m in cta_markers)


def extract_full_content(url: str) -> Optional[str]:
    """Fetch `url` and extract the article body as clean HTML.

    Returns the HTML string, or `None` if extraction failed for any
    reason (network, paywall, bot detection, layout we can't parse).
    Never raises — the caller falls back to the RSS-supplied content.
    """
    if not url or not url.startswith(("http://", "https://")):
        return None

    try:
        # Fetch ourselves so we control timeout and headers. trafilatura's
        # internal fetch_url is convenient but harder to bound.
        resp = requests.get(
            url,
            timeout=_HTTP_TIMEOUT,
            headers={"User-Agent": _USER_AGENT, "Accept-Language": "ca,es,en"},
        )
        if resp.status_code != 200 or not resp.text:
            return None
    except (requests.RequestException, ValueError) as e:
        log.debug("article_extractor: fetch failed for %s: %s", url, e)
        return None

    try:
        # Lazy import: trafilatura pulls lxml + a few siblings, so don't
        # eat the import cost in modules that never call us.
        import trafilatura

        extracted = trafilatura.extract(
            resp.text,
            url=url,
            output_format="html",
            include_images=True,
            include_links=True,
            include_formatting=True,
            favor_recall=True,
            with_metadata=False,
        )
        if extracted and len(extracted) > 200:
            return extracted
        return None
    except Exception as e:
        log.debug("article_extractor: parse failed for %s: %s", url, e)
        return None
