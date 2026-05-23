# Directiva: Neteja de propietats locals de la taula Recursos

**Taula:** Recursos (`8c80f2a861b843b790da4f0e260b7db9`), carpeta
`BD/Cervell Digital/Recursos/` (~296 entrades `.md`).

## Context i RCA (per què hi ha "propietats locals")

A l'editor, una **propietat local** (`adhocProperties`,
`BlockEditor.jsx:2710`) és qualsevol clau del frontmatter que **no és a
l'esquema de la taula per nom**. L'anàlisi de les 296 entrades reals va
trobar 4 orígens, tots residu d'importacions/syncs antics:

1. **`fld_*`** (claus = id de camp). NO és dada atrapada: és el **format
   canònic** d'emmagatzematge. El backend migra **nom → id**
   (`field_resolver.migrate_metadata_keys`, cridat al `PUT /pages`) i en
   llegir afegeix el nom al costat de l'id (`expand_metadata_for_response`,
   `vault_routes.py:3379`). Per això la columna ja mostra el valor; la clau
   `fld_*` apareix com a "local" només perquè `adhocProperties` no exclou
   claus id. ~11 entrades.
2. **Claus UUID** (id de camp **originals de Notion**). SÍ és dada atrapada:
   ISBN, ISSN, Clau Zotero, Catàleg, Signatura, etc. que **no són a cap
   columna** (l'esquema no en guarda àlies). Esborrar-les = pèrdua de dades.
   13 claus distintes.
3. **`Abrir en Zotero`** — columna orfe de la importació Notion, gairebé
   sempre buida (~285 entrades). El sync actual usa `Zotero URI` (sí és
   columna).
4. **Minúscules heretades** `source` (orfe, "Zotero"), `estat` (id intern
   tipus `main_6`, redundant: `Estat` ja porta el label), `description`.

## Mecanisme d'escriptura (CRÍTIC)

- `PATCH /pages/{id}` **fusiona** (`metadata.update`) → **no pot esborrar
  claus**.
- `PUT /pages/{id}` reemplaça PERÒ torna a migrar **nom → `fld_`** → desfaria
  qualsevol conversió a nom.
- ⇒ L'**única** via per deixar el disc en format-nom net i esborrar claus és
  **editar els `.md` directament**, replicant el serializer del backend:
  `yaml.dump(meta, default_flow_style=False, sort_keys=False,
  allow_unicode=True)` dins `---\n{yaml}---\n\n{body}` (vegeu
  `save_page_md`). Cap clau objectiu és de sidecar (només `*_manual` i
  flags de template ho són), així que el sidecar no s'ha de tocar.

## Operacions (idempotents, només si canvia el fitxer)

Per cada `.md` de la carpeta Recursos, transformar el frontmatter
(preservant el body) així:

- **(A) fld_\*** → si `id ∈ id_to_name` del schema: si valor no buit i la
  columna-nom és absent/buida, copiar-hi el valor; **esborrar la clau
  `fld_*`**. (Claus `fld_*` desconegudes: deixar-les.)
- **(B) UUID clares** → moure a columna **si la columna és buida** i esborrar
  la clau. Mapping inequívoc:
  - `3616d9de…` → Clau Zotero
  - `e96ed1c3…` → Catàleg
  - `b6ff885a…` → ISBN
  - `c04fc09c…` → ISSN
  - `23c4990c…` → Títol curt
  - `06fd5ede…`, `4804e557…` → Signatura
  - `6243cdb9…` → Núm. pàgines
  - `b0c3c6dd…` → Pàgines
  - **Ambigües (DEIXAR intactes, no esborrar):** `e56f0b98…`,
    `82b2a9a5…`, `771a9223…`, `2dd1c2a0…`.
- **(C) `Abrir en Zotero`** → esborrar només si buit.
- **(D) `estat`** → esborrar si `Estat` ja té valor o si `estat` és
  buit/`main_*`. `source` → esborrar (orfe). `description` → esborrar només
  si buit.

## Restriccions / edge cases (apreses)

- **No esborrar mai una clau amb dada que no estigui també a una columna**
  (les UUID ambigües i `description` no buida es DEIXEN).
- **No sobreescriure** una columna que ja té valor (només omplir buides).
- **Backup obligatori** abans d'escriure, fora d'OneDrive:
  `${HOME}/.cache/gnosi/recursos_local_cleanup/<timestamp>/`.
- **Dry-run per defecte**; `--apply` per escriure.
- Després d'aplicar: `GET /api/vault/pages?force_refresh=true` per refrescar
  els caches del backend en marxa.
- Round-trip YAML: només reformata els fitxers que es modifiquen (igual que
  fa l'app en desar); els no modificats no es toquen.
