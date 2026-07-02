# Directiva: Reconeixement d'escriptura a mà (ink → text) al canvas

**Objectiu:** convertir els traços manuscrits del canvas de dibuix (Tldraw) en
text, i millorar l'entrada amb llapis (palm rejection). Tot LOCAL, sense núvol,
coherent amb el vault offline-first.

## Arquitectura

- **Backend**
  - `backend/services/handwriting.py` — motor TrOCR (transformers) singleton lazy,
    CPU. Cache a `GNOSI_LOCAL_DATA/cache/trocr` (mai OneDrive). Segmentació simple
    per projecció horitzontal (TrOCR és mono-línia → partim en línies).
  - `backend/api/handwriting_routes.py` — `POST /api/vault/handwriting/recognize`
    (multipart `image` PNG → `{text, lines, model}`) i `GET .../status`.
  - Registrat a `server.py` (`include_router(handwriting_routes.router)`, el router
    ja porta el prefix `/api/vault/handwriting`).
- **Frontend** — `components/Vault/TldrawEditor.jsx`:
  - Botó **"Passar a text"**: exporta els shapes seleccionats (o tot el llenç) amb
    `editor.toImage(ids, { format:'png', background:true, darkMode:false })` i POST
    a l'endpoint; insereix el text reconegut com a shape `text` sota els traços.
  - Toggle **"Només llapis"** (palm rejection): bloqueja `pointerType==='touch'` en
    fase de captura al wrapper → el palmell no dibuixa; llapis/ratolí sí.

## Restriccions / Edge cases (apreses)

- **NO usar núvol.** TrOCR local encara que sigui pitjor: el vault és privat. Model
  configurable via env `GNOSI_TROCR_MODEL` o `ai.handwriting.model` a params.yaml.
- **TrOCR és ANGLÈS.** `microsoft/trocr-base-handwritten` va entrenat en anglès →
  en català/castellà encerta la forma però falla accents/dígrafs. És "de notes".
  No prometre transcripció perfecta. `-large-` millora però és MOLT lent en Intel.
- **CPU + torch 2.2.2 (Mac Intel):** lent (segons per línia). Per això:
  - Cap de línies a `_MAX_LINES=40` per no encallar la CPU amb un llenç enorme.
  - `recognize` corre a `asyncio.to_thread` (bloqueja: fora de l'event loop).
  - Export amb `background:true` + `darkMode:false` → fons blanc (TrOCR espera
    document fosc sobre blanc; amb fons transparent/fosc el resultat és brossa).
- **1a crida baixa el model (~1.3 GB).** Trigarà; el frontend ha de mostrar estat
  "Reconeixent…". No és penjada.
- **Backend SENSE --reload** (LaunchAgent): després de tocar codi backend cal
  `launchctl kickstart -k gui/$UID/com.gnosi.backend` (cf. memòria
  `backend_no_autoreload`). Endpoint nou = 404 fins a reiniciar.
- **Palm rejection** bloqueja també el pan/zoom amb dos dits mentre està actiu:
  és esperat (mode "només llapis"). És un toggle, off per defecte.
- La pressió del llapis (gruix variable) JA la fa Tldraw de forma nativa; no cal
  afegir res per això.

## Verificació

- `GET /api/vault/handwriting/status` → `{available:true, model:...}`.
- `POST .../recognize` amb un PNG → `{text, lines, model}`.
- Build frontend net (`npm run build`).
