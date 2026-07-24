# Directive: AI meeting notes

Record an online or in-person meeting, transcribe it locally, and create a
meeting-notes page in the Vault.

## Background-job architecture

1. `MeetingRecorder.jsx` records audio:
   - in person: `getUserMedia({audio: true})`;
   - online: `getDisplayMedia({video: true, audio: true})` plus microphone
     input, mixed through Web Audio into `MediaStreamDestination`;
   - `MediaRecorder` produces an Opus WebM blob.
2. Upload multipart `audio`, `title`, and `mode` to
   `POST /api/meetings/record`.
3. Transcribe locally through `backend/services/transcription.py` and
   faster-whisper.
4. Generate structured summary, topics, decisions, actions, and next steps
   through `factory.generate_text`.
5. `backend/services/meeting_notes.py` calls `create_page` through
   `asyncio.run`, storing notes in Wiki with the full transcript in a
   collapsible `<details>` block.
6. Keep one in-memory `meeting_notes.job_status` and poll
   `GET /api/meetings/status` for `transcribing`, `summarizing`, `saving`,
   `done`, or `error`.

Routes live in `backend/api/meeting_routes.py` under `/api/meetings`.

## Restrictions and edge cases

- faster-whisper uses CTranslate2 rather than Torch. It runs on CPU with
  `compute_type="int8"` and is unaffected by the Intel Mac Torch cap.
- The default `small` model was approximately real-time on a 16 GB Mac.
  Configure `GNOSI_WHISPER_MODEL` or `ai.transcription.model`; `base` is
  faster, while `medium` and `large-v3` are more accurate. Enable VAD.
- First use downloads the model to
  `GNOSI_LOCAL_DATA/cache/whisper`, outside OneDrive. Later loads are local.
- PyAV decodes WebM/Opus, so no external FFmpeg binary is required.
- Chrome requires `video: true` and explicit **Share tab audio** consent for
  display capture. Warn when the shared stream has no audio. Ignore video
  frames, but stop recording when the display track ends.
- The UI must show a legal consent warning before recording third parties.
  Process audio locally and delete the temporary file after transcription.
- If AI generation fails, still save the transcript with an i18n-backed notice
  that AI settings need attention.
- Calling `create_page` from the worker thread through `asyncio.run` is safe
  for a simple Wiki page. Formula and relation background tasks do not run and
  are not needed.

## QA

Verified on 2026-06-21:

- local transcription from generated audio without API credentials;
- end-to-end audio processing into a Wiki page with degraded notes and full
  transcript;
- temporary test page and audio cleanup;
- record and status endpoints against the worktree backend;
- frontend build, lint, recorder launcher, and panel rendering. Headless
  preview cannot fully validate browser microphone and screen capture.
