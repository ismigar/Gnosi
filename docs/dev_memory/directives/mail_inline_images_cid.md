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
- **`cid:` aliens**: el `quotedHtml` d'un reply porta `cid:` del missatge
  original (sense part inline corresponent al nou correu) — cobert per
  l'extensió «Citat amb imatges inline» (vegeu secció pròpia més avall).
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

## Extensió: citat amb imatges inline en reply/forward (2026-06-10)

### Problema

En respondre/reenviar un correu que tenia imatges inline (`cid:`), el
`quotedHtml` (construït per `MailViewer.buildQuotedHtml` a partir del
`body_html` sanititzat) conservava els `src="cid:xxx"` del missatge ORIGINAL.
Al correu nou aquests cid no tenen part MIME → el destinatari rebia el citat
amb les imatges trencades. La reescriptura cid → URL de l'endpoint `/cid/`
només s'aplicava a la vista (iframe de MailBody), no al citat.

### Descobriment clau (canvia el disseny)

**BlockNote (0.51) DESCARTA els `<img src="cid:...">`** en fer
`tryParseHTMLToBlocks` → la imatge citada ni tan sols arribava al backend:
desapareixia de la resposta en silenci. I **el contingut no-inline dins d'un
`<blockquote>` també es perd** (el bloc quote només admet contingut inline:
ni imatges ni taules). Conseqüències:

1. No n'hi ha prou amb resoldre `cid:` residuals al backend: el cos que envia
   el composer ja no els porta. Cal que el citat referenciï les imatges d'una
   manera que BlockNote conservi.
2. El composer ja NO embolcalla el citat amb `<blockquote>` (estil Outlook:
   capçalera From/Date/Subject + `<hr>` com a divisor). Si es reintrodueix,
   les imatges i taules del citat es tornaran a perdre.

### Decisió de disseny

- `buildQuotedHtml` reescriu `src="cid:X"` → URL **autocontinguda** de
  l'endpoint existent `/api/mail/messages/{id}/cid/{X}?email=..&folder=..`
  (la mateixa que usa l'iframe del viewer). Beneficis: BlockNote la conserva,
  el composer MOSTRA la imatge citada, i la URL porta tot el context
  (missatge, cid, compte, carpeta) — també funciona per a drafts represos
  que s'envien per `/send` sense cap context del missatge original.
- En enviar (`/send` i `/reply`), el backend detecta aquests `src` de
  `/api/mail/.../cid/`, recupera els bytes del missatge original (un sol
  fetch per missatge: IMAP raw / Gmail API / Microsoft Graph), els adjunta
  com a parts inline pròpies amb Content-ID nou i reescriu el cos. Mateix
  collector que serveix l'endpoint `/cid/` (que de retruc ara cobreix
  Microsoft, abans no).
- Fallback: els `src="cid:X"` crus que arribin igualment (cossos generats
  fora del viewer) es resolen contra el missatge que es respon — només a
  `/reply`, on hi ha `source_message_id`; el composer hi envia també la
  carpeta IMAP d'origen (`folder=`).

### Restriccions / Edge cases

- **Mai bloquejar l'enviament**: referència irrecuperable (missatge esborrat,
  compte caigut, cid inexistent) → es deixa el `src` intacte + warning. La
  resta d'imatges del citat s'envien bé igualment.
- **L'email/folder de la URL manen** sobre els del reply: el missatge citat
  pot pertànyer a un altre compte o carpeta (p. ex. respondre des d'un àlies).
- **Agrupació**: N imatges del mateix missatge citat = 1 sol fetch (IMAP
  sobretot: el RAW sencer ja porta totes les parts).
- **Microsoft**: Graph retorna els adjunts amb `contentBytes` només per a
  `fileAttachment`; els `referenceAttachment` (OneDrive) no porten bytes i es
  deixen intactes.
- **Seguretat**: el body el controla el client, però les URLs `/cid/` només
  resolen comptes del workspace (mateix nivell d'accés que el GET `/cid/`).

### Pla de test

1. **Unitat**: `docker exec gnosi_backend python -m pytest
   backend/tests/test_mail_reply_cid.py -v` — helpers purs (find/rewrite de
   cid crus i d'URLs `/cid/`), extracció de parts d'un MIME cru, orquestració
   amb collector mockejat (URL, cru, parcial, no trobat, error de transport,
   agrupació) i mapping Graph.
2. **E2E** (`e2e/tests/e2e/mail-reply-quoted-cid.spec.ts`, tot `/api/mail`
   mockejat): obrir missatge amb cid → Respon → el composer mostra la imatge
   citada (URL `/cid/`) → enviar → el POST `/reply` porta la URL al body i
   `folder=` a la query. És l'spec que va destapar els dos descobriments de
   BlockNote (sense ell, el fix backend-only semblava correcte i era inútil).
3. **Smoke sense comptes**: POST `/reply` amb body amb `cid:` o URL `/cid/` i
   compte inexistent → warnings «queden intactes» + 500 controlat del
   transport (la conversió s'executa abans de resoldre el compte).
4. **Pendent (Mac amb comptes)**: respondre un correu real amb imatge inline
   i revisar el MIME rebut (cada `cid:` amb la seva part, cap URL `/api/`).

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
- Extensió del citat (branca `claude/mail-quoted-cid`): 23/23 unitat dins
  Docker (els 14 d'inline images segueixen verds), E2E del reply verd,
  smokes de `/reply` (cid cru i URL `/cid/`) amb warnings correctes, build
  net, eslint sense errors nous (els 13 avisos són preexistents).
- **Pendents** (necessiten el Mac amb comptes): enviament real a un mateix
  per Gmail/IMAP/Microsoft i revisió del MIME rebut — tant del cas composer
  (pla #5 original) com d'un reply amb imatge citada (extensió).
