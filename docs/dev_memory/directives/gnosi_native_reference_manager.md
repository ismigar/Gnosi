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
