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

## Històric

- **2026-06-03 — Diagnòstic inicial**: l'usuari reporta enllaços trencats a la
  pàgina "Pla de futur i cures". Causa real a la Mac `ismaelgarcia`: el helper no
  corria (plist del repo amb usuari `ismaelgarciafernandez`). Causa latent a
  l'altra Mac: re-root limitat a Biblioteca. Es corregeixen totes dues.
