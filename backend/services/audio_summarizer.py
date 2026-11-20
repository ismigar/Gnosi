"""Generate the daily Reader podcast script and publish its audio atomically."""

from backend.services.agent_behavior import task_input
from backend.services import podcast_audio, podcast_episode as episodes
from backend.utils.metadata_io import MetadataUnavailable, vault_file_snapshot

import os
import re
import threading
from collections.abc import Callable, Sequence
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import Any, TypedDict

from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation

from backend.config.logger_config import get_logger
from backend.models.reader import Article
from backend.services.podcast_sources import readable_podcast_articles as _readable_podcast_articles

log = get_logger(__name__)


# --- Private generation status ---
class GenerationStatus(TypedDict):
    """Observable state for one background podcast generation."""

    running: bool
    progress: str
    error: str | None
    result_filename: str | None
    skipped_articles: list[dict[str, str]]


_episode: ContextVar[episodes.Episode | None] = ContextVar("podcast_occurrence", default=None)
_generation_lock = threading.RLock()
_generation_states: dict[tuple[str, str, str], GenerationStatus] = {}


def _generation_state() -> GenerationStatus:
    from backend.services.agent_execution_scope import current_scope
    scope = current_scope()
    key = (scope.user_id, scope.workspace_id, str(Path(scope.vault_path).resolve()))
    with _generation_lock:
        return _generation_states.setdefault(key, {
            "running": False, "progress": "", "error": None, "result_filename": None, "skipped_articles": [],
        })


def get_generation_status() -> GenerationStatus:
    """Return only the current authenticated user's selected-vault state."""
    with _generation_lock:
        state = _generation_state().copy()
    if state["running"]:
        return state
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution_scope import current_scope
    scope = current_scope()
    episode = episodes.current(scope.vault_path)
    if episode and episode.scope == scope.model_dump() and episode.wait_reason and episode.status in {"waiting", "error"}:
        from backend.utils.errors import metadata_unavailable_detail
        try:
            language, _ = _resolve_podcast_language()
        except Exception:
            language = "en"
        _, message = metadata_unavailable_detail(language, episode.wait_reason)
        waiting = episode.status == "waiting"
        state.update({"running": waiting, "progress": message, "error": None if waiting else message, "result_filename": None})
        return state
    job = store.latest_job(scope, "podcast")
    if job is not None:
        state["running"] = job.status in {"queued", "running", "resuming"}
        state["error"] = job.error or None
        state["result_filename"] = job.result or None
        report = store.work_checkpoint(current_scope(), job.run_id, "podcast-skipped")
        state["skipped_articles"] = report["articles"] if report else []
    return state


# --- Batch configuration ---
MAX_SNIPPET_CHARS = 500  # Content chars per article
MAX_BATCH_CHARS = 20000  # ~5k input tokens per batch
MAX_BATCHES = 5  # Max batches (avoid >5 min wait)

PODCAST_LANGUAGES = {
    "ca": "Catalan",
    "en": "English",
    "es": "Spanish",
    "fr": "French",
}


def _build_batches(articles: Sequence[Article]) -> list[list[str]]:
    """Splits the articles into batches that respect Groq's token limit."""
    batches: list[list[str]] = []
    current_batch_texts: list[str] = []
    current_size = 0

    for art in articles:
        source_name = art.source.name if art.source else "Unknown"
        snippet = art.content[:MAX_SNIPPET_CHARS] if art.content else ""
        article_text = f"Source: {source_name}\nTitle: {art.title}\nContent: {snippet}\n\n"

        if current_size + len(article_text) > MAX_BATCH_CHARS:
            if current_batch_texts:
                batches.append(current_batch_texts)
            current_batch_texts = [article_text]
            current_size = len(article_text)
        else:
            current_batch_texts.append(article_text)
            current_size += len(article_text)

    if current_batch_texts:
        batches.append(current_batch_texts)

    return batches[:MAX_BATCHES]


class PodcastModelError(RuntimeError):
    """Raised when the configured podcast model cannot be executed."""


def _podcast_model_selection(settings: object) -> tuple[str, str]:
    """Return the normalized provider/model pair from application settings."""
    reader_settings = settings.get("reader") if isinstance(settings, dict) else {}
    reader_settings = reader_settings if isinstance(reader_settings, dict) else {}
    podcast_settings = reader_settings.get("podcast") or {}
    podcast_settings = podcast_settings if isinstance(podcast_settings, dict) else {}
    provider = str(podcast_settings.get("provider") or "").strip().lower()
    model = str(podcast_settings.get("model") or "").strip()
    if bool(provider) != bool(model):
        raise PodcastModelError(
            "The daily podcast AI model configuration is incomplete. "
            "Choose the model again in Settings → Reader."
        )
    return provider, model


def _podcast_language_selection(settings: object) -> tuple[str, str]:
    """Return the supported interface language used for script and speech."""
    from backend.config.app_config import normalize_interface_language

    language_code = normalize_interface_language(
        settings.get("language") if isinstance(settings, dict) else None
    )
    return language_code, PODCAST_LANGUAGES[language_code]


def _resolve_podcast_language() -> tuple[str, str]:
    """Resolve the current interface language for a new podcast generation."""
    from backend.config.app_config import load_params

    cfg = load_params(strict_env=False)
    return _podcast_language_selection(cfg.settings)


def _resolve_podcast_llm() -> tuple[AgentExecutionSnapshot, str, str]:
    """Freeze the principal and its assigned briefing skill for this episode."""
    from backend.services.agent_execution import prepare_snapshot
    from backend.services.agent_operation_catalog import skill_id

    snapshot = prepare_snapshot(skill_id("podcast"))
    return snapshot, str(snapshot.profile.get("provider") or ""), str(snapshot.profile.get("model") or "")


def _summarize_batch(
    llm: AgentExecutionSnapshot,
    batch_texts: list[str],
    batch_num: int,
    total_batches: int,
    provider: str,
    model: str,
    language_name: str,
) -> str:
    """Send one article batch to the configured LLM and return its script."""

    user_prompt = task_input("podcast.segment", articles=batch_texts,
                             segment=batch_num, total_segments=total_batches,
                             language=language_name)

    from backend.services.agent_execution import run_sync
    from backend.services.agent_operation_catalog import skill_id

    result = run_sync(AgentOperation(
        skill_id=skill_id("podcast"), operation="podcast.segment",
        input=user_prompt, language=language_name,
    ), snapshot=llm)
    return result.result


def _split_into_sentences(text: str) -> list[str]:
    """Split text into complete sentences for natural TTS pauses."""
    # Split at sentence-ending punctuation followed by space or newline
    # Handles: . ? ! … and combinations like .» or ."
    sentences = re.split(r'(?<=[.!?…»"])\s+', text)
    # Filter empty and merge very short fragments back
    result: list[str] = []
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        # If fragment is very short (<15 chars), merge with previous
        if result and len(s) < 15 and not s[-1] in ".!?…":
            result[-1] = result[-1] + " " + s
        else:
            result.append(s)
    return result


def _generate_tts_by_sentences(text: str, output_path: str | Path, language_code: str) -> None:
    """Use the same centrally configured engine as conversational playback."""
    from backend.services.workspace_speech import generate_document
    generate_document(text, output_path, language_code)


def _generate_tts_atomically(text: str, output_path: str | Path, language_code: str,
                             before_publish: Callable[[], None] | None = None) -> None:
    """Publish a complete MP3 without exposing an in-progress audio file."""
    partial_path = f"{output_path}.part"
    try:
        _generate_tts_by_sentences(text, partial_path, language_code)
        if os.path.getsize(partial_path) <= 0:
            raise RuntimeError("TTS produced an empty audio file.")
        if before_publish is not None:
            before_publish()
        os.replace(partial_path, output_path)
    finally:
        if os.path.exists(partial_path):
            os.remove(partial_path)


def _check_podcast_publication(snapshot: AgentExecutionSnapshot) -> None:
    from backend.services.agent_execution_scope import current_scope, revalidate_scope
    from backend.services import agent_execution_store as store
    from backend.services.agent_cancellation import AgentTurnCancelled
    scope = current_scope()
    if scope != snapshot.scope or scope.role == "viewer":
        raise PermissionError("podcast_publication_scope_mismatch")
    revalidate_scope(scope)
    if snapshot.parent_run_id and store.cancelled(scope, snapshot.parent_run_id):
        raise AgentTurnCancelled("agent_run_cancelled")


def _publish_podcast_audio(snapshot: AgentExecutionSnapshot, staged: Path, target: str | Path) -> None:
    from backend.services import agent_execution_store as store
    _check_podcast_publication(snapshot)
    if not snapshot.parent_run_id:
        raise RuntimeError("podcast_parent_job_required")
    with store.publication_guard(snapshot.scope, snapshot.parent_run_id):
        os.replace(staged, target)


def _recover_publication(snapshot: AgentExecutionSnapshot, receipt: dict[str, Any]) -> bool:
    """Recognize an atomic replace after a crash, or finish from fully generated audio."""
    import hashlib
    import shutil
    from tempfile import NamedTemporaryFile
    from backend.services.agent_execution_store import work_checkpoint

    filename, cache_file = str(receipt["filename"]), str(receipt["cache_file"])
    if any(Path(name).name != name or not name.endswith(".mp3") for name in (filename, cache_file)):
        raise ValueError("podcast_publication_invalid")
    directory = get_podcast_output_dir()
    target = directory / filename
    root = directory.parent.parent
    expected = receipt.get("sha256")
    if expected and target.is_file():
        with vault_file_snapshot(target, root=root) as view, view.path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() == expected:
                _check_podcast_publication(snapshot)
                return True
    cached, cache_root = podcast_audio.speech_cache(snapshot, directory, receipt)
    try:
        view = vault_file_snapshot(cached, root=cache_root)
    except FileNotFoundError:
        return False
    with view, NamedTemporaryFile(dir=directory, suffix=".tmp", delete=False) as staged:
        temp = Path(staged.name)
        try:
            with view.path.open("rb") as source:
                shutil.copyfileobj(source, staged)
            if not staged.tell():
                raise ValueError("podcast_audio_cache_empty")
            staged.flush()
            staged.seek(0)
            digest = hashlib.file_digest(staged, "sha256").hexdigest()
            if expected and digest != expected:
                raise ValueError("podcast_audio_cache_invalid")
            if not expected and snapshot.parent_run_id:
                work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-publication",
                                {**receipt, "sha256": digest})
            staged.close()
            _publish_podcast_audio(snapshot, temp, target)
            return True
        finally:
            temp.unlink(missing_ok=True)


def get_podcast_output_dir(vault_path: str | Path | None = None) -> Path:
    """Return the shared output directory used to generate and serve podcasts."""
    if vault_path is None:
        from backend.services.context_vars import get_active_vault_path

        vault_path = get_active_vault_path()
    if vault_path is None:
        raise RuntimeError("No active vault is available for podcast generation.")
    return Path(vault_path) / "data" / "podcasts"


_SCHEDULE_MESSAGES = {
    "ca": {
        "cancelled": "S’ha cancel·lat la generació del podcast.",
        "failed": "No s’ha pogut generar el podcast. Consulta l’execució a Activitat.",
        "empty": "No hi ha articles nous. No s’ha generat cap podcast.",
        "saved": "S’ha desat el podcast {filename}.",
    },
    "es": {
        "cancelled": "Se ha cancelado la generación del pódcast.",
        "failed": "No se ha podido generar el pódcast. Consulta la ejecución en Actividad.",
        "empty": "No hay artículos nuevos. No se ha generado ningún pódcast.",
        "saved": "Se ha guardado el pódcast {filename}.",
    },
    "en": {
        "cancelled": "Podcast generation was cancelled.",
        "failed": "Podcast generation failed. See the podcast run in Activity.",
        "empty": "No new articles. No podcast was generated.",
        "saved": "Saved podcast {filename}.",
    },
    "fr": {
        "cancelled": "La génération du podcast a été annulée.",
        "failed": "Impossible de générer le podcast. Consultez son exécution dans Activité.",
        "empty": "Aucun nouvel article. Aucun podcast n’a été généré.",
        "saved": "Le podcast {filename} a été enregistré.",
    },
}


def _schedule_messages() -> dict[str, str]:
    try:
        language, _ = _resolve_podcast_language()
    except Exception:
        from backend.config.app_config import DEFAULT_INTERFACE_LANGUAGE

        language = DEFAULT_INTERFACE_LANGUAGE
    return _SCHEDULE_MESSAGES[language]


class _ScheduledPodcastFailure(RuntimeError):
    """Carry a safe outcome identifier from generation to its scheduler."""


def generate_daily_podcast(
    snapshot: AgentExecutionSnapshot | None = None, *, raise_on_failure: bool = False,
) -> str | None:
    import uuid
    from backend.services.agent_execution import create_job_run, operation_session
    from backend.services import agent_execution_store as store
    if snapshot is None:
        snapshot, _provider, _model = _resolve_podcast_llm()
        snapshot = create_job_run(snapshot, uuid.uuid4().hex, "podcast")
    run_id = snapshot.parent_run_id
    try:
        with operation_session(snapshot):
            store.update(snapshot.scope, run_id, status="running")
            result = _generate_daily_podcast()
            error_message = _generation_state()["error"]
            cancelled = store.cancelled(snapshot.scope, run_id)
            store.update(snapshot.scope, run_id,
                status="cancelled" if cancelled else "failed" if error_message else "completed",
                result=result or "", error=error_message or "")
    except MetadataUnavailable as error:
        store.update(snapshot.scope, run_id, status="waiting" if error.retryable else "failed",
                     error=f"cloud_file_{error.reason}")
        raise
    except Exception as error:
        store.update(snapshot.scope, run_id, status="cancelled" if store.cancelled(snapshot.scope, run_id) else "failed", error=type(error).__name__)
        raise
    except BaseException:
        store.update(snapshot.scope, run_id, status="interrupted", error="worker_stopped")
        raise
    if raise_on_failure and cancelled:
        raise _ScheduledPodcastFailure("cancelled")
    if raise_on_failure and error_message:
        raise _ScheduledPodcastFailure("failed")
    return result


def _episode_snapshot(episode: episodes.Episode) -> AgentExecutionSnapshot | None:
    """Claim the original scope-bound parent or create it after all prerequisites are available."""
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution import create_job_run
    from backend.services.agent_execution_scope import current_scope, revalidate_scope

    scope = current_scope()
    episodes.bind(episode, scope)
    if scope.role == "viewer":
        raise PermissionError("podcast_editor_required")
    revalidate_scope(scope)
    try:
        job = store.read(scope, episode.run_id)
    except LookupError:
        snapshot, _, _ = _resolve_podcast_llm()
        if snapshot.scope != scope:
            raise PermissionError("podcast_resume_scope_mismatch")
        try:
            return create_job_run(snapshot, episode.run_id, "podcast")
        except ValueError as error:
            if str(error) == "podcast_generation_already_running":
                raise episodes.EpisodeBusy() from error
            raise
    if store.cancelled(scope, job.run_id) or job.status == "cancelled":
        raise _ScheduledPodcastFailure("cancelled")
    if job.status == "completed":
        return None
    if job.status in {"running", "resuming", "queued"}:
        raise episodes.EpisodeBusy()
    if job.status == "failed" and not episode.retry_failure:
        raise _ScheduledPodcastFailure("failed")
    try:
        _, saved = store.resume_data(scope, job.run_id, automatic=True, retry_failed_podcast=episode.retry_failure)
    except ValueError as error:
        if str(error) == "podcast_generation_already_running" or store.read(scope, job.run_id).status in {"running", "resuming"}:
            raise episodes.EpisodeBusy() from error
        raise
    return AgentExecutionSnapshot.model_validate(saved).model_copy(update={"parent_run_id": job.run_id})


def generate_scheduled_podcast() -> dict[str, Any]:
    """Collect one safe outcome while retaining the exact occurrence across unavailable inputs."""
    from backend.services.agent_execution_scope import personal_scheduler_scope, current_scope, execution_scope
    from backend.services.agent_execution_models import ExecutionScope
    from backend.services import agent_execution_store as store

    messages = None
    episode = _episode.get()
    try:
        # An explicitly authorized Reader episode resumes only in its original scope.
        binding = (execution_scope(ExecutionScope.model_validate(episode.scope), origin="button")
                   if episode and episode.source == "reader" and episode.scope else personal_scheduler_scope())
        with binding:
            messages = _schedule_messages()
            if episode is None:
                filename = generate_daily_podcast(raise_on_failure=True)
            else:
                snapshot = _episode_snapshot(episode)
                filename = (generate_daily_podcast(snapshot, raise_on_failure=True) if snapshot is not None
                            else store.read(current_scope(), episode.run_id).result or None)
    except (MetadataUnavailable, episodes.EpisodeBusy):
        raise
    except PermissionError:
        raise MetadataUnavailable(reason="permission") from None
    except _ScheduledPodcastFailure as error:
        raise RuntimeError((messages or _schedule_messages())[str(error)]) from None
    except Exception as error:
        log.error("Scheduled podcast execution failed (%s)", type(error).__name__)
        raise RuntimeError((messages or _schedule_messages())["failed"]) from None
    if filename is None:
        return {"generated": False, "message": messages["empty"]}
    return {"filename": filename, "generated": True, "message": messages["saved"].format(filename=filename)}


def _prepare_podcast_articles(articles: Sequence[Any], snapshot: AgentExecutionSnapshot) -> list[Any]:
    from backend.services.agent_execution_store import work_checkpoint

    readable, skipped = _readable_podcast_articles(articles)
    _generation_state()["skipped_articles"] = skipped
    if snapshot.parent_run_id:
        work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-skipped", {"articles": skipped})
    if not readable:
        raise ValueError("podcast_no_readable_articles")
    return readable


def _resume_audio_publication(snapshot: AgentExecutionSnapshot) -> str | None:
    from backend.services.agent_execution import _operation_context
    from backend.services.agent_execution_store import work_checkpoint
    from backend.services.agent_operation_catalog import skill_id

    if not snapshot.parent_run_id:
        return None
    receipt = (work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-publication")
               or work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-speech"))
    if receipt is None:
        return None
    # Cached speech still requires the currently assigned agent and skill.
    _operation_context(AgentOperation(skill_id=skill_id("podcast"), operation="podcast"), snapshot)
    return str(receipt["filename"]) if _recover_publication(snapshot, receipt) else None


def _episode_script(snapshot: AgentExecutionSnapshot, articles: list[Any], language: str, durable: bool) -> str:
    from backend.services.agent_execution_store import work_checkpoint
    from backend.services.podcast_briefing import build_podcast_script

    saved = work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-final-script") if durable else None
    if saved and saved.get("revision") == snapshot.revision:
        return str(saved["text"])
    script = build_podcast_script([
        {"id": str(article.id), "title": str(article.title or ""), "text": article.full_content}
        for article in articles
    ], language, snapshot=snapshot, check_active=lambda: _check_podcast_publication(snapshot),
        progress=lambda text: _generation_state().update({"progress": text}))
    if durable:
        work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-final-script",
                        {"revision": snapshot.revision, "text": script})
    return script


def _generate_daily_podcast() -> str | None:
    """
    Collect unread articles from the last 24 hours, generate a batched script
    through the configured AI model, and convert it to MP3 audio.

    """
    _generation_state()["running"] = True
    _generation_state()["error"] = None
    _generation_state()["result_filename"] = None
    _generation_state()["skipped_articles"] = []

    try:
        from backend.services.podcast_sources import freeze_podcast_input, restore_articles
        llm, _, _ = _resolve_podcast_llm()
        episode = _episode.get()
        published = _resume_audio_publication(llm)
        if published:
            _generation_state().update({"result_filename": published, "progress": "Completed!"})
            return published
        period_end = datetime.fromisoformat(episode.period_end) if episode else datetime.now(timezone.utc)
        podcast_input = freeze_podcast_input(llm, period_end, _resolve_podcast_language)
        if not podcast_input or not podcast_input["articles"]:
            log.info("No new articles to summarize today.")
            _generation_state()["progress"] = "No new articles found."
            return None
        articles = restore_articles(podcast_input)
        language_code, language_name = podcast_input["language_code"], podcast_input["language_name"]
        log.info("Found %d articles in the daily period.", len(articles))
        _generation_state()["progress"] = f"Found {len(articles)} articles."
        articles = _prepare_podcast_articles(articles, llm)

        _generation_state()["progress"] = f"Processing {len(articles)} readable articles."
        full_script = _episode_script(llm, articles, language_name, episode is not None)
        log.info(f"Full script: {len(full_script)} chars ({len(full_script.split())} words).")
        _generation_state()["progress"] = "Generating TTS audio..."

        # 5. Generate audio
        audio_filename = str(podcast_input["audio_filename"])
        output_directory = get_podcast_output_dir()
        if Path(audio_filename).name != audio_filename or any(
            path.is_symlink() for path in (output_directory.parent, output_directory, output_directory / ".generated")
        ):
            raise MetadataUnavailable(path=output_directory / Path(audio_filename).name, reason="permission")
        audio_output_dir = str(output_directory)
        os.makedirs(audio_output_dir, exist_ok=True)
        audio_path = os.path.join(audio_output_dir, audio_filename)

        log.info(f"Generating TTS audio at {audio_path}...")
        try:
            from backend.services.agent_specialized_tools import run_engine
            receipt = run_engine("speech", audio_filename, partial(
                podcast_audio.prepare_speech, llm, output_directory, audio_filename, full_script,
                language_code, _generate_tts_atomically,
            ))
            if not _recover_publication(llm, receipt):
                raise RuntimeError("podcast_generated_audio_missing")
            log.info(f"Podcast generated successfully: {audio_filename}")
            _generation_state()["result_filename"] = audio_filename
            _generation_state()["progress"] = "Completed!"
            return audio_filename
        except MetadataUnavailable:
            raise
        except OSError as error:
            unavailable = MetadataUnavailable.from_oserror(Path(error.filename or audio_path), error)
            if error.filename and unavailable.reason != "unavailable":
                raise unavailable from error
            raise
        except Exception as e:
            log.error(f"Error generating TTS audio: {e}")
            _generation_state()["error"] = f"TTS Error: {e}"
            return None

    except MetadataUnavailable:
        raise
    except OSError as error:
        if error.filename:
            issue = MetadataUnavailable.from_oserror(Path(error.filename), error)
            if issue.reason != "unavailable":
                raise issue from error
        _generation_state()["error"] = str(error) or type(error).__name__
        return None
    except Exception as e:
        log.error(f"Podcast generator failed: {e}")
        _generation_state()["error"] = str(e) or type(e).__name__
        return None
    finally:
        _generation_state()["running"] = False


def _run_reader_episode(episode: episodes.Episode, snapshot: AgentExecutionSnapshot) -> None:
    from backend.services import agent_execution_store as store

    token = _episode.set(episode)
    try:
        generate_daily_podcast(snapshot)
        job = store.read(snapshot.scope, snapshot.parent_run_id)
        episodes.finish(episode, "success" if job.status == "completed" else "error")
    except MetadataUnavailable as error:
        episodes.cloud_failure(episode, error)
    except Exception as error:
        episodes.finish(episode, "error")
        _generation_state()["error"] = str(error)
    except BaseException:
        episodes.finish(episode, "running")
        raise
    finally:
        _generation_state()["running"] = False
        _episode.reset(token)


def start_generation_async(vault_path: str | Path | None = None) -> bool:
    """Launches the generation in a background thread. Returns immediately."""
    from backend.services.context_vars import get_active_vault_path
    from backend.services.agent_execution_scope import current_scope

    scope = current_scope()
    if scope.role == "viewer":
        raise PermissionError("podcast_editor_required")
    selected_vault = vault_path or get_active_vault_path()
    if selected_vault is None:
        return False
    selected_vault_path = Path(selected_vault).resolve()
    if selected_vault_path != Path(scope.vault_path).resolve():
        raise PermissionError("podcast_vault_scope_mismatch")
    with _generation_lock:
        if any(state["running"] for key, state in _generation_states.items()
               if key[2] == str(selected_vault_path)):
            return False
        _generation_state().update({"running": True, "progress": "", "error": None, "result_filename": None, "skipped_articles": []})

    from backend.services import agent_execution_store as store
    try:
        episode = episodes.claim(selected_vault_path, source="reader", scope=scope, retry_terminal=True)
    except episodes.EpisodeBusy:
        _generation_state()["running"] = False
        return False
    except Exception:
        _generation_state()["running"] = False
        raise

    if episode.status == "success":
        _generation_state()["running"] = False
        return False
    try:
        snapshot = _episode_snapshot(episode)
        if snapshot is None:
            episodes.finish(episode, "success")
            _generation_state()["running"] = False
            return False
    except MetadataUnavailable as error:
        episodes.cloud_failure(episode, error)
        _generation_state().update({"running": False, "error": None})
        return True
    except (episodes.EpisodeBusy, ValueError) as error:
        if isinstance(error, episodes.EpisodeBusy) or str(error) == "podcast_generation_already_running":
            episodes.finish(episode, "running")
            _generation_state()["running"] = False
            return False
        episodes.finish(episode, "error")
        _generation_state().update({"running": False, "error": str(error)})
        raise
    except Exception as error:
        episodes.finish(episode, "error")
        _generation_state().update({"running": False, "error": str(error)})
        raise

    from contextvars import copy_context
    context = copy_context()
    try:
        thread = threading.Thread(target=context.run, args=(_run_reader_episode, episode, snapshot), daemon=True)
        thread.start()
    except Exception as error:
        _generation_state().update({"running": False, "error": str(error)})
        store.update(scope, snapshot.parent_run_id, status="failed", error=str(error))
        episodes.finish(episode, "error")
        raise
    return True


if __name__ == "__main__":
    generate_daily_podcast()


def _refresh_podcast_upstream(snapshot: AgentExecutionSnapshot) -> AgentExecutionSnapshot:
    """Apply the current explicit route without changing frozen source/model instructions."""
    if snapshot.profile.get('provider') != 'openrouter':
        return snapshot
    from backend.config.app_config import load_params
    from backend.domains.agent.provider_routing import resumed_provider_profile
    from backend.services.agent_behavior import revision
    from backend.services.agent_execution_trace import append
    current = next((p for p in load_params(strict_env=False).ai.get('agents', [])
                    if isinstance(p, dict) and p.get('id') == snapshot.agent_id), {})
    frozen = snapshot.profile
    if (current.get('id') == snapshot.agent_id and current.get('provider') == 'openrouter'
            and current.get('model') and current['model'] != frozen.get('model')):
        from backend.domains.agent.provider_routing import selected_upstream
        # A resumed podcast retains its sources and instructions, while an
        # explicitly configured, pinned model may replace the failed route.
        if selected_upstream(current, 'openrouter', current['model']) is not None:
            frozen = {**frozen, 'model': current['model'],
                      '_podcast_preparation_model': frozen.get('_podcast_preparation_model', frozen.get('model'))}
            if current.get('reasoning_effort') is not None:
                frozen['reasoning_effort'] = current['reasoning_effort']
    profile = resumed_provider_profile(frozen, current)
    if profile is snapshot.profile:
        return snapshot
    updated = snapshot.model_copy(update={'profile': profile,
        'revision': revision([snapshot.revision, {'model': profile.get('model'),
                                                'reasoning_effort': profile.get('reasoning_effort'),
                                                'openrouter_route': profile.get('openrouter_route')}])})
    if snapshot.parent_run_id:
        append(snapshot.scope, snapshot.parent_run_id, 'job.provider_route', {
            'model': profile.get('model'), 'route': profile.get('openrouter_route'),
            'previous_revision': snapshot.revision, 'revision': updated.revision})
    return updated


def resume_podcast(snapshot: AgentExecutionSnapshot) -> None:
    """Continue the same authorized source snapshot and private work state."""
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution_scope import current_scope, revalidate_scope
    from contextvars import copy_context
    scope = current_scope()
    if (scope.user_id != snapshot.scope.user_id or scope.workspace_id != snapshot.scope.workspace_id
            or Path(scope.vault_path).resolve() != Path(snapshot.scope.vault_path).resolve()):
        raise PermissionError("podcast_resume_scope_mismatch")
    if scope.role == "viewer":
        raise PermissionError("podcast_editor_required")
    revalidate_scope(snapshot.scope)
    snapshot = _refresh_podcast_upstream(snapshot)
    with _generation_lock:
        if any(state["running"] for key, state in _generation_states.items()
               if key[2] == str(Path(scope.vault_path).resolve())):
            raise RuntimeError("podcast_generation_already_running")
        _generation_state().update({"running": True, "progress": "", "error": None, "result_filename": None, "skipped_articles": []})
    def worker() -> None:
        try:
            generate_daily_podcast(snapshot)
        except Exception as error:
            _generation_state()["error"] = type(error).__name__
        finally:
            _generation_state()["running"] = False
    try:
        threading.Thread(target=copy_context().run, args=(worker,), name="podcast-resume", daemon=True).start()
    except Exception as error:
        with _generation_lock:
            _generation_state().update({"running": False, "error": str(error)})
        store.update(snapshot.scope, snapshot.parent_run_id, status="failed", error=str(error))
        raise
