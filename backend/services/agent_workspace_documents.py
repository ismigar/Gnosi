"""Task-bound editable page sessions using native page concurrency and indexing."""
from __future__ import annotations

from typing import Any, cast

import difflib
import hashlib
import json

from fastapi import BackgroundTasks, HTTPException

from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore
from backend.services.workspace_service import WorkspaceContext

MAX_DOCUMENT_CHARS = 2_000_000


async def capture(store: WorkbenchStore, scope: WorkbenchScope, page_id: str) -> dict[str, Any]:
    from backend.domains.vault.api.pages_queries import get_page
    from backend.domains.vault.pages.cache import get_page_write_lock
    async with await get_page_write_lock(page_id):
        page = await get_page(page_id)
    if not page.get('etag') or len(str(page.get('content', ''))) > MAX_DOCUMENT_CHARS:
        raise HTTPException(422, 'Page cannot be opened as an editable session')
    return store.create(scope, 'document', dict(page_id=page['id'], title=page['title'], content=page['content'], etag=page['etag'], status='captured'))


def preview(store: WorkbenchStore, scope: WorkbenchScope, identity: str, content: str) -> dict[str, Any]:
    session = store.get(scope, 'document', identity)
    if len(content) > MAX_DOCUMENT_CHARS:
        raise HTTPException(413, 'Document exceeds the editing limit')
    diff = ''.join(difflib.unified_diff(session['content'].splitlines(True), content.splitlines(True), fromfile='captured', tofile='proposed'))
    return dict(id=identity, page_id=session['page_id'], expected_etag=session['etag'], diff=diff[:200_000], truncated=len(diff) > 200_000)


async def apply(store: WorkbenchStore, scope: WorkbenchScope, identity: str, content: str, request_id: str, context: WorkspaceContext, background_tasks: BackgroundTasks) -> dict[str, Any]:
    from backend.api import vault_routes
    from backend.domains.vault.schemas.pages import PagePatchRequest
    session = store.get(scope, 'document', identity)
    if len(content) > MAX_DOCUMENT_CHARS:
        raise HTTPException(413, 'Document exceeds the editing limit')
    fingerprint = hashlib.sha256(json.dumps([identity, content]).encode()).hexdigest()
    won, receipt = store.claim(scope, 'document-apply', request_id, fingerprint)
    if not won:
        return receipt
    try:
        result = await vault_routes.patch_page(session['page_id'], PagePatchRequest(content=content, expected_etag=session['etag'], force=False), background_tasks, context)
    except HTTPException as exc:
        if exc.status_code == 409:
            receipt.update(status='conflict', page_id=session['page_id'])
            return store.update(scope, 'document-apply', request_id, receipt)
        raise
    receipt.update(status='committed', page_id=session['page_id'], result=result)
    # Commit the actual mutation receipt before updating the editable snapshot.
    store.update(scope, 'document-apply', request_id, receipt)
    if result.get('etag'):
        session.update(content=result.get('content', content), etag=result['etag'], status='captured')
        store.update(scope, 'document', identity, session)
    return receipt
