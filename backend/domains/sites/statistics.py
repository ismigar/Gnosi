"""Read Webalizer and AWFFull monthly reports without executing remote markup."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from fastapi import HTTPException
from pydantic import BaseModel

from .models import SiteConfig
from .public_http import FetchBudget, PublicFetchError, fetch


class StatisticsMonth(BaseModel):
    month: str
    visits: int
    pages: int
    hits: int
    files: int
    clients: int
    transfer_bytes: int


class SiteStatistics(BaseModel):
    source_url: str
    generated_at: str
    fetched_at: str
    months: list[StatisticsMonth]


def _integer(value: str) -> int:
    if not re.fullmatch(r"[0-9][0-9., \xa0]*", value):
        raise ValueError("Invalid counter")
    return int(re.sub(r"[^0-9]", "", value))


def _transfer(value: str) -> int:
    match = re.fullmatch(r"([0-9.,]+)\s*(bytes|[KMGT]?B)?", value.strip(), re.I)
    if not match:
        raise ValueError("Invalid transfer size")
    number, unit = match.groups()
    # AWFFull formats volume with a decimal comma; Webalizer uses raw KiB.
    if unit:
        number = number.replace(".", "").replace(",", ".") if "," in number else number
        power = {"bytes": 0, "b": 0, "kb": 1, "mb": 2, "gb": 3, "tb": 4}[unit.lower()]
        return round(float(number) * 1024 ** power)
    return _integer(number) * 1024


def parse_report(body: bytes, source_url: str) -> SiteStatistics:
    soup = BeautifulSoup(body, "html.parser")
    months: dict[str, StatisticsMonth] = {}
    for row in soup.select("tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) != 11:
            continue
        link = cells[0].find("a", href=True)
        match = re.fullmatch(r"usage_(\d{4})(0[1-9]|1[0-2])\.html", str(link.get("href", ""))) if link else None
        if not match:
            continue
        try:
            values = [cell.get_text(" ", strip=True) for cell in cells]
            month = match[1] + "-" + match[2]
            months[month] = StatisticsMonth(month=month, clients=_integer(values[5]), transfer_bytes=_transfer(values[6]), visits=_integer(values[7]), pages=_integer(values[8]), files=_integer(values[9]), hits=_integer(values[10]))
        except ValueError:
            raise HTTPException(422, "The statistics report contains invalid monthly counters") from None
    if not months:
        raise HTTPException(422, "No supported Webalizer monthly report was found")
    modified = soup.find("meta", attrs={"name": "DC.date.modified"})
    return SiteStatistics(source_url=source_url, generated_at=str(modified.get("content", "")) if modified else "", fetched_at=datetime.now(timezone.utc).isoformat(), months=sorted(months.values(), key=lambda item: item.month))


def read_statistics(site: SiteConfig) -> SiteStatistics:
    url = site.statistics_url.strip() or urljoin(site.origin, "/webalizer/")
    try:
        response = fetch(url, FetchBudget.start(seconds=20), maximum=1024 * 1024)
    except PublicFetchError:
        raise HTTPException(502, "The public statistics report could not be read") from None
    return parse_report(response.body, response.url)
