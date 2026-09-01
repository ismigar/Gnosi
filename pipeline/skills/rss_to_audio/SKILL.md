---
name: rss-to-audio
description: Generate Gnosi's standalone RSS podcast from an explicitly selected OPML file, preserving its existing English summary and audio behavior. Use for this CLI's development or requested execution, not automatic provider calls.
---

# SKILL: RSS to Audio Podcast

> ID: rss-audio-gen
> Associated Script: scripts/rss_to_audio.py 
> Status: ACTIVE — standalone opt-in tool, not the application's podcast scheduler

---

## 1. Objectives and Scope

- **Main Objective:** Read OPML feeds, synthesize their recent content with the existing Groq model setting and generate English audio using gTTS.
- **Success Criteria:** Review the generated text and audio. A zero exit code alone does not prove success: existing provider errors can be reported as text and TTS errors are logged. This refactor does not certify live provider availability or add Piper support.

---

## 2. Input/Output (I/O) Specifications

### Inputs
- **Arguments:** `--opml <file>` and `--output-dir <directory>` override the configured defaults. Execution is opt-in, not an installed autonomous job.
- **Environment Variables (process, local `.env`, or explicit shared file):**
    - `GROQ_API_KEY`: Groq API access key for synthesis.
- **Source Files:**
    - Default input: `GNOSI_DATA_DIR/rss_to_audio/feeds.opml`. Export an OPML file from an RSS reader or select one explicitly with `--opml`.

### Outputs
- **Generated Artifacts:**
    - `summary_YYYY_MM_DD.txt` and `summary_YYYY_MM_DD.mp3`, under `GNOSI_DATA_DIR/audio/rss_to_audio` unless `--output-dir` is selected. Source and sandbox directories are not defaults. Repeating a run on the same date replaces that day's outputs; use another output directory to preserve previous runs.
- **Console Output:** Execution logs, processed articles, and audio generation confirmation.

---

## 3. Logical Flow (Algorithm)
1. **Initialization:** Load environment variables and verify the existence of the `feeds.opml` file. Configure logging.
2. **Acquisition (OPML & RSS):** Match the existing folder labels `Religió`, `ESS`, `Actualitat` and `News` exactly. Fetch with feedparser, keep articles dated within the last 24 hours and remove HTML with BeautifulSoup. Preserve FeedParserDict aliases and both struct_time and nine-element date tuples.
3. **Processing (Groq API):** Preserve the existing `llama3-70b-8192` model setting, English editorial prompt, 2,000-character article limit and 25,000-character approximate prompt budget. These are implementation settings, not a claim about current provider limits or guaranteed duration.
4. **Persistence (TTS):** Write the summary text and request English gTTS audio (`lang='en'`) in the chosen output directory. Keep null provider content as an error rather than silently producing an empty podcast.
5. **Cleanup & Robustness:** Implement `try/except` blocks per RSS source so that a crash or poor format from one blog does not stop the entire execution.

---

## 4. Tools and Libraries
- **Python libraries:** `feedparser`, `groq`, `gTTS`, `beautifulsoup4`, `python-dotenv`.
- **External APIs:** Groq API (`llama3-70b-8192`).

---

## 5. Restrictions and Edge Cases
- **External effects:** RSS downloads, Groq and gTTS require network access and can disclose selected article content to providers. Run them only for an explicitly requested generation; unit tests must inject fake providers.
- **Formats:** RSS feed content is often infested with HTML tags. It is mandatory to clean it with BeautifulSoup before sending it to Groq.
- **Robustness:** OPML nodes sometimes lack category tags; the script must handle this.
- **Scope:** Changing language, model, category selection or TTS engine is a separate behavior change. Earlier instructions described Catalan/Piper aspirations that the implementation did not provide.

---

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-02-19 | Initial Creation | N/A | N/A |

> Implementation Note: If the script fails during parsing of a malformed XML feed, intercept the error and continue.

---

## 7. Usage Examples

```bash
# Explicit input and output outside source
uv run python pipeline/skills/rss_to_audio/scripts/rss_to_audio.py \
  --opml /path/to/feeds.opml --output-dir /path/to/podcast-output
```

---

## 8. Pre-Execution Checklist
- [ ] `GROQ_API_KEY` available through the process, local `.env`, or explicitly selected shared environment file. This CLI reads the resolved environment.
- [x] Dependencies installed (`uv sync --frozen`).
- [x] Input `feeds.opml` file available.

---

## 9. Post-Execution Checklist
- [ ] Outputs generated correctly (`.mp3` created).
- [ ] Logs reviewed for errors/warnings.
- [ ] Results validated against expected criteria.
- [ ] Guideline updated with new learnings (if applicable).
