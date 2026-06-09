# Directiva: Publicar a XXSS amb IA (skill `publish_social`)

> **Estat:** Fase 0 IMPLEMENTADA (pendent QA E2E al navegador) — 2026-06-09
> **Visió mare:** [`gnosi_publisher.md`](gnosi_publisher.md) (capa "Social Media distribution")
> **Patró de referència:** [`translate_row_skill.md`](translate_row_skill.md) i [`drupal_content_sync.md`](drupal_content_sync.md)
> **Decisions preses (usuari, 2026-06-09):** arquitectura **híbrida** · **totes** les xarxes (per fases) · **tots dos** disparadors (registre del Vault + publicació lliure)

## 1. Objectiu i abast

Afegir una acció **"Publicar a XXSS"** al costat de "Traduir" i "Sincronitzar". El sistema, **amb IA**, proposa un missatge **adaptat a cada xarxa** seleccionada; l'usuari **aprova/edita/regenera** cada proposta i, en confirmar, es **publica** i queda **registrada** com a fila d'una taula del Vault.

- **Objectiu principal:** convertir un contingut (registre del Vault o text lliure) en publicacions adaptades per xarxa, amb pas d'aprovació humà i publicació real.
- **Criteri d'èxit (Fase 0):** des d'un registre del Vault, generar propostes per Mastodon i Bluesky, editar-les, publicar-les de veritat, i veure la publicació enregistrada a la taula "Publicacions Socials" amb les URLs resultants. Sobreviu a un reinici del backend.

## 2. Estat actual (reaprofitament) — NO partim de zero

| Ja existeix i s'aprofita | Fitxer | Estat |
|---|---|---|
| `MastodonClient.post_status()` / `BlueskyClient.create_post()` | `backend/services/social_clients.py` | ✅ funcionals (només text) |
| Lectura de feeds, like, reblog | `backend/services/social_clients.py` | ✅ |
| Config de xarxes i streams (`/networks`, `/streams`) | `backend/api/social_routes.py` | ✅ |
| `/feed`, `/interact` | `backend/api/social_routes.py` | ✅ |
| `SOCIAL_NETWORK_DEFAULTS` a Settings | `frontend/src/components/GlobalSettingsModal.jsx` | ✅ |
| Scheduler (APScheduler) | `backend/scheduler/manager.py` | ✅ (sense tasca social) |
| Keychain per a credencials | `backend/security/keychain_manager.py` | ✅ |
| Capa IA amb fallback | `pipeline/ai_client.py` (`call_ai_with_fallback`) + `backend/agent/factory.py` (`get_llm`) | ✅ |

| A reparar / construir | Fitxer | Problema |
|---|---|---|
| `POST /api/social/post` | `social_routes.py:312` | **501** — depenia de n8n (eliminat). Reescriure cridant els clients. |
| `/schedule`, `/history`, `/process-scheduled` | `social_routes.py` | persisteixen en **arrays en memòria** (`SCHEDULED_POSTS`, `POST_HISTORY`) → es perden a cada reinici |
| Execució de programades | — | **cap cron** crida `process-scheduled` |
| Adaptació per xarxa | — | `CreatePostRequest` envia **el mateix text** a totes; sense IA |
| Pas d'aprovació | — | no existeix |
| Clients LinkedIn/FB/IG/X | — | no existeixen (només al config) |
| Publicació amb imatge | `social_clients.py` | els clients només envien text |

> **Nota:** `publisher/SKILL.md` esmenta `broadcast_social.py` i `sync_vault_to_drupal.py`, però **aquests scripts no existeixen** (vaporware). La sincronització Drupal real viu a `backend/services/drupal_sync_service.py`. Aquesta directiva substitueix la idea de `broadcast_social.py`.

## 3. Arquitectura proposada (híbrida)

El **flux** és el "pla B" (directe amb IA i aprovació); la **persistència** és el "pla A" (taula del Vault), però com a **output/log**, no com a entrada manual. Resol, de passada, la persistència en memòria actual.

```
[Registre del Vault]  ──"Publicar a XXSS"──┐         ┌── [Botó "Nova publicació"] (lliure)
 (títol, contingut, imatge, id)            │         │
                                           ▼         ▼
                              ┌─────────────────────────────────┐
                              │  PublishSocialModal              │
                              │  ① tria xarxes (de les actives)  │
                              │  ② POST /api/social/compose  ────┼──► IA per xarxa
                              │     → {mastodon:{text,...}, …}   │    (límit, to, #tags, idioma)
                              │  ③ targetes editables:           │
                              │     editar / regenerar 1 / media │
                              │  ④ "Publicar ara" | "Programar"  │
                              └───────────────┬─────────────────┘
                                              ▼
                  POST /api/social/publish  (o /schedule)
                                              ▼
              clients de xarxa  +  fila a taula "Publicacions Socials"
              (estat, missatge/url per xarxa, dates, errors)
```

**Principi clau: separar `compose` (generar, no publica) de `publish` (publica de veritat).** Permet el pas d'aprovació i la regeneració individual sense efectes col·laterals.

## 4. Components

| Capa | Fitxer | Rol |
|------|--------|-----|
| Frontend | `frontend/src/components/Vault/PublishSocialModal.jsx` *(nou)* | Selecció de xarxes + targetes editables + publicar/programar |
| Frontend | `frontend/src/components/Vault/VaultTable.jsx` | Botó de fila "Publicar a XXSS" via flag `social_publish_enabled` (com `translatable`) |
| Frontend | `frontend/src/components/Vault/SchemaConfigModal.jsx` | Toggle "Publicable a XXSS" per taula |
| Frontend | secció social existent (streams) + `GlobalSettingsModal.jsx` | Botó "Nova publicació" + paràmetres per xarxa i connexió OAuth |
| Backend | `backend/api/social_routes.py` | `compose` (nou), `publish` (reescriu `/post`), `schedule`/`history` a disc |
| Backend | `backend/services/social_compose.py` *(nou)* | Construcció de prompt per xarxa + crida IA |
| Backend | `backend/services/social_clients.py` | + clients LinkedIn/FB/IG/X + suport media; registry `SOCIAL_PUBLISHERS` |
| Backend | `backend/services/social_store.py` *(nou)* | Persistència de publicacions a la taula del Vault (substitueix arrays en memòria) |
| Backend | `backend/scheduler/manager.py` | Tasca `publish_scheduled_social` (interval 1–5 min) |
| Backend | `backend/api/credentials_routes.py` | Afegir noves xarxes a `CREDENTIAL_INFO` |
| Skill | `pipeline/skills/publisher/scripts/compose_social.py` *(nou)* | Funció pura de generació (consolidació futura) |

## 5. Contractes d'endpoints (I/O)

```
POST /api/social/compose            (NOU — no publica)
  in : { source_text, source_title?, source_url?, source_page_id?,
         networks:[...], regenerate_only?:[...], user_hint? }
  out: { proposals: { <network>: { text, hashtags:[...], char_count,
                                   over_limit:bool, media_suggested?:[...] } },
         provider }

POST /api/social/publish            (REESCRIU el /post mort, sense n8n)
  in : { posts: { <network>: { text, media?:[...] } },
         source_page_id?, save_record?:true }
  out: { record_id, results: { <network>: { status, url?, error? } } }

POST /api/social/schedule           (MODIFICA — desa a disc, no en memòria)
  in : { posts: {...}, scheduled_time, source_page_id? }
  out: { record_id, scheduled_time }

GET  /api/social/scheduled | /history    → llegeixen de la taula del Vault
POST /api/social/process-scheduled       → cridat pel scheduler; publica vençudes
```

## 6. Model de la taula "Publicacions Socials" (esquema FIX)

Es crea automàticament la primera vegada (patró de subitems de `translate_row`). **Les xarxes són dades, no columnes** (evita migracions d'esquema en afegir xarxes).

| Camp | Tipus | Contingut |
|---|---|---|
| `Títol` | title | autogenerat (origen o primeres paraules) |
| `Estat` | select | `esborrany` · `programada` · `publicant` · `publicada` · `parcial` · `error` |
| `Xarxes` | multi-select | `mastodon`, `bluesky`, `linkedin`, `facebook`, `instagram`, `x` |
| `Origen` | relation→registre / `URL origen` text | enllaç al contingut font (si n'hi ha) |
| `Missatges` | estructurat (frontmatter JSON) | `{ <network>: { text, url_publicat, error } }` |
| `Programada per` | date | quan està en estat `programada` |
| `Publicada el` | date | timestamp de publicació efectiva |
| `Mètriques` | estructurat | *(Fase 4)* likes/reposts/replies per xarxa |

Es desa com a Markdown + frontmatter (coherent amb tot el Vault). El cos pot guardar el contingut origen.

## 7. Clients de xarxes (interfície uniforme + credencials)

Interfície comuna perquè `compose`/`publish` iterin sense `if` per xarxa:

```
class SocialPublisher:  # contracte
    network: str
    char_limit: int
    async def publish(self, text: str, media: list | None = None) -> dict  # {url}
    def is_configured(self) -> bool

SOCIAL_PUBLISHERS = { "mastodon": ..., "bluesky": ..., "linkedin": ..., ... }
```

| Xarxa | Auth | On es guarda | Notes |
|---|---|---|---|
| Mastodon | Bearer token | env/keychain (`TEMENOS_MASTODON_BEARER`) | ✅ ja |
| Bluesky | handle + app password | env/keychain | ✅ ja |
| LinkedIn | OAuth2 | `integrations.json` (com Google) + keychain | aprovació d'app |
| Facebook / Instagram | OAuth2 (Meta Graph) | `integrations.json` + keychain | IG només comptes *business* |
| X / Twitter | OAuth2 | `integrations.json` + keychain | **API de pagament** |

Model OAuth a seguir: `backend/api/google_auth_routes.py` + `backend/services/oauth2_helpers.py` (refresc de tokens).

## 8. Capa IA (`compose`)

- **Un prompt per xarxa** (millor control de to/límit i regeneració individual) que rep: contingut origen + paràmetres de la xarxa (límit de caràcters, to/veu, hashtags per defecte, idioma) provinents de la config `/networks`.
- **Proveïdor:** usa la capa existent (`call_ai_with_fallback` o `get_llm`). **Recomanat Anthropic/Claude** per qualitat de copy; ha de funcionar amb el fallback per defecte (Ollama→Groq) si Claude no està configurat.
- **Sortida validada:** retalla a límit, marca `over_limit`, separa hashtags. Mai publica des de `compose`.
- Quan es toqui la crida real a Claude, **consultar la skill `claude-api`** (model id, params) abans d'escriure-la.

## 9. Fases d'implementació

> "Totes les xarxes" és l'objectiu; el disseny és uniforme des de l'inici, però l'entrega és esglaonada perquè cada OAuth és feina real. La Fase 0 ja publica de veritat.

- **Fase 0 — Fonament (MVP real):** `compose` + `publish` (reescriu `/post`) + taula del Vault + scheduler + `PublishSocialModal` + tots dos disparadors. Xarxes: **Mastodon + Bluesky** (ja funcionen). + suport imatge bàsic.
- **Fase 1 — LinkedIn** (OAuth2).
- **Fase 2 — Meta** (Facebook + Instagram business, Graph API).
- **Fase 3 — X/Twitter** (OAuth2; **avisar del cost** de l'API).
- **Fase 4 — Mètriques** de tornada a la taula (likes/reposts) + analítica.

## 10. Restriccions / edge cases (previstos)

- **`compose` mai publica.** Separació estricta compose/publish.
- **Persistència a disc, no en memòria** — eliminar `SCHEDULED_POSTS`/`POST_HISTORY` globals; tot a la taula del Vault.
- **Publicació parcial:** si una xarxa falla i una altra reïx → estat `parcial`, mai es perd el que sí s'ha publicat; reintent per xarxa fallida.
- **Idempotència:** desar `url_publicat` per xarxa abans de marcar `publicada`; un reintent no ha de duplicar posts ja fets.
- **Límits de caràcters** per xarxa (Mastodon ~500, Bluesky ~300, X ~280…) validats a `compose` i a la UI.
- **Backend mount HOME ro:** escriure la taula dins el contenidor via `/vault` (rw), no via ruta host (regla [`backend_home_mount_ro`]).
- **Acció destructiva = confirmació:** cap publicació/eliminació a la 1a pulsació; `ConfirmModal` (regla d'accessibilitat de l'usuari).
- **QA segur:** no publicar de veritat durant proves; usar comptes de prova o interceptar `/publish` (regla QA de persistència).
- **OAuth d'X:** API de pagament — confirmar amb l'usuari abans d'invertir-hi temps.

## 11. QA / verificació (gates)

- **Build:** `npm run build` (frontend) + `docker-compose up -d` (backend), zero errors.
- **E2E Fase 0:** des d'un registre → compose (veure propostes) → editar → publicar a Mastodon/Bluesky de prova → confirmar URLs a la taula → reiniciar backend → la fila persisteix.
- **Programació:** crear una programada a +2 min, confirmar que el scheduler la publica sola.

## 12. Decisions obertes (per validar amb l'usuari)

- Compte(s) reals de cada xarxa per a proves (o quedem en comptes de test a la Fase 0).
- Idioma per defecte del copy generat (CA? mateix idioma del contingut origen?).
- "Missatges" com a camp estructurat dins una fila (recomanat) vs files filles per xarxa.
- Prioritat d'X donat el cost de l'API.

## 13. Estat d'implementació (2026-06-09)

**Fitxers (branca `claude/kind-kare-5ad5a2`):**
- Backend nous: `services/social_compose.py`, `services/social_store.py`.
- Backend modificats: `services/social_clients.py`, `api/social_routes.py`, `scheduler/manager.py`.
- Frontend nou: `components/Vault/PublishSocialModal.jsx`.
- Frontend modificats: `components/Vault/VaultTable.jsx`, `components/Vault/SchemaConfigModal.jsx`, `pages/SocialDashboard.jsx`.

**Validat sense desplegar:** `npm run build` net (5450 mòduls, 0 errors); `py_compile` dels 5 fitxers backend; símbols externs consumits existeixen al container (vault_routes, integration_manager, ai_client, detect_source_lang); funcions pures de `social_compose` (prompt, neteja, hashtags) OK.

**Pendent (requereix codi a ~/Projectes):** E2E per HTTP — `/compose` amb IA real, `/publish` escrivint la fila a la taula, prova al navegador. Es farà després del merge.

**Lliçons / notes:**
- **Config IA i context:** `pipeline/ai_client.call_ai_with_fallback` resol `model_url` només amb context de request (vault actiu). Un `python -c` aïllat dóna `model_url=None` → `/compose` s'ha de provar via HTTP a l'app, no en scripts. (El mateix client ja l'usa mail amb èxit en runtime.)
- **Entorn:** el container `gnosi_backend` i el dev server llegeixen `~/Projectes/monorepo`, **no el worktree**. El codi backend del worktree no es pot provar al container sense desplegar (mount = host). Build del frontend al worktree via symlink de `node_modules` (regla `worktree_build_symlink`).
- **Media:** la interfície `publish(text, media)` als clients està llesta (Mastodon `/api/v2/media`, Bluesky `uploadBlob`+embed), però la **resolució automàtica d'imatges del registre del Vault** (camp imatge compost → ruta local) queda per a una iteració posterior; el modal de Fase 0 publica text.
- **Botó lliure:** reaprofita `SocialDashboard` existent (botó "Amb IA" obre el modal amb `noteId=null`). El `Composer` simple existent torna a funcionar perquè `/post` ja no és 501.
- **Taula d'historial:** tipus de columna deliberadament segurs (title/text/date); promovibles a select/multi-select des de la UI sense trencar res.
- **Tokens:** Mastodon/Bluesky es llegeixen de l'env (`TEMENOS_MASTODON_BEARER`, `TEMENOS_BLUESKY_HANDLE`/`_APP_PASSWORD`). Si una xarxa no està configurada, `/publish` torna estat `error` per aquella xarxa però desa igualment el registre (no peta).
