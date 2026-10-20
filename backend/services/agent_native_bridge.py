"""Durable native requests claimed once by the authorized desktop conversation."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any

from fastapi import HTTPException

from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore


def enqueue(store: WorkbenchStore, scope: WorkbenchScope, identity: str, operation: dict[str, Any]) -> dict[str, Any]:
    fingerprint = hashlib.sha256(json.dumps(operation, sort_keys=True).encode()).hexdigest()
    fresh, receipt = store.claim(scope, 'native-request', identity, fingerprint)
    if fresh:
        return store.update(scope, 'native-request', identity, {**receipt, 'status': 'pending',
            'operation': operation, 'created_at': time.time()})
    return public(receipt)


def public(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key not in {'lease', 'fingerprint'}}


def requests(store: WorkbenchStore, scope: WorkbenchScope) -> list[dict[str, Any]]:
    values = store.list(scope, 'native-request')
    for value in values:
        if value.get('status') in {'pending', 'running'} and time.time() - value.get('created_at', 0) > 300:
            value['status'] = 'expired' if value['status'] == 'pending' else 'unknown'
            store.update(scope, 'native-request', value['id'], value)
    return [public(value) for value in values]


def claim(store: WorkbenchStore, scope: WorkbenchScope, identity: str) -> dict[str, Any]:
    value = store.get(scope, 'native-request', identity)
    if value.get('status') != 'pending' or time.time() - value.get('created_at', 0) > 300:
        raise HTTPException(409, 'Native request is no longer pending')
    fresh, _receipt = store.claim(scope, 'native-claim', identity, value['fingerprint'])
    if not fresh:
        raise HTTPException(409, 'Native request already claimed; inspect its result')
    value.update(status='running', lease=uuid.uuid4().hex)
    return store.update(scope, 'native-request', identity, value)


def complete(store: WorkbenchStore, scope: WorkbenchScope, identity: str, lease: str,
             result: dict[str, Any]) -> dict[str, Any]:
    value = store.get(scope, 'native-request', identity)
    if value.get('lease') != lease or value.get('status') not in {'running', 'unknown'}:
        raise HTTPException(409, 'Native request claim is no longer current')
    if len(json.dumps(result)) > 100_000:
        raise HTTPException(413, 'Native result exceeds the limit')
    value.update(status='failed' if result.get('error') else 'completed', result=result)
    return public(store.update(scope, 'native-request', identity, value))
