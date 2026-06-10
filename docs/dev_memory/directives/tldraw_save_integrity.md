# Directive: Integritat del desat de dibuixos (TldrawEditor)

> ID: 2026-06-10 · Estat: ACTIVE
> Fitxers: `frontend/src/components/Vault/TldrawEditor.jsx` · `frontend/src/pages/VaultDashboard.jsx` · `backend/api/vault_routes.py` (rutes `/drawings`)
> Relacionades: [excalidraw_integration.md](excalidraw_integration.md) (MVP original) · [async_event_loop_vault_io.md](async_event_loop_vault_io.md) (IO del vault dins handlers async)

## 1. Risc cobert (pèrdua de dades)

Un editor amb autosave que NO distingeix "no he pogut carregar" de "dibuix nou"
acaba sobreescrivint el fitxer real amb un llenç buit. Tres camins reals:

1. **GET `/api/vault/drawings/{id}` falla** (500 per fitxer online-only de
   OneDrive, backend a mig arrencar, error de xarxa): el `catch` tractava
   QUALSEVOL error com a "dibuix nou encara no existeix" → llenç buit +
   autosave d'1 s → PUT destructiu sobre el fitxer real.
2. **Dibuix legacy `.excalidraw.json`**: el GET retorna el JSON d'Excalidraw
   tal qual; `loadSnapshot` de tldraw v3 NO llança error amb objectes sense
   claus `store`/`document`/`session` — és un **no-op silenciós** → llenç buit
   → el PUT crea un `.tldraw.json` buit que **eclipsa** el legacy (el backend
   prioritza `.tldraw.json` tant al GET com a la llista).
3. **Reutilització del component entre pestanyes**: VaultDashboard renderitzava
   TldrawEditor sense `key`; canviar de pestanya reutilitzava el mateix
   `TLStore`, i si el GET del dibuix següent fallava o feia 404, el contingut
   del dibuix ANTERIOR quedava al store → l'autosave el desava sota l'id nou.

## 2. Regles (com està arreglat)

- **Front — estat de càrrega explícit** (`loading | ready | error |
  incompatible`). El desat (autosave i Ctrl+S) NOMÉS és possible a `ready`.
  - 404 del GET ⇒ `ready` (dibuix nou legítim: el dashboard crea el fitxer amb
    un PUT de data buida abans d'obrir l'editor; el 404 només passa si el
    fitxer s'ha esborrat — no hi ha res a destruir).
  - Qualsevol altre error del GET ⇒ `error`: overlay amb "Torna-ho a provar" i
    desat bloquejat.
  - 200 amb data que NO és snapshot de tldraw (objecte amb claus però sense
    `store`/`document`/`session`, o que no és objecte) ⇒ `incompatible`:
    overlay i desat bloquejat. Un objecte BUIT `{}` sí que és vàlid — és el
    `data` inicial que crea el dashboard en fer un dibuix nou.
  - `loadSnapshot` embolcallat amb try/catch: si llança (migració d'esquema
    fallida) ⇒ `incompatible`.
- **Front — autosave filtrat**: `store.listen` amb `scope: 'document'` i
  `source: 'user'`. Càmera/selecció són scope `session` i ja no programen PUTs.
- **Front — `key={drawingId}`** al `<TldrawEditor>` del dashboard: cada dibuix
  té el seu propi `TLStore`; mai contingut creuat entre pestanyes.
- **Back — backup abans de sobreescriure**: el PUT `/drawings/{id}` copia el
  fitxer existent a `VAULT/.history/{id}/{timestamp}.tldraw.json` abans
  d'escriure, amb cooldown de 10 min (mateix patró que `_create_page_version`).
  Tota la IO va dins `asyncio.to_thread` (vegeu async_event_loop_vault_io.md).

## 3. Restriccions / Edge cases

- **Do not**: NO tractar un error de càrrega com a llenç nou → causa un PUT
  destructiu → usa l'estat explícit i bloqueja el desat fins a `ready`.
- `loadSnapshot` NO valida el format: amb un objecte desconegut simplement no
  fa res (cap excepció). Cal validar les claus (`store` | `document` |
  `session` | objecte buit) ABANS de cridar-lo; el try/catch sol no protegeix.
- El cooldown de 10 min implica que, en edició activa, la darrera versió de
  `.history` pot anar fins a 10 min enrere — pèrdua màxima acceptada (idèntic
  a les versions de pàgines). A canvi, el cooldown evita que un client trencat
  que desa en bucle clobberi el backup bo amb versions buides.
- La còpia a `.history` d'un fitxer online-only de OneDrive pot trigar
  (materialització); per això va dins `to_thread` i mai a l'event loop.
- El backend continua acceptant PUTs de clients antics: el backup és l'última
  línia de defensa, no substitueix les proteccions del front.
- Els dibuixos legacy `.excalidraw.json` queden en mode només-lectura
  bloquejada (overlay): tldraw no els pot renderitzar. Migrar-los és feina a
  part; mentre no es migrin, l'important és NO eclipsar-los.

## 4. Verificació (E2E)

- `e2e/tests/e2e/drawing-save-guard.spec.ts`:
  - GET 500 ⇒ overlay d'error i CAP PUT en 3 s.
  - GET amb JSON d'Excalidraw ⇒ overlay d'incompatible i CAP PUT.
  - GET `{}` (dibuix nou) ⇒ pan/zoom NO dispara cap PUT; dibuixar un traç
    dispara un PUT amb shapes al snapshot.
- Backend: dos PUTs consecutius sobre un dibuix de prova creen UNA versió a
  `VAULT/.history/{id}/` amb el contingut previ al segon PUT.

## 5. Error Protocol / Memòria viva

| Data | Error | Causa arrel | Patch |
|---|---|---|---|
| 2026-06-10 | Dibuixos del vault sobreescrits amb llenç buit | `catch` del GET tractava 500 com a dibuix nou; autosave sense filtre de scope; `loadSnapshot` no-op silenciós amb formats legacy; component sense `key` entre pestanyes | Estats de càrrega + gating del desat + `scope: document` + `key={drawingId}` + backup `.history` al PUT |
