# Directiva: Imatges enganxades al compositor de correu → adjunts inline (CID)

## Context / Problema

Al compositor de Gnosi (`MailComposer.jsx` + `MailBlockEditor.jsx`, BlockNote
0.51), enganxar o arrossegar una imatge la puja al vault
(`POST /api/vault/assets/upload`) i insereix un bloc imatge amb URL relativa
`/api/vault/assets/...`. Aquesta URL **només resol dins del Gnosi local**: el
cos s'envia tal qual i el destinatari rep `<img src="/api/vault/assets/...">`
→ imatge trencada.

Dos problemes germans descoberts al mateix flux:

1. **Paste de fitxers no-imatge** (p. ex. un PDF copiat del Finder): el
   `uploadFile` de BlockNote el puja a `Assets/Files` i insereix un enllaç al
   vault → el destinatari rep un enllaç trencat en lloc d'un adjunt real. El
   `handleDrop` ja ho feia bé (desvia no-imatges a `onAttachFile`); el paste no.
2. **Comptes Microsoft**: `microsoft_send_message` ni tan sols acceptava
   adjunts — el paràmetre no existia i `send_mail` no els hi passava. Tots els
   adjunts es perdien en silenci per a comptes Graph.

## Decisió de disseny

Convertir en **enviar** (no en editar): dins l'app la URL del vault és la
correcta (preview, drafts); només al moment de construir el MIME es
substitueixen les referències per **adjunts inline amb Content-ID** (`cid:`).

- Es descarta el data-URI: Gmail i Outlook els eliminen o bloquegen al cos
  HTML; el CID és l'únic mecanisme fiable entre clients. (El data-URI queda
  com a possible fallback futur per a clients que no suportin multipart.)
- La conversió viu al **backend** (servei `backend/services/mail_inline_images.py`),
  no al frontend: així cobreix totes les entrades (composer nou, reply/forward,
  drafts reenviats, signatures amb logo del vault) sense duplicar lògica, i el
  backend té accés directe als fitxers d'Assets.

## Abast del fix

1. **Servei nou** `backend/services/mail_inline_images.py`:
   - Extracció: troba atributs `src` que apuntin a `/api/vault/assets/<rel>`
     (relatius o absoluts amb host), llegeix el fitxer d'`Assets/` del vault
     actiu, substitueix el `src` per `cid:<id-únic>` i retorna la llista
     d'adjunts inline (filename, content_type, data, content_id).
   - Builder MIME compartit: text → embolcall `multipart/related` si hi ha
     inline → embolcall `multipart/mixed` si hi ha adjunts normals. El fan
     servir Gmail (nou + reply) i SMTP/IMAP per no triplicar l'estructura.
2. **Rutes** (`api/mail_routes.py`): `send_mail` i `reply_message` criden
   l'extracció sobre el cos abans de despatxar i passen els inline al servei
   corresponent.
3. **Serveis d'enviament**:
   - `google_mail_service`: `send_new_message_with_attachments` i `send_reply`
     accepten `inline_images` i usen el builder compartit.
   - `imap_mail_sync_service.imap_smtp_send`: ídem.
   - `microsoft_mail_service`: `microsoft_send_message` i
     `microsoft_reply_message` accepten `attachments` + `inline_images` i els
     mapen a `fileAttachment` de Graph (`contentBytes` b64, `isInline`,
     `contentId`). `send_mail` ara els hi passa (abans es perdien).
4. **Frontend** (`MailBlockEditor.jsx`): intercepció del paste en **fase de
   captura** (abans que ProseMirror/BlockNote), mirall del `handleDrop`:
   imatges → pujar al vault + bloc imatge; no-imatges → `onAttachFile` + toast.
   Guard addicional dins `uploadFile` per als camins residuals de BlockNote
   (menú slash «File»): si no és imatge i hi ha `onAttachFile`, desviar i
   avortar la inserció.

## Restriccions / Edge cases

- **No interceptar pastes amb `text/html`**: copiar contingut ric (Word, web)
  posa al clipboard html + una imatge renderitzada; cal deixar que BlockNote
  enganxi l'html (les imatges remotes https són vàlides per correu). Només
  s'intercepta quan hi ha fitxers i NO hi ha `text/html` (captures de
  pantalla, fitxers del Finder).
- **Contenció de paths**: l'extracció ha de resoldre `<rel>` sota `Assets/` i
  rebutjar traversal (`..`); si el fitxer no existeix o no es pot llegir, es
  deixa la URL intacta (mai bloquejar l'enviament per un asset perdut) i es
  logueja warning.
- **Només imatges**: si el content-type resolt no és `image/*`, no es converteix
  (un `<a href>` a un PDF del vault no és un `src`; i un `src` no-imatge no té
  sentit com a inline).
- **OneDrive online-only**: llegir bytes d'un fitxer dataless dins Docker pot
  retornar 0 bytes o EDEADLK (vegeu directives del warmup). Els assets acabats
  de pujar són materials; per a cossos vells, si la lectura retorna 0 bytes es
  tracta com a «no llegible» (URL intacta + warning), mai bloquejar.
- **Dedup**: la mateixa URL repetida al cos ha de generar UN sol adjunt i
  reutilitzar el mateix CID.
- **Drafts**: es desen amb URL de vault (correcte: es previsualitzen dins
  Gnosi). La conversió només passa a `/send` i `/reply`. Un draft sincronitzat
  a Gmail i enviat des de la UI de Gmail seguiria trencat — limitació
  coneguda, fora d'abast.
- **`cid:` aliens**: el `quotedHtml` d'un reply pot portar `cid:` del missatge
  original (sense part inline corresponent al nou correu) — problema
  preexistent, fora d'abast d'aquesta directiva.
- **Charset**: el builder força `utf-8` al `MIMEText` (l'IMAP ja ho feia;
  Gmail confiava en l'autodetecció de Python).

## Pla de test

1. **Unitat (dins Docker)**: `docker exec gnosi_backend python -m pytest
   backend/tests/test_mail_inline_images.py -v` — extracció (relatiu, absolut,
   URL-encoded, duplicats, fitxer absent, traversal, no-imatge) i estructura
   MIME (related / mixed(related) / Content-ID / Content-Disposition inline).
2. **MIME real**: script de sandbox que construeix el missatge complet amb un
   PNG real del vault i el mostra — verificar que el cos no conté cap
   `/api/vault/assets/` i que cada `cid:` té la seva part.
3. **Build**: `npm run build` del frontend sense errors.
4. **Browser**: enganxar al composer (a) una captura → bloc imatge; (b) un
   fitxer no-imatge → badge d'adjunt, sense bloc trencat.
5. **Enviament real**: correu a un mateix amb imatge enganxada i revisar el
   MIME rebut. ATENCIÓ: només possible al Mac que té `secrets/integrations.json`
   (no sincronitza entre màquines — vegeu memòria d'integracions buides).

## Aprenentatges de la implementació (2026-06-10)

- **curl i formularis amb HTML**: `-F 'body=<p>…'` interpreta `<` com a
  «llegeix d'un fitxer» (exit 26). Per provar `/api/mail/send` amb cossos
  HTML cal `--form-string`.
- **Playwright + toasts**: el toast «Adjuntat: X» i el badge comparteixen el
  nom del fitxer → `getByText` sense `exact: true` peta per strict mode.
- **Paste sintètic**: a Chromium es pot simular el paste amb
  `new ClipboardEvent('paste', { clipboardData: new DataTransfer()… })`
  despatxat sobre el contenteditable; el capture de React el rep.
- **Test E2E del paste**: el spec `e2e/tests/e2e/mail-composer-paste.spec.ts`
  mockeja `/api/vault/assets/upload` amb `page.route` per no escriure al
  vault real (OneDrive) a cada run; el camí de pujada real el cobreix
  `pipeline/sandbox/verify_mail_inline_mime.py`.
- **/send sense compte**: la conversió s'executa ABANS de resoldre el compte;
  un POST sense compte vàlid retorna el 500 controlat «Error sending email»
  havent passat ja per l'extracció (útil com a smoke en Macs sense
  `integrations.json`).

## Estat de verificació (2026-06-10, Mac ismaelgarcia)

- Unitat: 14/14 verds dins Docker.
- Sandbox MIME: estructura `mixed(related(html+png amb Content-ID), pdf)`,
  cos sense URLs locals, utf-8 intacte, asset de prova netejat.
- Build frontend: net (només l'avís preexistent de mida de chunks).
- Playwright: imatge → bloc inline; PDF → badge d'adjunt sense enllaç al cos.
- **Pendents** (necessiten el Mac amb comptes): pla de test #5 (enviament
  real a un mateix per Gmail/IMAP/Microsoft i revisió del MIME rebut).
