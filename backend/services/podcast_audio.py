"""Prepare a daily episode's speech artifact in its private cache."""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.services.agent_execution_models import AgentExecutionSnapshot
from backend.utils.metadata_io import MetadataUnavailable


def speech_cache(snapshot: AgentExecutionSnapshot, directory: Path, receipt: dict[str, Any]) -> tuple[Path, Path]:
    """Resolve only the current private job's local cache or its historical vault cache."""
    import hashlib
    from backend.config.data_dir import resolve_data_dir

    name = str(receipt["cache_file"])
    if Path(name).name != name or not name.endswith(".mp3"):
        raise ValueError("podcast_publication_invalid")
    storage = receipt.get("cache_storage", "vault")
    if storage == "vault":
        return directory / ".generated" / name, directory.parent.parent
    if storage != "device":
        raise ValueError("podcast_publication_invalid")
    root = resolve_data_dir(create=True)
    # Parent IDs are scope-bound by the private run store. Hash their arbitrary
    # historical representation before using them as a directory component.
    private_job = hashlib.sha256(snapshot.parent_run_id.encode()).hexdigest()
    folder = root / "cache" / "podcasts" / private_job
    if any((root / component).is_symlink() for component in (folder.relative_to(root), *folder.relative_to(root).parents)):
        raise MetadataUnavailable(path=folder / name, reason="permission")
    return folder / name, root


def prepare_speech(
    snapshot: AgentExecutionSnapshot, directory: Path, audio_filename: str, full_script: str,
    language_code: str, generate: Callable[[str, Path, str], None],
) -> dict[str, str]:
    """Produce or reuse complete speech before the final publication step."""
    from backend.services.agent_execution_store import work_checkpoint
    from backend.services.workspace_speech import fingerprint, effective_settings_sync, speech_session
    with speech_session(effective_settings_sync(language_code)):
        digest = fingerprint(full_script, language_code)
        receipt = {"filename": audio_filename, "cache_file": f"{digest}.mp3"}
        legacy_cache, _ = speech_cache(snapshot, directory, receipt)
        # Consume an already produced legacy file without creating new vault caches.
        if not legacy_cache.is_file():
            receipt["cache_storage"] = "device"
        cached, _ = speech_cache(snapshot, directory, receipt)
        if snapshot.parent_run_id:
            work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-speech", receipt)
        if cached.is_symlink() or Path(f"{cached}.part").is_symlink():
            raise MetadataUnavailable(path=cached, reason="permission")
        if not cached.is_file():
            if receipt.get("cache_storage") != "device":
                raise MetadataUnavailable(path=cached, reason="pending")
            cached.parent.mkdir(parents=True, exist_ok=True)
            generate(full_script, cached, language_code)
        return receipt
