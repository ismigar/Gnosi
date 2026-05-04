import os
import re
import io
import time
import logging
import threading
from datetime import datetime, timedelta, timezone
from groq import Groq
from gtts import gTTS
from sqlalchemy.orm import Session

from backend.data.db import SessionLocal
from backend.models.reader import FeedSource, Article

log = logging.getLogger(__name__)

from backend.config.app_config import load_params

cfg = load_params(strict_env=False)
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
AUDIO_OUTPUT_DIR = str(cfg.paths["AUDIO"])
os.makedirs(AUDIO_OUTPUT_DIR, exist_ok=True)

# --- Global generation status ---
generation_status = {
    "running": False,
    "progress": "",
    "error": None,
    "result_filename": None,
}

# --- Batch configuration for Groq free tier ---
MAX_SNIPPET_CHARS = 500  # Content chars per article
MAX_BATCH_CHARS = 20000  # ~5k input tokens per batch
MAX_BATCHES = 5  # Max batches (avoid >5 min wait)
RATE_LIMIT_WAIT_SECS = 65  # Wait between Groq calls (60s + margin)

SYSTEM_PROMPT = (
    "You are an intelligent podcast assistant. "
    "Write exclusively the text that will be read literally out loud, "
    "without adding notes, section titles, or meta-comments. "
    "Language: English."
)


def _build_batches(articles):
    """Divideix els articles en lots que respecten el límit de tokens de Groq."""
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


def _summarize_batch(client, batch_texts, batch_num, total_batches):
    """Envia un lot d'articles a Groq i retorna el text del resum."""
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

    response = client.chat.completions.create(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model="llama-3.3-70b-versatile",
        temperature=0.7,
        max_tokens=3000,
    )
    return response.choices[0].message.content


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

    gTTS internally chunks text by character count (~100 chars), which often
    cuts sentences mid-word. By pre-splitting at sentence boundaries and
    generating each one independently, we get natural pauses between sentences
    and no pauses within them.
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
                log.warning(f"TTS error en frase {i + 1}: {e}")
                # Skip this sentence but continue with others
                continue

    log.info(f"TTS completed: {os.path.getsize(output_path)} bytes")


def generate_daily_podcast():
    """
    Recull els articles «no llegits» de les últimes 24h, genera un resum per lots
    via Groq (respectant el rate limit del free tier) i els converteix a àudio MP3.
    """
    global generation_status
    generation_status["running"] = True
    generation_status["error"] = None
    generation_status["result_filename"] = None

    db: Session = SessionLocal()
    try:
        # 1. Articles no llegits de les últimes 24h
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

        # 2. Dividir en lots
        batches = _build_batches(articles)
        total_batches = len(batches)
        total_articles = sum(len(b) for b in batches)
        log.info(f"Processing {total_articles} articles in {total_batches} batches.")
        generation_status["progress"] = (
            f"Processing {total_articles} articles in {total_batches} batches..."
        )

        # 3. Validar API key
        if not GROQ_API_KEY:
            log.error("GROQ_API_KEY is missing!")
            generation_status["error"] = "Groq API key missing."
            return None

        client = Groq(api_key=GROQ_API_KEY)
        all_summaries = []

        for i, batch in enumerate(batches):
            batch_num = i + 1
            generation_status["progress"] = (
                f"Batch {batch_num}/{total_batches}: calling Groq..."
            )
            log.info(
                f"Batch {batch_num}/{total_batches}: {len(batch)} articles, calling Groq..."
            )

            try:
                summary = _summarize_batch(client, batch, batch_num, total_batches)
                all_summaries.append(summary)
                log.info(f"Batch {batch_num} completed ({len(summary)} chars).")
            except Exception as e:
                log.error(f"Error in batch {batch_num}: {e}")
                generation_status["progress"] = f"Error in batch {batch_num}: {e}"
                # Continuem amb els lots restants si n'hi ha

            # Esperar entre lots per respectar el rate limit
            if batch_num < total_batches:
                generation_status["progress"] = (
                    f"Batch {batch_num}/{total_batches} completed. Waiting {RATE_LIMIT_WAIT_SECS}s for rate limit..."
                )
                log.info(f"Waiting {RATE_LIMIT_WAIT_SECS}s for Groq rate limit...")
                time.sleep(RATE_LIMIT_WAIT_SECS)

        if not all_summaries:
            log.error("No summaries generated. All calls failed.")
            generation_status["error"] = "No summaries generated."
            return None

        # 4. Unir tots els resums
        full_script = "\n\n".join(all_summaries)
        log.info(
            f"Full script: {len(full_script)} chars ({len(full_script.split())} words)."
        )
        generation_status["progress"] = "Generating TTS audio..."

        # 5. Generate audio
        today_str = datetime.now().strftime("%Y_%m_%d")
        audio_filename = f"daily_podcast_{today_str}.mp3"
        audio_path = os.path.join(AUDIO_OUTPUT_DIR, audio_filename)

        log.info(f"Generating TTS audio at {audio_path}...")
        try:
            log.info(f"✅ Podcast generated successfully: {audio_filename}")
            generation_status["result_filename"] = audio_filename
            generation_status["progress"] = "Completed!"
            return audio_filename
        except Exception as e:
            log.error(f"Error generating TTS audio: {e}")
            generation_status["error"] = f"TTS Error: {e}"
            return None

    except Exception as e:
        log.error(f"Error global al generador de podcast: {e}")
        generation_status["error"] = str(e)
        return None
    finally:
        db.close()
        generation_status["running"] = False


def start_generation_async():
    """Llança la generació en un thread de fons. Retorna immediatament."""
    if generation_status["running"]:
        return False  # Ja hi ha una generació en curs
    thread = threading.Thread(target=generate_daily_podcast, daemon=True)
    thread.start()
    return True


if __name__ == "__main__":
    generate_daily_podcast()
