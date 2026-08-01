# Directive: LLM Wiki — Gnosi Brain

**Status:** F0–F8 implemented. F8 supersedes earlier conflicting decisions.
**Origin:** 2026-07-14. The design adapts Andrej Karpathy's
[LLM-maintained wiki proposal](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
to Gnosi.

## 1. Purpose

The Brain compiles immutable source material into a persistent, incrementally maintained
knowledge wiki. It does not re-derive all knowledge from raw sources for every question.

The core operations are:

- **Ingest:** process a source and update its reading notes, indexes, provenance, and log.
- **Query:** answer from the Brain before opening original sources for evidence verification.
- **Lint:** detect bookkeeping drift, broken citations, stale sources, duplicates, and orphans.

## 2. Gnosi mapping

| Karpathy concept | Gnosi implementation |
| --- | --- |
| Immutable raw sources | Configured source tables |
| Wiki pages | Rows in the per-vault **Brain** table |
| Wikilinks and cross-references | Native wikilinks and relation properties |
| Index | Managed index rows and database views |
| Log | Append-only **Brain log** row |
| Editable schema | Managed **Brain schema** row |
| Ingest | Per-resource **Process** action |
| Query | The managed Brain agent's `query_wiki` tool |
| Lint | Scheduled deterministic maintenance and manual audit |

## 3. Persistent configuration

The configuration lives at `<vault>/.gnosi/llm_wiki.json`, is version 2, and is
synchronized with the vault. It contains `brain_table_id`, `brain_roles`,
`index_field_ids`, `source_tables[]`, and `ui_locale`.

The default generated-content language is **English**. New table names, properties,
relations, system rows, and the managed agent therefore use English by default:
**Brain**, **Note type**, **Source**, **Position**, **General index**, **Brain schema**,
and **Brain log**. Interface copy remains localized through i18n.
Existing configured vaults retain their saved locale and are never renamed automatically.

Each source table stores property IDs for its title, attachments, URLs, language, the
Brain relation, and categorical-field mappings. The backend validates tables, field types,
relation targets, reserved fields, permissions, and allowed categorical values atomically.

A v1 `target_table` migrates to `brain_table_id`. The global References table is adopted
as the first source, without changing its global configuration. The migrated source may
fall back to the row body; newly configured sources require an attachment or URL.

Canonical API endpoints:

- `GET/PUT /api/vault/llm-wiki/config`
- `POST /api/vault/llm-wiki/brain/create`
- `POST /api/vault/llm-wiki/process`
- `GET /api/vault/llm-wiki/status/{job_or_resource}`
- `GET /api/vault/llm-wiki/evidence/{resource}/{snapshot}/{segment}`
- `POST /api/vault/llm-wiki/maintenance?semantic=false|true`

Legacy Brain-designation endpoints remain compatibility adapters.

## 4. Brain schema and Zettelkasten contract

Creating or designating a Brain adds compatible missing fields without retargeting or
deleting existing properties:

- native title field;
- **Note type**: reading, index, permanent, system;
- **Idea type**: entity, concept, summary, synthesis;
- one many-to-one source relation for every configured source table;
- **Position**: one-based idea order within that source;
- **Based on**: self-relation for manual permanent-note work;
- **Verification status** and **Last reviewed**;
- **Areas** and **Tags**.

Code uses persistent IDs and semantic roles, never visible field names. Compatible existing
fields are reused. A relation always targets exactly one table; it is never retargeted.
Each reading note and resource index links to exactly one source row through the canonical
singular source relation. A permanent note has no source relation. Legacy plural source
properties are merged into the singular relation and removed.

The ethical contract is that automation performs mechanical work while the user retains
cognitive authorship:

| Layer | Author | Contract |
| --- | --- | --- |
| Sources | User | Chooses what enters the Brain |
| Reading notes | Plugin | One atomic idea per note, linked to exactly one source, in source order |
| Permanent notes | User only | The plugin never creates or accepts permanent-note drafts |

Generated and managed pages keep their operational state in synchronized sidecars at
`<vault>/.gnosi/llm_wiki/pages/<page-id>.json`. The Markdown frontmatter contains only
portable schema properties plus structural `id` and `table_id`; it never stores
`llm_wiki_*` or the technical `note_type` marker. The visible schema **Note type** property
is the portable classification used outside Gnosi.

Legacy managed pages are migrated idempotently. The sidecar is written before the Markdown
is cleaned, readers temporarily fall back to legacy frontmatter when no sidecar exists,
and manual body content is never rewritten except through the normal page serializer.

The inbox exposes evidence-backed connections, support, contradictions, and gaps. It can
open notes or dismiss a proposal; it cannot create permanent notes. Semantic proposals run
only through explicit manual maintenance or the dedicated, user-enabled
`suggest_connections` scheduler. Daily deterministic maintenance and the general memory
refresh never invoke a model, so enabling those tasks cannot create unexpected model costs.

## 5. Ingestion and provenance

The `Process` action is visible only when the LLM Wiki plugin is enabled, the current
table is configured as a source, and the row contains a mapped attachment or URL. It is
available both from a source-table row and from that record's page-action menu, with the
same eligibility and process/reprocess state. Persistent
jobs expose **Process**, **In progress**, **Processed**, **Partial/Error**, and
**Reprocess**. The historical `Processat pel Cervell` field remains for compatibility but
does not control visibility.

Extractors yield ordered origins and segments with stable IDs, text, origin, and structured
locators:

- textual PDF by page and paragraph, using OCR only on text-poor pages;
- DOCX, EPUB, HTML, TXT, and Markdown by section, paragraph, or line;
- images through Tesseract;
- audio through faster-whisper, preserving start and end times;
- video through audio transcription and periodic key-frame OCR;
- public URLs for articles, direct documents/media, podcast enclosures, and supported
  yt-dlp streams.

Attachments are processed in field order, followed by URLs. Equal normalized content is
deduplicated by hash while all source aliases remain recorded. Downloads enforce SSRF
protection, validated redirects, and bounded temporary files. Authenticated URLs, paywalls,
DRM, and private content are intentionally unsupported.

Files are materialized through the existing FilesProvider before reading in both native and
Docker deployments. Temporary data, models, and jobs live under `GNOSI_LOCAL_DATA`;
immutable normalized text and transcripts live in the synchronized vault manifest. Binaries
and video files are not copied.

There is no 24,000-character limit. Ingestion uses ordered map/reduce chunks, source hashes,
a persistent manifest, checkpoints, and stable managed keys. All origins are analyzed before
publication starts. Interrupted writes resume idempotently; obsolete notes are marked stale,
never deleted.

Every reading note has one idea, a position, source relation, propagated or inferred
categories, and one or more citations whose text is validated against a segment.

## 6. Evidence and citations

Citation metadata records snapshot, segment, origin, and a structured locator: page and
paragraph, chapter, line range, region, or time. Clicking a citation opens the source at
the available position and displays the exact highlighted evidence. Audio and video jump to
the timestamp; web evidence displays the immutable captured passage and links to the
original URL.

The PDF path is implemented end-to-end. A rendered citation contains
`gnosi-cite:?res=<id>&page=N`; frontend citation handling materializes the source
attachment and opens the vendored Zotero reader with `pageNumber`. The reader receives
both initial location and later navigation messages.

## 7. Managed indexes, search, and maintenance

Only rows with an LLM Wiki role are managed. Managed blocks are delimited, so manual text
outside them is preserved. Existing manual MOCs are never adopted by title alone.

The system maintains:

- a flat resource index with reading notes in appearance order; the source relation stores
  the resource and citations retain attachment/URL provenance;
- a direct category index for each selected field value, grouped by resource, with manual
  permanent notes in a separate section;
- **General index**, **Brain schema**, and append-only **Brain log**;
- a local, rebuildable lexical/vector search cache restricted to the Brain.

`query_wiki` searches indexes first and then the hybrid cache, returning provenance and
citations. It opens raw sources only to verify evidence.

Daily maintenance is deterministic and makes no LLM calls. It rebuilds indexes and cache,
then audits stale sources, broken citations, duplicates, orphans, stale managed notes, and
index drift. Semantic auditing is manual.

## 8. Managed agent lifecycle

Enabling the built-in `llm-wiki` plugin creates the managed **Brain** agent profile with
reserved ID `llm-wiki` and marker `managed_by: llm-wiki`. It seeds model and provider
from a configured active agent when possible, but never invents a model. The user may edit
its normal profile fields and instructions.

A managed profile cannot be deleted or unmarked through a generic Settings save while the
plugin is enabled. Disabling the plugin is the only removal path, it requires confirmation,
and it removes only the managed agent. It preserves the Brain table, notes, sources,
configuration, manifests, indexes, and suggestions. Reactivation is idempotent and does not
overwrite user-edited instructions.

## 9. Constraints and learned safeguards

- Do not use the legacy processed-date property to discover sources. Use
  `source_tables[]`, manifests, and jobs.
- Do not keep a parallel plural source relation. Merge its values into the
  canonical singular relation and remove the duplicate property.
- Embedded Brain views on source pages must use the contextual
  `<source relation> = this` filter. Do not persist a URL or UID for one
  particular row because copied resource pages would show the wrong notes.
- Resolve generated source labels from the configured title property before
  generic metadata or the path stem. A UUID filename is only a last-resort
  fallback when the row genuinely has no title.
- Do not hide Process or Reprocess for a configured source row merely because
  the frontend cannot resolve its attachment/URL field. Stale schemas and
  interrupted jobs can make that client-side check incomplete; expose the
  action and let the backend inspect the durable row data.
- Closing an in-progress Process modal must not abandon its durable job. Keep
  polling it from the dashboard and show a localized terminal notification;
  this in-session notification does not persist after the whole application is
  closed.
- Generated Markdown wikilinks use `[[stable-id|visible title]]`. Do not write
  `[[title|id]]`: the editor treats the text after `|` as the visible alias and
  would expose internal UUIDs in managed indexes and logs.
- Source-mapped relation values may arrive as bare UUIDs after frontmatter
  normalization. Canonicalize relation mappings by target row ID as well as by
  title and serialized relation value, or configured fields will be dropped.
- Explicit source mappings override any persisted or model-generated dimension
  values. The source relation property is the canonical provenance link; do not
  duplicate it in reading-note citations or as a resource line in the managed
  resource index.
- Do not render attachment names, URL labels, or other source headings in a
  managed resource index. The canonical source is already visible in the
  relation property, while citations preserve origin-level provenance.
- Keep a blank line between managed HTML markers and their Markdown content.
  Without that boundary, BlockNote parses ordered index entries as one
  paragraph and visually collapses the source-order line breaks.
- Deterministic index maintenance re-synchronizes source-mapped fields into
  existing managed reading notes and clears target values when the source value
  is empty. Configuration repairs must not require another LLM ingest.
- Do not cast legacy position values directly to integers while rebuilding
  indexes. Manual or imported notes may contain ranges such as `254-255`; use
  their numeric prefix as a stable sort key and let nonnumeric values sort as
  zero instead of aborting maintenance.
- Keep deterministic `note_type` and `llm_wiki_*` state only in synchronized
  `.gnosi/llm_wiki/pages/` sidecars. Write the sidecar before removing legacy
  fields from Markdown, overlay it on every Brain read path, and retain a
  frontmatter fallback until existing vaults have migrated.
- Do not use `tempfile` without an explicit `llm_wiki/tmp` directory under
  `GNOSI_LOCAL_DATA`.
- Do not create unconstrained categorical values. Canonicalize them against existing
  options or related rows.
- Do not resume a plan when any origin hash changes; citations could point to another
  source version.
- Do not run semantic proposals on every ingest or scheduled maintenance.
- Treat `.gnosi/llm_wiki_suggestions.json` as the canonical proposal queue. The
  `suggest_connections` scheduler, Brain inbox, and global graph must all use this queue;
  do not revive a parallel generated graph under `BD/` as a second suggestion source.
- Mirror the canonical queue to `<vault>/suggestions.json` for graph portability, add that
  layer during `/api/graph` construction, and invalidate the graph response cache whenever
  the mirror changes. The frontend must not merge a second no-op suggestions endpoint.
- A dedicated `suggest_connections` scheduler is an explicit opt-in to model use. Keep it
  disabled by default, make failures fail the scheduler execution, and never let
  `update_memories` call it implicitly.
- Scheduler task functions may return structured failures. Do not mark a task successful
  merely because it returned normally; propagate `success: false` or an `error` value to
  task state, history, and notifications.
- Do not treat the `(llm, provider, model)` result of `_get_hybrid_llm()` as a model.
  Unpack it before calling model methods.
- Docker CI must provide a unique job-only `GNOSI_JWT_SECRET` to both Compose validation
  and the smoke container.
- Native backend code reloads automatically. Python dependency changes require
  `launchctl kickstart -k gui/$UID/com.gnosi.backend-native`.
- OneDrive files can be dataless. Always materialize attachments through the existing
  provider/warmup path before extraction.
- On the current native Mac, FFmpeg, faster-whisper, yt-dlp, Tesseract, and the official
  `cat`, `spa`, `eng`, and `fra` tessdata models are installed. The capability report
  must show no missing OCR languages. Re-check after a Homebrew Tesseract update because
  the versioned tessdata directory may change.
