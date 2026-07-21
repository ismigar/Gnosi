# Directiva: Gestor de referències natiu (independència de Zotero)

> ID: NATIVE-REFMANAGER-20260525
> Estat: VIU — implementació multi-fase (P0–P4).
> Relacionada: `zotero_integration.md` (sync deprecated), `autoria_field_type.md`.

---

## 1. Objectiu

Que Gnosi sigui un gestor de referències **autònom**, sense dependre de l'app
Zotero externa ni del seu sync. El sistema de cites/bibliografia (citeproc-js +
CSL + Recursos) ja funciona; el que falta és l'**alta i intercanvi** de
referències que abans entraven via sync Zotero. S'aprofita el codi open source
de Zotero on té sentit (translators, translation-server, schema), no es
reescriu el que ja és natiu.

### Estat de partida (2026-05-25)
- Sync Zotero ↔ Vault: **mort** (config buida, endpoints 410, scheduler no-op).
- Cites/bibliografia: **completes** (`cslEngine.js`, `_recursos_metadata_to_csl`,
  `BibliographyBlock`, `/format-*`, `/export` via pandoc).
- Lookup per identificador: **parcial** (`/lookup-metadata`: CrossRef/OpenLibrary/arXiv).
- Taula real "Recursos": 289 pàgines, `Citation Key` + `Authors` (tipus `autoria`) + `Any` + `Llibre/Revista` poblats. `Full Citation` existeix però buit i **no l'usa cap codi** (la referència completa es genera en viu).

## 2. Fases

| Fase | Descripció | Estat |
|---|---|---|
| **P0** | Generació automàtica de `Citation Key` (`cognom+any` + sufix col·lisió). `generate_citation_key` + injecció a `/lookup-metadata` + `POST /generate-citation-key`. | ✅ 2026-05-25 |
| **P3** | Lookup PMID/PubMed (NCBI E-utilities esummary) afegit a `/lookup-metadata` + camp PMID al modal. | ✅ 2026-05-25 |
| **P4** | Reconeixement de PDF: `POST /recognize-pdf` extreu text (pypdf) → DOI/arXiv → lookup. Botó al modal. | ✅ 2026-05-25 (cal rebuild backend per `pypdf`) |
| **P1** | Import/Export BibTeX i RIS: `backend/services/references_io.py` (pur) + `POST /import-references` + `GET /export-references` + `ReferenceImportExport.jsx` a la capçalera. | ✅ 2026-05-25 |
| **P2** | Captura web via Zotero **translation-server** (sidecar Docker, triat per l'usuari): servei a `docker-compose.yml` + `_zotero_item_to_recursos` + `POST /translate-url` (proxy a `/web`, gestiona 300 multiple) + branca URL del modal. Bookmarklet "Save to Gnosi" = follow-up. | ✅ 2026-05-25 (cal `docker compose up -d` del sidecar + rebuild backend) |

## 3. Camps canònics de Recursos (font de veritat per al CSL)

`recursosPageToCsl` (front) i `_recursos_metadata_to_csl` (back) llegeixen, **per
nom de columna**:
`Citation Key`, `Item Type`, `Authors` (autoria o string), `Any`, `Llibre/Revista`,
`Editorial`, `Lloc`, `Volum`, `Número`, `Pàgines`, `Edició`, `DOI`, `ISBN`,
`ISSN`, `URL`, `Idioma`, `Title`. Tota alta nova (lookup, import, PDF, web) ha
d'escriure en aquests noms.

## 4. Restriccions i casos de cantonada

- **Citation Key és obligatori per citar:** sense ell `recursosPageToCsl` torna
  `null`. Tota via d'alta ha de generar-lo si falta.
- **Col·lisions de clau:** `cognom2017`, `cognom2017a`, `cognom2017b`… La
  comprovació es fa contra `_cite_key_index` del vault actiu (claus ja existents).
- **Autors poden ser estructurats** (`[{nom,cognom1,cognom2}]`) **o string**.
  El cognom per a la clau surt del primer autor: `cognom1` (estructurat) o
  `family` del primer parse (string). Reaprofitar `_parse_authors_to_csl`.
- **Sense any:** usar `nd` (`cognomnd`).
- **L'any pot arribar com a float** (`2017.0`, p.ex. via JSON/pandas): no fer
  `int(str(year))` directament → `ValueError` → el fallback `_ck_norm` treu el
  punt i surt `murphy20170`. Usar `int(float(str(year)))` (i capturar també
  `OverflowError` per strings tipus `"inf"`); els no numèrics (`"c. 1850"`)
  segueixen caient al fallback `_ck_norm` com sempre.
- **Sense autor:** usar primera paraula significativa del títol; si res, `ref`.
- **Eliminar camp d'esquema NO neteja els .md** (només la UI; els valors queden
  com a propietats òrfenes). Netejar dades requereix migració idempotent + backup.
- **No afegir deps innecessàries:** BibTeX/RIS amb parser propi; només `pypdf`
  per a P4 (requereix rebuild del backend Docker).
- **HTTP extern:** seguir el patró del fitxer (`urllib.request` amb timeout, o
  `requests` ja importat). Mai bloquejar l'event loop: `asyncio.to_thread` per a
  E/S de xarxa/disc lenta.

## 5. Fitxers crítics

| Path | Rol |
|---|---|
| `backend/api/vault_routes.py` | `/lookup-metadata`, mappers, `_cite_key_index`, CSL, nou `/generate-citation-key`, import/export |
| `frontend/src/components/Vault/MetadataLookupModal.jsx` | UI d'alta per identificador |
| `frontend/src/components/Vault/cslEngine.js` | Mapeig Recursos→CSL (referència de noms) |

## 6. Cicle d'aprenentatge

| Data | Aprenentatge | Solució |
|---|---|---|
| 2026-05-25 | El sync Zotero ja era mort però el lookup no posava Citation Key → referències importades no citables. | P0: generació automàtica de clau a totes les vies d'alta. |
| 2026-06-10 | `generate_citation_key(..., 2017.0)` → `murphy20170`: `int("2017.0")` peta i el fallback `_ck_norm` esborra el punt. | Normalitzar amb `int(float(str(year)))` + capturar `OverflowError`; cobert per `test_year_as_string_or_float`. |
| 2026-07-20 | `Item Type` rebia valors de DOS espais: el catàleg select parla etiquetes catalanes ('Llibre') però tots els camins d'importació escrivien la clau Zotero ('book') → agrupar/filtrar separava els dos espais. | Normalització a la frontera d'escriptura: `csl_type_resolver.normalize_item_type(valor, catàleg)` — el catàleg de la taula és l'autoritat (PR #917, rebasat sobre el #914 que ja n'havia fet la meitat export en paral·lel). Vegeu §7. |

## 7. Espais de valor d'Item Type (normalització d'escriptura)

**Contracte:** al disc només hi viuen **etiquetes del catàleg** ('Llibre'), mai claus
Zotero ('book'). Tota via d'alta nova HA de passar per la normalització.

- **Resolució** (`backend/services/csl_type_resolver.py`):
  - `resolve_zotero_type(raw)` — clau|etiqueta (qualsevol locale)|àlies legacy → clau
    canònica. Mateixa precedència que `resolve_csl_type` (legacy primer: 'Article de
    revista' vol dir journalArticle, NO magazineArticle). Identitat via
    `ALL_ITEM_TYPES`, no `ZOTERO_TO_CSL_TYPE`: 'annotation' és clau vàlida sense CSL.
  - `normalize_item_type(valor, catàleg)` — clau → etiqueta del catàleg. Rànquing:
    etiqueta canònica del locale inferit del catàleg > canònica d'altre locale > àlies
    legacy (el catàleg real té 'Tesi' I 'Tesis': guanya 'Tesi'). Tipus absent del
    catàleg → etiqueta del locale inferit ('preprint'→'Prepublicació'); sense catàleg
    → en-US. Valors no-Zotero ('Ruta en bici') passen intactes. Idempotent.
- **Ganxos** (`vault_routes.py`): `_normalize_suggested_item_type` embolcalla els 5
  camins de `/lookup-metadata`, `/translate-url` i el fallback de `/recognize-pdf`
  (catàleg de la taula designada per `get_reference_table_id`); `/import-references`
  normalitza cada entrada amb el catàleg de la SEVA taula destí. El frontend no es
  toca: `MetadataLookupModal.resolveZoteroType` ja resol els dos espais per al badge
  i el gating de rellevància.
- **Export** BibTeX/RIS (`references_io.entry_to_bibtex/entry_to_ris`): resol els dos
  espais amb `resolve_zotero_item_type` (variant total del #914, ara delega a
  `resolve_zotero_type`) abans dels mapes de tipus — sense això, tot
  registre etiquetat exportava `@misc`/`GEN`. El **parse** segueix emetent claus
  canòniques (la frontera d'escriptura converteix).
- **Restriccions:**
  - No normalitzar dins dels helpers purs (`_pdf_fallback_to_recursos`, mappers):
    els tests els volen sense registre; fer-ho als endpoints.
  - `LEGACY_TYPE_TO_ZOTERO` i `LEGACY_TYPE_ALIASES` han de tenir les MATEIXES claus i
    ser CSL-coherents (invariant a `test_item_type_normalization.py`).
  - Tests: `backend/tests/test_item_type_normalization.py` (unitats) i
    `test_e2e_import_references_item_type.py` (E2E aïllat, `GNOSI_REFS_E2E=1` + vault
    a /tmp; cicle import→frontmatter→export).
  - **Migració de dades 2026-07-21 (unificació de duplicats):** feta amb els
    endpoints d'opcions (`/tables/{tid}/options/usage|remove|rename`; `remove` amb
    `reassign_to` reescriu files I treu l'opció del catàleg). 6 fusions + 3 typos,
    catàleg 34→28, 277 files conservades. Backup per-pàgina a
    `docs/dev_memory/backups/item_type_unify_20260721.json`. Gotcha: el `folder`
    del registre ('Recursos') és lògic — les pàgines viuen repartides entre
    `Biblioteca/` i `BD/Recursos/`.
  - `test_vault_trash.py` és contra el backend VIU (127.0.0.1:5002) i s'activa dins
    la suite per la fuita de dotenv (vegeu `environment_integrity`): els seus fallits
    en local NO són del diff; deixa residus 'pytest-trash-*' al vault real (netejats
    2026-07-20).
