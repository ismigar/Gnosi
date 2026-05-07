# Directiva: Migració Gmail API → IMAP + XOAUTH2

> ID: MAIL-IMAP-XOAUTH2-20260507
> Estat: ACTIVA
> Motivació: Reduir dependència de Gmail API i unificar tots els proveïdors (Google/Microsoft/manuals) sota un sol protocol de lectura/escriptura (IMAP/SMTP), com fa Apple Mail.app.

## 0. Aclariment important

Aquesta migració **NO resol per si sola** la caducitat dels refresh_tokens en apps OAuth en mode *Testing* (Google els invalida als 7 dies). El refresh_token és el mateix tant si s'usa per Gmail API com per IMAP-XOAUTH2: és lligat al `client_id`, no al protocol. Per fer caducar a "mai" cal **publicar l'app** a Google Cloud (consent screen → *Publish*).

Per què val la pena igualment:
- IDLE/push real (Gmail API no en té sense Pub/Sub).
- Codi unificat: una única ruta `imap_*` per a tots els proveïdors amb OAuth.
- Independència del SDK de Google a runtime per a les operacions de mail.
- Compatibilitat amb tercers (Mail.app, Thunderbird) sense reconfiguració.

## 1. SASL XOAUTH2 — què és

Cadena d'autenticació codificada base64 amb el format:

```
user={email}\x01auth=Bearer {access_token}\x01\x01
```

S'utilitza tant a IMAP (`imap.authenticate("XOAUTH2", lambda _: auth_string.encode())`) com a SMTP (`smtp.docmd("AUTH", "XOAUTH2 " + base64(auth_string))`).

L'`access_token` dura ~1 hora. Si caduca, cal cridar `Credentials.refresh(Request())` amb el `refresh_token`. Si el `refresh_token` també falla amb `invalid_grant`, l'usuari ha de re-consentir (mateix flux que ara).

## 2. Servidors per proveïdor

| Proveïdor | IMAP host | IMAP port | SMTP host | SMTP port | Encryption |
|-----------|-----------|-----------|-----------|-----------|------------|
| Google    | imap.gmail.com | 993 | smtp.gmail.com | 465 | SSL |
| Microsoft 365 | outlook.office365.com | 993 | smtp.office365.com | 587 | STARTTLS |
| iCloud    | imap.mail.me.com | 993 | smtp.mail.me.com | 587 | STARTTLS |

**Scope OAuth requerit per IMAP/SMTP de Google:** `https://mail.google.com/` (full mailbox). Ja el demanem a `google_auth_routes.py`.

## 3. Arquitectura objectiu

```
┌─────────────────────────────────────────────────────────────┐
│                     mail_routes (FastAPI)                   │
└─────────────────────────────────────────────────────────────┘
              │                                  │
              ▼                                  ▼
   ┌────────────────────────┐       ┌────────────────────────┐
   │ hybrid_mail_service    │       │ imap_mail_sync_service │
   │  (lectura on-demand)   │       │  (sync vault i actions)│
   └────────────────────────┘       └────────────────────────┘
              │                                  │
              └──────────────┬───────────────────┘
                             ▼
                ┌────────────────────────┐
                │ oauth2_helpers         │ ← NOU
                │  build_xoauth2_string  │
                │  ensure_fresh_token    │
                └────────────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │ google_mail_service    │ ← només per autenticació inicial
                │  (deprecated runtime)  │
                └────────────────────────┘
```

## 4. Pla per fases

### Fase 1 — Lectura per IMAP+XOAUTH2 [PRIMER]
Migrar list/get/counts dels comptes Google a IMAP. És el camí calent (95% del trànsit).

1. Crear `backend/services/oauth2_helpers.py` amb:
   - `ensure_fresh_token(account_email) -> (access_token, refreshed_account_dict)`: refresca si cal.
   - `build_xoauth2_string(email, access_token) -> bytes`: format SASL.
   - `xoauth2_imap_login(imap, email, access_token) -> bool`: fa `imap.authenticate("XOAUTH2", ...)`.
2. Modificar `_imap_connect_fresh` (a `hybrid_mail_service.py`) i `ImapMailSyncService._connect` (a `imap_mail_sync_service.py`):
   - Si compte té `auth_type == "oauth2"` i `provider == "google"`, usar XOAUTH2.
   - Si no, login amb password com ara.
3. Modificar `integration_manager.is_imap_account()` i `resolve_imap_defaults()`:
   - Acceptar Google amb refresh_token com IMAP-eligible.
   - Auto-injectar `imap_host=imap.gmail.com`, `imap_port=993`, `imap_encryption=ssl`, `imap_user=email`, anàleg per SMTP.
4. Modificar `mail_routes.py` per **prioritzar IMAP** quan `is_imap_account` és True (treure el `if is_google_account` que precedeix `is_imap_account`).
5. Auto-injectar paràmetres IMAP/SMTP al callback OAuth (`google_auth_routes.py`).
6. Script idempotent a `pipeline/sandbox/migrate_google_to_imap.py` per actualitzar comptes existents.

### Fase 2 — Send + Drafts via SMTP/IMAP
1. Modificar `imap_smtp_send` per usar XOAUTH2 quan no hi ha password.
2. Implementar `imap_save_draft` amb `IMAP4.append("[Gmail]/Drafts", "(\\Draft)", ...)`.
3. Re-route a `mail_routes.py` (línies ~717, ~776, ~1000).

### Fase 3 — Actions (trash/move/archive/star/read)
Ja existeix infraestructura completa a `ImapMailSyncService`. Només cal eliminar les bifurcacions `if is_google_account → Gmail API` a `mail_routes.py` (línies ~597, ~611, ~632, ~657, ~1060, ~1151).

### Fase 4 — Push via IDLE (opcional, plus respecte Mail.app)
Worker en background que faci `imap.idle()` per compte Google i emeti events SSE al frontend.

## 5. Restriccions / Edge cases

- **No usar `imaplib.IMAP4.login()` per OAuth**. Cal `authenticate("XOAUTH2", ...)`. → Crida diferent, fàcil oblidar.
- **El token al pool persistent expira**. El pool actual només re-connecta si `noop()` falla. Cal capturar també `imaplib.IMAP4.error` amb status `BAD` (token expired) → invalidar pool, refrescar token, reconnectar.
- **`[Gmail]/Drafts`, `[Gmail]/Sent Mail`, `[Gmail]/Trash`** són els noms reals de les carpetes especials de Gmail via IMAP. El `_discover_folders` actual ja les detecta via `\Drafts`, `\Sent`, `\Trash` (RFC 6154 SPECIAL-USE), però el nom contindrà `[Gmail]/`.
- **Gmail "All Mail"** (`\All`) és la carpeta arxiu. No es pot esborrar de "All Mail" sense moure a Trash primer.
- **Append a Drafts** triga a aparèixer al frontend de Gmail (cache servidor); el lector via IMAP ho veu immediatament.
- **`X-OAuth-Token` per a SMTP**: smtplib no té helper directe per XOAUTH2; cal usar `docmd("AUTH", ...)` manualment.
- **Pool de connexions**: una connexió IMAP autenticada per OAuth té el mateix lifetime que el token (1h max). Cal renovar el pool cada hora encara que `noop()` no doni error.

## 6. Idempotència del script de migració

`pipeline/sandbox/migrate_google_to_imap.py`:
- Carrega `data/integrations.json` via `integration_manager`.
- Per cada compte Google sense `imap_host`, hi afegeix els defaults de Gmail.
- Si `imap_host` ja existeix, no toca res.
- Sortida: log dels comptes modificats. Re-execució = no-op.

## 7. Verificació

1. **Static build**: `docker-compose up -d backend` → cap import error.
2. **Browser test**: obrir `/mail`, verificar que la INBOX carrega via log "[IMAP-XOAUTH2]" en lloc de "[Gmail]".
3. **E2E**: marcar com a llegit, eliminar, moure de carpeta → verificar que el canvi es reflecteix també a Gmail Web.
4. **Send**: enviar un missatge nou, verificar a la carpeta "Enviats" del Gmail Web.

## 8. Aprenentatges (apèndix viu)

| Data | Error / Lliçó | Causa | Solució |
|------|---------------|-------|---------|
| 2026-05-07 | (inicial) | Gmail API + refresh_token caducat als 7d (mode Testing) | Migració C iniciada |
| 2026-05-07 | Fases 2-4 implementades | — | APPEND drafts, X-GM-THRID, IDLE+SSE, health endpoint |

## 9. Estat post-implementació (2026-05-07)

Totes les fases del pla original (1-4) i les limitacions identificades estan resoltes:

- ✅ **Fase 1 — Lectura via IMAP+XOAUTH2**: list/get/counts passen per IMAP per Google.
- ✅ **Fase 2 — Send + Drafts**: `imap_smtp_send` autentica XOAUTH2; `append_draft` fa IMAP APPEND a `[Gmail]/Drafts`. Auto-save passa `replace_uid` per substituir versions anteriors.
- ✅ **Fase 3 — Actions**: redirigides al camí IMAP via `_is_imap_account` (que ara inclou Google).
- ✅ **Fase 4 — Push real (IDLE)**: `imap_idle_service.py` llança un worker per compte; `/api/mail/events` exposa SSE; el frontend (`MailList.jsx`) s'hi subscriu i fa stale-while-revalidate.

Limitació "publicar l'app a Google Cloud":
- ✅ Guia: `docs/dev_memory/directives/publish_google_app.md`.
- ✅ Health endpoint: `GET /api/auth/google/health` retorna `app_status: testing-likely | healthy | unknown` segons heurística (basada en `last_refresh_error` als comptes).
- ✅ Telemetria: `_record_refresh_outcome` desa `last_refresh_error` i `last_refresh_success_at` als comptes per al diagnòstic.

## 10. Threading (X-GM-THRID)

- `imap_list_messages` i `imap_get_message` fetch-en `X-GM-THRID` quan el compte és Gmail (`is_imap_oauth_account`).
- El `thread_id` de cada missatge usa el `gm_thrid` numèric quan està disponible, o el `Message-ID` com a fallback per servidors no-Gmail.
- `/api/mail/threads/{id}` cerca a "All Mail" amb `X-GM-THRID <thrid>` per agrupar tots els missatges del thread (INBOX + SENT).

## 11. Push (IMAP IDLE)

Arquitectura:
- `ImapIdleManager` singleton al backend.
- Un worker thread per compte IMAP-eligible.
- Cada worker manté `IDLE` durant 28 min, després envia `DONE` i renova.
- Reconnexió amb backoff exponencial si la xarxa cau.
- Events `EXISTS`/`EXPUNGE`/`FETCH` es publiquen a una cua interna; els clients SSE es subscriuen.

Limitacions de la implementació actual:
- Servidor sense capacitat IDLE: el worker es tanca silenciosament. Caldria fallback a polling.
- Tokens XOAUTH2 caducats al mig de la sessió IDLE: actualment es detecta pel timeout del proper read; al pròxim cicle de reconnexió `_connect` reb força refresh.
- Concurrència: el `_connect` context manager fa `logout()` al sortir, així que el worker manté la connexió només durant la `_idle_session`. Cal investigar si això és correcte: pot ser que `with imap_sync_service._connect(...)` perdi la connexió massa aviat. Si veiem desconnexions freqüents, refactorant a no-context-manager.

