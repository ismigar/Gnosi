# Directiva: Portabilitat d'enllaços a fitxers locals entre màquines

## Context / Problema

L'Ismael treballa des de **dues Macs amb noms d'usuari macOS diferents**
(`ismaelgarcia` i `ismaelgarciafernandez`), sincronitzant el vault per OneDrive.
Els enllaços a fitxers externs es desen al markdown amb ruta absoluta del host,
p. ex.:

```
[Història Clara](<file:///Users/ismaelgarcia/Library/CloudStorage/OneDrive-UNED/Documents/.../Història Clara.docx>)
```

El prefix `/Users/<usuari>/` és **específic de la màquina on es va inserir
l'enllaç**. En obrir el mateix .md a l'altra Mac (usuari diferent), la ruta no
existeix i l'enllaç es trenca.

Hi ha **dues capes** que poden trencar-se de forma independent (vist 2026-06-03):

1. **El helper `host_open_helper`** (obre el fitxer al host perquè el backend
   corre dins Docker). El seu LaunchAgent tenia l'usuari incrustat al plist del
   repo → a la segona Mac no arrencava → cap enllaç `file://` s'obria
   (`Could not open: ... 'xdg-open'`). Vegeu `host_open_helper/SKILL.md` i el nou
   `scripts/install_launchagent.sh` (genera el plist amb `$HOME`, sense usuari
   hardcodejat). **Aquest era el símptoma real a la Mac `ismaelgarcia`.**

2. **El backend** rep el path i, si no existeix tal qual, intenta re-arrelar-lo
   sota la màquina actual (`_reroot_attachment_under_current_host` a
   `api/vault_routes.py`). Fins ara **només cobria la carpeta `Biblioteca`**;
   els enllaços a `Documents/` (o qualsevol germana del vault) NO es re-arrelaven
   → `404 Path not found` a l'altra Mac.

## Abast del fix (causa 2 — backend)

Generalitzar `_reroot_attachment_under_current_host` perquè re-arreli **qualsevol
carpeta germana del vault**, no només Biblioteca. El tram després de l'arrel del
núvol (`.../OneDrive-UNED/`) és estable entre màquines; només canvia el prefix
(home de l'usuari macOS).

Estratègies de re-arrelament, en ordre, retornant el primer candidat que
**existeixi**:

1. **Forma servida** `/api/vault/biblioteca/<rel>` → `get_p("BIBLIOTECA")/<rel>`
   (es manté com estava — adjunts nous de biblioteca, ja portables).
2. **Arrel del núvol**: `cloud_root = get_p("BIBLIOTECA").parent`
   (= `.../OneDrive-UNED`). Si el path conté `/<cloud_root.name>/`, re-arrelar el
   tram posterior sota `cloud_root`. Cobreix `Documents/`, `Biblioteca/` i
   qualsevol germana sincronitzada.
3. **Intercanvi de home**: si el path té forma `/Users/<algú>/<resta>`,
   substituir `/Users/<algú>` pel home del host actual (derivat de
   `get_p("BIBLIOTECA")`, que dins Docker ve de `VAULT_HOST_PATH`). Cobreix
   fitxers fora del núvol (Desktop, Downloads…).

A més, integrar el re-root a `_pick_existing_path` (usat per `/open-resource`,
que serveix els adjunts de taula a VaultTable/Feed/Gallery), no només a
`/open-local-path`. Així els dos camins d'obertura es beneficien.

## Restriccions / Edge cases

- **No destructiu**: el re-root només actua com a *fallback* quan el path desat
  no existeix tal qual. Mai reescriu el .md; resol en runtime. Sempre comprova
  `candidate.exists()` abans de retornar.
- **Dins Docker** el HOME del host es munta a la mateixa ruta absoluta
  (`/host_mnt/Users/<usuari> → /Users/<usuari>`), i Biblioteca a la seva ruta
  absoluta. Per això `cloud_root` derivat de `VAULT_HOST_PATH` existeix dins el
  contenidor i `candidate.exists()` és fiable. Verificat amb `docker inspect
  gnosi_backend` (2026-06-03).
- **macOS-específic**: l'intercanvi de home assumeix `/Users/<user>`. Acceptable:
  l'ecosistema és de dues Macs. No trenca Windows/Linux perquè el regex no casa.
- **`get_p("BIBLIOTECA").parent`** és l'arrel del núvol tant dins Docker
  (via `VAULT_HOST_PATH`) com en local (via `base.parent`). No usar
  `get_active_vault_path()` (dins Docker torna `/vault`, no la ruta del host).

## Test plan

1. **CAS A (usuari actual, Documents)**: `POST /api/vault/open-local-path` amb
   `file:///Users/<actual>/.../Documents/X` → 200 (helper obre). [regressió]
2. **CAS B (altre usuari, Documents)**: mateix fitxer amb `/Users/altremac/...`
   → abans 404; després del fix ha de resoldre (200 o l'error del helper si no
   corre, que JA no és 404). **Aquest és el cas que es vol arreglar.**
3. **CAS C (altre usuari, Biblioteca)**: ha de seguir resolent (regressió del
   comportament previ).
4. **CAS D (path inexistent de veritat)**: `/Users/x/no/existeix.pdf` → 404
   (no s'ha de re-arrelar a res fals).

## Fase 2 (2026-06-10) — Escriptura portable + lectors restants

La fase 1 va arreglar la LECTURA (`/open-resource`, `/open-local-path`), però
l'ESCRIPTURA seguia generant valors no portables: `/link-existing-file`
retornava **sempre** `{path: <ruta absoluta del host>, url: None}` i el frontend
desava la ruta absoluta crua (amb `/Users/<usuari>/` de la màquina on es va fer
l'enllaç). Vist el 2026-06-09: adjunts enllaçats des d'una Mac apareixien amb
rutes de l'altre usuari, triplicats i amb noms divergents.

### Regles del valor desat (contracte nou)

`/link-existing-file` calcula un valor **portable** i el retorna a `url`
(el frontend desa `data.url || data.path`):

1. Fitxer dins **Biblioteca** → `/api/vault/biblioteca/<rel>` (re-arrelable).
2. Fitxer dins el **Vault** (forma host via `VAULT_HOST_PATH` o contenidor) →
   `/api/vault/raw/<rel>`.
3. Fitxer sota el **HOME del host** → `~/<rel>` (independent del nom d'usuari;
   les dues Macs sincronitzen el mateix OneDrive sota homes diferents).
4. Fora del HOME (`/Volumes/...`) → `url=None`, es desa la ruta absoluta
   (intrínsecament local; el re-root de lectura no hi pot fer res).

### Resolució en LECTURA del format `~/`

**Mai `Path.expanduser()` dins Docker** (HOME del contenidor = `/root`). El `~`
s'expandeix contra el HOME del host: `HOME_HOST_PATH` (docker-compose) o el home
derivat de `get_p("BIBLIOTECA")` (`/Users/<actual>/Library/...`), helper
`_host_home_path()`. Cobert a: `_reroot_attachment_under_current_host` (entrada
`~/`), `_extract_attachment_paths`, `_pick_existing_path`, `open_local_path`,
`register_local_file` (visor PDF — abans NO re-arrelava: 404 a l'altra Mac),
`delete_physical_file` (branca absoluta — abans 403/404 amb HOME aliè) i
l'entrada de `link_existing_file` (un valor vell re-enllaçat resol igualment).

### Deduplicació i noms (mateixa tanda de fixes)

- Els camps `files` dedupliquen en AFEGIR amb una clau canònica
  (`fileTargetKey` a `lib/fileResource.js`): `file://` decodificat ≡ ruta
  absoluta ≡ `~/...` ≡ `/api/vault/biblioteca/<rel>` del mateix fitxer. Sense
  això, repetir l'enllaç (idempotent al backend) afegia entrades duplicades.
- `interpolateNamePattern` honora `{Authors.cognom1}` també quan el camp
  autoria és un **string llegat** ("Ismael García Fernández" → cognom1
  "García", convenció Nom Cognom1 Cognom2 o "Cognoms, Nom"). Abans l'accessor
  s'ignorava → fitxers reanomenats/creats amb el nom complet, divergint del
  patró i dels fitxers existents (enllaços trencats als 2 registres "Ética").

### Incident «adjunt al registre equivocat» (2026-06-09 20:58)

Evidència (.history + ctime del disc): una pujada preparada amb les metadades
d'«El camí de tornada» (el target_name interpolat ho demostra) va PATCHar
«Un viaje inexperado» a les 20:58:46; l'usuari ho va netejar a les 21:03 i el
reintent (21:13–21:21) va deixar les entrades duplicades. Al codi actual TOTS
els camins fixen el destí per closure/argument (onInsert pinned, handleCellSave
per id, BlockEditor amb `key={tab.id}` des del 2026-05-18) — l'escriptura
creuada va passar amb una iteració de desenvolupament NO commitejada (la sessió
de l'altre Mac treballava sobre aquests fluxos exactes en aquell moment).

**Regla de blindatge:** el `InsertContentModal` de VaultTable porta
`key={mediaPickerCell?.rowId || 'closed'}` → reobrir el modal sobre una altra
fila REMUNTA la instància; una pujada llarga que sobreviu a tancar/reobrir
escriu a la fila ORIGINAL (closure vella, correcta), mai a la nova. No treure
aquesta key: sense ella, la instància persistent + qualsevol lectura de props
«actuals» (efecte, ref, refactor futur) reintrodueix la família de bugs de
registre creuat.

### Restriccions / Edge cases (fase 2)

- El valor `~/...` NO és una URL servible: els xips el mostren com a text
  (basename) i s'obre via `/open-resource`/`/open-local-path` (re-arrelen).
- `delete-physical-file` necessita branca pròpia per a `~/` (el catch-all
  `startswith("/")` no el cobreix) i re-root abans del check de contenció.
- Dins Docker `get_p("VAULT")` és `/vault` però el picker dona rutes del host:
  per detectar "dins el vault" cal provar també `VAULT_HOST_PATH`.

## Fase 3 (2026-06-10) — Materialització de Biblioteca (503 «warmup pending»)

Els PDFs de Biblioteca *online-only* (dataless) tornaven **503 permanent**:
`OneDriveProvider.materialize()` només sabia traduir paths sota `/vault`
(`relative_to(container_root)` → `VAULT_HOST_PATH/rel`); els de Biblioteca
(mount **identitat**: mateixa ruta host ↔ contenidor) llançaven `ValueError`
→ `return False` **silenciós a nivell DEBUG** → mai es cridava el daemon.
Era el pas (b) del TODO de `_THUMB_ROOTS_MAP`: el pas (a) — allowlist
multi-root al daemon — es va fer el 2026-05-18 i el comentari «el daemon la
rebutjaria com out_of_scope» havia quedat desfasat.

**Fix**: `identity_roots` al provider (env `BIBLIOTECA_HOST_PATH` +
`HOME_HOST_PATH`): un path fora de `/vault` però sota un mount identitat es
passa **tal qual** al daemon (la seva allowlist és l'autoritat). Mateixa
extensió a `_container_to_host_path` (thumbs). El log del path no traduïble
puja a WARNING (l'abort silenciós va costar setmanes de diagnòstic).

### Context que el diagnòstic va deixar clar

- **El pin «Always keep on this device» NO es conserva**: `fileproviderctl
  evaluate` mostrava `isKeepDownloaded=0` a la carpeta Biblioteca i a TOTS
  els ítems tot i que l'usuari l'havia activat (~22-05). La BD del File
  Provider (on viu el pin) es recrea gairebé a cada update setmanal
  d'OneDrive (database history: 05-23 ×3, 05-31 ×8, 06-06 ×3…). No fiar-se'n:
  amb aquest fix, Gnosi es re-materialitza a demanda encara que el pin caigui.
- Llegir un fitxer dataless DINS Docker no dispara la baixada (el bind mount
  VirtioFS no passa pel File Provider): errno 35. Només el daemon al host pot.
- El daemon corre via LoginItem (no pel LaunchAgent, que està
  `.disabled-by-loginitem`) amb stdout/stderr a /dev/null: cap observabilitat.

## Històric

- **2026-06-03 — Diagnòstic inicial**: l'usuari reporta enllaços trencats a la
  pàgina "Pla de futur i cures". Causa real a la Mac `ismaelgarcia`: el helper no
  corria (plist del repo amb usuari `ismaelgarciafernandez`). Causa latent a
  l'altra Mac: re-root limitat a Biblioteca. Es corregeixen totes dues.
- **2026-06-09/10 — Adjunts triplicats**: el registre "El camí de tornada" acaba
  amb 3 entrades (1 `file://` llegada + 2 rutes absolutes idèntiques de l'altre
  Mac) i una còpia física byte a byte; "Ética de Kant/Aristóteles" amb enllaços
  trencats per la divergència de noms (`cognom1` ignorat amb Authors string).
  Es fa la fase 2: escriptura portable, `~` contra HOME del host, dedup i fix
  de `cognom1`.
