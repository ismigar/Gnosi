"""Explicit, observable and cancellable TrOCR downloads, without loading weights."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import hashlib
import os
import re
import shutil
from threading import Event, RLock
from typing import Any
from urllib.parse import urlsplit


class DownloadCancelled(RuntimeError):
    pass


class InsufficientDiskSpace(RuntimeError):
    pass


@dataclass
class Download:
    state: str = 'downloading'
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    error: str = ''
    cancel: Event = field(default_factory=Event)


_lock = RLock()
_downloads: dict[tuple[str, str, str], Download] = {}


def cached_snapshot(model: str, cache: str) -> Path | None:
    """Inspect cache metadata; never import transformers or read weight contents."""
    root = Path(cache) / ('models--' + model.replace('/', '--'))
    try:
        revision = (root / 'refs/main').read_text().strip()
        if not re.fullmatch(r'[a-f0-9]{40}', revision):
            return None
        snapshot = root / 'snapshots' / revision
        if not all((snapshot / name).is_file() for name in ('config.json', 'preprocessor_config.json')):
            return None
        tokenizer = ((snapshot / 'tokenizer.json').is_file()
                     or ((snapshot / 'vocab.json').is_file() and (snapshot / 'merges.txt').is_file())
                     or any((snapshot / name).is_file() for name in ('tokenizer.model', 'spiece.model', 'sentencepiece.bpe.model')))
        if not tokenizer:
            return None
        for name in ('model.safetensors', 'pytorch_model.bin'):
            if (snapshot / name).is_file():
                return snapshot
        for name in ('model.safetensors.index.json', 'pytorch_model.bin.index.json'):
            index = snapshot / name
            if index.is_file():
                import json
                weights = json.loads(index.read_text()).get('weight_map', {})
                if weights and all(isinstance(part, str) and Path(part).name == part
                                   and (snapshot / part).is_file() for part in weights.values()):
                    return snapshot
    except (OSError, ValueError, TypeError, AttributeError):
        return None
    return None


def status(model: str, cache: str, owner: str) -> dict[str, Any]:
    cached = cached_snapshot(model, cache) is not None
    with _lock:
        job = _downloads.get((model, cache, owner))
        return {'downloaded': cached, 'state': job.state if job else 'downloaded' if cached else 'not_downloaded',
                'downloaded_bytes': job.downloaded_bytes if job else 0,
                'total_bytes': job.total_bytes if job else None, 'error': job.error if job else '',
                'cancelling': bool(job and job.cancel.is_set() and job.state == 'downloading')}


def cancel(model: str, cache: str, owner: str) -> bool:
    with _lock:
        job = _downloads.get((model, cache, owner))
        if not job or job.state != 'downloading':
            return False
        job.cancel.set()
        return True


def active(owner: str) -> tuple[str, str] | None:
    with _lock:
        for (model, cache, principal), job in reversed(list(_downloads.items())):
            if principal == owner and job.state in {'downloading', 'loading'}:
                return model, cache
    return None


def transition(model: str, cache: str, owner: str, state: str) -> None:
    with _lock:
        job = _downloads.setdefault((model, cache, owner), Download())
        if state == 'loading' and job.cancel.is_set():
            job.state = 'cancelled'
            raise DownloadCancelled('handwriting_download_cancelled')
        job.state = state


def failed(model: str, cache: str, owner: str, error: BaseException) -> None:
    with _lock:
        job = _downloads.setdefault((model, cache, owner), Download())
        job.state = 'cancelled' if isinstance(error, DownloadCancelled) else 'failed'
        job.error = '' if isinstance(error, DownloadCancelled) else type(error).__name__


def _download_file(model: str, revision: str, name: str, target: Path, job: Download) -> None:
    """Stream with public Hub metadata APIs, including Hub 0.36 on Intel Macs.

    A file becomes cache-visible only after its size and content hash agree with
    the pinned revision. Cancellation never exposes a partial weight file.
    """
    import httpx
    from huggingface_hub import get_hf_file_metadata, hf_hub_url
    from huggingface_hub.utils import build_hf_headers  # type: ignore[attr-defined]  # Public API omitted by Hub's typing export list.

    if job.cancel.is_set():
        raise DownloadCancelled('handwriting_download_cancelled')
    url = hf_hub_url(model, name, revision=revision)
    headers = build_hf_headers()
    metadata = get_hf_file_metadata(url, headers=headers, timeout=10)
    if job.cancel.is_set():
        raise DownloadCancelled('handwriting_download_cancelled')
    etag = str(metadata.etag or '').strip('"')
    if (metadata.commit_hash != revision or not isinstance(metadata.size, int)
            or metadata.size < 0 or not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', etag)):
        raise ValueError('handwriting_file_metadata_invalid')
    location = metadata.location
    if urlsplit(location).scheme != 'https':
        raise ValueError('handwriting_download_url_invalid')
    if urlsplit(location).netloc != urlsplit(url).netloc:
        headers = {key: value for key, value in headers.items() if key.lower() != 'authorization'}
    headers['Accept-Encoding'] = 'identity'
    digest = hashlib.sha256() if len(etag) == 64 else hashlib.sha1()
    if len(etag) == 40:
        digest.update(f'blob {metadata.size}\0'.encode())
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.incomplete')
    received = 0
    try:
        with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(10, connect=10)) as client:
            with client.stream('GET', location, headers=headers) as response:
                response.raise_for_status()
                with partial.open('wb') as output:
                    for chunk in response.iter_bytes(chunk_size=64 * 1024):
                        if job.cancel.is_set():
                            raise DownloadCancelled('handwriting_download_cancelled')
                        if shutil.disk_usage(target.parent).free < len(chunk) + 512 * 1024 ** 2:
                            raise InsufficientDiskSpace('handwriting_insufficient_disk')
                        received += len(chunk)
                        if received > metadata.size:
                            raise ValueError('handwriting_file_size_mismatch')
                        output.write(chunk)
                        digest.update(chunk)
                        with _lock:
                            job.downloaded_bytes += len(chunk)
        if job.cancel.is_set():
            raise DownloadCancelled('handwriting_download_cancelled')
        if received != metadata.size or digest.hexdigest() != etag:
            raise ValueError('handwriting_file_integrity_mismatch')
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)


def _complete_download(model: str, cache: str, revision: str, job: Download) -> None:
    # Record the resolved main revision so cache status never needs network.
    reference = Path(cache) / ('models--' + model.replace('/', '--')) / 'refs/main'
    reference.parent.mkdir(parents=True, exist_ok=True)
    reference.write_text(revision)
    if cached_snapshot(model, cache) is None:
        raise ValueError('handwriting_download_incomplete')
    with _lock:
        if job.cancel.is_set():
            raise DownloadCancelled('handwriting_download_cancelled')
        job.state = 'downloaded'
        if job.total_bytes is not None:
            job.downloaded_bytes = job.total_bytes


def prepare(model: str, cache: str, owner: str) -> str:
    cached = cached_snapshot(model, cache)
    if cached is not None:
        if shutil.disk_usage(cache).free < 512 * 1024 ** 2:
            error = InsufficientDiskSpace('handwriting_insufficient_disk')
            failed(model, cache, owner, error)
            raise error
        with _lock:
            _downloads[(model, cache, owner)] = Download(state='downloaded')
        return str(cached)
    from huggingface_hub import HfApi, try_to_load_from_cache

    job = Download()
    with _lock:
        _downloads[(model, cache, owner)] = job
    existing_bytes = 0

    try:
        Path(cache).mkdir(parents=True, exist_ok=True)
        info = HfApi().model_info(model, files_metadata=True)
        revision = info.sha
        if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}', revision):
            raise ValueError('handwriting_model_revision_unavailable')
        siblings = info.siblings or []
        names = {item.rfilename for item in siblings}
        weight = next((name for name in ('model.safetensors', 'model.safetensors.index.json',
                                        'pytorch_model.bin', 'pytorch_model.bin.index.json') if name in names), None)
        if weight is None:
            raise ValueError('handwriting_weights_not_found')
        files = [item.rfilename for item in siblings if '/' not in item.rfilename
                 and (item.rfilename.endswith(('.json', '.txt'))
                      or item.rfilename in {'tokenizer.model', 'spiece.model', 'sentencepiece.bpe.model'})]
        files.extend(name for name in names if '/' not in name and '\\' not in name and (name == weight or (
            weight.endswith('.index.json') and name.startswith('model-' if weight.startswith('model.') else 'pytorch_model-')
            and name.endswith('.safetensors' if weight.startswith('model.') else '.bin'))))
        sizes = {item.rfilename: item.size for item in siblings if item.rfilename in files}
        with _lock:
            job.total_bytes = sum(size for size in sizes.values() if isinstance(size, int)) if all(isinstance(size, int) for size in sizes.values()) else None
        for name in set(files):
            present = try_to_load_from_cache(model, name, cache_dir=cache, revision=info.sha)
            if isinstance(present, str) and Path(present).is_file():
                existing_bytes += Path(present).stat().st_size
        required = max(0, (job.total_bytes or 0) - existing_bytes) + 512 * 1024 ** 2
        if shutil.disk_usage(cache).free < required:
            raise InsufficientDiskSpace('handwriting_insufficient_disk')
        if job.cancel.is_set():
            raise DownloadCancelled('handwriting_download_cancelled')
        snapshot = Path(cache) / ('models--' + model.replace('/', '--')) / 'snapshots' / revision
        with _lock:
            job.downloaded_bytes = existing_bytes
        for name in sorted(set(files)):
            if job.cancel.is_set():
                raise DownloadCancelled('handwriting_download_cancelled')
            target = snapshot / name
            present = try_to_load_from_cache(model, name, cache_dir=cache, revision=info.sha)
            if isinstance(present, str) and Path(present).is_file():
                continue
            _download_file(model, revision, name, target, job)
        _complete_download(model, cache, revision, job)
        return str(snapshot)
    except BaseException as error:
        with _lock:
            cancelled = isinstance(error, DownloadCancelled) or job.cancel.is_set()
            job.state = 'cancelled' if cancelled else 'failed'
            job.error = '' if cancelled else type(error).__name__
        if cancelled and not isinstance(error, DownloadCancelled):
            raise DownloadCancelled('handwriting_download_cancelled') from error
        raise
