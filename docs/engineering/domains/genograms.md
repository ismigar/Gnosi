---
status: implemented
last_verified: 2026-09-08
source_paths:
  - backend/domains/genograms
  - frontend/src/features/genograms
  - frontend/src/shared/api/genograms.ts
  - backend/services/builtin_plugins.py
  - frontend/src/features/vault/views/VaultViewBody.tsx
  - frontend/src/features/vault/views/db-view-embed/useEmbedDerived.ts
tests:
  - backend/tests/test_genograms.py
  - backend/tests/test_genograms_api.py
  - frontend/src/features/genograms/genograms.test.tsx
  - frontend/src/features/genograms/export.test.ts
  - frontend/src/features/vault/view-config/page-view-modal/useViewAppearance.genogram.test.tsx
---

# Genograms

The optional `genograms` built-in plugin keeps one family network in each Vault.
Enable it in Settings → Plugins → Genograms, then select **Prepare tables**.
Preparation creates a Genograms database, People and Relationships tables, their
main table views, and an initial Genogram view. Names follow the selected interface
language (Catalan, English, Spanish or French). Repeating preparation reuses the
stable table and field identities and restores missing required fields.

Choose a reference person in the graphical view. Its default scope includes two
ancestor generations, one descendant generation, the reference person's siblings,
and immediate partners. Partner expansion does not traverse their entire family.
Explicit inclusions, exclusions and the table's normal filters further define the
visible network. Search highlights names without filtering the diagram. Hidden
connections are counted, and surviving relatives are never connected by invented
parentage links.

## Records and validation

People and relationships remain regular Markdown records with named YAML fields
and a note body. Field roles use stable IDs, so renaming tables or fields does not
break the adapter. Select values use the table's localized option names; the API
normalizes them to stable option codes. IDs are independent of names, which may
repeat. Sources link to other Vault records; people also support tags.

Partial dates retain their actual precision (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`),
with separate approximation flags. Unknown dates remain empty. Pregnancy records
can become people without changing identity. Multiple births share a group ID.
Union, directed parentage and emotional relationships have separate identities;
parentage may identify a particular union. Emotional absence means undocumented.
Dates are retained, but historical reconstruction is outside this version.

Canonical Markdown writes and trash operations share validation with visual
editing. A per-Vault filesystem lock and an in-process lock serialize network
validation and writes across local server workers. Existing page ETag protections
remain active. Self-relations, missing endpoints, duplicate relationships, invalid
union references and parentage cycles are rejected. Shared ancestors, partner
cycles and emotional cycles are supported. Empty relationship rows are drafts and
are reported until endpoints are completed. Date contradictions produce warnings.
Records referenced by relationships cannot be deleted until those links are
resolved; there is no relationship cascade.

Reads scan the two network folders rather than trusting an asynchronously updated
index. Invalid externally edited relationships produce issues and are excluded
from drawing; reads never repair files. Unreadable files block network mutations
until resolved, because validating against an incomplete network is unsafe.

## Views and rendering

A versioned `genogram` object on the existing view record holds the reference,
depths, explicit membership, labels, layers and manual coordinates. The same
renderer is used in table pages, panels and note embeds. Copying a saved view into
a note retains these options. Moving a symbol changes only that view. Record
changes are shared across all views; disabling the plugin retains tables and
configurations and shows the disabled-plugin state on graphical views.

Layout runs in a browser worker. Family parentage defines ranks; partners are
aligned only when doing so does not contradict ancestry. Partner groups and
multiple births are placed together, with birth dates and optional birth order
used to sort siblings. Every person is rendered once. Emotional links do not
influence positions. Manual coordinates override automatic positions until
**Reorganize**. Revision tokens and Vault-scoped cancellation reject obsolete
loads, worker replies and queued saves.

The drawing uses monochrome SVG with geometric symbols and distinct line patterns.
Its legend includes only conventions used in the visible diagram. The repertoire
is based on [GenoPro symbols](https://genopro.com/genogram/symbols/) and
[emotional relationships](https://genopro.com/genogram/emotional-relationships/),
with the neutral diamond/question-mark symbol and monochrome adaptations identified
in the legend. Complex overlapping branches can be adjusted manually.

## API and export

- `POST /api/vault/genograms/prepare`: editor-only, idempotent preparation.
- `POST /api/vault/genograms/graph`: resolves saved or inline options, normalizes
  records, validates the network and returns visible IDs, issues and field mappings.
- Record creation and editing use the regular Vault page APIs and ETags.

All exports use the visible SVG, including title, generation date and the enabled
legend. Full-name, initials or alias labels affect rendering only. Export strips
interactive attributes and selection highlights. SVG has embedded styles; PNG uses
a white background and 2× resolution, reduced proportionally for diagrams exceeding
32 megapixels or 16,000 pixels on a side. Nothing is cropped for that reduction.

PDF conversion uses locally loaded jsPDF and
[svg2pdf.js](https://github.com/yWorks/svg2pdf.js/) with embedded Liberation Sans
fonts, A4/A3, portrait/landscape and fit or tiled output. Font licensing is included
in the feature's assets folder. Conversion uses no external services or AI.

## Verification

The backend tests cover real disposable Vault preparation and page mutations,
cycle protection (including simultaneous changes), renamed fields, ETags,
pregnancy conversion, disabled-plugin preservation and invalid external files.
Frontend tests cover deterministic layout, shared ancestors, different-generation
partners, manual positions, perinatal symbols, export privacy and embedded settings.
The PDF test runs the real converters, verifies embedded fonts and a nine-page
mosaic, supplying only the text geometry missing from jsdom. Browser review in an
isolated Vault covers record editing without leaving the view, relationship-line
selection, manual dragging, emotional-layer stability and hiding/restoring people.
A deterministic fixture measures layout of 200 people and 500 relationships; its
1.5-second ceiling is a regression guard, not a promise for every device or an
end-to-end rendering benchmark. Large networks should be explored by focus and
branches; the graph endpoint does not silently truncate records.

GEDCOM, temporal reconstruction, structured clinical conditions and ecomaps remain
future extensions.
