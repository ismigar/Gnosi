"""Generate the daily Reader podcast script and publish its audio atomically."""

from backend.services.agent_behavior import task_input

import io
import os
import re
import threading
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, TypedDict

from gtts import gTTS  # type: ignore[import-untyped]
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation
from sqlalchemy.orm import Session

from backend.config.logger_config import get_logger
from backend.models.reader import Article

log = get_logger(__name__)


# --- Global generation status ---
class GenerationStatus(TypedDict):
    """Observable state for one background podcast generation."""

    running: bool
    progress: str
    error: str | None
    result_filename: str | None


generation_status: GenerationStatus = {
    "running": False,
    "progress": "",
    "error": None,
    "result_filename": None,
}

# Lock to prevent two clients from starting two simultaneous generations (each
# generation takes ~5 min and makes paid Groq calls). Without a lock, two
# very rapid requests passed the `running:False` check before the first
# had time to mark it.
_generation_lock = threading.Lock()

# --- Batch configuration ---
MAX_SNIPPET_CHARS = 500  # Content chars per article
MAX_BATCH_CHARS = 20000  # ~5k input tokens per batch
MAX_BATCHES = 5  # Max batches (avoid >5 min wait)
MAX_TTS_WORKERS = 4  # Bounded parallelism for independent sentence requests

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
    from backend.services.agent_execution import prepare_snapshot, _snapshot
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


def _synthesize_tts_sentence(payload: tuple[int, str, str]) -> bytes:
    """Synthesize one indexed sentence and return its MP3 bytes."""
    index, sentence, language_code = payload
    try:
        tts = gTTS(text=sentence, lang=language_code, slow=False)
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        return buf.getvalue()
    except Exception as exc:
        log.warning("TTS failed for sentence %s: %s", index + 1, exc)
        return b""


def _generate_tts_by_sentences(text: str, output_path: str | Path, language_code: str) -> None:
    """
    Generate TTS audio sentence by sentence to avoid mid-sentence pauses.
    """
    sentences = _split_into_sentences(text)
    log.info(f"TTS: {len(sentences)} sentences to process.")

    payloads = [
        (index, sentence, language_code)
        for index, sentence in enumerate(sentences)
        if sentence.strip()
    ]
    worker_count = min(MAX_TTS_WORKERS, len(payloads)) or 1
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        audio_chunks = executor.map(_synthesize_tts_sentence, payloads)
        with open(output_path, "wb") as output_file:
            for audio_chunk in audio_chunks:
                output_file.write(audio_chunk)

    log.info(f"TTS completed: {os.path.getsize(output_path)} bytes")


def _generate_tts_atomically(text: str, output_path: str | Path, language_code: str) -> None:
    """Publish a complete MP3 without exposing an in-progress audio file."""
    partial_path = f"{output_path}.part"
    try:
        _generate_tts_by_sentences(text, partial_path, language_code)
        if os.path.getsize(partial_path) <= 0:
            raise RuntimeError("TTS produced an empty audio file.")
        os.replace(partial_path, output_path)
    finally:
        if os.path.exists(partial_path):
            os.remove(partial_path)


def get_podcast_output_dir(vault_path: str | Path | None = None) -> Path:
    """Return the shared output directory used to generate and serve podcasts."""
    if vault_path is None:
        from backend.services.context_vars import get_active_vault_path

        vault_path = get_active_vault_path()
    if vault_path is None:
        raise RuntimeError("No active vault is available for podcast generation.")
    return Path(vault_path) / "data" / "podcasts"


def generate_daily_podcast() -> str | None:
    import uuid
    from backend.services.agent_execution import create_job_run, operation_session
    from backend.services import agent_execution_store as store
    snapshot, _provider, _model = _resolve_podcast_llm()
    run_id = uuid.uuid4().hex
    snapshot = create_job_run(snapshot, run_id, "podcast")
    with operation_session(snapshot):
        store.update(snapshot.scope, run_id, status="running")
        try:
            result = _generate_daily_podcast()
            store.update(snapshot.scope, run_id,
                status="failed" if generation_status["error"] else "completed",
                result=result or "", error=generation_status["error"] or "")
            return result
        except BaseException as error:
            store.update(snapshot.scope, run_id, status="failed", error=type(error).__name__)
            raise


def _generate_daily_podcast() -> str | None:
    """
    Collect unread articles from the last 24 hours, generate a batched script
    through the configured AI model, and convert it to MP3 audio.

    """
    global generation_status
    generation_status["running"] = True
    generation_status["error"] = None
    generation_status["result_filename"] = None

    # Get DB session dynamically
    from backend.data.db import get_db

    db_gen = get_db()
    db: Session = next(db_gen)

    try:
        llm, provider, model = _resolve_podcast_llm()
        from backend.services.agent_execution_store import work_checkpoint
        podcast_input = work_checkpoint(llm.scope, llm.parent_run_id, "podcast-input") if llm.parent_run_id else None
        articles: list[Any]
        # 1. Unread articles from the last 24h
        target_time = datetime.now(timezone.utc) - timedelta(hours=24)
        if podcast_input is not None:
            from types import SimpleNamespace
            articles = [SimpleNamespace(**{**row, "source": SimpleNamespace(name=row["source"])}) for row in podcast_input["articles"]]
        else:
            articles = (
                db.query(Article)
                .filter(Article.is_read == False, Article.published_at > target_time)
                .all()
            )


        if not articles:
            log.info("No new articles to summarize today.")
            generation_status["progress"] = "No new articles found."
            return None

        log.info(f"Found {len(articles)} unread articles.")
        generation_status["progress"] = f"Found {len(articles)} articles."

        # 2. Split into batches.
        batches = _build_batches(articles)
        total_batches = len(batches)
        total_articles = sum(len(b) for b in batches)
        log.info(f"Processing {total_articles} articles in {total_batches} batches.")
        generation_status["progress"] = (
            f"Processing {total_articles} articles in {total_batches} batches..."
        )

        # 3. Resolve the model from the latest Settings state.
        language_code, language_name = _resolve_podcast_language()
        if podcast_input is not None:
            language_code, language_name = podcast_input["language_code"], podcast_input["language_name"]
        elif llm.parent_run_id and llm.behavior_resources:
            podcast_input = {"articles": [{"id": str(article.id), "title": str(article.title or ""),
                "full_content": str(article.full_content or ""), "content": str(article.content or ""),
                "source": str(article.source.name if article.source else "")} for article in articles],
                "language_code": language_code, "language_name": language_name,
                "audio_filename": f"daily_podcast_{datetime.now().strftime('%Y_%m_%d')}.mp3"}
            work_checkpoint(llm.scope, llm.parent_run_id, "podcast-input", podcast_input)
        model_label = f"{provider}/{model}"
        all_summaries: list[str] = []

        if llm.behavior_resources:
            from backend.services.agent_document_work import synthesize
            from backend.domains.reader.analysis import _article_text
            outcome = synthesize("podcast", [
                {"id": str(article.id), "title": str(article.title or ""), "text": _article_text(article)}
                for article in articles
            ], task_input("podcast.script", language=language_name), snapshot=llm,
                output_schema={"type": "object", "required": ["text"], "properties": {"text": {"type": "string", "minLength": 1}}})
            all_summaries.append(outcome["result"]["text"])
        else:
            for i, batch in enumerate(batches):
                batch_num = i + 1
                generation_status["progress"] = (
                    f"Batch {batch_num}/{total_batches}: calling {model_label}..."
                )
                log.info(
                    "Batch %s/%s: %s articles, calling %s.",
                    batch_num,
                    total_batches,
                    len(batch),
                    model_label,
                )

                try:
                    summary = _summarize_batch(
                        llm,
                        batch,
                        batch_num,
                        total_batches,
                        provider,
                        model,
                        language_name,
                    )
                    all_summaries.append(summary)
                    log.info(f"Batch {batch_num} completed ({len(summary)} chars).")
                except Exception as e:
                    log.error(f"Error in batch {batch_num}: {e}")
                    generation_status["progress"] = f"Error in batch {batch_num}: {e}"
                    raise  # A partial episode must not be reported as complete.

        if not all_summaries:
            log.error("No summaries generated. All calls failed.")
            generation_status["error"] = "No summaries generated."
            return None

        # 4. Merge all the summaries
        full_script = "\n\n".join(all_summaries)
        log.info(f"Full script: {len(full_script)} chars ({len(full_script.split())} words).")
        generation_status["progress"] = "Generating TTS audio..."

        # 5. Generate audio
        today_str = datetime.now().strftime("%Y_%m_%d")
        audio_filename = str(podcast_input["audio_filename"]) if podcast_input else f"daily_podcast_{today_str}.mp3"
        audio_output_dir = str(get_podcast_output_dir())
        os.makedirs(audio_output_dir, exist_ok=True)
        audio_path = os.path.join(audio_output_dir, audio_filename)

        log.info(f"Generating TTS audio at {audio_path}...")
        try:
            from backend.services.agent_specialized_tools import run_engine
            def publish_audio() -> None:
                if not llm.behavior_resources:
                    _generate_tts_atomically(full_script, audio_path, language_code)
                    return
                import hashlib
                import shutil
                import tempfile
                digest = hashlib.sha256((language_code + "\0" + full_script).encode()).hexdigest()
                cached = Path(audio_output_dir) / ".generated" / f"{digest}.mp3"
                cached.parent.mkdir(parents=True, exist_ok=True)
                if not cached.is_file():
                    _generate_tts_atomically(full_script, cached, language_code)
                with tempfile.NamedTemporaryFile(dir=audio_output_dir, suffix=".tmp", delete=False) as temporary:
                    temporary_path = Path(temporary.name)
                try:
                    shutil.copyfile(cached, temporary_path)
                    os.replace(temporary_path, audio_path)
                finally:
                    temporary_path.unlink(missing_ok=True)
            run_engine("speech", audio_filename, publish_audio)
            log.info(f"Podcast generated successfully: {audio_filename}")
            generation_status["result_filename"] = audio_filename
            generation_status["progress"] = "Completed!"
            return audio_filename
        except Exception as e:
            log.error(f"Error generating TTS audio: {e}")
            generation_status["error"] = f"TTS Error: {e}"
            return None

    except Exception as e:
        log.error(f"Podcast generator failed: {e}")
        generation_status["error"] = str(e)
        return None
    finally:
        # Close the session obtained from the generator
        try:
            next(db_gen)  # This will trigger the generator's 'finally'
        except StopIteration:
            pass
        generation_status["running"] = False


def start_generation_async(vault_path: str | Path | None = None) -> bool:
    """Launches the generation in a background thread. Returns immediately."""
    from backend.services.context_vars import active_vault_path, get_active_vault_path

    with _generation_lock:
        if generation_status["running"]:
            return False  # A generation is already in progress
        # Sets the flag INSIDE the lock so no one else passes the check before
        # the thread starts. The thread itself will overwrite the progress.
        generation_status["running"] = True
    selected_vault = vault_path or get_active_vault_path()
    if selected_vault is None:
        generation_status["running"] = False
        return False
    selected_vault_path = Path(selected_vault)

    def run_for_selected_vault() -> None:
        token = active_vault_path.set(selected_vault_path)
        try:
            generate_daily_podcast()
        except Exception as error:
            generation_status["error"] = str(error)
        finally:
            generation_status["running"] = False
            active_vault_path.reset(token)

    from contextvars import copy_context
    context = copy_context()
    thread = threading.Thread(target=context.run, args=(run_for_selected_vault,), daemon=True)
    thread.start()
    return True


if __name__ == "__main__":
    generate_daily_podcast()


def resume_podcast(snapshot: AgentExecutionSnapshot) -> None:
    """Continue the same authorized source snapshot and private work state."""
    from backend.services.agent_execution import operation_session
    from backend.services import agent_execution_store as store
    with _generation_lock:
        if generation_status["running"]:
            raise RuntimeError("podcast_generation_already_running")
        generation_status["running"] = True
    def worker() -> None:
        try:
            with operation_session(snapshot):
                store.update(snapshot.scope, snapshot.parent_run_id, status="running")
                result = _generate_daily_podcast()
                store.update(snapshot.scope, snapshot.parent_run_id,
                    status="failed" if generation_status["error"] else "completed",
                    result=result or "", error=generation_status["error"] or "")
        except BaseException as error:
            store.update(snapshot.scope, snapshot.parent_run_id, status="failed", error=str(error))
        finally:
            generation_status["running"] = False
    threading.Thread(target=worker, name="podcast-resume", daemon=True).start()
