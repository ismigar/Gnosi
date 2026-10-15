"""Confined CalDAV discovery and transport, including iCloud principal discovery."""

from __future__ import annotations

import posixpath
import re
from typing import Any
from urllib.parse import unquote, urljoin, urlsplit
from xml.etree.ElementTree import Element

import requests
from defusedxml import ElementTree

from backend.domains.calendar.provider_errors import CalendarProviderError

DAV = "{DAV:}"
CAL = "{urn:ietf:params:xml:ns:caldav}"
_DISCOVERY = """<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><d:displayname/><d:resourcetype/><d:current-user-principal/>
<c:calendar-home-set/><c:calendar-timezone/><d:current-user-privilege-set/></d:prop></d:propfind>"""


def base_url(account: dict[str, Any]) -> str:
    value = account.get("caldav_url") or account.get("server_url")
    if not value and str(account.get("email", "")).endswith("@icloud.com"):
        value = "https://caldav.icloud.com"
    if not isinstance(value, str) or not value:
        raise CalendarProviderError(400, "CalDAV server is not configured")
    return checked_url(value, value).rstrip("/") + "/"


def checked_url(base: str, href: str, *, collection: str | None = None) -> str:
    """Only trust configured origins (or authenticated Apple CalDAV shard redirects)."""
    candidate = urljoin(base, href)
    try:
        configured, parsed = urlsplit(base), urlsplit(candidate)
        origin = (configured.scheme, configured.hostname, configured.port)
        target = (parsed.scheme, parsed.hostname, parsed.port)
        apple = (
            configured.scheme == parsed.scheme == "https"
            and configured.port in {None, 443}
            and parsed.port in {None, 443}
            and re.fullmatch(r"(?:p\d+-)?caldav\.icloud\.com", configured.hostname or "")
            and re.fullmatch(r"(?:p\d+-)?caldav\.icloud\.com", parsed.hostname or "")
        )
        if parsed.scheme not in {"https", "http"} or not parsed.hostname:
            raise ValueError("Invalid origin")
        if (
            parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or "\\" in candidate
        ):
            raise ValueError("Invalid URL")
        if any(ord(char) < 33 for char in candidate) or (origin != target and not apple):
            raise ValueError("Untrusted origin")
        path = unquote(parsed.path)
        if unquote(path) != path or any(part in {".", ".."} for part in path.split("/")):
            raise ValueError("Ambiguous path")
        if collection:
            parent = urlsplit(collection)
            prefix = posixpath.normpath(unquote(parent.path)).rstrip("/") + "/"
            if (parent.scheme, parent.netloc) != (parsed.scheme, parsed.netloc):
                raise ValueError("Untrusted collection")
            if not path.startswith(prefix) or path == prefix:
                raise ValueError("Outside calendar collection")
    except ValueError as error:
        raise CalendarProviderError(400, "Invalid CalDAV resource URL") from error
    return candidate


def parse_xml(text: str) -> Element:
    try:
        return ElementTree.fromstring(text)
    except Exception as error:
        raise CalendarProviderError(502, "Invalid CalDAV server response") from error


def success_props(response: Element) -> list[Element]:
    return [
        prop
        for entry in response.findall(DAV + "propstat")
        if " 200 " in entry.findtext(DAV + "status", "")
        and (prop := entry.find(DAV + "prop")) is not None
    ]


class CalDAVClient:
    def __init__(self, account: dict[str, Any]) -> None:
        self.base = base_url(account)
        self.session = requests.Session()
        self.session.auth = (
            account.get("username") or account.get("email", ""),
            account.get("password", ""),
        )

    def request(
        self,
        method: str,
        url: str,
        *,
        data: str | bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> requests.Response:
        target = checked_url(self.base, url)
        write = method in {"PUT", "DELETE"}
        for _ in range(4):
            try:
                result = self.session.request(
                    method, target, data=data, headers=headers, timeout=20, allow_redirects=False
                )
            except requests.RequestException as error:
                raise CalendarProviderError(
                    502, "CalDAV server could not be reached", outcome_unknown=write
                ) from error
            if result.status_code in {301, 302, 307, 308}:
                if write:
                    raise CalendarProviderError(
                        502, "CalDAV write redirect was refused", outcome_unknown=True
                    )
                target = checked_url(self.base, urljoin(target, result.headers.get("Location", "")))
                continue
            if result.status_code in {409, 412}:
                raise CalendarProviderError(409, "Calendar event changed; reload before saving")
            if result.status_code == 404:
                raise CalendarProviderError(404, "Calendar event was not found")
            if result.status_code in {401, 403}:
                raise CalendarProviderError(
                    403, "Calendar access was refused; check the connected account"
                )
            if not 200 <= result.status_code < 300:
                raise CalendarProviderError(
                    502,
                    "CalDAV server rejected the request",
                    outcome_unknown=write and result.status_code >= 500,
                )
            return result
        raise CalendarProviderError(502, "CalDAV discovery exceeded the redirect limit")

    def calendars(self, email: str) -> list[dict[str, Any]]:
        queue = [self.base]
        visited: set[str] = set()
        calendars: dict[str, dict[str, Any]] = {}
        while queue and len(visited) < 8:
            url = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)
            result = self.request(
                "PROPFIND",
                url,
                data=_DISCOVERY,
                headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
            )
            result_url = result.url or url
            for response in parse_xml(result.text).findall(DAV + "response"):
                href = response.findtext(DAV + "href", "")
                for prop in success_props(response):
                    if prop.find(DAV + "resourcetype/" + CAL + "calendar") is not None:
                        calendar_url = (
                            checked_url(self.base, urljoin(result_url, href)).rstrip("/") + "/"
                        )
                        privileges = prop.find(DAV + "current-user-privilege-set")
                        writable = privileges is None or any(
                            privileges.find(".//" + DAV + name) is not None
                            for name in ("write", "write-content", "all")
                        )
                        calendars[calendar_url] = {
                            "id": href,
                            "url": calendar_url,
                            "name": prop.findtext(DAV + "displayname")
                            or href.rstrip("/").split("/")[-1],
                            "provider": "caldav",
                            "account": email,
                            "access_role": "writer" if writable else "reader",
                            "color": None,
                            "timezone_ical": prop.findtext(CAL + "calendar-timezone"),
                        }
                    for tag in (DAV + "current-user-principal", CAL + "calendar-home-set"):
                        for linked in prop.findall(tag + "/" + DAV + "href"):
                            if linked.text:
                                queue.append(
                                    checked_url(self.base, urljoin(result_url, linked.text))
                                )
        return list(calendars.values())

    def calendar(self, email: str, calendar_id: str, *, write: bool = False) -> dict[str, Any]:
        calendars = self.calendars(email)
        selected = next(
            (
                calendar
                for calendar in calendars
                if calendar_id in {calendar["id"], calendar["url"]}
            ),
            None,
        )
        if selected is None:
            raise CalendarProviderError(404, "Selected CalDAV calendar is unavailable")
        if write and selected.get("access_role") == "reader":
            raise CalendarProviderError(403, "Selected calendar is read-only")
        return selected
