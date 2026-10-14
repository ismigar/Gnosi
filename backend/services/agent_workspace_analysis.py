"""Optional Docker-isolated Python workspaces; never fall back to host execution."""
from __future__ import annotations

from typing import Any

import asyncio
import base64
import json
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import time

from fastapi import HTTPException

from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore

IMAGE = os.environ.get('GNOSI_ANALYSIS_IMAGE', 'python:3.11-slim')

# Only the immutable program is mounted from the host. All writable container
# paths are size-limited tmpfs volumes; artifacts leave through bounded stdout.
_RUNNER = r"""
import base64, contextlib, json, pathlib, runpy, traceback
failed = False
with open('/tmp/output', 'w+') as output:
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        try:
            runpy.run_path('/code/main.py', run_name='__main__')
        except BaseException:
            failed = True
            traceback.print_exc()
    output.seek(0)
    text = output.read(1000000)
artifacts = []
total = 0
for entry in pathlib.Path('/work').iterdir():
    if len(artifacts) >= 50:
        break
    if entry.name.startswith('.') or entry.is_symlink() or not entry.is_file():
        continue
    size = entry.stat().st_size
    if size > 15000000 or total + size > 15000000:
        continue
    data = entry.read_bytes()
    total += len(data)
    artifacts.append({'name': entry.name, 'data': base64.b64encode(data).decode()})
print(json.dumps({'output':text, 'artifacts':artifacts, 'exit_code':1 if failed else 0}))
"""


async def status() -> dict[str, Any]:
    docker = shutil.which('docker')
    if not docker:
        return dict(available=False, reason='docker_unavailable', image=IMAGE)
    try:
        process = await asyncio.create_subprocess_exec(docker, 'image', 'inspect', IMAGE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        available = await asyncio.wait_for(process.wait(), 5) == 0
    except OSError:
        available = False
    except TimeoutError:
        process.kill()
        await process.wait()
        available = False
    return dict(available=available, reason='ready' if available else 'local_image_or_daemon_unavailable', image=IMAGE)


def _artifact_directory(store: WorkbenchStore, scope: WorkbenchScope, request_id: str) -> Path:
    return store.path.parent / 'agent-workspace-artifacts' / scope.key / hashlib.sha256(request_id.encode()).hexdigest()


def _stage_inputs(store: WorkbenchStore, scope: WorkbenchScope, inputs: list[dict[str, str]], destination: Path) -> None:
    total_input = 0
    for item in inputs:
        previous = store.get(scope, 'analysis', item.get('identity', ''))
        name = item.get('name', '')
        entry = next((artifact for artifact in previous.get('artifacts', []) if artifact['name'] == name), None)
        if entry is None or Path(name).name != name or name.startswith('.'):
            raise HTTPException(404, 'Analysis input artifact not found')
        source = _artifact_directory(store, scope, item['identity']) / name
        if source.is_symlink() or source.stat().st_size > 15_000_000:
            raise HTTPException(422, 'Invalid analysis input')
        data = source.read_bytes()
        total_input += len(data)
        if total_input > 15_000_000 or len(data) != entry['size'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise HTTPException(422, 'Analysis input integrity or size verification failed')
        with (destination / name).open('xb') as input_file:
            input_file.write(data)


def _docker_arguments(name: str, root: Path) -> list[str]:
    return [shutil.which('docker') or 'docker', 'run', '--pull=never', '--rm', '--name', name,
            '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--pids-limit=64', '--memory=256m', '--cpus=1', '--ulimit', 'fsize=15360:15360',
            '--user', f'{os.getuid()}:{os.getgid()}', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
            '--mount', f'type=bind,src={root / "main.py"},dst=/code/main.py,readonly',
            '--mount', f'type=bind,src={root / "inputs"},dst=/inputs,readonly',
            '--tmpfs', '/work:rw,noexec,nosuid,size=32m,mode=1777', '--workdir=/work',
            IMAGE, 'python', '-I', '-B', '-c', _RUNNER]


async def _collect_output(process: asyncio.subprocess.Process, output: bytearray) -> int:
    assert process.stdout is not None
    while chunk := await process.stdout.read(65536):
        if len(output) + len(chunk) > 22_000_000:
            raise OverflowError('Analysis output limit reached')
        output.extend(chunk)
    return await process.wait()


def _persist_artifacts(entries: Any, destination: Path) -> list[dict[str, Any]]:
    artifacts = []
    total_bytes = 0
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    for entry in entries[:50]:
        filename = entry['name']
        if not isinstance(filename, str) or not filename or Path(filename).name != filename or filename.startswith('.'):
            continue
        data = base64.b64decode(entry['data'], validate=True)
        if len(data) > 15_000_000 or total_bytes + len(data) > 15_000_000:
            continue
        total_bytes += len(data)
        with (destination / filename).open('xb') as artifact:
            artifact.write(data)
        (destination / filename).chmod(0o600)
        artifacts.append(dict(name=filename, size=len(data), sha256=hashlib.sha256(data).hexdigest()))
    return artifacts


def _decode_output(receipt: dict[str, Any], output: bytearray, destination: Path) -> None:
    receipt['output'] = output[:1_000_000].decode('utf-8', errors='replace')
    receipt['artifacts'] = []
    if receipt['status'] != 'completed' or receipt.get('exit_code') != 0:
        return
    try:
        parsed = json.loads(output)
        receipt['output'] = str(parsed['output'])[:1_000_000]
        receipt['exit_code'] = int(parsed.get('exit_code', 0))
        receipt['artifacts'] = _persist_artifacts(parsed.get('artifacts', []), destination)
    except (ValueError, TypeError, KeyError):
        receipt.update(status='failed', reason='invalid_runtime_result')


def _cancelled_receipt(identity: str) -> dict[str, Any]:
    return dict(id=identity, status='stopped', reason='cancelled', artifacts=[])


def _is_cancelled(store: WorkbenchStore, scope: WorkbenchScope, identity: str) -> bool:
    try:
        store.get(scope, 'analysis-cancel', identity)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        return False
    return True


async def execute(store: WorkbenchStore, scope: WorkbenchScope, code: str, request_id: str, inputs: list[dict[str, str]] | None = None) -> dict[str, Any]:
    if len(code) > 100_000:
        raise HTTPException(413, 'Analysis code exceeds the limit')
    if _is_cancelled(store, scope, request_id):
        return _cancelled_receipt(request_id)
    runtime = await status()
    if _is_cancelled(store, scope, request_id):
        return _cancelled_receipt(request_id)
    if not runtime['available']:
        raise HTTPException(503, detail=runtime)
    inputs = inputs or []
    if len(inputs) > 10:
        raise HTTPException(422, 'At most ten analysis inputs are supported')
    fingerprint = hashlib.sha256(json.dumps([code, inputs], sort_keys=True).encode()).hexdigest()
    won, receipt = store.claim(scope, 'analysis', request_id, fingerprint)
    if not won:
        return receipt
    name = 'gnosi-analysis-' + hashlib.sha256((scope.key + request_id).encode()).hexdigest()[:32]
    root = Path(tempfile.mkdtemp(prefix='gnosi-analysis-'))
    process: asyncio.subprocess.Process | None = None
    try:
        root.chmod(0o700)
        (root / 'main.py').write_text(code, encoding='utf-8')
        input_root = root / 'inputs'
        input_root.mkdir(mode=0o700)
        _stage_inputs(store, scope, inputs, input_root)
        if _is_cancelled(store, scope, request_id):
            receipt.update(_cancelled_receipt(request_id))
            return store.update(scope, 'analysis', request_id, receipt)
        receipt.update(container=name, status='running', created_at=time.time())
        store.update(scope, 'analysis', request_id, receipt)
        process = await asyncio.create_subprocess_exec(*_docker_arguments(name, root), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        if _is_cancelled(store, scope, request_id):
            receipt.update(_cancelled_receipt(request_id))
            return store.update(scope, 'analysis', request_id, receipt)
        output = bytearray()
        try:
            exit_code = await asyncio.wait_for(_collect_output(process, output), 30)
            receipt.update(status='completed', exit_code=exit_code)
        except (TimeoutError, OverflowError):
            receipt.update(status='stopped', reason='time_or_output_limit')
        destination = _artifact_directory(store, scope, request_id)
        _decode_output(receipt, output, destination)
        current = store.get(scope, 'analysis', request_id)
        if _is_cancelled(store, scope, request_id) or current.get('reason') == 'cancelled':
            shutil.rmtree(destination, ignore_errors=True)
            current.update(_cancelled_receipt(request_id))
            return store.update(scope, 'analysis', request_id, current)
        return store.update(scope, 'analysis', request_id, receipt)
    finally:
        await remove_container(name)
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        shutil.rmtree(root, ignore_errors=True)


async def remove_container(name: str) -> None:
    docker = shutil.which('docker')
    if docker:
        process = await asyncio.create_subprocess_exec(docker, 'rm', '-f', name, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        try:
            await asyncio.wait_for(process.wait(), 5)
        except TimeoutError:
            process.kill()
            await process.wait()


async def cancel(store: WorkbenchStore, scope: WorkbenchScope, identity: str) -> dict[str, Any]:
    store.claim(scope, 'analysis-cancel', identity, 'cancelled')
    try:
        receipt = store.get(scope, 'analysis', identity)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        return _cancelled_receipt(identity)
    if receipt.get('container'):
        await remove_container(receipt['container'])
    destination = _artifact_directory(store, scope, identity)
    shutil.rmtree(destination, ignore_errors=True)
    receipt.update(status='stopped', reason='cancelled', artifacts=[])
    return store.update(scope, 'analysis', identity, receipt)


def receipt_status(store: WorkbenchStore, scope: WorkbenchScope, identity: str) -> dict[str, Any]:
    receipt = store.get(scope, 'analysis', identity)
    if receipt.get('status') == 'running' and time.time() - receipt.get('created_at', 0) > 45:
        receipt.update(status='unknown', reason='runtime_interrupted')
        return store.update(scope, 'analysis', identity, receipt)
    return receipt
