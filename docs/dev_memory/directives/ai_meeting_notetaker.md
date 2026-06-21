# Directiva: Tomador de actas de reuniones con IA (grabar → transcribir → acta)

Estilo Notion AI Meeting Notes: graba la reunión (online o presencial), la
transcribe **localmente** y genera el **acta** como página del Vault.

## Arquitectura (job en segundo plano)

1. **Grabar** (frontend `components/MeetingRecorder.jsx`, global en `App.jsx`):
   - Presencial → `getUserMedia({audio:true})` (micro = la sala).
   - Online → `getDisplayMedia({video:true, audio:true})` (audio de la pestaña/pantalla
     = los demás) **+** `getUserMedia` (micro), **mezclados** con Web Audio API
     (`AudioContext` + 2× `createMediaStreamSource` → `MediaStreamDestination`).
   - `MediaRecorder` (audio/webm;codecs=opus) → Blob.
2. **Subir** → `POST /api/meetings/record` (multipart `audio`+`title`+`mode`).
3. **Transcribir** local: `backend/services/transcription.py` (faster-whisper).
4. **Acta** con IA: `factory.generate_text` (prompt estructurado: Resum, Punts tractats,
   Decisions, Tasques i acords, Properes passes).
5. **Página del Vault**: `backend/services/meeting_notes.py` reusa `create_page`
   (`vault_routes`) vía `asyncio.run` (página simple → carpeta Wiki). Acta arriba +
   transcripción completa en `<details>` plegable.
6. **Estado**: job único en memoria (`meeting_notes.job_status`), polling desde
   `GET /api/meetings/status` (stage: transcribing|summarizing|saving|done|error).

Rutas en `backend/api/meeting_routes.py` (`prefix=/api/meetings`), registradas en
`server.py`.

## Restricciones / Edge cases (aprendidos)

- **faster-whisper usa CTranslate2, NO torch** → el tope de torch del Mac Intel es
  IRRELEVANTE; corre en CPU con `compute_type=int8`. Verificado en Mac 16 GB: modelo
  `small`, detecta catalán, ~tiempo real (14 s para 15 s de audio). Por eso es job en
  segundo plano (una reunión de 30 min tarda ~30 min). Modelo configurable
  (`GNOSI_WHISPER_MODEL` env o `ai.transcription.model`): `base` más rápido,
  `medium`/`large-v3` más precisos. `vad_filter=True` salta silencios.
- **1ª ejecución descarga el modelo** (~480 MB `small`) a `GNOSI_LOCAL_DATA/cache/whisper`
  (fuera de OneDrive, cf. memoria de caches). Cargas posteriores son instantáneas.
- **webm/opus se decodifica con PyAV** (incluido en faster-whisper) → NO hace falta
  ffmpeg externo. El backend guarda el upload como `.webm` aunque el contenido lo
  decodifica por contenido, no por extensión.
- **getDisplayMedia con audio = solo Chrome**; requiere `video:true` para poder compartir
  pestaña/pantalla y que el usuario marque «Compartir audio de la pestaña». Si no hay
  pista de audio compartida, avisar (no se oirá a los demás). El track de vídeo se
  ignora; su `onended` (botón nativo «Dejar de compartir») detiene la grabación.
- **Consentimiento**: grabar a terceros tiene implicaciones legales; la UI muestra aviso.
  El audio se procesa **localmente** y el fichero temporal se **borra** tras transcribir.
- **Acta degrada sin IA**: si `generate_text` falla (claves inválidas, cf.
  [[feedback_llm_oneshot_path]] y directiva `ai_content_and_meeting_reminders.md`), la
  página se guarda igual con la transcripción + un aviso «revisa Configuració › IA».
- **create_page desde thread de fondo**: es async y normalmente corre en contexto de
  petición; se invoca con `asyncio.run`. Para una página simple (sin tabla) no necesita
  estado de petición (escribe el .md en Wiki e inserta en el índice en línea); los
  `background_tasks` (fórmulas/relaciones) no se ejecutan pero no son necesarios.

## QA (cómo se verificó, 2026-06-21)

- Transcripción local: `say` → aiff → `transcribe()` devuelve catalán correcto (sin claves).
- `process_meeting` E2E: audio → página Wiki con acta(degradada)+transcripción; borrada tras
  verificar (no deja basura en el vault).
- Endpoints `/api/meetings/record` (multipart) + `/status` contra backend del worktree.
- Frontend: `npm run build` + `eslint` limpios; preview → launcher + panel del grabador
  renderizan (captura real de mic/pantalla limitada en preview headless).
