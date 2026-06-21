# Directiva: IA al editor (insertar contenido) + Notificador de reuniones con IA

Estilo Notion. Dos features con IA, montadas sobre infraestructura ya existente.

## 1. Generación de texto one-shot — usar `factory.generate_text`, NO `ai_client`

- **CRÍTICO**: `pipeline/ai_client.py::call_ai_with_fallback` es el cliente *legacy*.
  Espera `model_url`/`model_name` por proveedor (formato plano antiguo). El esquema
  de proveedores ACTUAL (gestionado por `ai_routes`/`ai_credentials`) guarda
  `credential_ref`/`base_url`, **no** `model_url` → `call_ai_with_fallback` falla con
  `Invalid URL 'None'`. El endpoint gemelo `/api/mail/ai/generate_draft` también está
  roto por esto.
- **Usar siempre** `backend/agent/factory.py::generate_text(prompt, user_message="")`
  → `(texto, etiqueta_model)`. Es el camino MODERNO (`get_default_llm` → `get_llm` +
  `resolve_provider_api_key`), el mismo que usa el agente y el botón «validar» de
  Configuración › IA. `get_default_llm` resuelve: agente activo → `_resolve_auto_llm`
  (según el texto) → `_get_hybrid_llm` (cualquier proveedor con clave). Lanza
  `RuntimeError("No AI provider available")` si no hay ninguno.
- No hay caché en este camino → cada llamada es nueva (lo que quiere el editor).

## 2. Degradación elegante (las claves pueden ser inválidas)

- Estado a 2026-06-21: las claves de groq y openrouter del usuario dan
  `AuthenticationError` (401) — IA caída en el entorno. Verificable con
  `POST /api/ai/providers/{groq|openrouter}/validate`. **El usuario debe re-introducir
  las claves en Configuración › IA.**
- `POST /api/ai/generate`: `RuntimeError` (sin proveedor) → 503; error de auth/clave
  (401/403/"api key") → 503 con mensaje accionable; otros → 502. Nunca 500 mudo.
- Notificador: si la IA falla, `_generate_agenda` devuelve `""` y el aviso se envía
  **igualmente sin orden del día**. El recordatorio nunca depende de la IA.

## 3. Endpoint del editor: `POST /api/ai/generate`

- Cuerpo `{ prompt, context?, mode?, language? }`. `mode`:
  `free | continue | summarize | improve | translate`. `_build_generation_prompt`
  construye el prompt según el modo (presets estilo Notion). Devuelve `{content, provider}`.
- Frontend: `AIGenerateModal.jsx` (prompt libre + chips de preset + previsualización
  antes de insertar) + grupo «IA» en los slash commands de `BlockEditor.jsx` (icono
  `Sparkles`). Inserción con el helper existente `richMarkdownToBlocks(md, editor)` →
  `editor.insertBlocks(blocks, anchor, 'after')` + autosave. Patrón de estado calcado
  de `CitePicker` (`aiRequest` + render al final).

## 4. Notificador de reuniones — motor en el scheduler

- `backend/services/meeting_reminders.py`: `scan_and_notify()` escanea reuniones en
  `[ahora, ahora+lead]`, deduplica por clave `id|start`, genera la **orden del día** con
  `generate_text`, dispara `notify()` (macOS nativo + BD + MD) y persiste estado en
  `LOCAL_DATA/system/meeting_reminders.json` (`safe_write_json`). Helpers `get_active`
  (recalcula `minutes_until`, poda caducados/descartados), `dismiss`, `get/update_settings`.
- Endpoints en `calendar_routes.py`: `GET /reminders`, `POST /reminders/{id}/dismiss`,
  `GET/PUT /reminders/settings` (al activar, sincroniza la tarea del scheduler →
  **una sola fuente de verdad** del on/off).
- Tarea `meeting_reminders` en `scheduler/manager.py`, `default_interval: 1` (cada minuto).
  **Marcada `quiet: True`**: las notificaciones genéricas «Tasca Iniciada/Finalitzada» del
  scheduler se SUPRIMEN para tareas quiet (si no, una tarea de 1 min llenaría macOS de
  burbujas cada minuto). El flag se respeta en `run_task_now` (inicio/éxito/error).
- **macOS nativo**: `MacOSChannel` usa `osascript` → sólo funciona porque el backend corre
  NATIVO (no Docker). Bajo Docker degradaría a BD+MD (no rompe).
- Frontend: `MeetingReminderWatcher.jsx` (global en `App.jsx`, polling 60s de `/reminders`,
  banner con cuenta atrás + orden del día plegable + «Veure al calendari»/«Descarta»). Toggle
  «Recordatoris IA» + selector de antelación (5/10/15/30) en la cabecera de `CalendarPage.jsx`.

## 5. Recogida de eventos resiliente (`collect_all_events`)

- `GET /events` y el notificador comparten `calendar_routes.collect_all_events` (síncrono).
- **Robustez por cuenta**: un token de Google caducado (`GoogleAuthExpired`) o cualquier
  fallo de una cuenta NO debe tumbar toda la consulta → se omite esa cuenta y se devuelven
  las demás + los eventos del Vault. Imprescindible para que el notificador vea reuniones del
  Vault aunque Google esté caducado. La UI pide reconexión vía la cabecera de `GET /calendars`.

## QA (cómo se verificó, 2026-06-21)

- Backend (llamadas directas con venv nativo + `params.yaml` del vault): `build_prompt` OK;
  motor del notificador OK (scan→1, agenda, notify, dedup, dismiss); `generate_text` llega a la
  API (401 por clave inválida, no por bug); endpoint degrada a 503; `collect_all_events`
  omite Google caducado y devuelve el evento del Vault.
- Frontend: `npm run build` + `eslint` limpios; preview del worktree (vite→backend worktree en
  puerto libre) → banner renderiza, agenda despliega, descartar funciona (front+back), toggle
  del calendario sincroniza con el backend; sin errores de consola.
- Para QA del worktree: backend nativo en puerto libre con `GNOSI_LOCAL_DATA` = local_data de
  main (secretos/DB reales) + `PYTHONPATH` = worktree; vite con `VITE_BACKEND_PORT` al backend
  del worktree y `VITE_DEV_HTTPS=false`.
