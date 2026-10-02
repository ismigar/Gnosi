"""Short-lived, exact write proposals. No deletion or forced overwrites."""

import secrets
import time

from .client import ConnectorError, page_segment


class Editing:
    def __init__(self, client):
        self.client = client
        self.pending = {}

    async def prepare(self, vault: str, title: str, content: str,
                      identifier: str | None = None) -> dict:
        if not vault or not title.strip() or len(title) > 200 or len(content) > 60000:
            raise ConnectorError("Provide an explicit vault, title (1–200 characters), and content up to 60,000 characters.")
        selected = self.client.select(vault)
        await selected.authorize(write=True)
        payload = {"title": title, "content": content}
        before = None
        if identifier is not None:
            page = await selected._get(selected.prefix + "/pages/" + page_segment(identifier))
            if (not isinstance(page, dict) or not isinstance(page.get("content"), str)
                    or not isinstance(page.get("etag"), str) or not page["etag"]):
                raise ConnectorError("Page has no usable revision; editing is refused.")
            if len(page["content"]) > 60000:
                raise ConnectorError("Page exceeds the editing limit; editing is refused.")
            payload["expected_etag"] = page["etag"]
            before = {"title": page.get("title"), "content": page["content"]}
        now = time.monotonic()
        self.pending = {k: v for k, v in self.pending.items() if v[0] > now}
        if len(self.pending) >= 20:
            raise ConnectorError("Too many pending proposals; wait for expiry.")
        proposal = secrets.token_urlsafe(24)
        self.pending[proposal] = (now + 600, vault, identifier, payload)
        return {"proposal_id": proposal, "vault": vault, "id": identifier,
                "operation": "edit" if identifier is not None else "create",
                "before": before, "after": {"title": title, "content": content},
                "expires_in_seconds": 600,
                "next_step": "Show this exact proposal to the user and ask for explicit confirmation before commit_page_change."}

    async def commit(self, proposal_id: str) -> dict:
        # Consume before dispatch: an ambiguous network failure must never cause
        # an automatic duplicate create or replay of an old confirmation.
        proposal = self.pending.pop(proposal_id, None)
        if proposal is None or proposal[0] <= time.monotonic():
            raise ConnectorError("Proposal missing, expired or already attempted. Prepare and confirm a new proposal.")
        _, vault, identifier, payload = proposal
        return await self.client.write_page(vault, payload, identifier)
