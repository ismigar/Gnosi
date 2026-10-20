"""Bounded API adapter. No direct vault filesystem access or arbitrary HTTP tools."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field, replace
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import httpx


class ConnectorError(ValueError):
    """An error safe to return to an MCP client (never includes credentials)."""


class GnosiHTTPError(ConnectorError):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f"Gnosi returned HTTP {status}; check access and configuration.")


def load_profile(path: str) -> None:
    """Load an explicitly selected local profile; never accepts plaintext tokens."""
    try:
        profile = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ConnectorError("Cannot read the selected connector profile.") from None
    allowed = {"GNOSI_BASE_URL", "GNOSI_VAULT_SLUG", "GNOSI_TOKEN_FILE", "GNOSI_WEB_URL",
               "GNOSI_WORKSPACE_ID", "GNOSI_ALLOW_PRIVATE_HTTP", "GNOSI_MCP_TOKEN_FILE",
               "GNOSI_MCP_ALLOWED_HOSTS"}
    if not isinstance(profile, dict) or any(k not in allowed or not isinstance(v, str)
                                            for k, v in profile.items()):
        raise ConnectorError("Invalid profile fields; use configuration values and token-file paths only.")
    # Explicit --config values win over the parent environment.
    if "GNOSI_TOKEN_FILE" in profile:
        os.environ.pop("GNOSI_TOKEN", None)
    if "GNOSI_MCP_TOKEN_FILE" in profile:
        os.environ.pop("GNOSI_MCP_TOKEN", None)
    os.environ.update(profile)


def secret(name: str) -> str:
    value, filename = os.getenv(name, ""), os.getenv(name + "_FILE", "")
    if value and filename:
        raise ConnectorError(f"Set only {name} or {name}_FILE.")
    if filename:
        try:
            value = Path(filename).read_text(encoding="utf-8").strip()
        except OSError:
            raise ConnectorError(f"Cannot read {name}_FILE.") from None
    if not value or any(c.isspace() for c in value):
        raise ConnectorError(f"Configure {name} or {name}_FILE with a nonempty token.")
    return value


def segment(value: str) -> str:
    if not re.fullmatch(r"[\w-]{1,160}", value, flags=re.ASCII):
        raise ConnectorError("Invalid identifier; use an ID returned by Gnosi.")
    return quote(value, safe="")


def page_segment(value: str) -> str:
    # Gnosi also uses legacy titles as IDs, including spaces and Unicode.
    decoded = unquote(value)
    if (not value or len(value) > 512 or decoded in {".", ".."}
            or any(c in decoded for c in "/\\")
            or any(ord(c) < 32 or ord(c) == 127 for c in decoded)):
        raise ConnectorError("Invalid page identifier; use an ID returned by Gnosi.")
    return quote(value, safe="")


def origin(value: str, *, allow_private_http: bool = False) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"}):
        raise ConnectorError("Configure a plain HTTP(S) origin without credentials or a path.")
    if (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            and not allow_private_http):
        raise ConnectorError("Use HTTPS, or explicitly enable GNOSI_ALLOW_PRIVATE_HTTP on a trusted network.")
    return value.rstrip("/")


@dataclass(frozen=True)
class Config:
    base_url: str
    vault: str
    token: str = field(repr=False)
    web_url: str = ""
    workspace: str = ""

    @classmethod
    def from_env(cls) -> Config:
        base = origin(os.getenv("GNOSI_BASE_URL", "http://127.0.0.1:5002"),
                      allow_private_http=os.getenv("GNOSI_ALLOW_PRIVATE_HTTP") == "1")
        vault = os.getenv("GNOSI_VAULT_SLUG", "")
        if vault:
            segment(vault)
        token = secret("GNOSI_TOKEN")
        if not token.startswith("gnosi_pat_"):
            raise ConnectorError("GNOSI_TOKEN must be a Gnosi personal access token.")
        web = os.getenv("GNOSI_WEB_URL", "")
        if web:
            web = origin(web, allow_private_http=True)
        workspace = os.getenv("GNOSI_WORKSPACE_ID", "")
        if workspace:
            segment(workspace)
        return cls(base, vault, token, web, workspace)


class GnosiClient:
    def __init__(self, config: Config, transport: httpx.AsyncBaseTransport | None = None):
        self.config = config
        self.transport = transport

    @property
    def prefix(self) -> str:
        return f"/api/v1/vaults/{segment(self.config.vault)}/knowledge"

    def select(self, vault: str | None) -> GnosiClient:
        slug = self.config.vault if vault is None else vault
        if not slug:
            raise ConnectorError("Choose a vault slug from list_vaults; no default vault is configured.")
        segment(slug)
        # Request-local client: concurrent calls never change each other's vault.
        return GnosiClient(replace(self.config, vault=slug), self.transport)

    async def _get(self, path: str, params: dict | None = None) -> object:
        return await self._request("GET", path, params=params)

    async def _request(self, method: str, path: str, params: dict | None = None,
                       payload: dict | None = None) -> object:
        headers = {"Authorization": f"Bearer {self.config.token}"}
        if self.config.workspace:
            headers["X-Workspace-ID"] = self.config.workspace
        try:
            async with httpx.AsyncClient(
                base_url=self.config.base_url, headers=headers, timeout=20,
                follow_redirects=False, trust_env=False, transport=self.transport,
            ) as client:
                async with client.stream(method, path, params=params, json=payload) as response:
                    if response.status_code == 409:
                        raise ConnectorError("Page changed: fetch it again, prepare a new proposal and ask for confirmation. Never force or retry this write.")
                    if response.status_code not in {200, 201}:
                        raise GnosiHTTPError(response.status_code)
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 4_000_000:
                            raise ConnectorError("Gnosi response exceeds the connector's 4 MB limit.")
                    return json.loads(body)
        except (httpx.HTTPError, UnicodeError, json.JSONDecodeError):
            raise ConnectorError("Could not read Gnosi's API; check its address, availability and response format.") from None

    async def authorize(self, write: bool = False) -> None:
        # Recheck every call, even if the local backend allows anonymous access.
        result = await self._get("/api/public/ping")
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise ConnectorError("Gnosi did not confirm authentication.")
        if "read" not in {s.strip() for s in str(result.get("scopes", "")).split(",")}:
            raise ConnectorError("The Gnosi token requires the read scope.")
        if write and "write" not in {s.strip() for s in str(result.get("scopes", "")).split(",")}:
            raise ConnectorError("Editing requires a Gnosi token with read and write scopes.")

    async def vaults(self, limit: int = 25, offset: int = 0) -> dict:
        if not 1 <= limit <= 100 or offset < 0:
            raise ConnectorError("limit must be 1–100 and offset must be nonnegative.")
        await self.authorize()
        catalog = await self._get("/api/vaults")
        rows = catalog.get("vaults") if isinstance(catalog, dict) else None
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ConnectorError("Unexpected vault list from Gnosi.")
        accessible = []
        for row in rows[offset:offset + limit]:
            slug = row.get("slug")
            if not isinstance(slug, str):
                raise ConnectorError("Gnosi returned a vault without a valid slug.")
            selected = self.select(slug)
            # The catalog can include other organization vaults. Check the
            # canonical, workspace-authorized route before disclosing a name.
            try:
                await selected._get(selected.prefix + "/pages", {"limit": 1})
            except GnosiHTTPError as exc:
                if exc.status in {403, 404}:
                    continue
                raise
            accessible.append({"id": str(row.get("id", "")), "name": str(row.get("name", "")),
                               "slug": slug, "default": slug == self.config.vault})
        return {"vaults": accessible, "default_vault": self.config.vault or None,
                "next_offset": offset + limit if len(rows) > offset + limit else None}

    def page_url(self, page_id: str) -> str:
        if self.config.web_url:
            return f"{self.config.web_url}/@{segment(self.config.vault)}/knowledge/page/{page_segment(page_id)}"
        return f"{self.config.base_url}{self.prefix}/pages/{page_segment(page_id)}"

    def summary(self, page: dict) -> dict:
        identifier = str(page.get("id", ""))
        return {"id": identifier, "title": str(page.get("title", "")),
                "url": self.page_url(identifier), "folder": str(page.get("folder") or ""),
                "table_id": page.get("resolved_table_id")}

    async def pages(self, limit: int = 50, offset: int = 0, vault: str | None = None) -> dict:
        if not 1 <= limit <= 100 or offset < 0:
            raise ConnectorError("limit must be 1–100 and offset must be nonnegative.")
        selected = self.select(vault)
        await selected.authorize()
        rows = await selected._get(selected.prefix + "/pages", {"limit": limit + 1, "offset": offset})
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ConnectorError("Unexpected page list from Gnosi.")
        return {"vault": selected.config.vault, "pages": [selected.summary(row) for row in rows[:limit]],
                "next_offset": offset + limit if len(rows) > limit else None}

    async def search(self, query: str, vault: str | None = None) -> dict:
        terms = query.casefold().split()
        if not terms or len(query) > 500:
            raise ConnectorError("Supply a search query of 1–500 characters.")
        selected = self.select(vault)
        await selected.authorize()
        results = []
        # Bounded metadata search; never claim full-text or exhaustive results.
        for offset in range(0, 5000, 250):
            rows = await selected._get(selected.prefix + "/pages", {"limit": 250, "offset": offset})
            if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                raise ConnectorError("Unexpected page list from Gnosi.")
            for row in rows:
                haystack = f"{row.get('title', '')} {row.get('folder', '')}".casefold()
                if all(term in haystack for term in terms):
                    results.append(selected.summary(row))
                    if len(results) == 50:
                        return {"vault": selected.config.vault, "results": results, "partial": True, "search_fields": ["title", "folder"]}
            if len(rows) < 250:
                return {"vault": selected.config.vault, "results": results, "partial": False, "search_fields": ["title", "folder"]}
        return {"vault": selected.config.vault, "results": results, "partial": True, "search_fields": ["title", "folder"]}

    async def fetch(self, identifier: str, vault: str | None = None) -> dict:
        encoded_id = page_segment(identifier)
        selected = self.select(vault)
        await selected.authorize()
        page = await selected._get(selected.prefix + "/pages/" + encoded_id)
        if not isinstance(page, dict) or not isinstance(page.get("content"), str):
            raise ConnectorError("Unexpected page content from Gnosi.")
        content = page["content"]
        return {"vault": selected.config.vault, "id": identifier, "title": str(page.get("title", "")),
                "text": content[:60000], "url": selected.page_url(identifier),
                "truncated": len(content) > 60000}

    async def write_page(self, vault: str, payload: dict, identifier: str | None = None) -> dict:
        if not vault:
            raise ConnectorError("Writes require an explicit vault.")
        selected = self.select(vault)
        await selected.authorize(write=True)
        path = selected.prefix + "/pages"
        if identifier is not None:
            path += "/" + page_segment(identifier)
        result = await selected._request("PATCH" if identifier is not None else "POST", path,
                                         payload=payload)
        if not isinstance(result, dict) or not result.get("id"):
            raise ConnectorError("Write result uncertain; inspect Gnosi before attempting another write.")
        return {"vault": vault, "id": result["id"], "title": result.get("title"),
                "etag": result.get("etag"), "status": result.get("status"),
                "url": selected.page_url(str(result["id"]))}

    async def tables(self, limit: int = 50, offset: int = 0, vault: str | None = None) -> dict:
        if not 1 <= limit <= 100 or offset < 0:
            raise ConnectorError("limit must be 1–100 and offset must be nonnegative.")
        selected = self.select(vault)
        await selected.authorize()
        rows = await selected._get(selected.prefix + "/tables")
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ConnectorError("Unexpected table list from Gnosi.")
        return {"vault": selected.config.vault, "tables": [{"id": row.get("id"), "name": row.get("name"),
                            "database_id": row.get("database_id")}
                           for row in rows[offset:offset + limit]],
                "next_offset": offset + limit if len(rows) > offset + limit else None}
