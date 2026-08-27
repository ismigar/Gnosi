# SKILL: RSS to Audio Podcast

> ID: rss-audio-gen
> Associated Script: scripts/rss_to_audio.py 
> Last Update: 2026-02-19
> Status: DRAFT

---

## 1. Objectives and Scope

- **Main Objective:** Automate the reading of RSS feeds (from OPML), synthesize the content using the Groq API (Llama-3-70b), and generate a daily podcast-style audio file using TTS (gTTS or Piper) to reduce eye strain.
- **Success Criteria:** The script runs correctly, reads the OPML file, discards old articles (over 24h), generates a 10-15 minute summary, and saves a `resum_YYYY_MM_DD.mp3` file.

---

## 2. Input/Output (I/O) Specifications

### Inputs
- **Required Arguments:** None by default (daily autonomous execution).
- **Environment Variables (.env_shared):**
    - `GROQ_API_KEY`: Groq API access key for synthesis.
- **Source Files:**
    - `feeds.opml`: Exported file from Reeder with feeds and folders. It must be in the same folder or in a known path.

### Outputs
- **Generated Artifacts:**
    - `resum_YYYY_MM_DD.mp3`: Audio file with the synthesized daily podcast.
- **Console Output:** Execution logs, processed articles, and audio generation confirmation.

---

## 3. Logical Flow (Algorithm)
1. **Initialization:** Load environment variables and verify the existence of the `feeds.opml` file. Configure logging.
2. **Acquisition (OPML & RSS):** Analyze the OPML to extract feed URLs, filtering by target categories (Religion, ESS, Current Events). Use `feedparser` to download articles. Filter those exclusively published in the last 24 hours. Extract title, source, and content, cleaning the resulting HTML text to count tokens appropriately.
3. **Processing (Groq API):** Combine articles while monitoring the token limit. Send the prepared texts to the Groq API (Llama-3-70b model) with the following prompt: "You are a high-level editorial assistant. Summarize the following articles for a listener with an engineering and philosophy background. Do not look for the easy headline; seek depth, connection between topics, and ethical implications. Structure the summary as a smooth 10-15 minute podcast script. Language: Catalan."
4. **Persistence (TTS):** Receive the synthesized script. Use `gTTS` as a fast, free engine to convert the generated text to Catalan audio (`lang='ca'`). Save the resulting audio file in the execution/sandbox directory as `resum_YYYY_MM_DD.mp3`.
5. **Cleanup & Robustness:** Implement `try/except` blocks per RSS source so that a crash or poor format from one blog does not stop the entire execution.

---

## 4. Tools and Libraries
- **Python libraries:** `feedparser`, `groq`, `gTTS`, `beautifulsoup4`, `python-dotenv`.
- **External APIs:** Groq API (`llama3-70b-8192`).

---

## 5. Restrictions and Edge Cases
- **Limits:** Groq allows up to ~8k tokens. If there are too many articles, content must be truncated or partial summaries requested.
- **Formats:** RSS feed content is often infested with HTML tags. It is mandatory to clean it with BeautifulSoup before sending it to Groq.
- **Robustness:** OPML nodes sometimes lack category tags; the script must handle this.
- **TTS Voice:** The gTTS voice in Catalan can be robotic; the future goal is to implement `Piper` with a local neural model in Catalan.

---

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-02-19 | Initial Creation | N/A | N/A |

> Implementation Note: If the script fails during parsing of a malformed XML feed, intercept the error and continue.

---

## 7. Usage Examples

```bash
# Execution in sandbox
python rss_to_audio.py
```

---

## 8. Pre-Execution Checklist
- [x] Environment variables configured in `.env`/`.env_shared` (`GROQ_API_KEY`).
- [x] Dependencies installed (`uv sync --frozen`).
- [x] Input `feeds.opml` file available.

---

## 9. Post-Execution Checklist
- [ ] Outputs generated correctly (`.mp3` created).
- [ ] Logs reviewed for errors/warnings.
- [ ] Results validated against expected criteria.
- [ ] Guideline updated with new learnings (if applicable).
