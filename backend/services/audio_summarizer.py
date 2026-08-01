import io
import os
import re
import threading
from datetime import datetime, timedelta, timezone

from gtts import gTTS
from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy.orm import Session

from backend.config.logger_config import get_logger
from backend.models.reader import Article

log = get_logger(__name__)

# --- Global generation status ---
generation_status = {
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

SYSTEM_PROMPT = (
    "You are an intelligent podcast assistant. "
    "Write exclusively the text that will be read literally out loud, "
    "without adding notes, section titles, or meta-comments. "
    "Language: English."
)


def _build_batches(articles):
    """Splits the articles into batches that respect Groq's token limit."""
    batches = []
    current_batch_texts = []
    current_size = 0

    for art in articles:
        source_name = art.source.name if art.source else "Unknown"
        snippet = art.content[:MAX_SNIPPET_CHARS] if art.content else ""
        article_text = (
            f"Source: {source_name}\nTitle: {art.title}\nContent: {snippet}\n\n"
        )

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


def _podcast_model_selection(settings):
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


def _resolve_podcast_llm():
    """Resolve the current podcast LLM and return it with provider metadata."""
    from backend.agent.factory import get_default_llm_with_meta, get_llm
    from backend.agent.model_router import strip_legacy_registry_rows
    from backend.config.app_config import load_params
    from backend.security.ai_credentials import resolve_provider_api_key

    cfg = load_params(strict_env=False)
    provider, model = _podcast_model_selection(cfg.settings)
    if not provider:
        llm, provider, model = get_default_llm_with_meta(
            user_message="Generate the daily news podcast script."
        )
        if not llm:
            raise PodcastModelError(
                "No default AI model is available. Configure one in Settings → AI."
            )
        return llm, provider, model

    registry = strip_legacy_registry_rows((cfg.ai or {}).get("models"))
    route_enabled = any(
        row.get("enabled") is True
        and str(row.get("provider") or "").strip().lower() == provider
        and str(row.get("model_id") or "").strip() == model
        for row in registry
    )
    if not route_enabled:
        raise PodcastModelError(
            f"The selected daily podcast model ({provider}/{model}) is not active. "
            "Choose an active model in Settings → Reader."
        )

    providers = (cfg.ai or {}).get("providers") or {}
    provider_config = providers.get(provider) or {}
    if provider_config.get("enabled") is False:
        raise PodcastModelError(
            f"The selected daily podcast provider ({provider}) is disabled. "
            "Enable it in Settings → AI."
        )
    api_key = resolve_provider_api_key(provider, provider_config)
    llm = get_llm(
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=provider_config.get("base_url"),
    )
    if not llm:
        raise PodcastModelError(
            f"The selected daily podcast model ({provider}/{model}) is unavailable. "
            "Check its provider in Settings → AI."
        )
    return llm, provider, model


def _summarize_batch(llm, batch_texts, batch_num, total_batches, provider, model):
    """Send one article batch to the configured LLM and return its script."""
    joined = "\n".join(batch_texts)
    num_articles = len(batch_texts)

    if total_batches == 1:
        user_prompt = (
            "Summarize the following articles for a listener with a background in engineering and philosophy. "
            "Don't look for the easy headline; search for depth, connection between topics, and ethical implications. "
            "Structure the summary as a fluid 10-15 minute podcast script.\n\n"
            f"ARTICLES:\n{joined}"
        )
    else:
        user_prompt = (
            f"Summarize the following {num_articles} articles as segment {batch_num} of {total_batches} "
            f"of a daily podcast. Make a fluid and deep narrative. "
            f"Do not add opening or closing phrases for the podcast, "
            f"because this segment will be joined with others.\n\n"
            f"ARTICLES:\n{joined}"
        )

    response = llm.invoke([
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ])
    content = getattr(response, "content", "") or ""
    if not isinstance(content, str):
        content = str(content)

    from backend.agent.model_router import record_llm_usage, usage_from_message

    usage = usage_from_message(response)
    if usage:
        record_llm_usage(provider, model, usage[0], usage[1])
    return content


def _split_into_sentences(text):
    """Split text into complete sentences for natural TTS pauses."""
    # Split at sentence-ending punctuation followed by space or newline
    # Handles: . ? ! … and combinations like .» or ."
    sentences = re.split(r'(?<=[.!?…»"])\s+', text)
    # Filter empty and merge very short fragments back
    result = []
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


def _generate_tts_by_sentences(text, output_path):
    """
    Generate TTS audio sentence by sentence to avoid mid-sentence pauses.
    """
    sentences = _split_into_sentences(text)
    log.info(f"TTS: {len(sentences)} sentences to process.")

    with open(output_path, "wb") as f:
        for i, sentence in enumerate(sentences):
            if not sentence.strip():
                continue
            try:
                tts = gTTS(text=sentence, lang="en", slow=False)
                buf = io.BytesIO()
                tts.write_to_fp(buf)
                buf.seek(0)
                f.write(buf.read())
            except Exception as e:
                log.warning(f"TTS failed for sentence {i + 1}: {e}")
                # Skip this sentence but continue with others
                continue

    log.info(f"TTS completed: {os.path.getsize(output_path)} bytes")


def generate_daily_podcast():
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
        # 1. Unread articles from the last 24h
        target_time = datetime.now(timezone.utc) - timedelta(hours=24)
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
        llm, provider, model = _resolve_podcast_llm()
        model_label = f"{provider}/{model}"
        all_summaries = []

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
                )
                all_summaries.append(summary)
                log.info(f"Batch {batch_num} completed ({len(summary)} chars).")
            except Exception as e:
                log.error(f"Error in batch {batch_num}: {e}")
                generation_status["progress"] = f"Error in batch {batch_num}: {e}"
                # Continue with the remaining batches if there are any

        if not all_summaries:
            log.error("No summaries generated. All calls failed.")
            generation_status["error"] = "No summaries generated."
            return None

        # 4. Merge all the summaries
        full_script = "\n\n".join(all_summaries)
        log.info(
            f"Full script: {len(full_script)} chars ({len(full_script.split())} words)."
        )
        generation_status["progress"] = "Generating TTS audio..."

        # 5. Generate audio
        today_str = datetime.now().strftime("%Y_%m_%d")
        audio_filename = f"daily_podcast_{today_str}.mp3"
        from backend.config.app_config import load_params

        audio_output_dir = str(load_params(strict_env=False).paths["AUDIO"])
        os.makedirs(audio_output_dir, exist_ok=True)
        audio_path = os.path.join(audio_output_dir, audio_filename)

        log.info(f"Generating TTS audio at {audio_path}...")
        try:
            _generate_tts_by_sentences(full_script, audio_path)
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
            next(db_gen) # This will trigger the generator's 'finally'
        except StopIteration:
            pass
        generation_status["running"] = False


def start_generation_async():
    """Launches the generation in a background thread. Returns immediately."""
    with _generation_lock:
        if generation_status["running"]:
            return False  # A generation is already in progress
        # Sets the flag INSIDE the lock so no one else passes the check before
        # the thread starts. The thread itself will overwrite the progress.
        generation_status["running"] = True
    thread = threading.Thread(target=generate_daily_podcast, daemon=True)
    thread.start()
    return True


if __name__ == "__main__":
    generate_daily_podcast()
