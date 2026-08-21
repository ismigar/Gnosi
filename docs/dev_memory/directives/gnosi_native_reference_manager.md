# Native Reference Manager

> ID: `NATIVE-REFMANAGER-20260525`
> Status: active, phases P0–P4 implemented

## Objective

Make Gnosi an independent reference manager without requiring the Zotero
desktop application or live Zotero synchronization. Reuse open-source Zotero
translators and schemas where useful while keeping citations, bibliography,
storage, and user data native to Gnosi.

## Implemented phases

- P0: automatic collision-safe citation keys.
- P1: BibTeX and RIS import/export.
- P2: web capture through Zotero translation-server.
- P3: PMID/PubMed lookup.
- P4: PDF recognition through extracted DOI or arXiv identifiers.

Citation rendering and bibliography already use citeproc-js, CSL, and the
Resources table.

The Resources built-in plugin now owns selection and creation of the Resources
table. `/api/vault/reference-table` remains the single source of truth; the
former References setting is only a direct link to the plugin panel.

Federated literature import is another reference input path. It converts the
canonical academic-work contract through the same Zotero-to-Resources mapper,
item-type normalization, author normalization, and citation-key generator used
by identifier lookup. Import repeats deterministic DOI, PMID/PMCID, arXiv,
ISBN-13, and title/year/first-author matching inside one process lock. An
existing resource is returned instead of creating a second page.

## Canonical reference fields

CSL readers use stable persisted field identifiers such as Citation Key, Item
Type, Authors, Year, Container, Publisher, Place, Volume, Issue, Pages,
Edition, DOI, ISBN, ISSN, URL, Language, and Title.

These are compatibility identifiers in stored data. User-visible labels are
localized and default to English. New import paths must populate the canonical
fields expected by both frontend and backend CSL converters.

## Citation keys

Every citable reference requires a key.

- Base: first author's family name plus year.
- Collision suffixes: `a`, `b`, and so on.
- Missing year: `nd`.
- Missing author: first meaningful title word, then `ref`.
- Structured and legacy string authors are both supported.

Normalize numeric years through `int(float(str(year)))` and catch invalid or
infinite values. A float year such as `2017.0` must become `2017`, not `20170`.

## Item Type normalization

Persist catalog labels, not Zotero keys. Every write path calls
`csl_type_resolver.normalize_item_type(value, catalog)`.

Resolution accepts:

- Canonical Zotero keys.
- Canonical labels from supported locales.
- Legacy aliases.
- Non-Zotero custom values, which pass through unchanged.

The real table catalog is authoritative. When an item type is absent, use the
inferred catalog locale; without a catalog, default to English.

Normalize at endpoint write boundaries, not inside pure parsers. BibTeX and RIS
parsers may emit canonical Zotero keys; import converts them before storage.
Export resolves stored labels back to canonical types before mapping.

Keep legacy type maps internally consistent and covered by invariants.

## Restrictions

- Never create a reference without a citation key when enough data exists.
- Preserve ordered structured authors.
- External lookup and PDF work must not block the event loop.
- Avoid unnecessary dependencies; only PDF extraction needs `pypdf`.
- Removing a schema field does not clean persisted frontmatter; use an
  idempotent backed-up migration.
- Web capture may return multiple candidates and must ask the user to choose.
- User bibliographic data remains in its source language.
- Search preview never writes a page or downloads a file. Full-text attachment
  remains an explicit user action and requires a verified open-access location.
- Do not create a parallel Resources table configuration in literature search;
  always resolve `/api/vault/reference-table` at import time.

## Data migration record

The 2026-07-21 Item Type cleanup merged duplicate catalog values and corrected
typos through option-management endpoints, preserving all rows. The backup is
stored under `docs/dev_memory/backups/`.

Logical table folders do not prove physical page location; Resources pages can
be distributed across library and database directories.

## QA

1. Unit tests cover item-type resolution across locales and legacy aliases.
2. Citation-key tests cover collisions, missing data, structured authors, and
   float years.
3. Isolated E2E imports references into a temporary vault, inspects
   frontmatter, then exports BibTeX and RIS.
4. PDF and web lookup use disposable records.
5. Browser QA verifies lookup, recognition, import/export, and citations.
